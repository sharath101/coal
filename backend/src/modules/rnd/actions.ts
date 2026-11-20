import {
  EngineError,
  OPEN_STATUSES,
  apply,
  startRun,
  stepOf,
  type Action,
  type Effect,
  type Preview,
  type StepDefinition,
  type StepKey,
} from '@coal/shared';
import type { ChangeLog } from '../../core/db/change';
import type { Tx } from '../../core/db/client';
import type { AppDeps } from '../../core/deps';
import type { Actor, RequestContext } from '../../core/http/context';
import { AppError, fromEngineError, notFound, validationFailed } from '../../core/http/errors';
import { insertDeviation } from '../deviations/store';
import { getProductLine } from './service';
import {
  onStepReset,
  onStepReturned,
  onStepSigned,
  onStepSubmitted,
  signDecision,
  type HookContext,
} from '../documents/signoff';
import {
  createRun,
  findRunStep,
  latestVersion,
  recordDecision,
  recordSendBack,
  saveOutcome,
  type Attribution,
  type DecisionRow,
  type LoadedRun,
} from '../process/service';
import {
  closeTasks,
  createTasks,
  findActiveKeyedTask,
  setStepTasksWaiting,
  startStepTasks,
  type NewTask,
} from '../tasks/service';
import { findUser, findUsersByIds, type UserRow } from '../users/service';
import {
  addMembers,
  nextProjectCode,
  requireActiveUsers,
  startingTeam,
  type ProjectRow,
} from './projects';
import { factsOf } from './env';
import { roleName, routeRole } from './routing';
import { projects } from './tables';
import {
  adoptBaseline,
  assertDelayExplained,
  dueResolver,
  recompute,
  splitItems,
  timelineRows,
  type DueResolver,
} from '../schedule/service';

export const RND_ROUTE = 'rnd-route';

/** The date a task is due, and the date it was first due (the on-time rate counts the first). */
const dueFields = (date: string) => ({ dueOn: date, firstDueOn: date });

/** What an action did, as shown in previews and in the response. */
export interface Collected {
  steps: Preview['steps'];
  tasks: Preview['tasks'];
  cancelledTasks: number;
  warnings: string[];
}

export const newCollected = (): Collected => ({
  steps: [],
  tasks: [],
  cancelledTasks: 0,
  warnings: [],
});

export const toPreview = (c: Collected, team: Preview['team'] = []): Preview => ({ ...c, team });

/** Everything an action needs to know about the project it acts on. */
export interface Env {
  orgId: string;
  actor: Actor;
  project: ProjectRow;
  loaded: LoadedRun;
  /** The active team, as people. */
  team: UserRow[];
  /** The time of the action, set when it runs. */
  now?: Date;
}

/** What an action needs beyond the database: the file and PDF services, and whether it is only a preview. */
export interface Services {
  deps: AppDeps;
  preview: boolean;
}

const STEP_CHANGE = {
  'step.ready': 'ready',
  'step.started': 'started',
  'step.submitted': 'submitted',
  'step.signed': 'signed',
  'step.approved': 'approved',
  'step.done': 'done',
  'step.returned': 'returned',
  'step.reset': 'reset',
  'step.cancelled': 'cancelled',
} as const;

const RUN_EVENT = {
  'run.held': 'project.held',
  'run.resumed': 'project.resumed',
  'run.dropped': 'project.dropped',
  'run.completed': 'project.launched',
  'run.closed': 'project.closed',
} as const;

/** Closes tasks and records each one: the audit trail and the events say what the engine closed. */
async function closeAndLog(
  tx: Tx,
  log: ChangeLog,
  env: Env,
  options: Parameters<typeof closeTasks>[2],
): Promise<number> {
  const closed = await closeTasks(tx, env.loaded.run.id, {
    ...options,
    now: env.now ?? new Date(),
  });
  for (const task of closed) {
    log.audit({
      action: `task.${options.status}`,
      recordType: 'task',
      recordId: task.id,
      after: { status: options.status, title: task.title },
    });
    log.event({
      type: `task.${options.status}`,
      projectId: env.project.id,
      stepKey: task.stepKey,
      payload: { taskId: task.id },
    });
  }
  return closed.length;
}

const label = (project: ProjectRow) => `${project.code} · ${project.name}`;

function addWarning(c: Collected, warning: string | null) {
  if (warning && !c.warnings.includes(warning)) c.warnings.push(warning);
}

