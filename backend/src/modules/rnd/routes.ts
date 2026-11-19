import {
  approveStep,
  claimTask,
  createCorrectiveAction,
  createTask,
  createProject,
  decideStep,
  dropProject,
  getActivity,
  getProject,
  getProjectRoute,
  getStep,
  getTeam,
  holdProject,
  listProductLines as listProductLinesEndpoint,
  listProjects,
  putTeam,
  reassignTask,
  recordMilestone,
  resumeProject,
  returnStep,
  runActionRoles,
  sendBackStep,
  startStep,
  submitStep,
  type Action,
  type ActionResult,
  type StepDefinition,
} from '@coal/shared';
import { change, previewable } from '../../core/db/change';
import type { Tx } from '../../core/db/client';
import type { AppDeps } from '../../core/deps';
import type { Actor, RequestContext } from '../../core/http/context';
import { implement } from '../../core/http/endpoint';
import { AppError, notFound, validationFailed } from '../../core/http/errors';
import { assertUsableEvidence } from '../files/service';
import { assertCanAccess } from '../permissions';
import { assignTask, createTasks, findTask, presentTask } from '../tasks/service';
import { findActiveUsersByRole, findUser } from '../users/service';
import { goProject, performAction, raiseCorrectiveAction, toPreview, type Env } from './actions';
import { assertMay, loadEnv, type ScopedPermission } from './env';
import {
  activeMembers,
  addMembers,
  findProject,
  listProjectRows,
  removeMembers,
  requireActiveUsers,
} from './projects';
import { listProductLines } from './service';
import {
  presentActivity,
  presentProject,
  presentProjects,
  presentRoute,
  presentStep,
  presentTeam,
} from './views';

interface StepActionArgs {
  deps: AppDeps;
  ctx: RequestContext;
  actor: Actor;
  projectId: string;
  key: string;
  preview?: boolean;
  permission: ScopedPermission;
  /** The roles the route lets do this, for this step. Empty: nobody, and the engine says why. */
  roles: (step: StepDefinition, env: Env) => string[];
  action: (tx: Tx, env: Env, step: StepDefinition) => Promise<Action> | Action;
  attribution?: { reason?: string; note?: string; evidenceFileId?: string };
}

/** One workflow action on a step: lock the run, check the person, run the engine, save. */
async function stepAction(a: StepActionArgs): Promise<ActionResult> {
  const preview = a.preview ?? false;
  return previewable(a.deps.db, a.ctx, preview, async (tx, log) => {
    const env = await loadEnv(tx, a.ctx.orgId, a.actor, a.projectId, { forUpdate: true });
    const step = env.loaded.route.steps.find((s) => s.key === a.key);
    if (!step) throw notFound('step');
    assertMay(env, a.permission, a.roles(step, env));
    if (a.attribution?.evidenceFileId) {
      await assertUsableEvidence(
        tx,
        a.ctx.orgId,
        a.actor,
        a.attribution.evidenceFileId,
        'evidenceFileId',
      );
    }
    const collected = await performAction(tx, log, env, await a.action(tx, env, step), {
      userId: a.actor.userId,
      ...a.attribution,
    });
    return { saved: !preview, preview: toPreview(collected) };
  });
}

/** Hold, resume and drop: the roles allowed come from the route and the run's state. */
async function runAction(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  projectId: string,
  type: 'hold' | 'resume' | 'drop',
  reason: string,
  preview: boolean,
): Promise<ActionResult> {
  return previewable(deps.db, ctx, preview, async (tx, log) => {
    const env = await loadEnv(tx, ctx.orgId, actor, projectId, { forUpdate: true });
    const permission = {
      hold: 'projects.hold',
      resume: 'projects.resume',
      drop: 'projects.drop',
    } as const;
    assertMay(env, permission[type], runActionRoles(env.loaded.route, env.loaded.state)[type]);
    const collected = await performAction(tx, log, env, { type }, { userId: actor.userId, reason });
    return { saved: !preview, preview: toPreview(collected) };
  });
}

const OPEN_TASK = ['open', 'in_progress', 'waiting'];

/**
 * Asks someone to do something: a request in their tasks, linked to an R&D project if given
 * (docs/workstation-and-ai.md#assigning-work). It lives here because its subject is a project.
 */
