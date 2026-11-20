import {
  acceptTask,
  createTask,
  dateOfInstant,
  declineTask,
  getTask,
  listTasks as listTasksEndpoint,
  updateTask,
} from '@coal/shared';
import { change, previewable } from '../../core/db/change';
import type { Tx } from '../../core/db/client';
import type { Actor } from '../../core/http/context';
import { implement, noEffects } from '../../core/http/endpoint';
import { AppError, notFound, validationFailed } from '../../core/http/errors';
import { taskHasDeviation } from '../deviations/store';
import { shortDate } from '../notifications/service';
import { assertCanAccess } from '../permissions';
import { howToGive } from '../permissions/rules';
import { loadEnv, scopeOf } from '../rnd/env';
import { onLineTeam } from '../rnd/projects';
import { recompute } from '../schedule/service';
import { findUser } from '../users/service';
import {
  answerRequest,
  createTasks,
  findTask,
  isActive,
  followsStep,
  listTasks,
  presentTask,
  previewTaskOf,
  setTaskStatus,
  whereOf,
  type TaskRow,
} from './service';

/** Loads a request made of the actor that is still waiting for an answer. */
async function openRequest(tx: Tx, orgId: string, actor: Actor, id: string): Promise<TaskRow> {
  const task = await findTask(tx, orgId, id, { forUpdate: true });
  if (!task) throw notFound('task');
  assertCanAccess('tasks.answer', actor, task);
  if (task.kind !== 'request') {
    throw validationFailed('Only a request is accepted or declined.');
  }
  if (task.acceptedAt || !isActive(task)) {
    throw new AppError(409, 'ALREADY_DONE', 'This request has already been answered.');
  }
  return task;
}

