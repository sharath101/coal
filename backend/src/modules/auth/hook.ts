import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../core/deps';
import { readSessionToken, resolveSession } from './service';

/** Builds each request's context from its session, before any route runs. */
export function registerSessionHook(app: FastifyInstance, deps: AppDeps): void {
  app.decorateRequest('ctx', null as never);
  app.addHook('onRequest', async (request) => {
    request.ctx = {
      orgId: deps.config.orgId,
      requestId: request.id,
      actor: null,
      sessionId: null,
      viaAi: false,
    };
    const token = readSessionToken(request);
    if (!token) return;
    const session = await resolveSession(deps.db, deps.config.orgId, token);
    if (session) {
      request.ctx.actor = session.actor;
      request.ctx.sessionId = session.sessionId;
    }
  });
}
