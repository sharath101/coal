import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { API_BASE_PATH } from '@coal/shared';
import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { sql } from 'drizzle-orm';
import type { AppDeps } from './core/deps';
import { registerEndpoints } from './core/http/endpoint';
import { registerIdempotency } from './core/http/idempotency';
import { annotateOpenApi } from './core/http/openapi';
import { registerProblemHandlers } from './core/http/problems';
import { registerSessionHook } from './modules/auth/hook';
import { IMPLEMENTATIONS } from './modules';

export function loggerOptions(level: string): FastifyServerOptions['logger'] {
  return {
    level,
    // Logs never carry session tokens, document content, prompts or AI results.
    redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
  };
}

export async function buildApp(
  deps: AppDeps,
  options: { logger?: FastifyServerOptions['logger'] } = {},
) {
  const app = Fastify({
    logger: options.logger ?? false,
    genReqId: () => randomUUID(),
    // So request.ip, which the rate limits key on, is the person's address, not the proxy's.
    trustProxy: deps.config.trustProxy,
    bodyLimit: 1024 * 1024,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerProblemHandlers(app);

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'COAL API',
        version: '1',
        description: 'Generated from the zod schemas in shared/. See docs/api.md for the map.',
      },
      servers: [{ url: '/' }],
    },
    transform: jsonSchemaTransform,
  });
  if (deps.config.env !== 'production') {
    await app.register(swaggerUi, { routePrefix: `${API_BASE_PATH}/docs` });
  }

  registerSessionHook(app, deps);
  registerIdempotency(app, deps.db);

  app.get('/health', { schema: { hide: true } }, async () => {
    await deps.db.execute(sql`select 1`);
    return { ok: true };
  });
  app.get(`${API_BASE_PATH}/openapi.json`, { schema: { hide: true } }, async () =>
    annotateOpenApi(app.swagger()),
  );

  registerEndpoints(app, IMPLEMENTATIONS, deps);
  await app.ready();
  return app;
}