export const tasksRoutes = [
  implement(listTasksEndpoint, ({ deps, ctx, actor, query }) =>
    listTasks(deps.db, ctx.orgId, actor, query, deps.now()),
  ),

  implement(getTask, async ({ deps, ctx, actor, params }) => {
    const task = await findTask(deps.db, ctx.orgId, params.id);
    if (!task) throw notFound('task');
    assertCanAccess('tasks.readOne', actor, task);
    return presentTask(deps.db, ctx.orgId, task, deps.now());
  }),

  implement(updateTask, ({ deps, ctx, actor, params, body }) =>
    change(deps.db, ctx, async (tx, log) => {
      const task = await findTask(tx, ctx.orgId, params.id, { forUpdate: true });
      if (!task) throw notFound('task');
      assertCanAccess('tasks.update', actor, task);
      if (!['open', 'in_progress', 'waiting'].includes(task.status)) {
        throw new AppError(409, 'ALREADY_DONE', 'This task is already closed.');
      }
      // The step is the one truth: marking its task done by hand would leave the step open with
      // nobody holding it, and nothing handed in for sign-off (docs/workflow.md#tasks).
      if (followsStep(task)) {
        throw new AppError(
          409,
          'USE_THE_STEP',
          `This task belongs to step ${task.stepKey}, so it follows the step: start the step, then submit it${
            task.kind === 'sign' ? ' (a sign-off task closes when you sign)' : ' for sign-off'
          } from the step, and the task closes when the step is signed off.`,
        );
      }
      // A late task of the route can't be closed until someone has said why (docs/dashboard.md#deviations).
      // Work given by hand isn't on the plan, so it needs no deviation.
      if (
        body.status === 'done' &&
        task.runStepId &&
        task.dueOn &&
        dateOfInstant(deps.now()) > task.dueOn &&
        !(await taskHasDeviation(tx, task.id, task.dueOn))
      ) {
        throw new AppError(
          409,
          'DEVIATION_REQUIRED',
          `This task was due on ${task.dueOn}. Record why it is late, and the new date, before closing it.`,
        );
      }
      const updated = await setTaskStatus(tx, task, body.status, deps.now());
      log.audit({
        action: 'task.updated',
        recordType: 'task',
        recordId: task.id,
        before: { status: task.status },
        after: { status: updated.status },
      });
      if (body.status === 'done') {
        log.event({
          type: 'task.done',
          projectId: task.subjectId,
          stepKey: task.stepKey,
          payload: { taskId: task.id },
        });
        // Finished work no longer holds the step's forecast back.
        if (task.runId && task.subjectId) {
          await recompute(tx, log, deps.now(), ctx.orgId, task.subjectId, task.runId);
        }
      }
      return presentTask(tx, ctx.orgId, updated, deps.now());
    }),
  ),

  implement(
    createTask,
    ({ deps, ctx, actor, query, body }) =>
      previewable(deps.db, ctx, query.preview, async (tx, log) => {
        if (body.stepKey && !body.projectId) {
          throw validationFailed('A step needs its project.', 'stepKey');
        }
        const env = body.projectId ? await loadEnv(tx, ctx.orgId, actor, body.projectId) : null;
        assertCanAccess('tasks.create', actor, { project: env ? scopeOf(env) : null });
        if (env && body.stepKey && !env.loaded.route.steps.some((s) => s.key === body.stepKey)) {
          throw validationFailed("The project's route has no such step.", 'stepKey');
        }
        const today = dateOfInstant(deps.now());
        if (body.dueOn && body.dueOn < today) {
          throw validationFailed('That date has passed.', 'dueOn');
        }
        const assignee = await findUser(tx, ctx.orgId, body.assigneeId ?? actor.userId);
        if (!assignee || assignee.status !== 'active') {
          throw validationFailed('There is no active account for that person.', 'assigneeId');
        }
        const onLine =
          actor.roleKey === 'rd_lead' && actor.productLineId
            ? await onLineTeam(tx, ctx.orgId, assignee.id, actor.productLineId, env?.project.id)
            : false;
        const kind = howToGive(actor, assignee, onLine);
        if (ctx.viaAi && kind !== 'own') {
          throw new AppError(
            403,
            'AI_NOT_ALLOWED',
            'The AI can only propose work for someone else. You confirm it on an action card.',
          );
        }
        const [row] = await createTasks(tx, ctx.orgId, [
          {
            kind,
            title: body.title,
            body: body.body,
            assigneeId: assignee.id,
            assignedBy: actor.userId,
            viaAi: ctx.viaAi || !!ctx.proposal?.preparedByAi,
            stepKey: body.stepKey ?? null,
            subjectType: env ? 'project' : null,
            subjectId: env?.project.id ?? null,
            subjectLabel: env?.project.code ?? null,
            dueOn: body.dueOn ?? null,
            firstDueOn: body.dueOn ?? null,
          },
        ]);
        const task = row as TaskRow;
        log.audit({
          action: 'task.created',
          recordType: 'task',
          recordId: task.id,
          after: {
            kind,
            title: task.title,
            assigneeId: task.assigneeId,
            dueOn: task.dueOn,
            projectId: task.subjectId,
            stepKey: task.stepKey,
            viaAi: task.viaAi,
            ...(ctx.proposal && { proposalId: ctx.proposal.id, chatId: ctx.proposal.chatId }),
          },
        });
        // Kept off the project's activity feed, which shows status to everyone: a given task's words are content.
        log.event({
          type: 'task.created',
          payload: { taskId: task.id, kind, assigneeId: task.assigneeId, given: true },
        });
        const warnings =
          kind === 'request'
            ? [
                `${assignee.name} isn't someone you assign work to, so this goes as a request they can accept or decline.`,
              ]
            : [];
        return {
          saved: !query.preview,
          task: await presentTask(tx, ctx.orgId, task, deps.now()),
          warnings,
        };
      }),
    {
      describe: ({ task, warnings }) => ({
        summary: `${
          task.kind === 'own'
            ? 'Add to my tasks'
            : task.kind === 'request'
              ? `Ask ${task.assignee?.name ?? 'them'}`
              : `Assign to ${task.assignee?.name ?? 'them'}`
        }: ${task.title}${task.dueOn ? `, due ${shortDate(task.dueOn)}` : ''}${whereOf(task)}`,
        effects: { ...noEffects(warnings), tasks: [previewTaskOf(task)] },
        notified: task.kind !== 'own' && task.assignee ? [task.assignee] : [],
      }),
    },
  ),

  implement(
    acceptTask,
    ({ deps, ctx, actor, params }) =>
      change(deps.db, ctx, async (tx, log) => {
        const task = await openRequest(tx, ctx.orgId, actor, params.id);
        const updated = await answerRequest(tx, task, { accepted: true }, deps.now());
        log.audit({
          action: 'task.accepted',
          recordType: 'task',
          recordId: task.id,
          after: { acceptedAt: updated.acceptedAt?.toISOString() ?? null },
        });
        log.event({
          type: 'task.accepted',
          payload: { taskId: task.id, assignedBy: task.assignedBy },
        });
        return presentTask(tx, ctx.orgId, updated, deps.now());
      }),
    {
      describe: (task) => ({
        summary: `Accept the request: ${task.title}${whereOf(task)}`,
        effects: noEffects(),
        notified: task.assignedBy ? [task.assignedBy] : [],
      }),
    },
  ),

  implement(
    declineTask,
    ({ deps, ctx, actor, params, body }) =>
      change(deps.db, ctx, async (tx, log) => {
        const task = await openRequest(tx, ctx.orgId, actor, params.id);
        const updated = await answerRequest(
          tx,
          task,
          { accepted: false, reason: body.reason },
          deps.now(),
        );
        log.audit({
          action: 'task.declined',
          recordType: 'task',
          recordId: task.id,
          before: { status: task.status },
          after: { status: updated.status },
          reason: body.reason,
        });
        log.event({
          type: 'task.declined',
          payload: { taskId: task.id, assignedBy: task.assignedBy },
        });
        return presentTask(tx, ctx.orgId, updated, deps.now());
      }),
    {
      describe: (task, { body }) => ({
        summary: `Decline the request: ${task.title}, because "${body.reason}"`,
        effects: noEffects(),
        notified: task.assignedBy ? [task.assignedBy] : [],
      }),
    },
  ),
];