/** Creates the tasks, and records each in the preview, the audit trail and the events. */
async function makeTasks(
  tx: Tx,
  log: ChangeLog,
  env: Env,
  c: Collected,
  inputs: (NewTask & { assigneeName?: string | null })[],
): Promise<void> {
  const rows = await createTasks(
    tx,
    env.orgId,
    inputs.map(({ assigneeName: _name, ...task }) => task),
  );
  rows.forEach((row, index) => {
    const name = inputs[index]?.assigneeName ?? null;
    c.tasks.push({
      stepKey: row.stepKey,
      kind: row.kind,
      title: row.title,
      assignee: row.assigneeId ? { id: row.assigneeId, name: name ?? '' } : null,
      queueRole: row.queueRole ? { key: row.queueRole, name: roleName(row.queueRole) } : null,
    });
    log.audit({
      action: 'task.created',
      recordType: 'task',
      recordId: row.id,
      after: {
        title: row.title,
        kind: row.kind,
        assigneeId: row.assigneeId,
        queueRole: row.queueRole,
      },
    });
    log.event({
      type: 'task.created',
      projectId: env.project.id,
      stepKey: row.stepKey,
      payload: {
        taskId: row.id,
        title: row.title,
        kind: row.kind,
        roleKey: row.roleKey,
        dueOn: row.dueOn,
        assigneeId: row.assigneeId,
        queueRole: row.queueRole,
      },
    });
  });
}

const taskBase = (env: Env, step: StepDefinition, runStepId: string | undefined) => ({
  runId: env.loaded.run.id,
  runStepId: runStepId ?? null,
  stepKey: step.key,
  subjectType: 'project',
  subjectId: env.project.id,
  subjectLabel: label(env.project),
});

/** When a step opens: one task for each doer role, and any extra tasks the step defines. */
async function openStepTasks(
  tx: Tx,
  log: ChangeLog,
  env: Env,
  c: Collected,
  step: StepDefinition,
  runStepId: string | undefined,
  due: DueResolver,
): Promise<void> {
  const inputs: (NewTask & { assigneeName?: string | null })[] = [];
  const taken = new Set<string>();
  const scope = { productLineId: env.project.productLineId };

  for (const doer of step.doers.filter((d) => d !== 'team')) {
    const routing = await routeRole(tx, env.orgId, scope, env.team, doer);
    addWarning(c, routing.warning);
    if (routing.assignee) taken.add(routing.assignee.id);
    inputs.push({
      ...taskBase(env, step, runStepId),
      ...dueFields(due(step.key, doer, 'work')),
      kind: 'work',
      title: `Work on step ${step.key}: ${step.name}`,
      roleKey: doer,
      assigneeId: routing.assignee?.id ?? null,
      assigneeName: routing.assignee?.name ?? null,
      queueRole: routing.queueRole,
    });
  }
  if (step.doers.includes('team')) {
    for (const member of env.team.filter((m) => !taken.has(m.id))) {
      inputs.push({
        ...taskBase(env, step, runStepId),
        ...dueFields(due(step.key, member.roleKey, 'work')),
        kind: 'work',
        title: `Take part in step ${step.key}: ${step.name}`,
        roleKey: member.roleKey,
        assigneeId: member.id,
        assigneeName: member.name,
        queueRole: null,
      });
    }
  }
  for (const extra of step.tasks) {
    if (await findActiveKeyedTask(tx, env.loaded.run.id, extra.key)) continue;
    const routing = await routeRole(tx, env.orgId, scope, env.team, extra.role);
    addWarning(c, routing.warning);
    inputs.push({
      ...taskBase(env, step, runStepId),
      ...dueFields(due(step.key, extra.role, 'work')),
      kind: 'work',
      title: extra.name,
      taskKey: extra.key,
      keepOnReset: extra.keep_on_reset,
      roleKey: extra.role,
      assigneeId: routing.assignee?.id ?? null,
      assigneeName: routing.assignee?.name ?? null,
      queueRole: routing.queueRole,
    });
  }
  await makeTasks(tx, log, env, c, inputs);
}

