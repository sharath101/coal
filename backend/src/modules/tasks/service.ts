import type { Task } from '@coal/shared';
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { Executor, Tx } from '../../core/db/client';
import { notFound, validationFailed } from '../../core/http/errors';
import { listRoles } from '../org/service';
import { findUsersByIds } from '../users/service';
import { tasks } from './tables';

export type TaskRow = typeof tasks.$inferSelect;
export type NewTask = Omit<
  typeof tasks.$inferInsert,
  'id' | 'orgId' | 'createdAt' | 'updatedAt' | 'doneAt' | 'status'
>;

const ACTIVE: TaskRow['status'][] = ['open', 'in_progress', 'waiting'];
const CLOSED: TaskRow['status'][] = ['done', 'declined', 'cancelled'];

export async function createTasks(tx: Tx, orgId: string, input: NewTask[]): Promise<TaskRow[]> {
  if (input.length === 0) return [];
  return tx
    .insert(tasks)
    .values(input.map((t) => ({ ...t, orgId })))
    .returning();
}

export async function findTask(
  ex: Executor,
  orgId: string,
  id: string,
  options: { forUpdate?: boolean } = {},
): Promise<TaskRow | null> {
  const query = ex
    .select()
    .from(tasks)
    .where(and(eq(tasks.orgId, orgId), eq(tasks.id, id)));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  return row ?? null;
}

/** An active task made by a step under `taskKey`, so a reopened step doesn't repeat it. */
export async function findActiveKeyedTask(ex: Executor, runId: string, taskKey: string) {
  const [row] = await ex
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.runId, runId), eq(tasks.taskKey, taskKey), inArray(tasks.status, ACTIVE)));
  return row ?? null;
}

export async function activeTasksOfRun(ex: Executor, runId: string): Promise<TaskRow[]> {
  return ex
    .select()
    .from(tasks)
    .where(and(eq(tasks.runId, runId), inArray(tasks.status, ACTIVE)))
    .orderBy(tasks.createdAt, tasks.id);
}

export async function activeTasksOfStep(ex: Executor, runId: string, stepKey: string) {
  return ex
    .select()
    .from(tasks)
    .where(and(eq(tasks.runId, runId), eq(tasks.stepKey, stepKey), inArray(tasks.status, ACTIVE)));
}

/** Closes the active tasks of a step (or of the whole run), except those a reset keeps. Returns what it closed. */
export async function closeTasks(
  tx: Tx,
  runId: string,
  options: {
    stepKey?: string;
    kinds?: TaskRow['kind'][];
    status: 'done' | 'cancelled';
    /** Only this person's tasks, such as one Board member's sign-off task. */
    assigneeId?: string;
    keepOnReset?: boolean;
  },
): Promise<TaskRow[]> {
  const conditions: SQL[] = [eq(tasks.runId, runId), inArray(tasks.status, ACTIVE)];
  if (options.stepKey) conditions.push(eq(tasks.stepKey, options.stepKey));
  if (options.kinds) conditions.push(inArray(tasks.kind, options.kinds));
  if (options.assigneeId) conditions.push(eq(tasks.assigneeId, options.assigneeId));
  if (options.keepOnReset) conditions.push(eq(tasks.keepOnReset, false));
  return tx
    .update(tasks)
    .set({
      status: options.status,
      doneAt: options.status === 'done' ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(and(...conditions))
    .returning();
}

export async function countOpenCorrectiveActions(ex: Executor, runId: string): Promise<number> {
  const [row] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        eq(tasks.runId, runId),
        eq(tasks.kind, 'corrective_action'),
        inArray(tasks.status, ACTIVE),
      ),
    );
  return row?.n ?? 0;
}

export async function setTaskStatus(
  tx: Tx,
  task: TaskRow,
  status: 'open' | 'in_progress' | 'done',
): Promise<TaskRow> {
  const [row] = await tx
    .update(tasks)
    .set({ status, doneAt: status === 'done' ? new Date() : null, updatedAt: new Date() })
    .where(eq(tasks.id, task.id))
    .returning();
  return row as TaskRow;
}

/** Gives a task to a person. The queue no longer holds it. */
export async function assignTask(
  tx: Tx,
  task: TaskRow,
  assigneeId: string,
  assignedBy: string,
): Promise<TaskRow> {
  const [row] = await tx
    .update(tasks)
    .set({ assigneeId, queueRole: null, assignedBy, updatedAt: new Date() })
    .where(eq(tasks.id, task.id))
    .returning();
  return row as TaskRow;
}

const encodeCursor = (row: TaskRow) =>
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

/** My tasks, or the tasks waiting in my role's queue; newest first. */
export async function listTasks(
  ex: Executor,
  orgId: string,
  actor: { userId: string; roleKey: string },
  query: {
    cursor?: string | undefined;
    limit: number;
    scope: 'mine' | 'queue';
    'filter[status]': 'active' | 'closed';
  },
): Promise<{ items: Task[]; nextCursor: string | null }> {
  const conditions: SQL[] = [
    eq(tasks.orgId, orgId),
    inArray(tasks.status, query['filter[status]'] === 'active' ? ACTIVE : CLOSED),
  ];
  if (query.scope === 'mine') conditions.push(eq(tasks.assigneeId, actor.userId));
  else conditions.push(isNull(tasks.assigneeId), eq(tasks.queueRole, actor.roleKey));
  if (query.cursor) {
    const [at, id] = decodeCursor(query.cursor);
    conditions.push(sql`(${tasks.createdAt}, ${tasks.id}) < (${at}::timestamptz, ${id}::uuid)`);
  }
  const rows = await ex
    .select()
    .from(tasks)
    .where(and(...conditions))
    .orderBy(desc(tasks.createdAt), desc(tasks.id))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: await presentTasks(ex, orgId, page),
    nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
  };
}

export async function presentTasks(ex: Executor, orgId: string, rows: TaskRow[]): Promise<Task[]> {
  if (rows.length === 0) return [];
  const [people, roleList] = await Promise.all([
    findUsersByIds(
      ex,
      orgId,
      rows.flatMap((r) => (r.assigneeId ? [r.assigneeId] : [])),
    ),
    listRoles(ex, orgId),
  ]);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const roleName = new Map(roleList.map((r) => [r.key, r.name]));
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    status: row.status,
    stepKey: row.stepKey,
    assignee: row.assigneeId
      ? { id: row.assigneeId, name: nameOf.get(row.assigneeId) ?? 'Unknown' }
      : null,
    queueRole: row.queueRole
      ? { key: row.queueRole, name: roleName.get(row.queueRole) ?? row.queueRole }
      : null,
    subject:
      row.subjectType && row.subjectId
        ? { type: row.subjectType, id: row.subjectId, label: row.subjectLabel ?? '' }
        : null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function presentTask(ex: Executor, orgId: string, row: TaskRow): Promise<Task> {
  const [task] = await presentTasks(ex, orgId, [row]);
  if (!task) throw notFound('task');
  return task;
}
