import {
  dateOfInstant,
  decisionValue,
  milestoneOpen,
  milestoneReached,
  runActionRoles,
  stepActions,
  stepsWaitingFor,
  waitsFor,
  workingDaysBetween,
  type ActivityItem,
  type ProjectDetail,
  type ProjectSummary,
  type RouteView,
  type StepKey,
  type StepView,
} from '@coal/shared';
import type { Executor } from '../../core/db/client';
import { explainedSteps } from '../deviations/store';
import { listProjectEvents } from '../events/service';
import { currentSteps, getRuns, stepHistory, versionsByIds } from '../process/service';
import { loadCalendar } from '../schedule/calendar';
import { MILESTONE_ROLES, nextMilestones, presentMilestones } from '../schedule/milestones';
import { activeTasksOfRun, presentTasks, signOffWaits } from '../tasks/service';
import { findUsersByIds, present } from '../users/service';
import type { Env } from './actions';
import { documentNeedsOfSteps } from '../documents/needs';
import { visibleDocuments } from '../documents/service';
import { canSeeProjectContent, may, viewerOf } from './env';
import { activeMembers, type ProjectRow } from './projects';
import { roleName } from './routing';
import { listProductLines } from './service';

const roleRef = (key: string) => ({ key, name: key === 'team' ? 'Project team' : roleName(key) });

export async function presentProjects(
  ex: Executor,
  orgId: string,
  rows: ProjectRow[],
  now: Date = new Date(),
): Promise<ProjectSummary[]> {
  if (rows.length === 0) return [];
  const [runs, lines, creators] = await Promise.all([
    getRuns(
      ex,
      orgId,
      rows.map((r) => r.processRunId),
    ),
    listProductLines(ex, orgId),
    findUsersByIds(
      ex,
      orgId,
      rows.map((r) => r.createdBy),
    ),
  ]);
  const versions = await versionsByIds(
    ex,
    [...runs.values()].map((r) => r.processVersionId),
  );
  const next = await nextMilestones(
    ex,
    orgId,
    [...runs.values()].flatMap((run) => {
      const version = versions.get(run.processVersionId);
      return version
        ? [
            {
              runId: run.id,
              route: version.route,
              running: ['active', 'on_hold'].includes(run.status),
            },
          ]
        : [];
    }),
    now,
  );
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const creatorName = new Map(creators.map((u) => [u.id, u.name]));
  return rows.map((row) => {
    const run = runs.get(row.processRunId);
    const milestone = next.get(row.processRunId);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      productLine: lineById.get(row.productLineId) as ProjectSummary['productLine'],
      status: run?.status ?? 'active',
      stage: run?.stage ?? 1,
      health: run?.health ?? null,
      healthReasons: (run?.healthReasons ?? []) as ProjectSummary['healthReasons'],
      plannedLaunch: run?.plannedLaunch ?? null,
      forecastLaunch: run?.forecastLaunch ?? null,
      nextMilestone: milestone
        ? {
            id: milestone.row.id,
            title: milestone.title,
            targetDate: milestone.row.targetDate,
            status: milestone.status,
            daysLate: milestone.daysLate,
          }
        : null,
      createdAt: row.createdAt.toISOString(),
      createdBy: creatorName.get(row.createdBy) ?? 'Unknown',
    };
  });
}

export async function presentTeam(ex: Executor, env: Env) {
  const members = await activeMembers(ex, env.orgId, env.project.id);
  const users = await present(
    ex,
    env.orgId,
    members.map((m) => m.user),
  );
  return members.map((m, i) => ({
    user: users[i] as ProjectDetail['team'][number]['user'],
    addedAt: m.addedAt.toISOString(),
  }));
}

export async function presentProject(
  ex: Executor,
  env: Env,
  now: Date = new Date(),
): Promise<ProjectDetail> {
  const { run, route, state } = env.loaded;
  const [summary] = await presentProjects(ex, env.orgId, [env.project], now);
  const roles = runActionRoles(route, state);
  const running = ['active', 'on_hold'].includes(state.status);
  return {
    ...(summary as ProjectSummary),
    holdReason: run.holdReason,
    dropReason: run.dropReason,
    team: await presentTeam(ex, env),
    milestones: await presentMilestones(
      ex,
      { orgId: env.orgId, runId: run.id, route, seesContent: canSeeProjectContent(env) },
      now,
    ),
    can: {
      hold: may(env, 'projects.hold', roles.hold),
      resume: may(env, 'projects.resume', roles.resume),
      drop: may(env, 'projects.drop', roles.drop),
      editTeam: may(env, 'projects.team.write', ['rd_head', 'rd_lead']),
      editMilestones: running && may(env, 'milestones.write', MILESTONE_ROLES),
      reachMilestones: running && may(env, 'milestones.reach', MILESTONE_ROLES),
    },
  };
}