/** When a step is submitted: sign-off tasks for the signer (every Board member at 4 and 23). */
async function openSignTasks(
  tx: Tx,
  log: ChangeLog,
  env: Env,
  c: Collected,
  step: StepDefinition,
  runStepId: string | undefined,
  signers: string[],
  due: DueResolver,
): Promise<void> {
  if (!step.signer) return;
  const title = `Sign off step ${step.key}: ${step.name}`;
  const base = {
    ...taskBase(env, step, runStepId),
    ...dueFields(due(step.key, step.signer, 'sign')),
    kind: 'sign' as const,
    title,
    roleKey: step.signer,
  };
  if (step.all_must_sign) {
    const people = await findUsersByIds(tx, env.orgId, signers);
    if (people.length === 0) {
      const name = roleName(step.signer);
      addWarning(c, `No ${name} user yet, so this goes to the ${name} queue.`);
      await makeTasks(tx, log, env, c, [{ ...base, assigneeId: null, queueRole: step.signer }]);
      return;
    }
    await makeTasks(
      tx,
      log,
      env,
      c,
      people.map((p) => ({ ...base, assigneeId: p.id, assigneeName: p.name, queueRole: null })),
    );
    return;
  }
  const routing = await routeRole(
    tx,
    env.orgId,
    { productLineId: env.project.productLineId },
    env.team,
    step.signer,
  );
  addWarning(c, routing.warning);
  await makeTasks(tx, log, env, c, [
    {
      ...base,
      assigneeId: routing.assignee?.id ?? null,
      assigneeName: routing.assignee?.name ?? null,
      queueRole: routing.queueRole,
    },
  ]);
}

/**
 * Turns the engine's effects into tasks, events and audit entries (docs/architecture.md#the-process-engine).
 * `oldIds` are the run step rows before the action, `newIds` after (a send-back adds new ones).
 */
