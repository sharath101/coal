import {
  API_BASE_PATH,
  ENDPOINTS,
  toColonPath,
  type EndpointBody,
  type EndpointOutput,
  type EndpointParams,
  type EndpointQuery,
  type EndpointSpec,
} from '@coal/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { assertCanUse } from '../../modules/permissions';
import type { AppDeps } from '../deps';
import { AppError } from './errors';
import type { Actor, RequestContext } from './context';

export interface HandlerArgs<E extends EndpointSpec> {
  ctx: RequestContext;
  actor: E extends { auth: 'session' } ? Actor : Actor | null;
  params: EndpointParams<E>;
  query: EndpointQuery<E>;
  body: EndpointBody<E>;
  ifMatch: string | undefined;
  deps: AppDeps;
  http: { request: FastifyRequest; reply: FastifyReply };
}

export interface Implementation<E extends EndpointSpec = EndpointSpec> {
  endpoint: E;
  handler: (args: HandlerArgs<E>) => Promise<EndpointOutput<E>>;
  rateLimit?: (deps: AppDeps) => { max: number; timeWindow: string };
}

export function implement<E extends EndpointSpec>(
  endpoint: E,
  handler: Implementation<E>['handler'],
  options: Pick<Implementation<E>, 'rateLimit'> = {},
): Implementation<E> {
  return { endpoint, handler, ...options };
}

/**
 * The AI tiers, enforced by the server (docs/workstation-and-ai.md#what-the-ai-may-do).
 * `auto` endpoints confine the AI to the user's own things through their resource rules.
 */
export function assertAiTier(endpoint: EndpointSpec, ctx: RequestContext): void {
  if (!ctx.viaAi) return;
  switch (endpoint.aiTier) {
    case 'read':
    case 'auto':
      return;
    case 'confirm':
      throw new AppError(
        403,
        'AI_NOT_ALLOWED',
        'The AI can only propose this. You confirm it on an action card.',
      );
    case 'never':
    case 'none':
      throw new AppError(403, 'AI_NOT_ALLOWED', 'The AI may not do this.');
  }
}

/** The checks every endpoint runs before its handler, in this order. */
export function guard(endpoint: EndpointSpec, ctx: RequestContext): void {
  if (endpoint.auth === 'session' && !ctx.actor) {
    throw new AppError(401, 'NOT_SIGNED_IN', 'Sign in first.');
  }
  assertAiTier(endpoint, ctx);
  assertCanUse(endpoint.permission as Parameters<typeof assertCanUse>[0], ctx.actor);
}

/** Registers the implementations, refusing to start if any endpoint has none. */
export function registerEndpoints(
  app: FastifyInstance,
  implementations: Implementation[],
  deps: AppDeps,
): void {
  const byId = new Map(implementations.map((i) => [i.endpoint.id, i]));
  const missing = ENDPOINTS.filter((e) => !byId.has(e.id)).map((e) => e.id);
  if (missing.length > 0)
    throw new Error(`Endpoints without an implementation: ${missing.join(', ')}`);

  for (const impl of implementations) {
    const { endpoint } = impl;
    const status = endpoint.status ?? 200;
    app.withTypeProvider<ZodTypeProvider>().route({
      method: endpoint.method,
      url: API_BASE_PATH + toColonPath(endpoint.path),
      schema: {
        operationId: endpoint.id,
        summary: endpoint.summary,
        tags: [endpoint.id.split('.')[0] as string],
        ...(endpoint.params && { params: endpoint.params }),
        ...(endpoint.query && { querystring: endpoint.query }),
        ...(endpoint.body && { body: endpoint.body }),
        ...(endpoint.response && { response: { [status]: endpoint.response } }),
      },
      config: impl.rateLimit ? { rateLimit: impl.rateLimit(deps) } : {},
      // Before validation, so callers who may not use the endpoint learn nothing about its input.
      preValidation: async (request) => guard(endpoint, request.ctx),
      handler: async (request, reply) => {
        const ctx = request.ctx;
        const result = await impl.handler({
          ctx,
          actor: ctx.actor,
          params: request.params as never,
          query: request.query as never,
          body: request.body as never,
          ifMatch: request.headers['if-match'],
          deps,
          http: { request, reply },
        });
        reply.code(status);
        return status === 204 ? reply.send() : result;
      },
    });
  }
}
