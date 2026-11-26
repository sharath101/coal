import { dateOfInstant, workingDaysBetween, type SignOffWait, type Task } from '@coal/shared';
import { and, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { Executor, Tx } from '../../core/db/client';
import { msOf } from '../../core/db/columns';
import { containing, wordsQuery } from '../../core/db/search';
import { notFound, validationFailed } from '../../core/http/errors';
import { latestEventsOfRunSteps } from '../events/service';
import { listRoles } from '../org/service';
import { linesOfProjectIds } from '../rnd/service';
import { loadCalendar } from '../schedule/calendar';
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
    /** When it happened, for the clock (tests move it). */
    now?: Date;
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
      doneAt: options.status === 'done' ? (options.now ?? new Date()) : null,
      updatedAt: options.now ?? new Date(),
    })
    .where(and(...conditions))
    .returning();
}

/** The event written when the doers remind a step's signers. */
export const SIGNERS_REMINDED = 'signature.reminded';

/** The sign-off tasks nobody has signed yet, for each of these run steps. */
export async function unsignedSignTasks(
  ex: Executor,
  runStepIds: string[],
): Promise<Map<string, TaskRow[]>> {
  if (runStepIds.length === 0) return new Map();
  const rows = await ex
    .select()
    .from(tasks)
    .where(
      and(
        inArray(tasks.runStepId, runStepIds),
        eq(tasks.kind, 'sign'),
        inArray(tasks.status, ['open', 'in_progress']),
      ),
    )
    .orderBy(tasks.createdAt, tasks.id);
  const byStep = new Map<string, TaskRow[]>();
  for (const row of rows) {
    const key = row.runStepId as string;
    byStep.set(key, [...(byStep.get(key) ?? []), row]);
  }
  return byStep;
}

/**
 * What a step that is with its signers waits on (docs/dashboard.md#widgets): the signers who have
 * not signed yet, since when, their date, how late they are, and the last reminder since it was
 * handed in. Steps with no unsigned sign-off task are left out.
 */
export async function signOffWaits(
  ex: Executor,
  orgId: string,
  runStepIds: string[],
  now: Date = new Date(),
): Promise<Map<string, SignOffWait>> {
  const unsigned = await unsignedSignTasks(ex, [...new Set(runStepIds)]);
  if (unsigned.size === 0) return new Map();
  const [reminders, roleList, cal, handedIn] = await Promise.all([
    latestEventsOfRunSteps(ex, orgId, SIGNERS_REMINDED, [...unsigned.keys()]),
    listRoles(ex, orgId),
    loadCalendar(ex, orgId),
    // When the doers handed it in: their tasks have waited since then.
    ex
      .select({
        runStepId: tasks.runStepId,
        at: sql<string>`min(${tasks.handedInAt})`,
      })
      .from(tasks)
      .where(and(inArray(tasks.runStepId, [...unsigned.keys()]), eq(tasks.status, 'waiting')))
      .groupBy(tasks.runStepId),
  ]);
  const handedInAt = new Map(
    handedIn.flatMap((r) => (r.runStepId && r.at ? [[r.runStepId, new Date(r.at)] as const] : [])),
  );
  const people = await findUsersByIds(ex, orgId, [
    ...[...unsigned.values()].flat().flatMap((t) => (t.assigneeId ? [t.assigneeId] : [])),
    ...[...reminders.values()].flatMap((e) => (e.actorId ? [e.actorId] : [])),
  ]);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const roleName = new Map(roleList.map((r) => [r.key, r.name]));
  const today = dateOfInstant(now);
  const waits = new Map<string, SignOffWait>();
  for (const [runStepId, signTasks] of unsigned) {
    const first = signTasks[0] as TaskRow;
    const signer = first.roleKey ?? first.queueRole ?? '';
    const since =
      handedInAt.get(runStepId) ??
      signTasks.reduce((a, t) => (t.createdAt < a ? t.createdAt : a), first.createdAt);
    const dueOn = signTasks.reduce<string | null>(
      (a, t) => (t.dueOn && (!a || t.dueOn < a) ? t.dueOn : a),
      null,
    );
    const reminder = reminders.get(runStepId);
    // When it was reminded, by the clock of the request (tests move it), else when it was written.
    const at = reminder ? (reminder.payload as { at?: unknown }).at : undefined;
    const remindedAt = reminder
      ? typeof at === 'string'
        ? new Date(at)
        : reminder.createdAt
      : null;
    const lastReminder =
      reminder && remindedAt && remindedAt >= since
        ? {
            at: remindedAt.toISOString(),
            by: {
              id: reminder.actorId ?? '',
              name: (reminder.actorId && nameOf.get(reminder.actorId)) || 'Someone',
            },
          }
        : null;
    waits.set(runStepId, {
      signer: { key: signer, name: roleName.get(signer) ?? signer },
      pending: signTasks.flatMap((t) =>
        t.assigneeId ? [{ id: t.assigneeId, name: nameOf.get(t.assigneeId) ?? 'Unknown' }] : [],
      ),
      queued: signTasks.some((t) => !t.assigneeId),
      since: since.toISOString(),
      dueOn,
      daysLate: dueOn && today > dueOn ? workingDaysBetween(cal, dueOn, today) : 0,
      lastReminder,
      remindedToday: !!lastReminder && dateOfInstant(new Date(lastReminder.at)) === today,
    });
  }
  return waits;
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
  now: Date = new Date(),
): Promise<TaskRow> {
  // Starting or finishing a request takes it on.
  const acceptedAt = task.kind === 'request' && !task.acceptedAt ? now : task.acceptedAt;
  const [row] = await tx
    .update(tasks)
    .set({ status, doneAt: status === 'done' ? now : null, acceptedAt, updatedAt: now })
    .where(eq(tasks.id, task.id))
    .returning();
  return row as TaskRow;
}

