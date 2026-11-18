/** Who is making a request. Everything else in the backend uses only this (docs/roles-and-access.md). */
export interface Actor {
  userId: string;
  name: string;
  roleKey: string;
  productLineId: string | null;
}

export interface RequestContext {
  orgId: string;
  requestId: string;
  actor: Actor | null;
  sessionId: string | null;
  /** Set by the backend when the AI calls an endpoint on the user's behalf; never by a client. */
  viaAi: boolean;
}

export function systemContext(orgId: string, requestId = 'system'): RequestContext {
  return { orgId, requestId, actor: null, sessionId: null, viaAi: false };
}

declare module 'fastify' {
  interface FastifyRequest {
    ctx: RequestContext;
  }
}
