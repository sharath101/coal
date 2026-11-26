import {
  addMilestone as addMilestoneEndpoint,
  changeDates as changeDatesEndpoint,
  dateOfInstant,
  getTimeline as getTimelineEndpoint,
  launchStepKey,
  putPlan as putPlanEndpoint,
  reachMilestone as reachMilestoneEndpoint,
  removeMilestone as removeMilestoneEndpoint,
  updateMilestone as updateMilestoneEndpoint,
  type RouteDefinition,
} from '@coal/shared';
import { change, type ChangeLog } from '../../core/db/change';
import type { Tx } from '../../core/db/client';
import type { Actor, RequestContext } from '../../core/http/context';
import { implement } from '../../core/http/endpoint';
import { AppError, validationFailed } from '../../core/http/errors';
import type { Env } from '../rnd/actions';
import { assertMay, canSeeProjectContent, loadEnv } from '../rnd/env';
import {
  MILESTONE_ROLES,
  checkMilestoneInput,
  checkTargetDate,
  insertMilestones,
  lockMilestone,
  milestoneTitle,
  milestonesOfRuns,
  presentMilestones,
  refuseStepMilestone,
  updateMilestoneRow,
  type MilestoneRow,
} from './milestones';
import {
  insertChange,
  recompute,
  replaceDraft,
  splitItems,
  timelineRows,
  validatePlanItems,
} from './service';
import { PLAN_EDITABLE, presentTimeline } from './timeline';