/** The route view: every step's state, what is open, and what this person may do. */
export async function presentRoute(
  ex: Executor,
  env: Env,
  now: Date = new Date(),
): Promise<RouteView> {
  const { route, state, run, stepIds, version } = env.loaded;
  const taskRows = await activeTasksOfRun(ex, run.id);
  const tasks = await presentTasks(ex, env.orgId, taskRows, now);
  const inReview = route.steps.flatMap((s) => {
    const id = state.steps[s.key]?.status === 'in_review' ? stepIds.get(s.key) : undefined;
    return id ? [id] : [];
  });
  const [stepRows, cal, explained, waits] = await Promise.all([
    currentSteps(ex, run.id),
    loadCalendar(ex, env.orgId),
    explainedSteps(ex, [...stepIds.values()], dateOfInstant(now)),
    signOffWaits(ex, env.orgId, inReview, now),
  ]);
  const rowOf = new Map(stepRows.map((r) => [r.stepKey, r]));
  const documentNeeds = await documentNeedsOfSteps(
    ex,
    env.orgId,
    run.id,
    route.steps.filter((s) => stepActions(route, state, s.key).submit).map((s) => s.key),
  );
  const today = dateOfInstant(now);
  const tasksByStep = new Map<string, typeof tasks>();
  taskRows.forEach((row, i) => {
    if (row.runStepId && row.runStepId === stepIds.get(row.stepKey ?? '')) {
      const key = row.stepKey as string;
      tasksByStep.set(key, [...(tasksByStep.get(key) ?? []), tasks[i] as (typeof tasks)[number]]);
    }
  });
  const approvers = await findUsersByIds(
    ex,
    env.orgId,
    Object.values(state.steps).flatMap((s) => s.approvedBy),
  );
  const approverName = new Map(approvers.map((u) => [u.id, u.name]));

  const seesContent = canSeeProjectContent(env);
  const steps: StepView[] = route.steps.map((step) => {
    const s = state.steps[step.key] as (typeof state.steps)[string];
    const a = stepActions(route, state, step.key);
    const signer = step.signer ? [step.signer] : [];
    const myBoardTurn =
      !step.all_must_sign ||
      (s.signers.includes(env.actor.userId) && !s.approvedBy.includes(env.actor.userId));
    const mySignOff = may(env, 'steps.approve', signer) && myBoardTurn;
    const deciders = (key: string) => {
      const def = step.decisions.find((d) => d.key === key);
      return def ? [def.by] : [];
    };
    const sendBackTargets = step.send_back
      .filter((rule) => may(env, 'steps.sendBack', [rule.decided_by]))
      .flatMap((rule) => rule.to);
    const dates = rowOf.get(step.key);
    const unfinished = !['approved', 'done', 'cancelled'].includes(s.status);
    const pastDue = !!dates?.plannedEnd && unfinished && today > dates.plannedEnd;
    const stepHealth = unfinished ? (pastDue ? 'overdue' : (dates?.health ?? null)) : null;
    const stepRowId = stepIds.get(step.key);
    const withSigners = (s.status === 'in_review' && stepRowId && waits.get(stepRowId)) || null;
    return {
      key: step.key,
      name: step.name,
      stage: step.stage,
      checkpoint: step.checkpoint,
      new: step.new,
      iteration: s.iteration,
      status: s.status,
      path: s.path,
      doers: step.doers.map(roleRef),
      signer: step.signer ? roleRef(step.signer) : null,
      outside: step.outside,
      outputs:
        s.path && step.path
          ? (step.path.options.find((o) => o.value === s.path)?.outputs ?? [])
          : step.outputs,
      waitsFor: s.status === 'locked' && !step.done_at_go ? waitsFor(route, state, step.key) : [],
      submitNeeds: a.submitNeeds,
      approveNeeds: a.approveNeeds,
      documentNeeds: documentNeeds.get(step.key) ?? [],
      approvedBy: s.approvedBy.map((id) => ({ id, name: approverName.get(id) ?? 'Unknown' })),
      decisions: step.decisions.map((d) => ({
        key: d.key,
        name: d.name,
        by: roleRef(d.by),
        options: d.options,
        answer: decisionValue(state, step.key, d.key) ?? null,
      })),
      tasks: (tasksByStep.get(step.key) ?? []).map((t) => ({
        id: t.id,
        // A corrective action's text is content (it describes a finding); its existence is status.
        title: t.kind === 'corrective_action' && !seesContent ? 'Corrective action' : t.title,
        kind: t.kind,
        status: t.status,
        dueOn: t.dueOn,
        assignee: t.assignee,
        queueRole: t.queueRole,
      })),
      plannedStart: dates?.plannedStart ?? null,
      plannedEnd: dates?.plannedEnd ?? null,
      forecastEnd: dates?.forecastEnd ?? null,
      health: stepHealth,
      daysLate: pastDue && dates?.plannedEnd ? workingDaysBetween(cal, dates.plannedEnd, today) : 0,
      // Once handed in, the wait is the signers': the doers have nothing left to explain.
      needsDeviation:
        pastDue && s.status !== 'in_review' && !!stepRowId && !explained.has(stepRowId),
      withSigners,
      actions: {
        start: a.start && may(env, 'steps.start', step.doers),
        submit: a.submit && may(env, 'steps.submit', step.doers),
        approve: a.approve && mySignOff,
        return: a.return && mySignOff,
        decide: a.decide.filter((key) => may(env, 'steps.decide', deciders(key))),
        sendBack: a.sendBack.filter((to) => sendBackTargets.includes(to)),
        correctiveActions: a.correctiveActions && may(env, 'correctiveActions.create', ['rd_lead']),
        remind:
          !!withSigners &&
          !withSigners.remindedToday &&
          state.status === 'active' &&
          may(env, 'steps.remind', step.doers),
      },
    };
  });

  return {
    process: version.key,
    version: version.version,
    status: state.status,
    stage: run.stage,
    stages: route.stages,
    steps,
    prerequisites: route.milestones.map((m) => ({
      key: m.key,
      name: m.name,
      recordedAt: m.recorded_at,
      recordedBy: m.recorded_by.map(roleRef),
      holdsUp: stepsWaitingFor(route, m.key),
      reached: milestoneReached(route, state, m.key),
      canRecord:
        milestoneOpen(route, state, m.key) && may(env, 'prerequisites.record', m.recorded_by),
    })),
    openCorrectiveActions: state.openCorrectiveActions,
  };
}

