import { createHash } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client';
import { AppError } from './errors';
import { idempotencyKeys } from './tables';

const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,200}$/;

const hashRequest = (method: string, url: string, body: unknown) =>
  createHash('sha256')
    .update(`${method} ${url}\n${JSON.stringify(body ?? null)}`)
    .digest('hex');

/**
 * POST requests may carry an Idempotency-Key header, so a retry returns the first response
 * instead of repeating the action (docs/api.md#conventions). Keys belong to the signed-in user.
 *
 * The key is claimed before the handler runs, so a retry that arrives while the first request
 * is still running is refused rather than run twice. A failed request releases its key.
 */
export function registerIdempotency(app: FastifyInstance, db: Db): void {
  app.addHook('preHandler', async (request, reply) => {
    const key = request.headers['idempotency-key'];
    const actor = request.ctx.actor;
    if (request.method !== 'POST' || typeof key !== 'string' || !actor) return;
    if (!KEY_PATTERN.test(key)) {
      throw new AppError(
        400,
        'VALIDATION_FAILED',
        'Idempotency-Key must be 8 to 200 letters, digits or -_.:',
      );
    }

    const requestHash = hashRequest(request.method, request.url, request.body);
    const [claimed] = await db
      .insert(idempotencyKeys)
      .values({ orgId: request.ctx.orgId, key, userId: actor.userId, requestHash })
      .onConflictDoNothing()
      .returning({ id: idempotencyKeys.id });
    if (claimed) {
      request.idempotency = { id: claimed.id };
      return;
    }

    const [stored] = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.userId, actor.userId), eq(idempotencyKeys.key, key)));
    if (!stored) {
      throw new AppError(
        409,
        'IDEMPOTENCY_IN_PROGRESS',
        'This request is still being handled. Try again shortly.',
      );
    }
    if (stored.requestHash !== requestHash) {
      throw new AppError(
        422,
        'IDEMPOTENCY_CONFLICT',
        'This Idempotency-Key was used for a different request.',
      );
    }
    if (stored.responseStatus === null) {
      throw new AppError(
        409,
        'IDEMPOTENCY_IN_PROGRESS',
        'This request is still being handled. Try again shortly.',
      );
    }
    reply.header('idempotent-replayed', 'true');
    reply.code(stored.responseStatus);
    return reply.send(stored.response ?? undefined);
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const claim = request.idempotency;
    if (!claim) return payload;

    if (reply.statusCode >= 300) {
      await db.delete(idempotencyKeys).where(eq(idempotencyKeys.id, claim.id));
      return payload;
    }
    let response: unknown = null;
    if (typeof payload === 'string' && payload.length > 0) {
      try {
        response = JSON.parse(payload);
      } catch {
        response = null;
      }
    }
    await db
      .update(idempotencyKeys)
      .set({ responseStatus: reply.statusCode, response })
      .where(eq(idempotencyKeys.id, claim.id));
    return payload;
  });
}

/** Keys are kept for a day. */
export async function deleteOldIdempotencyKeys(db: Db, olderThanHours = 24): Promise<void> {
  await db
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.createdAt, new Date(Date.now() - olderThanHours * 3600_000)));
}

declare module 'fastify' {
  interface FastifyRequest {
    idempotency?: { id: string };
  }
}