const createRequest = implement(createTask, ({ deps, ctx, actor, body, query }) =>
  previewable(deps.db, ctx, query.preview, async (tx, log) => {
    const assignee = await findUser(tx, ctx.orgId, body.assigneeId);
    if (!assignee || assignee.status !== 'active') {
      throw validationFailed('Choose someone with an active account.', 'assigneeId');
    }
    const project = body.projectId ? await findProject(tx, ctx.orgId, body.projectId) : null;
    if (body.projectId && !project) throw notFound('project');
    const [row] = await createTasks(tx, ctx.orgId, [
      {
        kind: 'request',
        title: body.title,
        body: body.body,
        assigneeId: assignee.id,
        assignedBy: actor.userId,
        viaAi: ctx.viaAi,
        stepKey: body.stepKey ?? null,
        ...(project && {
          subjectType: 'project',
          subjectId: project.id,
          subjectLabel: `${project.code} · ${project.name}`,
        }),
      },
    ]);
    log.audit({
      action: 'task.created',
      recordType: 'task',
      recordId: row!.id,
      after: { kind: 'request', assigneeId: assignee.id, title: body.title },
    });
    log.event({
      type: 'task.created',
      projectId: project?.id ?? null,
      stepKey: body.stepKey ?? null,
      payload: { taskId: row!.id, assigneeId: assignee.id },
    });
    return { saved: !query.preview, task: await presentTask(tx, ctx.orgId, row!) };
  }),
);