export const scheduleRoutes = [
  implement(getTimelineEndpoint, async ({ deps, ctx, actor, params }) =>
    presentTimeline(deps.db, await loadEnv(deps.db, ctx.orgId, actor, params.id), deps.now()),
  ),

  implement(putPlanEndpoint, ({ deps, ctx, actor, params, body }) =>
    change(deps.db, ctx, async (tx, log) => {
      const env = await loadEnv(tx, ctx.orgId, actor, params.id, { forUpdate: true });
      const { route, state, run } = env.loaded;
      const planStep = route.steps.find((s) => s.baseline);
      if (!planStep) {
        throw new AppError(409, 'STEP_NOT_READY', 'This route has no step that writes the plan.');
      }
      assertMay(env, 'timeline.plan', planStep.doers);
      if (state.status !== 'active') {
        throw new AppError(
          409,
          'PROJECT_NOT_ACTIVE',
          "The project isn't running, so its plan can't change.",
        );
      }
      if (!PLAN_EDITABLE.includes(state.steps[planStep.key]?.status ?? '')) {
        throw new AppError(
          409,
          'STEP_NOT_READY',
          `The plan can be written while step ${planStep.key} (${planStep.name}) is open and not under review.`,
        );
      }
      validatePlanItems(route, (key) => state.steps[key]?.status ?? 'locked', body.items);
      await replaceDraft(tx, ctx.orgId, run.id, actor.userId, body.items);
      log.audit({
        action: 'timeline.plan_saved',
        recordType: 'project',
        recordId: env.project.id,
        after: { items: body.items.length },
      });
      return presentTimeline(tx, env, deps.now());
    }),
  ),

  implement(changeDatesEndpoint, ({ deps, ctx, actor, params, body }) =>
    change(deps.db, ctx, async (tx, log) => {
      const env = await loadEnv(tx, ctx.orgId, actor, params.id, { forUpdate: true });
      const { route, state, run } = env.loaded;
      if (!['active', 'on_hold'].includes(state.status)) {
        throw new AppError(
          409,
          'PROJECT_NOT_ACTIVE',
          "The project isn't running, so its dates can't change.",
        );
      }
      if (run.baselineNo < 1) {
        throw new AppError(
          409,
          'STEP_NOT_READY',
          'Dates can be changed once the Action Plan is signed. Until then, write them in the plan.',
        );
      }
      validatePlanItems(route, (key) => state.steps[key]?.status ?? 'locked', [body]);
      // The Head changes dates; only the VP changes the step that is the launch.
      const launches = launchStepKey(route) === body.stepKey;
      assertMay(env, 'timeline.change', launches ? ['vp'] : ['rd_head', 'vp']);
      const { current } = splitItems(await timelineRows(tx, run.id));
      const before = current.find((r) => r.stepKey === body.stepKey && r.roleKey === body.roleKey);
      if (
        before &&
        before.plannedStart === body.plannedStart &&
        before.plannedEnd === body.plannedEnd
      ) {
        throw validationFailed('Those are already the planned dates.', 'plannedEnd');
      }
      await insertChange(tx, ctx.orgId, run.id, actor.userId, body);
      log.audit({
        action: 'timeline.changed',
        recordType: 'project',
        recordId: env.project.id,
        before: before ? { start: before.plannedStart, end: before.plannedEnd } : null,
        after: {
          step: body.stepKey,
          role: body.roleKey,
          start: body.plannedStart,
          end: body.plannedEnd,
        },
        reason: body.reason,
      });
      log.event({
        type: 'timeline.changed',
        projectId: env.project.id,
        stepKey: body.stepKey,
        payload: { step: body.stepKey, role: body.roleKey, end: body.plannedEnd },
      });
      await recompute(tx, log, deps.now(), ctx.orgId, env.project.id, run.id);
      return presentTimeline(tx, env, deps.now());
    }),
  ),

  implement(addMilestoneEndpoint, ({ deps, ctx, actor, params, body }) =>
    change(deps.db, ctx, async (tx, log) => {
      const env = await milestoneEnv(tx, ctx, actor, params.id, 'milestones.write');
      const { route, run } = env.loaded;
      const existing = await milestonesOfRuns(tx, [run.id]);
      checkMilestoneInput(route, body, {
        today: dateOfInstant(deps.now()),
        takenSteps: new Set(existing.flatMap((m) => (m.stepKey ? [m.stepKey] : []))),
        path: '',
      });
      const [row] = await insertMilestones(tx, ctx.orgId, run.id, actor.userId, [body]);
      const added = row as MilestoneRow;
      log.audit({
        action: 'project_milestone.added',
        recordType: 'project_milestone',
        recordId: added.id,
        after: { projectId: env.project.id, ...milestoneRecord(added) },
      });
      milestoneEvent(log, env, route, added, 'added');
      return afterMilestoneChange(tx, log, deps.now(), env);
    }),
  ),

  implement(updateMilestoneEndpoint, ({ deps, ctx, actor, params, body }) =>
    change(deps.db, ctx, async (tx, log) => {
      const env = await milestoneEnv(tx, ctx, actor, params.id, 'milestones.write');
      const { route, run } = env.loaded;
      const row = await lockMilestone(tx, run.id, params.milestoneId);
      if (body.title !== undefined && row.stepKey) {
        throw validationFailed("A step milestone takes the step's name.", 'title');
      }
      if (body.targetDate) {
        checkTargetDate(body.targetDate, { today: dateOfInstant(deps.now()), path: '' });
      }
      const set = {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.targetDate !== undefined && { targetDate: body.targetDate }),
      };
      const after = { ...row, ...set };
      if (after.title === row.title && after.targetDate === row.targetDate) {
        throw validationFailed('The milestone already has that title and date.', 'targetDate');
      }
      await updateMilestoneRow(tx, row.id, set);
      log.audit({
        action: 'project_milestone.changed',
        recordType: 'project_milestone',
        recordId: row.id,
        before: milestoneRecord(row),
        after: milestoneRecord(after),
      });
      milestoneEvent(log, env, route, after, 'changed');
      return afterMilestoneChange(tx, log, deps.now(), env);
    }),
  ),

  implement(removeMilestoneEndpoint, ({ deps, ctx, actor, params }) =>
    change(deps.db, ctx, async (tx, log) => {
      const env = await milestoneEnv(tx, ctx, actor, params.id, 'milestones.write');
      const { route, run } = env.loaded;
      const row = await lockMilestone(tx, run.id, params.milestoneId);
      await updateMilestoneRow(tx, row.id, { removedAt: deps.now() });
      log.audit({
        action: 'project_milestone.removed',
        recordType: 'project_milestone',
        recordId: row.id,
        before: milestoneRecord(row),
      });
      milestoneEvent(log, env, route, row, 'removed');
      return afterMilestoneChange(tx, log, deps.now(), env);
    }),
  ),

  implement(reachMilestoneEndpoint, ({ deps, ctx, actor, params, body }) =>
    change(deps.db, ctx, async (tx, log) => {
      const env = await milestoneEnv(tx, ctx, actor, params.id, 'milestones.reach');
      const { route, run } = env.loaded;
      const row = await lockMilestone(tx, run.id, params.milestoneId);
      refuseStepMilestone(route, row);
      const title = milestoneTitle(route, row);
      if (body.reached === !!row.reachedAt) {
        throw new AppError(
          409,
          'ALREADY_DONE',
          body.reached ? `"${title}" is already reached.` : `"${title}" isn't marked reached.`,
        );
      }
      const set = body.reached
        ? { reachedAt: deps.now(), reachedBy: actor.userId, note: body.note || null }
        : { reachedAt: null, reachedBy: null, note: null };
      await updateMilestoneRow(tx, row.id, set);
      log.audit({
        action: body.reached ? 'project_milestone.reached' : 'project_milestone.unreached',
        recordType: 'project_milestone',
        recordId: row.id,
        before: { reachedAt: row.reachedAt, note: row.note },
        after: { reachedAt: set.reachedAt, note: set.note },
      });
      milestoneEvent(log, env, route, row, body.reached ? 'reached' : 'unreached');
      return afterMilestoneChange(tx, log, deps.now(), env);
    }),
  ),
];