async function applyEffects(
  tx: Tx,
  log: ChangeLog,
  env: Env,
  effects: Effect[],
  oldIds: Map<StepKey, string>,
  newIds: Map<StepKey, string>,
  c: Collected,
  reason: string | undefined,
  h: HookContext,
): Promise<{ baselineNo?: number }> {
  const { route, run } = env.loaded;
  const nameOf = (key: StepKey) => stepOf(route, key)?.name ?? key;
  /** The person who signed: the one acting, or another signer of a step several must sign. */
  const signerNamed = async (userId: string) => {
    if (userId === env.actor.userId) return env.actor;
    const user = await findUser(tx, env.orgId, userId);
    return user ? { userId, name: user.name, roleKey: user.roleKey } : env.actor;
  };
  // Due dates come from the plan; the plan changes when the Action Plan step is approved.
  let due = await dueResolver(tx, env.orgId, run.id, route, h.deps.now());
  const outcome: { baselineNo?: number } = {};

  for (const effect of effects) {
    if (effect.type in STEP_CHANGE) {
      const e = effect as Extract<Effect, { step: StepKey }> & {
        iteration: number;
        newIteration?: number;
      };
      c.steps.push({
        key: e.step,
        name: nameOf(e.step),
        iteration: e.newIteration ?? e.iteration,
        change: STEP_CHANGE[effect.type as keyof typeof STEP_CHANGE],
      });
    }

    switch (effect.type) {
      case 'step.ready': {
        await openStepTasks(
          tx,
          log,
          env,
          c,
          stepOf(route, effect.step) as StepDefinition,
          newIds.get(effect.step),
          due,
        );
        break;
      }
      case 'step.started':
        // The doers' tasks follow the step: no one marks them by hand (P96).
        await startStepTasks(tx, run.id, effect.step, env.now);
        break;
      case 'step.submitted': {
        const step = stepOf(route, effect.step) as StepDefinition;
        await openSignTasks(tx, log, env, c, step, newIds.get(effect.step), effect.signers, due);
        // The doers wait for the signer.
        if (step.signer) await setStepTasksWaiting(tx, run.id, step.key, true, env.now);
        if (step.baseline && splitItems(await timelineRows(tx, run.id)).draft.length === 0) {
          addWarning(
            c,
            'No dates are written for the remaining steps, so the default lengths stay in use.',
          );
        }
        const runStepId = newIds.get(effect.step) as string;
        const row = await findRunStep(tx, runStepId);
        const state = env.loaded.state;
        const decisions = state.decisions
          .filter((d) => d.step === effect.step && d.iteration === effect.iteration)
          .map((d) => {
            const def = step.decisions.find((x) => x.key === d.decision);
            return {
              name: def?.name ?? d.decision,
              answer: def?.options.find((o) => o.value === d.value)?.name ?? d.value,
            };
          });
        for (const warning of await onStepSubmitted(h, {
          step,
          runStepId,
          iteration: effect.iteration,
          openedAt: row?.openedAt ?? null,
          signers: effect.signers,
          decisions,
        })) {
          addWarning(c, warning);
        }
        break;
      }
      case 'step.signed':
        await closeAndLog(tx, log, env, {
          stepKey: effect.step,
          kinds: ['sign'],
          status: 'done',
          assigneeId: effect.by,
        });
        await onStepSigned(h, effect.step, await signerNamed(effect.by));
        break;
      case 'step.approved': {
        await closeAndLog(tx, log, env, {
          stepKey: effect.step,
          kinds: ['sign', 'work'],
          status: 'done',
        });
        await onStepSigned(h, effect.step, await signerNamed(effect.by));
        if ((stepOf(route, effect.step) as StepDefinition).baseline) {
          const baselineNo = run.baselineNo + 1;
          const written = await adoptBaseline(tx, env.orgId, run.id, effect.by, baselineNo);
          if (written > 0) {
            outcome.baselineNo = baselineNo;
            due = await dueResolver(tx, env.orgId, run.id, route, h.deps.now());
            log.event({
              type: 'timeline.changed',
              projectId: env.project.id,
              stepKey: effect.step,
              payload: { baselineNo, items: written },
            });
          }
        }
        break;
      }
      case 'step.done':
        await closeAndLog(tx, log, env, { stepKey: effect.step, kinds: ['work'], status: 'done' });
        break;
      case 'step.returned':
        await closeAndLog(tx, log, env, {
          stepKey: effect.step,
          kinds: ['sign'],
          status: 'cancelled',
        });
        await setStepTasksWaiting(tx, run.id, effect.step, false, env.now);
        await onStepReturned(h, effect.step, effect.comment);
        break;
      case 'step.reset':
        // The step-20 follow-up is never cancelled: patients already treated must still be followed (P16).
        c.cancelledTasks += await closeAndLog(tx, log, env, {
          stepKey: effect.step,
          status: 'cancelled',
          keepOnReset: true,
        });
        await onStepReset(h, effect.step, {
          runStepId: newIds.get(effect.step) as string,
          iteration: effect.newIteration,
        });
        if (effect.reopened) {
          // The delay is recorded as a deviation with the reason "rework" (docs/workflow.md).
          const reopened = stepOf(route, effect.step) as StepDefinition;
          const deviation = await insertDeviation(tx, env.orgId, {
            runId: run.id,
            runStepId: newIds.get(effect.step) ?? null,
            stepKey: effect.step,
            taskId: null,
            kind: 'rework',
            plannedDate: null,
            newDate: null,
            reasonCode: 'rework',
            reasonText: reason ?? 'Sent back for rework.',
            causeType: 'role',
            causeUserId: null,
            causeRole: reopened.doers.find((d) => d !== 'team') ?? null,
            causeParty: null,
            recordedBy: env.actor.userId,
            correctsId: null,
          });
          log.audit({
            action: 'deviation.recorded',
            recordType: 'deviation',
            recordId: deviation.id,
            after: { step: effect.step, kind: 'rework', reasonCode: 'rework' },
            reason,
          });
          log.event({
            type: 'deviation.recorded',
            projectId: env.project.id,
            stepKey: effect.step,
            payload: { deviationId: deviation.id, kind: 'rework', reasonCode: 'rework' },
          });
        }
        break;
      case 'run.dropped':
        c.cancelledTasks += await closeAndLog(tx, log, env, { status: 'cancelled' });
        break;
      default:
        break;
    }

    // Events and audit entries.
    if (effect.type in STEP_CHANGE) {
      const e = effect as Extract<Effect, { step: StepKey }> & {
        iteration: number;
        newIteration?: number;
        comment?: string;
      };
      const recordId = (effect.type === 'step.reset' ? oldIds : newIds).get(e.step) as string;
      const payload: Record<string, unknown> = { step: e.step, iteration: e.iteration };
      if (e.newIteration) payload.newIteration = e.newIteration;
      if (effect.type === 'step.returned') payload.comment = effect.comment;
      log.event({ type: effect.type, projectId: env.project.id, stepKey: e.step, payload });
      log.audit({
        action: effect.type,
        recordType: 'run_step',
        recordId,
        after: payload,
        reason: effect.type === 'step.reset' || effect.type === 'step.returned' ? reason : null,
      });
    } else if (effect.type === 'decision.recorded') {
      const payload = {
        step: effect.step,
        iteration: effect.iteration,
        decision: effect.decision,
        value: effect.value,
      };
      log.event({
        type: 'decision.recorded',
        projectId: env.project.id,
        stepKey: effect.step,
        payload,
      });
      log.audit({
        action: 'decision.recorded',
        recordType: 'run_step',
        recordId: (effect.step ? newIds.get(effect.step) : undefined) ?? run.id,
        after: payload,
        reason,
      });
    } else if (effect.type === 'milestone.recorded') {
      const payload = {
        milestone: effect.milestone,
        step: effect.step,
        iteration: effect.iteration,
      };
      log.event({
        type: 'milestone.recorded',
        projectId: env.project.id,
        stepKey: effect.step,
        payload,
      });
      log.audit({
        action: 'milestone.recorded',
        recordType: 'project',
        recordId: env.project.id,
        after: payload,
      });
    } else if (effect.type in RUN_EVENT) {
      const type = RUN_EVENT[effect.type as keyof typeof RUN_EVENT];
      log.event({ type, projectId: env.project.id, payload: { project: env.project.code } });
      log.audit({
        action: type,
        recordType: 'project',
        recordId: env.project.id,
        after: { event: effect.type },
        reason,
      });
    }
  }
  return outcome;
}

