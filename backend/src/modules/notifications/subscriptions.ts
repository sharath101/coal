import {
  WIDGETS,
  addWorkingDays,
  dateOfInstant,
  workingDaysBetween,
  type MessageKey,
} from '@coal/shared';
import type { Tx } from '../../core/db/client';
import { findDeviation } from '../deviations/store';
import { pendingSignersOf } from '../documents/service';
import type { OutboxEvent, Subscription } from '../events/dispatcher';
import { loadCalendar, loadSettings } from '../schedule/calendar';
import { SIGNERS_REMINDED, findTask, activeTasksOfStep, signOffWaits } from '../tasks/service';
import { findUser, findActiveUsersByRole, findUsersByIds, type UserRow } from '../users/service';
import { roleAbove } from '../permissions/rules';
import { holdersOf, projectContext, nextRoleUp, type ProjectContext } from './audience';
import {
  notify,
  renderMessage,
  sendLiveHint,
  shortDate,
  stepVars,
  type NewNotification,
} from './service';

type Payload = Record<string, unknown>;
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const linkTo = (projectId: string, stepKey: string | null) =>
  stepKey ? `/projects/${projectId}?step=${encodeURIComponent(stepKey)}` : `/projects/${projectId}`;

/** One notification per person, with the event it came from as its dedupe key (safe to run twice). */
function messageTo(
  people: UserRow[],
  event: OutboxEvent,
  ctx: ProjectContext,
  options: {
    key: MessageKey;
    kind: NewNotification['kind'];
    title: string;
    vars: Parameters<typeof renderMessage>[2];
  },
): NewNotification[] {
  const body = renderMessage(ctx.route, options.key, options.vars);
  return [...new Map(people.map((p) => [p.id, p])).values()].map((p) => ({
    userId: p.id,
    kind: options.kind,
    eventType: event.type,
    title: options.title,
    body,
    link: linkTo(ctx.project.id, event.stepKey),
    projectId: ctx.project.id,
    stepKey: event.stepKey,
    dedupeKey: `event:${event.id}`,
  }));
}

async function context(tx: Tx, event: OutboxEvent): Promise<ProjectContext | null> {
  return event.projectId ? projectContext(tx, event.orgId, event.projectId) : null;
}

/** A task was made: tell the person it is for (or the holders of the role whose queue it joined). */
async function onTaskCreated(event: OutboxEvent, tx: Tx) {
  if ((event.payload as Payload).given) return onTaskGiven(event, tx);
  const ctx = await context(tx, event);
  const p = event.payload as Payload;
  const step = ctx?.route.steps.find((s) => s.key === event.stepKey);
  if (!ctx || !step) return;
  const assigneeId = str(p.assigneeId);
  const queueRole = str(p.queueRole);
  const people = assigneeId
    ? await findUsersByIds(tx, event.orgId, [assigneeId])
    : queueRole
      ? await findActiveUsersByRole(tx, event.orgId, queueRole, {
          productLineId: queueRole === 'rd_lead' ? ctx.project.productLineId : null,
        })
      : [];
  const sign = p.kind === 'sign';
  await notify(
    tx,
    event.orgId,
    messageTo(people, event, ctx, {
      key: sign ? 'signature_requested' : 'task_assigned',
      kind: 'work_message',
      title: sign ? `Sign off step ${step.key}` : (str(p.title) ?? 'New task'),
      vars: {
        ...stepVars(ctx.route, step, ctx.project, ctx.lineName),
        due: shortDate(str(p.dueOn)),
      },
    }),
  );
}

/**
 * Work given by hand, or a request: the person it is for hears who gave it. These aren't the
 * route's work, so the words are COAL's own, not the route's templates.
 */