/** Loads a project for a change to its milestones: locked, the person allowed, and still running. */
async function milestoneEnv(
  tx: Tx,
  ctx: RequestContext,
  actor: Actor,
  projectId: string,
  permission: 'milestones.write' | 'milestones.reach',
): Promise<Env> {
  const env = await loadEnv(tx, ctx.orgId, actor, projectId, { forUpdate: true });
  assertMay(env, permission, MILESTONE_ROLES);
  if (!['active', 'on_hold'].includes(env.loaded.state.status)) {
    throw new AppError(
      409,
      'PROJECT_NOT_ACTIVE',
      "The project isn't running, so its milestones can't change.",
    );
  }
  return env;
}

const milestoneRecord = (m: MilestoneRow) => ({
  runId: m.runId,
  stepKey: m.stepKey,
  title: m.title,
  targetDate: m.targetDate,
});

function milestoneEvent(
  log: ChangeLog,
  env: Env,
  route: RouteDefinition,
  m: MilestoneRow,
  what: 'added' | 'changed' | 'removed' | 'reached' | 'unreached',
) {
  log.event({
    type: `project_milestone.${what}`,
    projectId: env.project.id,
    ...(m.stepKey && { stepKey: m.stepKey }),
    payload: {
      milestone: milestoneTitle(route, m),
      ...(m.stepKey && { step: m.stepKey }),
      targetDate: m.targetDate,
    },
  });
}

/** Health counts milestones, so it is worked out again; the answer is the project's milestones. */
async function afterMilestoneChange(tx: Tx, log: ChangeLog, now: Date, env: Env) {
  const { route, run } = env.loaded;
  await recompute(tx, log, now, env.orgId, env.project.id, run.id);
  return {
    items: await presentMilestones(
      tx,
      { orgId: env.orgId, runId: run.id, route, seesContent: canSeeProjectContent(env) },
      now,
    ),
  };
}