/** The assignee's answer to a request: accepted (it stays open as their task) or declined, with why. */
export async function answerRequest(
  tx: Tx,
  task: TaskRow,
  answer: { accepted: true } | { accepted: false; reason: string },
  now: Date = new Date(),
): Promise<TaskRow> {
  const [row] = await tx
    .update(tasks)
    .set(
      answer.accepted
        ? { acceptedAt: now, updatedAt: now }
        : { status: 'declined', declineReason: answer.reason, updatedAt: now },
    )
    .where(eq(tasks.id, task.id))
    .returning();
  return row as TaskRow;
}

/**
 * Whether a task's status is the step's to change: the route's work, sign-off and review tasks
 * follow their step. Corrective actions are closed by hand, and work given by hand belongs to no step.
 */
export const followsStep = (task: Pick<TaskRow, 'runStepId' | 'kind'>) =>
  task.runStepId !== null && task.kind !== 'corrective_action';

/** When a step is started, the work of its doers is under way. */
export async function startStepTasks(
  tx: Tx,
  runId: string,
  stepKey: string,
  now: Date = new Date(),
): Promise<number> {
  const rows = await tx
    .update(tasks)
    .set({ status: 'in_progress', updatedAt: now })
    .where(
      and(
        eq(tasks.runId, runId),
        eq(tasks.stepKey, stepKey),
        eq(tasks.kind, 'work'),
        eq(tasks.status, 'open'),
      ),
    )
    .returning({ id: tasks.id });
  return rows.length;
}

/** Whether a task is still to be done. */
export const isActive = (task: Pick<TaskRow, 'status'>) => ACTIVE.includes(task.status);

/**
 * Tasks whose title or words match, among those the person may see: theirs, their role's queue,
 * and what they gave or asked others for. Open ones first.
 */
export async function searchTasks(
  ex: Executor,
  orgId: string,
  actor: { userId: string; roleKey: string },
  q: string,
  limit: number,
): Promise<TaskRow[]> {
  const words = sql`to_tsvector('english', ${tasks.title} || ' ' || ${tasks.body})`;
  return ex
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.orgId, orgId),
        or(
          eq(tasks.assigneeId, actor.userId),
          eq(tasks.assignedBy, actor.userId),
          and(isNull(tasks.assigneeId), eq(tasks.queueRole, actor.roleKey)),
        ),
        or(sql`${words} @@ ${wordsQuery(q)}`, ilike(tasks.title, containing(q))),
      ),
    )
    .orderBy(
      sql`case when ${inArray(tasks.status, ACTIVE)} then 0 else 1 end`,
      desc(sql`ts_rank(${words}, ${wordsQuery(q)})`),
      desc(tasks.createdAt),
    )
    .limit(limit);
}