async function onTaskGiven(event: OutboxEvent, tx: Tx) {
  const taskId = str((event.payload as Payload).taskId);
  const task = taskId ? await findTask(tx, event.orgId, taskId) : null;
  if (!task?.assigneeId || !task.assignedBy || task.assigneeId === task.assignedBy) return;
  const giver = await findUser(tx, event.orgId, task.assignedBy);
  const name = giver?.name ?? 'Someone';
  const where = task.subjectLabel ? ` on ${task.subjectLabel}` : '';
  const due = task.dueOn ? ` Due ${shortDate(task.dueOn)}.` : '';
  await notify(tx, event.orgId, [
    {
      userId: task.assigneeId,
      kind: 'work_message',
      eventType: event.type,
      title: task.kind === 'request' ? `${name} asks: ${task.title}` : task.title,
      body:
        task.kind === 'request'
          ? `${name} asked you for this${where}.${due} Accept it to make it your task, or decline it with a reason.`
          : `${name} assigned this to you${where}.${due}`,
      link: '/tasks',
      projectId: task.subjectId,
      stepKey: task.stepKey,
      dedupeKey: `event:${event.id}`,
    },
  ]);
}

/** A request was accepted or declined: the person who asked hears. The reason stays on the task. */
async function onRequestAnswered(event: OutboxEvent, tx: Tx) {
  const taskId = str((event.payload as Payload).taskId);
  const task = taskId ? await findTask(tx, event.orgId, taskId) : null;
  if (!task?.assignedBy || !task.assigneeId) return;
  const person = await findUser(tx, event.orgId, task.assigneeId);
  const name = person?.name ?? 'Someone';
  const accepted = event.type === 'task.accepted';
  await notify(tx, event.orgId, [
    {
      userId: task.assignedBy,
      kind: accepted ? 'work_message' : 'alert',
      eventType: event.type,
      title: `${name} ${accepted ? 'accepted' : 'declined'}: ${task.title}`,
      body: accepted
        ? `${name} took on your request.`
        : `${name} declined your request. Open it to see why.`,
      link: '/tasks?scope=sent',
      projectId: task.subjectId,
      stepKey: task.stepKey,
      dedupeKey: `event:${event.id}`,
    },
  ]);
}

/** A task was claimed or given to someone: tell them, unless they did it themselves. */
async function onTaskAssigned(event: OutboxEvent, tx: Tx) {
  const p = event.payload as Payload;
  const assigneeId = str(p.assigneeId);
  const taskId = str(p.taskId);
  if (!assigneeId || !taskId || assigneeId === event.actorId) return;
  const [ctx, task, people] = await Promise.all([
    context(tx, event),
    findTask(tx, event.orgId, taskId),
    findUsersByIds(tx, event.orgId, [assigneeId]),
  ]);
  const step = ctx?.route.steps.find((s) => s.key === event.stepKey);
  if (!ctx || !task || !step) return;
  await notify(
    tx,
    event.orgId,
    messageTo(people, event, ctx, {
      key: 'task_assigned',
      kind: 'work_message',
      title: task.title,
      vars: { ...stepVars(ctx.route, step, ctx.project, ctx.lineName), due: shortDate(task.dueOn) },
    }),
  );
}

/** Work was returned: the doers still holding the step's tasks hear of it. */
async function onStepReturned(event: OutboxEvent, tx: Tx) {
  const ctx = await context(tx, event);
  const step = ctx?.route.steps.find((s) => s.key === event.stepKey);
  if (!ctx || !step) return;
  const tasks = await activeTasksOfStep(tx, ctx.runId, step.key);
  const ids = tasks.flatMap((t) => (t.kind === 'work' && t.assigneeId ? [t.assigneeId] : []));
  const people = await findUsersByIds(tx, event.orgId, ids);
  await notify(
    tx,
    event.orgId,
    messageTo(people, event, ctx, {
      key: 'work_returned',
      kind: 'alert',
      title: `Step ${step.key} was returned`,
      vars: stepVars(ctx.route, step, ctx.project, ctx.lineName),
    }),
  );
}

