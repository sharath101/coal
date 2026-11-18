import type { z } from 'zod';

/**
 * What the AI may do with an endpoint (docs/workstation-and-ai.md#what-the-ai-may-do).
 * `none` is the "—" tier: not available as an AI tool at all.
 */
export const AI_TIERS = ['read', 'auto', 'confirm', 'never', 'none'] as const;
export type AiTier = (typeof AI_TIERS)[number];

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface EndpointSpec {
  /** Unique id, also the OpenAPI operationId. */
  id: string;
  method: HttpMethod;
  /** Path under /api/v1, with OpenAPI-style parameters: `/users/{id}`. */
  path: string;
  summary: string;
  /** `public` endpoints work without a session (sign-up, sign-in and the sign-up form's lists). */
  auth: 'session' | 'public';
  /** The permission the backend checks. Every permission has a rule and a test table entry. */
  permission: string;
  aiTier: AiTier;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  /** Omitted for 204 responses. */
  response?: z.ZodType;
  status?: 200 | 201 | 204;
}

export function defineEndpoint<const E extends EndpointSpec>(spec: E): E {
  return spec;
}

type ParamsInput<E> = E extends { params: infer P extends z.ZodType }
  ? { params: z.input<P> }
  : { params?: never };
type QueryInput<E> = E extends { query: infer Q extends z.ZodType }
  ? { query?: z.input<Q> }
  : { query?: never };
type BodyInput<E> = E extends { body: infer B extends z.ZodType }
  ? { body: z.input<B> }
  : { body?: never };

export type EndpointInput<E extends EndpointSpec> = ParamsInput<E> &
  QueryInput<E> &
  BodyInput<E> & {
    idempotencyKey?: string;
    ifMatch?: string;
  };

export type EndpointOutput<E extends EndpointSpec> = E extends {
  response: infer R extends z.ZodType;
}
  ? z.output<R>
  : void;

export type EndpointBody<E extends EndpointSpec> = E extends { body: infer B extends z.ZodType }
  ? z.output<B>
  : undefined;
export type EndpointParams<E extends EndpointSpec> = E extends {
  params: infer P extends z.ZodType;
}
  ? z.output<P>
  : undefined;
export type EndpointQuery<E extends EndpointSpec> = E extends {
  query: infer Q extends z.ZodType;
}
  ? z.output<Q>
  : undefined;

export const API_BASE_PATH = '/api/v1';

/** The parameter names in a path such as `/users/{id}`. */
export function pathParamNames(path: string): string[] {
  return [...path.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map((m) => m[1] as string);
}

/** `/users/{id}` → `/users/:id`, for routers that use colon parameters. */
export function toColonPath(path: string): string {
  return path.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, ':$1');
}

export type PathValue = string | number | null | undefined;

export function fillPath(path: string, params: Record<string, PathValue> | undefined): string {
  return path.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, name: string) => {
    const value = params?.[name];
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing path parameter "${name}" for ${path}`);
    }
    return encodeURIComponent(String(value));
  });
}
