import type { EndpointSpec } from '@coal/shared';
import type { z } from 'zod';
import type { AppDeps } from '../deps';
import type { Actor, RequestContext } from './context';
import { guard, type HandlerArgs, type Implementation } from './endpoint';
import { AppError } from './errors';

/** Endpoints run from code, not over HTTP: a handler that needs the request or the reply can't be called this way. */
const NO_HTTP = new Proxy({} as HandlerArgs<EndpointSpec>['http'], {
  get() {
    throw new Error('An endpoint run from code has no HTTP request.');
  },
});

function parseInput(schema: z.ZodType | undefined, value: unknown, path: string): unknown {
  if (!schema) return undefined;
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new AppError(400, 'VALIDATION_FAILED', 'Some of the values sent are not valid.', {
    errors: result.error.issues.map((i) => ({
      path: [path, ...i.path.map(String)].filter(Boolean).join('.'),
      message: i.message,
    })),
  });
}

export interface EndpointCall {
  params?: unknown;
  query?: unknown;
  body?: unknown;
  ifMatch?: string | undefined;
}

/**
 * Calls an endpoint as the context's person, through the same checks as a request: the input is
 * validated, then the session, the AI tier and the permission, then the handler. The AI's tools
 * and the action cards both use it, so what they can do is exactly what the endpoint allows.
 * `at` prefixes the paths of validation errors, such as `actions.0`.
 */
export async function callEndpoint(
  impl: Implementation,
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  call: EndpointCall,
  at = '',
): Promise<{ output: unknown; input: { params: unknown; query: unknown; body: unknown } }> {
  const { endpoint } = impl;
  const input = {
    params: parseInput(endpoint.params, call.params ?? {}, at && `${at}.params`),
    query: parseInput(endpoint.query, call.query ?? {}, at && `${at}.query`),
    body: parseInput(endpoint.body, call.body, at && `${at}.body`),
  };
  guard(endpoint, ctx, input.body);
  const output = await impl.handler({
    ctx,
    actor,
    ...input,
    ifMatch: call.ifMatch,
    deps,
    http: NO_HTTP,
  } as HandlerArgs<typeof endpoint>);
  return { output, input };
}