/** A checkpoint was decided: the whole team hears. */
async function onDecision(event: OutboxEvent, tx: Tx) {
  const p = event.payload as Payload;
  if (p.decision !== 'checkpoint') return;
  const ctx = await context(tx, event);
  const step = ctx?.route.steps.find((s) => s.key === event.stepKey);
  if (!ctx || !step) return;
  await notify(
    tx,
    event.orgId,
    messageTo(ctx.team, event, ctx, {
      key: 'checkpoint_decided',
      kind: 'alert',
      title: `${step.name}: decision recorded`,
      vars: {
        ...stepVars(ctx.route, step, ctx.project, ctx.lineName),
        decision: str(p.value) ?? '',
      },
    }),
  );
}

const onProject =
  (key: 'project_held' | 'project_resumed' | 'project_dropped', title: string) =>
  async (event: OutboxEvent, tx: Tx) => {
    const ctx = await context(tx, event);
    if (!ctx) return;
    await notify(
      tx,
      event.orgId,
      messageTo(ctx.team, event, ctx, {
        key,
        kind: 'alert',
        title: `${ctx.project.code}: ${title}`,
        vars: { project: ctx.project.code, project_name: ctx.project.name },
      }),
    );
  };

/** A deviation was recorded: the next role up is asked to confirm it, and a named person is told. */
async function onDeviationRecorded(event: OutboxEvent, tx: Tx) {
  // A send-back's "rework" record has no new date to confirm: the step's own events tell the team.
  if ((event.payload as Payload).kind === 'rework') return;
  const ctx = await context(tx, event);
  const step = ctx?.route.steps.find((s) => s.key === event.stepKey);
  if (!ctx || !step) return;
  const recorder = event.actorId ? await findUser(tx, event.orgId, event.actorId) : null;
  if (!recorder) return;
  const vars = {
    ...stepVars(ctx.route, step, ctx.project, ctx.lineName),
    person: recorder.name,
    due: shortDate(str((event.payload as Payload).newDate)),
  };
  const reviewers = roleAbove(recorder.roleKey)
    ? await nextRoleUp(tx, event.orgId, ctx, recorder.roleKey)
    : [];
  const items = messageTo(reviewers, event, ctx, {
    key: 'deviation_to_review',
    kind: 'work_message',
    title: `A deviation on step ${step.key} needs a look`,
    vars,
  });
  const causeUserId = await namedCause(tx, event);
  if (causeUserId && causeUserId !== recorder.id) {
    const [named] = await findUsersByIds(tx, event.orgId, [causeUserId]);
    if (named) {
      items.push(
        ...messageTo([named], event, ctx, {
          key: 'named_as_cause',
          kind: 'alert',
          title: `You were named on a delay (step ${step.key})`,
          vars,
        }).map((n) => ({ ...n, dedupeKey: `event:${event.id}:cause` })),
      );
    }
  }
  await notify(tx, event.orgId, items);
}

async function namedCause(tx: Tx, event: OutboxEvent): Promise<string | null> {
  const id = str((event.payload as Payload).deviationId);
  if (!id) return null;
  const row = await findDeviation(tx, event.orgId, id);
  return row?.causeType === 'person' ? row.causeUserId : null;
}