/**
 * Applies one action to a project's run: asks the engine, saves the new state, then makes the
 * tasks, events and audit entries. Everything is in the caller's transaction.
 */
export async function performAction(
  tx: Tx,
  log: ChangeLog,
  env: Env,
  action: Action,
  attribution: Attribution,
  services: Services,
): Promise<Collected> {
  const { loaded } = env;
  const now = services.deps.now();
  env.now = now;
  let outcome;
  try {
    outcome = apply(loaded.route, loaded.state, action);
  } catch (error) {
    if (error instanceof EngineError) throw fromEngineError(error);
    throw error;
  }
  // Work that is late can't be handed in until someone says why (docs/dashboard.md#deviations).
  if (action.type === 'submit') {
    const runStepId = loaded.stepIds.get(action.step);
    if (runStepId) await assertDelayExplained(tx, runStepId, now);
  }

  const sendBackId =
    action.type === 'send_back'
      ? await recordSendBack(tx, env.orgId, loaded, {
          fromStep: action.from,
          toStep: action.to,
          effects: outcome.effects,
          attribution,
        })
      : undefined;
  const saved = await saveOutcome(
    tx,
    env.orgId,
    loaded,
    outcome.state,
    outcome.effects,
    attribution,
    sendBackId,
    now,
  );
  const decided: DecisionRow[] = [...saved.decisions];
  if (action.type === 'hold' || action.type === 'resume' || action.type === 'drop') {
    decided.push(
      await recordDecision(tx, env.orgId, loaded.run.id, {
        decision: action.type,
        value: action.type,
        reason: attribution.reason,
        by: attribution.userId,
      }),
    );
  }

  const hooks = await hookContext(tx, log, env, services);
  // Every decision is signed by the person who made it.
  for (const decision of decided) await signDecision(hooks, decision);

  const c = newCollected();
  const applied = await applyEffects(
    tx,
    log,
    env,
    outcome.effects,
    loaded.stepIds,
    saved.stepIds,
    c,
    attribution.reason,
    hooks,
  );
  if (action.type === 'send_back') {
    log.audit({
      action: 'send_back.recorded',
      recordType: 'project',
      recordId: env.project.id,
      after: { from: action.from, to: action.to },
      reason: attribution.reason,
    });
  }
  await recompute(tx, log, now, env.orgId, env.project.id, loaded.run.id, applied);
  return c;
}

/** What the documents module is told as the action's effects are applied. */
async function hookContext(
  tx: Tx,
  log: ChangeLog,
  env: Env,
  services: Services,
): Promise<HookContext> {
  return {
    deps: services.deps,
    tx,
    log,
    facts: await factsOf(tx, env),
    preview: services.preview,
    actor: env.actor,
  };
}

export interface GoInput {
  name: string;
  description: string;
  productLineId: string;
  teamUserIds: string[];
}