/** While a step is with its signer, the doers' tasks wait; when it is returned they are open again. */
export async function setStepTasksWaiting(
  tx: Tx,
  runId: string,
  stepKey: string,
  waiting: boolean,
  now: Date = new Date(),
): Promise<number> {
  const rows = await tx
    .update(tasks)
    .set({
      status: waiting ? 'waiting' : 'open',
      handedInAt: waiting ? now : null,
      updatedAt: now,
    })
    .where(
      and(
        eq(tasks.runId, runId),
        eq(tasks.stepKey, stepKey),
        eq(tasks.kind, 'work'),
        inArray(tasks.status, waiting ? ['open', 'in_progress'] : ['waiting']),
      ),
    )
    .returning({ id: tasks.id });
  return rows.length;
}

/**
 * Where a person's new date has moved the open work of a step past its first due date, for each
 * step: the forecast uses the latest of them. Done and waiting tasks no longer hold it back.
 */
export async function movedDueDates(ex: Executor, runId: string): Promise<Map<string, string>> {
  const rows = await ex
    .select({ runStepId: tasks.runStepId, dueOn: sql<string>`max(${tasks.dueOn})` })
    .from(tasks)
    .where(
      and(
        eq(tasks.runId, runId),
        eq(tasks.kind, 'work'),
        inArray(tasks.status, ['open', 'in_progress']),
        sql`${tasks.dueOn} > ${tasks.firstDueOn}`,
      ),
    )
    .groupBy(tasks.runStepId);
  return new Map(rows.flatMap((r) => (r.runStepId ? [[r.runStepId, r.dueOn] as const] : [])));
}

/** Moves the due date of a step's open tasks, for one role or all (a changed plan). The first due date stays. */
export async function moveDueDates(
  tx: Tx,
  runId: string,
  stepKey: string,
  roleKey: string | null,
  dueOn: string,
): Promise<number> {
  const conditions: SQL[] = [
    eq(tasks.runId, runId),
    eq(tasks.stepKey, stepKey),
    inArray(tasks.status, ACTIVE),
    inArray(tasks.kind, ['work', 'review', 'decision']),
  ];
  if (roleKey) conditions.push(eq(tasks.roleKey, roleKey));
  const rows = await tx
    .update(tasks)
    .set({ dueOn, updatedAt: new Date() })
    .where(and(...conditions))
    .returning({ id: tasks.id });
  return rows.length;
}

/** A person's new expected date for a task, from a deviation. The first due date stays. */
export async function setTaskDueDate(tx: Tx, taskId: string, dueOn: string): Promise<void> {
  await tx.update(tasks).set({ dueOn, updatedAt: new Date() }).where(eq(tasks.id, taskId));
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

/** My tasks, the tasks waiting in my role's queue, or what I gave or asked others for; newest first. */
export async function listTasks(
  ex: Executor,
  orgId: string,
  actor: { userId: string; roleKey: string },
  query: {
    cursor?: string | undefined;
    limit: number;
    scope: 'mine' | 'queue' | 'sent';
    'filter[status]': 'active' | 'closed';
  },
  now: Date = new Date(),
): Promise<{ items: Task[]; nextCursor: string | null }> {
  const conditions: SQL[] = [
    eq(tasks.orgId, orgId),
    inArray(tasks.status, query['filter[status]'] === 'active' ? ACTIVE : CLOSED),
  ];
  if (query.scope === 'mine') conditions.push(eq(tasks.assigneeId, actor.userId));
  else if (query.scope === 'sent') {
    conditions.push(eq(tasks.assignedBy, actor.userId), ne(tasks.assigneeId, actor.userId));
  } else conditions.push(isNull(tasks.assigneeId), eq(tasks.queueRole, actor.roleKey));
  if (query.cursor) {
    const [at, id] = decodeCursor(query.cursor);
    conditions.push(
      sql`(${msOf(tasks.createdAt)}, ${tasks.id}) < (${at}::timestamptz, ${id}::uuid)`,
    );
  }
  const rows = await ex
    .select()
    .from(tasks)
    .where(and(...conditions))
    .orderBy(desc(msOf(tasks.createdAt)), desc(tasks.id))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: await presentTasks(ex, orgId, page, now),
    nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
  };
}