export async function presentStep(ex: Executor, env: Env, key: StepKey, now: Date = new Date()) {
  const route = await presentRoute(ex, env, now);
  const step = route.steps.find((s) => s.key === key);
  const history = await stepHistory(ex, env.loaded.run.id, key);
  const seesContent = canSeeProjectContent(env);
  const people = await findUsersByIds(
    ex,
    env.orgId,
    history.decisions.map((d) => d.decidedBy),
  );
  const nameOf = new Map(people.map((u) => [u.id, u.name]));
  return {
    step,
    iterations: history.iterations.map(({ step: row, resetReason }) => ({
      iteration: row.iteration,
      status: row.status,
      openedAt: row.openedAt?.toISOString() ?? null,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      resetReason: seesContent ? (resetReason ?? null) : null,
    })),
    decisions: history.decisions.map((d) => ({
      iteration: d.iteration,
      decision: d.decision,
      value: d.value,
      reason: seesContent ? d.reason : null,
      decidedBy: nameOf.get(d.decidedBy) ?? null,
      at: d.createdAt.toISOString(),
    })),
  };
}

/** What an event says about status. The rest of a payload (comments, titles, reasons) is content. */
const STATUS_PAYLOAD_KEYS = [
  'step',
  'iteration',
  'newIteration',
  'decision',
  'value',
  'milestone',
  'project',
];

export async function presentActivity(
  ex: Executor,
  env: Env,
  query: { cursor?: string | undefined; limit: number },
): Promise<{ items: ActivityItem[]; nextCursor: string | null }> {
  const { rows, nextCursor } = await listProjectEvents(ex, env.orgId, env.project.id, query);
  const people = await findUsersByIds(
    ex,
    env.orgId,
    rows.flatMap((r) => (r.actorId ? [r.actorId] : [])),
  );
  const nameOf = new Map(people.map((u) => [u.id, u.name]));
  const seesContent = canSeeProjectContent(env);
  const visible = (payload: Record<string, unknown>) =>
    seesContent
      ? payload
      : Object.fromEntries(
          Object.entries(payload).filter(([k]) => STATUS_PAYLOAD_KEYS.includes(k)),
        );

  // Events about a document are shown only to people who may read the document, and drafts only to
  // the people who work on the project: the feed must not reveal what the document list hides.
  const aboutDocument = (type: string) => /^(document|signature)\./.test(type);
  const documents = rows.some((r) => aboutDocument(r.type))
    ? await visibleDocuments(ex, await viewerOf(ex, env))
    : null;
  const DRAFT_EVENTS = ['document.created', 'document.version_saved', 'document.carried_forward'];
  const shown = rows.filter((row) => {
    if (!documents || !aboutDocument(row.type)) return true;
    const documentId = (row.payload as { documentId?: unknown }).documentId;
    if (typeof documentId !== 'string' || !documents.readable.has(documentId)) return false;
    return documents.drafts || !DRAFT_EVENTS.includes(row.type);
  });
  return {
    items: shown.map((row) => ({
      id: row.id,
      type: row.type,
      at: row.createdAt.toISOString(),
      actor: {
        type: row.actorType,
        id: row.actorId,
        name: row.actorId ? (nameOf.get(row.actorId) ?? null) : null,
      },
      stepKey: row.stepKey,
      payload: visible(row.payload as Record<string, unknown>),
    })),
    nextCursor,
  };
}
