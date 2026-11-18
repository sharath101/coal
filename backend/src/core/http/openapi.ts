import { ENDPOINTS } from '@coal/shared';

type OpenApiDoc = { paths?: Record<string, Record<string, Record<string, unknown>>> };

/** Adds each operation's permission and AI tier, as `x-permission` and `x-ai-tier`. */
export function annotateOpenApi<T>(document: T): T {
  const byId = new Map<string, (typeof ENDPOINTS)[number]>(ENDPOINTS.map((e) => [e.id, e]));
  const doc = structuredClone(document) as OpenApiDoc;
  for (const methods of Object.values(doc.paths ?? {})) {
    for (const operation of Object.values(methods)) {
      const endpoint = byId.get(String(operation.operationId));
      if (!endpoint) continue;
      operation['x-permission'] = endpoint.permission;
      operation['x-ai-tier'] = endpoint.aiTier;
      operation['x-auth'] = endpoint.auth;
    }
  }
  return doc as T;
}
