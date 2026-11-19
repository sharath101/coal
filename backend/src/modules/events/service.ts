import { and, desc, eq, sql } from 'drizzle-orm';
import type { Executor, Tx } from '../../core/db/client';
import { msOf } from '../../core/db/columns';
import { validationFailed } from '../../core/http/errors';
import type { RequestContext } from '../../core/http/context';
import { actorOf } from '../audit/service';
import { outboxEvents } from './tables';

/** An event as written by a change (docs/api.md#events). */
export interface EventInput {
  type: string;
  payload: Record<string, unknown>;
  projectId?: string | null;
  stepKey?: string | null;
}

export async function writeEvents(tx: Tx, ctx: RequestContext, events: EventInput[]) {
  if (events.length === 0) return;
  const actor = actorOf(ctx);
  await tx.insert(outboxEvents).values(
    events.map((e) => ({
      orgId: ctx.orgId,
      type: e.type,
      actorType: actor.type,
      actorId: actor.id,
      projectId: e.projectId ?? null,
      stepKey: e.stepKey ?? null,
      payload: e.payload,
    })),
  );
}

export type ProjectEvent = typeof outboxEvents.$inferSelect;

/** A project's events, newest first, for its activity page. */
export async function listProjectEvents(
  ex: Executor,
  orgId: string,
  projectId: string,
  query: { cursor?: string | undefined; limit: number },
): Promise<{ rows: ProjectEvent[]; nextCursor: string | null }> {
  const conditions = [eq(outboxEvents.orgId, orgId), eq(outboxEvents.projectId, projectId)];
  if (query.cursor) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
    } catch {
      parsed = null;
    }
    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') {
      throw validationFailed('The cursor is not valid.', 'cursor');
    }
    conditions.push(
      sql`(${msOf(outboxEvents.createdAt)}, ${outboxEvents.id}) < (${parsed[0]}::timestamptz, ${parsed[1]}::uuid)`,
    );
  }
  const rows = await ex
    .select()
    .from(outboxEvents)
    .where(and(...conditions))
    .orderBy(desc(msOf(outboxEvents.createdAt)), desc(outboxEvents.id))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    rows: page,
    nextCursor:
      rows.length > query.limit && last
        ? Buffer.from(JSON.stringify([last.createdAt.toISOString(), last.id])).toString('base64url')
        : null,
  };
}
