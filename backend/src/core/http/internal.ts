import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Marks the backend's own in-process calls made for the AI, so every endpoint applies its AI tier
 * (docs/architecture.md#ai-module). The secret is random per process: no client can set the mark.
 */
export const VIA_AI_HEADER = 'x-coal-via-ai';
export const VIA_AI_SECRET = randomBytes(32).toString('hex');

export function isViaAi(value: unknown): boolean {
  if (typeof value !== 'string' || value.length !== VIA_AI_SECRET.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(VIA_AI_SECRET));
}
