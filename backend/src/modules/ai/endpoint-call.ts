import { API_BASE_PATH, ENDPOINTS, type EndpointSpec } from '@coal/shared';
import type { FastifyRequest } from 'fastify';
import { VIA_AI_HEADER, VIA_AI_SECRET } from '../../core/http/internal';

/**
 * Calls one of COAL's own endpoints in-process, as the person, so the AI goes through exactly
 * the same session, permission and AI-tier checks as anyone else (docs/architecture.md#ai-module).
 */

export interface EndpointInput {
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
}

export interface EndpointResult {
  ok: boolean;
  status: number;
  json: unknown;
}

export const endpointById = (id: string): EndpointSpec | undefined =>
  (ENDPOINTS as readonly EndpointSpec[]).find((e) => e.id === id);

/** A path or query value as text; the model sometimes sends numbers or booleans. */
const asText = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : JSON.stringify(value ?? '');

export async function callEndpoint(
  request: FastifyRequest,
  endpoint: EndpointSpec,
  input: EndpointInput,
  options: { viaAi: boolean; preview?: boolean },
): Promise<EndpointResult> {
  const path = endpoint.path.replace(/\{(\w+)\}/g, (_, key: string) =>
    encodeURIComponent(asText(input.params?.[key])),
  );
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value !== undefined && value !== null && key !== 'preview') query.set(key, asText(value));
  }
  if (options.preview) query.set('preview', 'true');
  const hasBody = input.body !== undefined && endpoint.method !== 'GET';
  const response = await request.server.inject({
    method: endpoint.method,
    url: API_BASE_PATH + path + (query.size ? `?${query.toString()}` : ''),
    headers: {
      cookie: request.headers.cookie ?? '',
      ...(options.viaAi && { [VIA_AI_HEADER]: VIA_AI_SECRET }),
      ...(hasBody && { 'content-type': 'application/json' }),
    },
    ...(hasBody && { payload: JSON.stringify(input.body) }),
  });
  let json: unknown = null;
  try {
    json = response.body ? JSON.parse(response.body) : null;
  } catch {
    json = response.body;
  }
  return { ok: response.statusCode < 300, status: response.statusCode, json };
}

/** A failed call in plain words, for the model and for cards. */
export function problemText(result: EndpointResult): string {
  const p = result.json as {
    detail?: string;
    title?: string;
    code?: string;
    whoCan?: string[];
  } | null;
  const who = p?.whoCan?.length ? ` Who can: ${p.whoCan.join(', ')}.` : '';
  return `${p?.code ?? result.status}: ${p?.detail ?? p?.title ?? 'failed'}${who}`;
}