/** A document's signature row opened: the person (or everyone holding the role) is asked to sign. */
async function onSignatureRequested(event: OutboxEvent, tx: Tx) {
  const documentId = str((event.payload as Payload).documentId);
  const ctx = await context(tx, event);
  const step = ctx?.route.steps.find((s) => s.key === event.stepKey);
  if (!documentId || !ctx || !step) return;
  const due = addWorkingDays(
    await loadCalendar(tx, event.orgId),
    dateOfInstant(event.createdAt),
    (await loadSettings(tx, event.orgId)).signatureDueWorkingDays,
  );
  const items: NewNotification[] = [];
  for (const request of await pendingSignersOf(tx, event.orgId, documentId)) {
    const people = request.assigneeId
      ? await findUsersByIds(tx, event.orgId, [request.assigneeId])
      : (
          await Promise.all(request.roleKeys.map((role) => holdersOf(tx, event.orgId, ctx, role)))
        ).flat();
    items.push(
      ...messageTo(people, event, ctx, {
        key: 'signature_requested',
        kind: 'work_message',
        title: `Sign ${request.number}`,
        vars: { ...stepVars(ctx.route, step, ctx.project, ctx.lineName), due: shortDate(due) },
      }).map((n) => ({
        ...n,
        link: `/projects/${ctx.project.id}/documents/${documentId}`,
        dedupeKey: `event:${event.id}:${request.meaning}`,
      })),
    );
  }
  await notify(tx, event.orgId, items);
}

/**
 * The doers reminded a step's signers: each one who still has not signed hears who reminded them
 * and how long it has waited. The words are the route's signature reminder; nothing the doer wrote.
 */
async function onSignersReminded(event: OutboxEvent, tx: Tx) {
  const p = event.payload as Payload;
  const runStepId = str(p.runStepId);
  const ctx = await context(tx, event);
  const step = ctx?.route.steps.find((s) => s.key === event.stepKey);
  if (!runStepId || !ctx || !step) return;
  const at = new Date(str(p.at) ?? event.createdAt.toISOString());
  const wait = (await signOffWaits(tx, event.orgId, [runStepId], at)).get(runStepId);
  if (!wait) return;
  // Someone who signed after the click isn't reminded; a queue stays everyone's who holds the role.
  const stillToSign = new Set(wait.pending.map((x) => x.id));
  const asked = Array.isArray(p.userIds) ? p.userIds.filter((id) => typeof id === 'string') : [];
  const people = await findUsersByIds(
    tx,
    event.orgId,
    asked.filter((id) => wait.queued || stillToSign.has(id)),
  );
  const by = event.actorId ? await findUser(tx, event.orgId, event.actorId) : null;
  const days = workingDaysBetween(
    await loadCalendar(tx, event.orgId),
    dateOfInstant(new Date(wait.since)),
    dateOfInstant(at),
  );
  await notify(
    tx,
    event.orgId,
    messageTo(people, event, ctx, {
      key: 'signature_waiting',
      kind: 'reminder',
      title: `${by?.name ?? 'The team'} reminded you to sign off step ${step.key}`,
      vars: {
        ...stepVars(ctx.route, step, ctx.project, ctx.lineName),
        days: String(Math.max(0, days)),
      },
    }),
  );
}

/** Tells open websites which widgets to fetch again. A hint only, never content. */
async function sendWidgetHints(event: OutboxEvent, tx: Tx) {
  const keys = WIDGETS.filter((w) => w.refreshOn.includes(event.type)).map((w) => w.key);
  if (keys.length > 0) await sendLiveHint(tx, { type: 'widgets', keys });
}

export const NOTIFICATION_SUBSCRIPTIONS: Subscription[] = [
  { type: 'task.created', handle: onTaskCreated },
  { type: 'task.assigned', handle: onTaskAssigned },
  { type: 'task.accepted', handle: onRequestAnswered },
  { type: 'task.declined', handle: onRequestAnswered },
  { type: 'step.returned', handle: onStepReturned },
  { type: 'decision.recorded', handle: onDecision },
  { type: 'project.held', handle: onProject('project_held', 'on hold') },
  { type: 'project.resumed', handle: onProject('project_resumed', 'running again') },
  { type: 'project.dropped', handle: onProject('project_dropped', 'dropped') },
  { type: 'deviation.recorded', handle: onDeviationRecorded },
  { type: 'signature.requested', handle: onSignatureRequested },
  { type: SIGNERS_REMINDED, handle: onSignersReminded },
  { type: '*', handle: sendWidgetHints },
];