export const rndRoutes = [
  createRequest,
  implement(listProductLinesEndpoint, async ({ deps, ctx }) => ({
    items: await listProductLines(deps.db, ctx.orgId),
  })),

  implement(createProject, ({ deps, ctx, actor, query, body }) =>
    previewable(deps.db, ctx, query.preview, async (tx, log) => {
      const { project, collected, team } = await goProject(tx, log, ctx, actor, body);
      const preview = toPreview(
        collected,
        team.map((u) => ({ id: u.id, name: u.name })),
      );
      if (query.preview) return { saved: false, preview, project: null };
      const env = await loadEnv(tx, ctx.orgId, actor, project.id);
      return { saved: true, preview, project: await presentProject(tx, env) };
    }),
  ),

  implement(listProjects, async ({ deps, ctx, query }) => {
    const { rows, nextCursor } = await listProjectRows(deps.db, ctx.orgId, {
      cursor: query.cursor,
      limit: query.limit,
      status: query['filter[status]'],
      productLineId: query['filter[productLine]'],
    });
    return { items: await presentProjects(deps.db, ctx.orgId, rows), nextCursor };
  }),

  implement(getProject, async ({ deps, ctx, actor, params }) =>
    presentProject(deps.db, await loadEnv(deps.db, ctx.orgId, actor, params.id)),
  ),

  implement(getProjectRoute, async ({ deps, ctx, actor, params }) =>
    presentRoute(deps.db, await loadEnv(deps.db, ctx.orgId, actor, params.id)),
  ),

  implement(getTeam, async ({ deps, ctx, actor, params }) => ({
    items: await presentTeam(deps.db, await loadEnv(deps.db, ctx.orgId, actor, params.id)),
  })),

  implement(putTeam, ({ deps, ctx, actor, params, body }) =>
    change(deps.db, ctx, async (tx, log) => {
      const env = await loadEnv(tx, ctx.orgId, actor, params.id, { forUpdate: true });
      assertMay(env, 'projects.team.write', ['rd_head', 'rd_lead']);
      const wanted = await requireActiveUsers(tx, ctx.orgId, body.userIds, 'userIds');
      const current = env.team.map((u) => u.id);
      const wantedIds = wanted.map((u) => u.id);
      const added = wantedIds.filter((id) => !current.includes(id));
      const removed = current.filter((id) => !wantedIds.includes(id));
      await removeMembers(tx, env.project.id, removed);
      await addMembers(
        tx,
        ctx.orgId,
        env.project.id,
        wanted.filter((u) => added.includes(u.id)),
        actor.userId,
      );
      log.audit({
        action: 'project.team_changed',
        recordType: 'project',
        recordId: env.project.id,
        before: { userIds: [...current].sort() },
        after: { userIds: [...wantedIds].sort() },
      });
      log.event({
        type: 'project.team_changed',
        projectId: env.project.id,
        payload: { added, removed },
      });
      return { items: await presentTeam(tx, await loadEnv(tx, ctx.orgId, actor, params.id)) };
    }),
  ),

  implement(holdProject, ({ deps, ctx, actor, params, query, body }) =>
    runAction(deps, ctx, actor, params.id, 'hold', body.reason, query.preview),
  ),
  implement(resumeProject, ({ deps, ctx, actor, params, query, body }) =>
    runAction(deps, ctx, actor, params.id, 'resume', body.reason, query.preview),
  ),
  implement(dropProject, ({ deps, ctx, actor, params, query, body }) =>
    runAction(deps, ctx, actor, params.id, 'drop', body.reason, query.preview),
  ),

  implement(getActivity, async ({ deps, ctx, actor, params, query }) =>
    presentActivity(deps.db, await loadEnv(deps.db, ctx.orgId, actor, params.id), query),
  ),

  implement(getStep, async ({ deps, ctx, actor, params }) => {
    const env = await loadEnv(deps.db, ctx.orgId, actor, params.id);
    if (!env.loaded.route.steps.some((s) => s.key === params.key)) throw notFound('step');
    return presentStep(deps.db, env, params.key) as never;
  }),

  implement(startStep, ({ deps, ctx, actor, params, query }) =>
    stepAction({
      deps,
      ctx,
      actor,
      projectId: params.id,
      key: params.key,
      preview: query.preview,
      permission: 'steps.start',
      roles: (step) => step.doers,
      action: () => ({ type: 'start', step: params.key }),
    }),
  ),

  implement(submitStep, ({ deps, ctx, actor, params, query }) =>
    stepAction({
      deps,
      ctx,
      actor,
      projectId: params.id,
      key: params.key,
      preview: query.preview,
      permission: 'steps.submit',
      roles: (step) => step.doers,
      action: async (tx, env, step) => {
        // At a Board checkpoint every Board member signs: the people holding the role now.
        const signers =
          step.all_must_sign && step.signer
            ? (await findActiveUsersByRole(tx, env.orgId, step.signer)).map((u) => u.id)
            : [];
        return { type: 'submit', step: params.key, signers };
      },
    }),
  ),

  implement(approveStep, ({ deps, ctx, actor, params, query }) =>
    stepAction({
      deps,
      ctx,
      actor,
      projectId: params.id,
      key: params.key,
      preview: query.preview,
      permission: 'steps.approve',
      roles: (step) => (step.signer ? [step.signer] : []),
      action: () => ({ type: 'approve', step: params.key, by: actor.userId }),
    }),
  ),

  implement(returnStep, ({ deps, ctx, actor, params, query, body }) =>
    stepAction({
      deps,
      ctx,
      actor,
      projectId: params.id,
      key: params.key,
      preview: query.preview,
      permission: 'steps.return',
      roles: (step) => (step.signer ? [step.signer] : []),
      action: () => ({ type: 'return', step: params.key, by: actor.userId, comment: body.comment }),
      attribution: { reason: body.comment },
    }),
  ),

  implement(decideStep, ({ deps, ctx, actor, params, query, body }) =>
    stepAction({
      deps,
      ctx,
      actor,
      projectId: params.id,
      key: params.key,
      preview: query.preview,
      permission: 'steps.decide',
      roles: (step) => step.decisions.filter((d) => d.key === body.decision).map((d) => d.by),
      action: () => ({
        type: 'decide',
        step: params.key,
        decision: body.decision,
        value: body.value,
      }),
      ...(body.reason && { attribution: { reason: body.reason } }),
    }),
  ),

  implement(sendBackStep, ({ deps, ctx, actor, params, query, body }) =>
    stepAction({
      deps,
      ctx,
      actor,
      projectId: params.id,
      key: params.key,
      preview: query.preview,
      permission: 'steps.sendBack',
      roles: (step) =>
        step.send_back.filter((r) => r.to.includes(body.to)).map((r) => r.decided_by),
      action: () => ({ type: 'send_back', from: params.key, to: body.to }),
      attribution: {
        reason: body.reason,
        ...(body.evidenceFileId && { evidenceFileId: body.evidenceFileId }),
      },
    }),
  ),

  implement(recordMilestone, ({ deps, ctx, actor, params, query, body }) =>
    previewable(deps.db, ctx, query.preview, async (tx, log) => {
      const env = await loadEnv(tx, ctx.orgId, actor, params.id, { forUpdate: true });
      const def = env.loaded.route.milestones.find((m) => m.key === body.milestone);
      assertMay(env, 'milestones.record', def?.recorded_by ?? []);
      if (body.evidenceFileId) {
        await assertUsableEvidence(tx, ctx.orgId, actor, body.evidenceFileId, 'evidenceFileId');
      }
      const collected = await performAction(
        tx,
        log,
        env,
        { type: 'record_milestone', milestone: body.milestone },
        {
          userId: actor.userId,
          ...(body.note && { note: body.note }),
          ...(body.evidenceFileId && { evidenceFileId: body.evidenceFileId }),
        },
      );
      return { saved: !query.preview, preview: toPreview(collected) };
    }),
  ),

  implement(createCorrectiveAction, ({ deps, ctx, actor, params, query, body }) =>
    previewable(deps.db, ctx, query.preview, async (tx, log) => {
      const env = await loadEnv(tx, ctx.orgId, actor, params.id, { forUpdate: true });
      assertMay(env, 'correctiveActions.create', ['rd_lead']);
      const collected = await raiseCorrectiveAction(tx, log, env, body);
      return { saved: !query.preview, preview: toPreview(collected) };
    }),
  ),

  implement(claimTask, ({ deps, ctx, actor, params }) =>
    change(deps.db, ctx, async (tx, log) => {
      const task = await findTask(tx, ctx.orgId, params.id, { forUpdate: true });
      if (!task) throw notFound('task');
      const project =
        task.subjectType === 'project' && task.subjectId
          ? await findProject(tx, ctx.orgId, task.subjectId)
          : null;
      assertCanAccess('tasks.claim', actor, {
        ...task,
        productLineId: project?.productLineId ?? null,
      });
      if (!OPEN_TASK.includes(task.status)) {
        throw new AppError(409, 'ALREADY_DONE', 'This task is already closed.');
      }
      const updated = await assignTask(tx, task, actor.userId, actor.userId);
      // Whoever picks up queued work joins the project team, so they can act on its step.
      if (task.subjectType === 'project' && task.subjectId) {
        const team = await activeMembers(tx, ctx.orgId, task.subjectId);
        const me = await findUser(tx, ctx.orgId, actor.userId);
        if (me && !team.some((m) => m.user.id === me.id)) {
          await addMembers(tx, ctx.orgId, task.subjectId, [me], actor.userId);
          log.audit({
            action: 'project.team_changed',
            recordType: 'project',
            recordId: task.subjectId,
            after: { added: [me.id], by: 'claim' },
          });
          log.event({
            type: 'project.team_changed',
            projectId: task.subjectId,
            payload: { added: [me.id], removed: [] },
          });
        }
      }
      log.audit({
        action: 'task.claimed',
        recordType: 'task',
        recordId: task.id,
        before: { assigneeId: null, queueRole: task.queueRole },
        after: { assigneeId: actor.userId },
      });
      log.event({
        type: 'task.assigned',
        projectId: task.subjectId,
        stepKey: task.stepKey,
        payload: { taskId: task.id, assigneeId: actor.userId },
      });
      return presentTask(tx, ctx.orgId, updated);
    }),
  ),

  implement(reassignTask, ({ deps, ctx, actor, params, body }) =>
    change(deps.db, ctx, async (tx, log) => {
      const task = await findTask(tx, ctx.orgId, params.id, { forUpdate: true });
      if (!task) throw notFound('task');
      if (task.subjectType !== 'project' || !task.subjectId) {
        throw validationFailed('Only a project task can be reassigned here.');
      }
      if (!OPEN_TASK.includes(task.status)) {
        throw new AppError(409, 'ALREADY_DONE', 'This task is already closed.');
      }
      const env = await loadEnv(tx, ctx.orgId, actor, task.subjectId);
      assertMay(env, 'tasks.reassign', ['vp', 'rd_head', 'rd_lead']);
      const [assignee] = await requireActiveUsers(tx, ctx.orgId, [body.assigneeId], 'assigneeId');
      if (!assignee) throw notFound('person');
      if (task.roleKey && assignee.roleKey !== task.roleKey) {
        throw validationFailed('The task is for someone in that role.', 'assigneeId');
      }
      const onTeam = env.team.some((u) => u.id === assignee.id);
      if (actor.roleKey === 'rd_lead' && !onTeam) {
        throw validationFailed(
          'A Lead can give work only to people on the project team.',
          'assigneeId',
        );
      }
      if (!onTeam) {
        await addMembers(tx, ctx.orgId, env.project.id, [assignee], actor.userId);
        log.audit({
          action: 'project.team_changed',
          recordType: 'project',
          recordId: env.project.id,
          after: { added: [assignee.id], by: 'reassign' },
        });
        log.event({
          type: 'project.team_changed',
          projectId: env.project.id,
          payload: { added: [assignee.id], removed: [] },
        });
      }
      const updated = await assignTask(tx, task, assignee.id, actor.userId);
      log.audit({
        action: 'task.reassigned',
        recordType: 'task',
        recordId: task.id,
        before: { assigneeId: task.assigneeId, queueRole: task.queueRole },
        after: { assigneeId: assignee.id },
      });
      log.event({
        type: 'task.assigned',
        projectId: env.project.id,
        stepKey: task.stepKey,
        payload: { taskId: task.id, assigneeId: assignee.id },
      });
      return presentTask(tx, ctx.orgId, updated);
    }),
  ),
];
