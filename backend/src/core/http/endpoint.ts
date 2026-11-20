import {
  API_BASE_PATH,
  ENDPOINTS,
  toColonPath,
  type EndpointBody,
  type EndpointOutput,
  type EndpointParams,
  type EndpointQuery,
  type EndpointSpec,
  type Preview,
} from '@coal/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { assertCanUse } from '../../modules/permissions';
import type { AppDeps } from '../deps';
import { AppError, validationFailed } from './errors';
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

/** How an action card puts what an action did into plain words (docs/workstation-and-ai.md#action-cards). */
export interface ActionDescription {
  summary: string;
  effects: Preview;
  notified: { id: string; name: string }[];
}

export interface Implementation<E extends EndpointSpec = EndpointSpec> {
  endpoint: E;
  handler: (args: HandlerArgs<E>) => Promise<EndpointOutput<E>>;
  rateLimit?: (deps: AppDeps) => { max: number; timeWindow: string };
  /**
   * Set on the endpoints that can be proposed on an action card: describes what the action did,
   * from its result. Only `auto` and `confirm` endpoints may have one.
   */
  describe?: (
    output: EndpointOutput<E>,
    input: { params: EndpointParams<E>; query: EndpointQuery<E>; body: EndpointBody<E> },
    /** The same connection the action ran on, so a card may look up what it needs to show. */
    deps: AppDeps,
  ) => ActionDescription | Promise<ActionDescription>;
}

export function implement<E extends EndpointSpec>(
  endpoint: E,
  handler: Implementation<E>['handler'],
  options: Pick<Implementation<E>, 'rateLimit' | 'describe'> = {},
): Implementation<E> {
  return { endpoint, handler, ...options };
}

/** An empty preview, for actions that open no steps and make no tasks. */
export const noEffects = (warnings: string[] = []): Preview => ({
  steps: [],
  tasks: [],
  cancelledTasks: 0,
  team: [],
  warnings,
});

const registered = new Map<string, Implementation>();

/** The implementation of an endpoint, once the app has registered them: proposals and the AI's tools run endpoints through it. */
export function implementationOf(endpointId: string): Implementation | undefined {
  return registered.get(endpointId);
}

/** The endpoints that can be put on an action card. */
export function proposableImplementations(): Implementation[] {
  return [...registered.values()].filter((i) => i.describe);
}

/** The `auto` endpoints that stay open in a chat with outside text: they only prepare cards. */
const OUTSIDE_TEXT_ALLOWED = ['proposals.create', 'proposals.update'];

/**
 * The AI tiers, enforced by the server (docs/workstation-and-ai.md#what-the-ai-may-do).
 * `auto` endpoints confine the AI to the user's own things through their resource rules.
 */
export function assertAiTier(endpoint: EndpointSpec, ctx: RequestContext): void {
  if (!ctx.viaAi) return;
  switch (endpoint.aiTier) {
    case 'read':
      return;
    case 'auto':
      // A file from outside is in the chat: it may hold hidden instructions, so nothing is saved
      // on its say-so. Action cards are the way through, because a person confirms each one.
      if (ctx.aiChat?.outsideText && !OUTSIDE_TEXT_ALLOWED.includes(endpoint.id)) {
        throw new AppError(
          403,
          'AI_NOT_ALLOWED',
          'This chat holds a file from outside the company’s records, so the assistant can only prepare action cards for you to confirm.',
        );
      }
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

/**
 * `?preview=true` means "change nothing". An endpoint that can't preview must refuse it, not
 * ignore it, or a caller that adds it to every action would make real changes.
 */
export function rejectStrayPreview(endpoint: EndpointSpec, query: unknown): void {
  if (endpoint.method === 'GET') return;
  if (!query || typeof query !== 'object' || !('preview' in query)) return;
  if (endpoint.query && 'preview' in endpoint.query.shape) return;
  throw validationFailed('This action has no preview.', 'preview');
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
  const proposable = implementations.filter(
    (i) => i.describe && !['auto', 'confirm'].includes(i.endpoint.aiTier),
  );
  if (proposable.length > 0) {
    throw new Error(
      `Only auto and confirm endpoints can be proposed: ${proposable.map((i) => i.endpoint.id).join(', ')}`,
    );
  }
  for (const [id, impl] of byId) registered.set(id, impl);

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
      preValidation: async (request) => {
        guard(endpoint, request.ctx);
        rejectStrayPreview(endpoint, request.query);
      },
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
        // A handler that streams its own reply has taken the connection over.
        if (reply.sent) return reply;
        reply.code(status);
        return status === 204 ? reply.send() : result;
      },
    });
  }
}
