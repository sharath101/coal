import { and, asc, desc, eq, exists, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { Executor, Tx } from '../../core/db/client';
import { msOf } from '../../core/db/columns';
import { validationFailed } from '../../core/http/errors';
import { deviationComments, deviationReviews, deviations } from './tables';

export type DeviationRow = typeof deviations.$inferSelect;
export type DeviationReviewRow = typeof deviationReviews.$inferSelect;
export type DeviationCommentRow = typeof deviationComments.$inferSelect;
export type NewDeviation = Omit<typeof deviations.$inferInsert, 'id' | 'orgId' | 'createdAt'>;

export async function insertDeviation(
  tx: Tx,
  orgId: string,
  input: NewDeviation,
): Promise<DeviationRow> {
  const [row] = await tx
    .insert(deviations)
    .values({ ...input, orgId })
    .returning();
  return row as DeviationRow;
}

export async function findDeviation(
  ex: Executor,
  orgId: string,
  id: string,
): Promise<DeviationRow | null> {
  const [row] = await ex
    .select()
    .from(deviations)
    .where(and(eq(deviations.orgId, orgId), eq(deviations.id, id)));
  return row ?? null;
}

/**
 * The steps among these whose lateness someone has explained: a person gave a new date that
 * hasn't passed yet. A step that is late again needs a new explanation, and the system's
 * "rework" records explain nothing.
 */
export async function explainedSteps(
  ex: Executor,
  runStepIds: string[],
  today: string,
): Promise<Set<string>> {
  if (runStepIds.length === 0) return new Set();
  const rows = await ex
    .selectDistinct({ runStepId: deviations.runStepId })
    .from(deviations)
    .where(
      and(
        inArray(deviations.runStepId, runStepIds),
        sql`${deviations.kind} <> 'rework'`,
        sql`${deviations.newDate} >= ${today}`,
      ),
    );
  return new Set(rows.flatMap((r) => (r.runStepId ? [r.runStepId] : [])));
}

/**
 * Has someone explained why this task missed its current due date? A deviation made for an
 * earlier date doesn't: when the new date passes too, the doer says why again.
 */
export async function taskHasDeviation(
  ex: Executor,
  taskId: string,
  dueOn: string,
): Promise<boolean> {
  const [row] = await ex
    .select({ id: deviations.id })
    .from(deviations)
    .where(and(eq(deviations.taskId, taskId), eq(deviations.plannedDate, dueOn)))
    .limit(1);
  return !!row;
}

export async function insertReview(
  tx: Tx,
  orgId: string,
  input: Omit<typeof deviationReviews.$inferInsert, 'id' | 'orgId' | 'createdAt'>,
): Promise<DeviationReviewRow> {
  const [row] = await tx
    .insert(deviationReviews)
    .values({ ...input, orgId })
    .returning();
  return row as DeviationReviewRow;
}

export async function insertComment(
  tx: Tx,
  orgId: string,
  input: { deviationId: string; userId: string; body: string },
): Promise<DeviationCommentRow> {
  const [row] = await tx
    .insert(deviationComments)
    .values({ ...input, orgId })
    .returning();
  return row as DeviationCommentRow;
}

export async function reviewsOf(
  ex: Executor,
  ids: string[],
): Promise<Map<string, DeviationReviewRow>> {
  if (ids.length === 0) return new Map();
  const rows = await ex
    .select()
    .from(deviationReviews)
    .where(inArray(deviationReviews.deviationId, ids));
  return new Map(rows.map((r) => [r.deviationId, r]));
}

export async function commentsOf(
  ex: Executor,
  ids: string[],
): Promise<Map<string, DeviationCommentRow[]>> {
  const result = new Map<string, DeviationCommentRow[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return result;
  const rows = await ex
    .select()
    .from(deviationComments)
    .where(inArray(deviationComments.deviationId, ids))
    .orderBy(asc(deviationComments.createdAt), asc(deviationComments.id));
  for (const row of rows) result.get(row.deviationId)?.push(row);
  return result;
}

/** The deviations that correct each of these: a correction points at the one it replaces. */
export async function correctionsOf(ex: Executor, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await ex
    .select({ id: deviations.id, correctsId: deviations.correctsId })
    .from(deviations)
    .where(inArray(deviations.correctsId, ids));
  return new Map(rows.map((r) => [r.correctsId as string, r.id]));
}

const encodeCursor = (row: DeviationRow) =>
  Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id])).toString('base64url');

function decodeCursor(cursor: string): [string, string] {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(value) && typeof value[0] === 'string' && typeof value[1] === 'string') {
      return [value[0], value[1]];
    }
  } catch {
    // fall through
  }
  throw validationFailed('The cursor is not valid.', 'cursor');
}

/** Deviations, newest first. `review`: those waiting for the next role up. */
export async function listDeviationRows(
  ex: Executor,
  orgId: string,
  query: {
    cursor?: string | undefined;
    limit: number;
    runIds?: string[] | undefined;
    state: 'all' | 'review';
  },
): Promise<{ rows: DeviationRow[]; nextCursor: string | null }> {
  const conditions: SQL[] = [eq(deviations.orgId, orgId)];
  if (query.runIds) {
    if (query.runIds.length === 0) return { rows: [], nextCursor: null };
    conditions.push(inArray(deviations.runId, query.runIds));
  }
  if (query.state === 'review') {
    conditions.push(
      isNull(deviations.correctsId),
      // A send-back's "rework" record is the system's, with nothing to confirm.
      sql`${deviations.kind} <> 'rework'`,
      sql`not ${exists(
        sql`(select 1 from ${deviationReviews} where ${deviationReviews.deviationId} = ${deviations.id})`,
      )}`,
    );
  }
  if (query.cursor) {
    const [at, id] = decodeCursor(query.cursor);
    conditions.push(
      sql`(${msOf(deviations.createdAt)}, ${deviations.id}) < (${at}::timestamptz, ${id}::uuid)`,
    );
  }
  const rows = await ex
    .select()
    .from(deviations)
    .where(and(...conditions))
    .orderBy(desc(msOf(deviations.createdAt)), desc(deviations.id))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    rows: page,
    nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
  };
}

/** The latest deviation of each of these steps, for the Delays widget's reason column. */
export async function latestDeviationOfSteps(
  ex: Executor,
  runStepIds: string[],
): Promise<Map<string, DeviationRow>> {
  if (runStepIds.length === 0) return new Map();
  const rows = await ex
    .select()
    .from(deviations)
    .where(inArray(deviations.runStepId, runStepIds))
    .orderBy(asc(deviations.createdAt), asc(deviations.id));
  const latest = new Map<string, DeviationRow>();
  for (const row of rows) latest.set(row.runStepId as string, row);
  return latest;
}
