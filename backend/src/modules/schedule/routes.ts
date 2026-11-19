import {
  changeDates as changeDatesEndpoint,
  getTimeline as getTimelineEndpoint,
  launchStepKey,
  putPlan as putPlanEndpoint,
} from '@coal/shared';
import { change } from '../../core/db/change';
import { implement } from '../../core/http/endpoint';
import { AppError, validationFailed } from '../../core/http/errors';
import { assertMay, loadEnv } from '../rnd/env';
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
];