/** Go: creates the project, its run and its team, and opens the first steps. */
export async function goProject(
  tx: Tx,
  log: ChangeLog,
  ctx: RequestContext,
  actor: Actor,
  input: GoInput,
  services: Services,
): Promise<{ project: ProjectRow; collected: Collected; team: UserRow[] }> {
  const line = await getProductLine(tx, ctx.orgId, input.productLineId);
  if (!line) throw validationFailed('There is no such product line.', 'productLineId');
  const version = await latestVersion(tx, ctx.orgId, RND_ROUTE);
  if (!version) throw notFound('route');

  const extra = await requireActiveUsers(tx, ctx.orgId, input.teamUserIds, 'teamUserIds');
  const starting = await startingTeam(tx, ctx.orgId, line.id);
  const team = [...new Map([...starting, ...extra].map((u) => [u.id, u])).values()];

  const start = startRun(version.route);
  const now = services.deps.now();
  const { run, stepIds } = await createRun(tx, ctx.orgId, version, start.state, now);
  const code = await nextProjectCode(tx, ctx.orgId, line);
  const [project] = await tx
    .insert(projects)
    .values({
      orgId: ctx.orgId,
      code,
      name: input.name,
      description: input.description,
      productLineId: line.id,
      processRunId: run.id,
      createdBy: actor.userId,
    })
    .returning();
  const row = project as ProjectRow;
  await addMembers(tx, ctx.orgId, row.id, team, actor.userId);

  const loaded: LoadedRun = { run, version, route: version.route, state: start.state, stepIds };
  const env: Env = { orgId: ctx.orgId, actor, project: row, loaded, team, now };

  // The VP's click is the Go decision, and it is signed (a confirmed click until passkeys).
  const hooks = await hookContext(tx, log, env, services);
  for (const effect of start.effects) {
    if (effect.type === 'decision.recorded') {
      const decision = await recordDecision(tx, ctx.orgId, run.id, {
        runStepId: effect.step ? stepIds.get(effect.step) : undefined,
        stepKey: effect.step,
        iteration: effect.iteration,
        decision: effect.decision,
        value: effect.value,
        by: actor.userId,
      });
      await signDecision(hooks, decision);
    }
  }
  log.audit({
    action: 'project.created',
    recordType: 'project',
    recordId: row.id,
    after: { code, name: row.name, productLineId: line.id, team: team.map((u) => u.id) },
  });
  log.event({ type: 'project.created', projectId: row.id, payload: { code, name: row.name } });

  const collected = newCollected();
  await applyEffects(tx, log, env, start.effects, stepIds, stepIds, collected, undefined, hooks);
  await recompute(tx, log, now, ctx.orgId, row.id, run.id);
  return { project: row, collected, team };
}

/** Raises a corrective action from the case study, as a task. Step 18 waits until all are closed. */
export async function raiseCorrectiveAction(
  tx: Tx,
  log: ChangeLog,
  env: Env,
  input: { title: string; body: string; assigneeId?: string | undefined },
  now: Date,
): Promise<Collected> {
  const { route, state } = env.loaded;
  if (!['active', 'completed'].includes(state.status)) {
    throw new AppError(
      409,
      'PROJECT_NOT_ACTIVE',
      "The project is on hold or finished, so this can't be done now.",
    );
  }
  const step = route.steps.find(
    (s) => s.corrective_actions && OPEN_STATUSES.includes(state.steps[s.key]?.status ?? 'locked'),
  );
  if (!step) {
    throw new AppError(
      409,
      'STEP_NOT_READY',
      'Corrective actions are raised from the case study, while its step is open.',
    );
  }
  const c = newCollected();
  let assignee: UserRow | null = null;
  let queueRole: string | null = null;
  if (input.assigneeId) {
    assignee =
      (await requireActiveUsers(tx, env.orgId, [input.assigneeId], 'assigneeId'))[0] ?? null;
  } else {
    const routing = await routeRole(
      tx,
      env.orgId,
      { productLineId: env.project.productLineId },
      env.team,
      'rd_lead',
    );
    addWarning(c, routing.warning);
    assignee = routing.assignee;
    queueRole = routing.queueRole;
  }
  const due = await dueResolver(tx, env.orgId, env.loaded.run.id, route, now);
  await makeTasks(tx, log, env, c, [
    {
      ...taskBase(env, step, env.loaded.stepIds.get(step.key)),
      ...dueFields(due(step.key, null, 'corrective_action')),
      kind: 'corrective_action',
      title: input.title,
      body: input.body,
      roleKey: assignee?.roleKey ?? queueRole,
      assigneeId: assignee?.id ?? null,
      assigneeName: assignee?.name ?? null,
      queueRole,
      assignedBy: env.actor.userId,
    },
  ]);
  return c;
}