export async function tasksByIds(ex: Executor, ids: string[]): Promise<Map<string, TaskRow>> {
  if (ids.length === 0) return new Map();
  const rows = await ex.select().from(tasks).where(inArray(tasks.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

/** Open tasks of these people (or of everyone, when `userIds` is omitted): the Dashboard's task and workload widgets. */
export async function activeTasksOf(
  ex: Executor,
  orgId: string,
  userIds?: string[],
): Promise<TaskRow[]> {
  const conditions: SQL[] = [eq(tasks.orgId, orgId), inArray(tasks.status, ACTIVE)];
  if (userIds) {
    if (userIds.length === 0) return [];
    conditions.push(inArray(tasks.assigneeId, userIds));
  }
  return ex
    .select()
    .from(tasks)
    .where(and(...conditions))
    .orderBy(tasks.dueOn, tasks.createdAt, tasks.id);
}

/** Tasks closed since a date, for the measures. */
export async function closedTasksSince(
  ex: Executor,
  orgId: string,
  userIds: string[],
  since: Date,
): Promise<TaskRow[]> {
  if (userIds.length === 0) return [];
  return ex
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.orgId, orgId),
        eq(tasks.status, 'done'),
        inArray(tasks.assigneeId, userIds),
        sql`${tasks.doneAt} >= ${since.toISOString()}::timestamptz`,
      ),
    );
}

/** The tasks of one person closed lately, newest first (the Done tab). */
export async function recentDoneTasks(
  ex: Executor,
  orgId: string,
  userId: string,
  limit: number,
): Promise<TaskRow[]> {
  return ex
    .select()
    .from(tasks)
    .where(and(eq(tasks.orgId, orgId), eq(tasks.assigneeId, userId), eq(tasks.status, 'done')))
    .orderBy(desc(tasks.doneAt), desc(tasks.id))
    .limit(limit);
}

export async function presentTasks(
  ex: Executor,
  orgId: string,
  rows: TaskRow[],
  now: Date = new Date(),
): Promise<Task[]> {
  if (rows.length === 0) return [];
  const [people, roleList, cal] = await Promise.all([
    findUsersByIds(
      ex,
      orgId,
      rows.flatMap((r) => [r.assigneeId, r.assignedBy].filter((id): id is string => !!id)),
    ),
    listRoles(ex, orgId),
    loadCalendar(ex, orgId),
  ]);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const roleName = new Map(roleList.map((r) => [r.key, r.name]));
  const today = dateOfInstant(now);
  const lines = await linesOfProjectIds(
    ex,
    orgId,
    rows.flatMap((r) => (r.subjectType === 'project' && r.subjectId ? [r.subjectId] : [])),
  );
  const waits = await signOffWaits(
    ex,
    orgId,
    rows.flatMap((r) => (r.status === 'waiting' && r.runStepId ? [r.runStepId] : [])),
    now,
  );
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
    dueOn: row.dueOn,
    // A task waiting for the signer isn't late: the signature has its own due date.
    daysLate:
      row.dueOn && ACTIVE.includes(row.status) && row.status !== 'waiting' && today > row.dueOn
        ? workingDaysBetween(cal, row.dueOn, today)
        : 0,
    subject:
      row.subjectType && row.subjectId
        ? { type: row.subjectType, id: row.subjectId, label: row.subjectLabel ?? '' }
        : null,
    productLine:
      (row.subjectType === 'project' && row.subjectId && lines.get(row.subjectId)) || null,
    onPlan: row.runStepId !== null,
    followsStep: followsStep(row),
    waitingOn: (row.status === 'waiting' && row.runStepId && waits.get(row.runStepId)) || null,
    // Someone else gave it; a task I claimed or made for myself has no giver to show.
    assignedBy:
      row.assignedBy && row.assignedBy !== row.assigneeId
        ? { id: row.assignedBy, name: nameOf.get(row.assignedBy) ?? 'Unknown' }
        : null,
    viaAi: row.viaAi,
    request:
      row.kind === 'request'
        ? {
            state: row.status === 'declined' ? 'declined' : row.acceptedAt ? 'accepted' : 'pending',
            declineReason: row.declineReason,
          }
        : null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function presentTask(
  ex: Executor,
  orgId: string,
  row: TaskRow,
  now: Date = new Date(),
): Promise<Task> {
  const [task] = await presentTasks(ex, orgId, [row], now);
  if (!task) throw notFound('task');
  return task;
}

/** A task as an action card shows it. */
export const previewTaskOf = (task: Task) => ({
  stepKey: task.stepKey,
  kind: task.kind,
  title: task.title,
  assignee: task.assignee,
  queueRole: task.queueRole,
});

/** ` (SPN-26-004, step 7)`: where a task belongs, for a card's summary. */
export const whereOf = (task: Task) =>
  task.subject ? ` (${task.subject.label}${task.stepKey ? `, step ${task.stepKey}` : ''})` : '';
