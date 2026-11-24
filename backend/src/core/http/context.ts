/** Who is making a request. Everything else in the backend uses only this (docs/roles-and-access.md). */
export interface Actor {
  userId: string;
  name: string;
  /** What they may do: the role of their position. */
  roleKey: string;
  /** Their box on the org chart (docs/roles-and-access.md#the-org-chart). */
  positionKey: string;
  productLineId: string | null;
  /**
   * The admin behind this session, when the demo's switching is on: the admin themself, or the
   * admin who switched to this person. Empty otherwise, so only an admin's sessions can switch.
   */
  switcherId: string | null;
}

export interface RequestContext {
  orgId: string;
  requestId: string;
  actor: Actor | null;
  sessionId: string | null;
  /** Set by the backend when the AI calls an endpoint on the user's behalf; never by a client. */
  viaAi: boolean;
  /** Set while the user's confirmed proposal (an action card) is being carried out. */
  proposal?: { id: string; chatId: string | null; preparedByAi: boolean };
  /** Set while the AI answers a message: the chat and the model request its tool calls belong to. */
  aiChat?: {
    chatId: string;
    requestId: string;
    outsideText?: boolean;
    /** What a draft may rest on: what the person said, and what the tools returned in this reply. */
    grounding?: { said: string; read: () => string };
  };
}

export function systemContext(orgId: string, requestId = 'system'): RequestContext {
  return { orgId, requestId, actor: null, sessionId: null, viaAi: false };
}

declare module 'fastify' {
  interface FastifyRequest {
    ctx: RequestContext;
  }
}
