import {
  FINISHED_STATUSES,
  addWorkingDays,
  dateOfInstant,
  defaultLaunch,
  launchStepKey,
  planOfSteps,
  projectHealth,
  scheduleRun,
  type DateKey,
  type PlanItem,
  type RouteDefinition,
  type RunSchedule,
  type StepFacts,
  type StepKey,
} from '@coal/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { ChangeLog } from '../../core/db/change';
import type { Executor, Tx } from '../../core/db/client';
import { AppError, validationFailed } from '../../core/http/errors';
import { explainedSteps } from '../deviations/store';
import { ROLES } from '../org/catalogue';
import { currentSteps, findRunStep, loadRun, saveSchedule, type RunRow } from '../process/service';
import { moveDueDates, movedDueDates } from '../tasks/service';
import { loadCalendar, loadSettings } from './calendar';
import { evaluateMilestones, milestoneHealth, milestonesOfRuns } from './milestones';
import { timelineItems } from './tables';

export type TimelineRow = typeof timelineItems.$inferSelect;

const ROLE_KEYS = new Set(ROLES.map((r) => r.key));

export async function timelineRows(ex: Executor, runId: string): Promise<TimelineRow[]> {
  return ex
    .select()
    .from(timelineItems)
    .where(eq(timelineItems.runId, runId))
    .orderBy(asc(timelineItems.createdAt), asc(timelineItems.id));
}

export interface SplitItems {
  draft: TimelineRow[];
  baseline: TimelineRow[];
  changes: TimelineRow[];
  /** The plan now: the newest baseline or change row for each step and role. */
  current: TimelineRow[];
}

export function splitItems(rows: TimelineRow[]): SplitItems {
  const latest = new Map<string, TimelineRow>();
  for (const row of rows) {
    if (row.kind !== 'draft') latest.set(`${row.stepKey}|${row.roleKey}`, row);
  }
  return {
    draft: rows.filter((r) => r.kind === 'draft'),
    baseline: rows.filter((r) => r.kind === 'baseline'),
    changes: rows.filter((r) => r.kind === 'change'),
    current: [...latest.values()],
  };
}

export const planOfRows = (rows: TimelineRow[]) =>
  planOfSteps(
    rows.map((r) => ({
      stepKey: r.stepKey,
      plannedStart: r.plannedStart,
      plannedEnd: r.plannedEnd,
    })),
  );

type TaskKind = 'work' | 'review' | 'sign' | 'decision' | 'corrective_action' | 'request' | 'own';

export type DueResolver = (stepKey: string, roleKey: string | null, kind: TaskKind) => string;

/**
 * Works out each new task's due date: the plan's end for that role (or for the step), and
 * otherwise the step's default length from today. A signature is due a few working days after
 * it is asked for (docs/dashboard.md#where-dates-come-from).
 */
export async function dueResolver(
  ex: Executor,
  orgId: string,
  runId: string,
  route: RouteDefinition,
  now: Date,
): Promise<DueResolver> {
  const [cal, settings, rows] = await Promise.all([
    loadCalendar(ex, orgId),
    loadSettings(ex, orgId),
    timelineRows(ex, runId),
  ]);
  const { current } = splitItems(rows);
  const byRole = new Map(current.map((r) => [`${r.stepKey}|${r.roleKey}`, r.plannedEnd]));
  const byStep = planOfRows(current);
  const today = dateOfInstant(now);
  return (stepKey, roleKey, kind) => {
    if (kind === 'sign') return addWorkingDays(cal, today, settings.signatureDueWorkingDays);
    if (kind === 'corrective_action') {
      return addWorkingDays(cal, today, settings.correctiveActionDueWorkingDays);
    }
    const own = roleKey ? byRole.get(`${stepKey}|${roleKey}`) : undefined;
    if (own) return own;
    const plan = byStep[stepKey];
    if (plan) return plan.end;
    const days = route.steps.find((s) => s.key === stepKey)?.default_days ?? 5;
    return addWorkingDays(cal, today, days);
  };
}

export interface Recomputed {
  schedule: RunSchedule;
  health: 'green' | 'amber' | 'red' | null;
  plannedLaunch: DateKey | null;
}

/**
 * Works out every step's dates and health and the project's, and stores them. Runs after every
 * action, every date change and deviation, and nightly, because time passing makes steps late.
 */
export async function recompute(
  tx: Tx,
  log: ChangeLog | null,
  now: Date,
  orgId: string,
  projectId: string,
  runId: string,
  options: { baselineNo?: number } = {},
): Promise<Recomputed> {
  const { run, route } = await loadRun(tx, orgId, runId, { forUpdate: true });
  const [rows, cal, settings, itemRows, expected, milestoneRows] = await Promise.all([
    currentSteps(tx, runId),
    loadCalendar(tx, orgId),
    loadSettings(tx, orgId),
    timelineRows(tx, runId),
    movedDueDates(tx, runId),
    milestonesOfRuns(tx, [runId]),
  ]);
  const { current } = splitItems(itemRows);
  const plan = planOfRows(current);
  const byKey = new Map(rows.map((r) => [r.stepKey, r]));
  const today = dateOfInstant(now);
  const startedOn = dateOfInstant(run.startedAt);

  const facts: Record<StepKey, StepFacts> = {};
  for (const step of route.steps) {
    const row = byKey.get(step.key);
    facts[step.key] = {
      status: row?.status ?? 'locked',
      openedOn: row?.openedAt ? dateOfInstant(row.openedAt) : null,
      submittedOn: row?.submittedAt ? dateOfInstant(row.submittedAt) : null,
      completedOn: row?.completedAt ? dateOfInstant(row.completedAt) : null,
      plan: plan[step.key] ?? null,
      expectedEnd: row ? (expected.get(row.id) ?? null) : null,
    };
  }
  const schedule = scheduleRun(route, facts, { today, startedOn, cal, settings });

  const launch = launchStepKey(route);
  const plannedLaunch =
    (launch && plan[launch]?.end) ||
    run.plannedLaunch ||
    defaultLaunch(route, startedOn, cal, settings);
  const tracked = ['active', 'on_hold'].includes(run.status);
  const milestones = evaluateMilestones(
    route,
    milestoneRows,
    (key) => {
      const f = facts[key];
      return f
        ? {
            status: f.status,
            completedOn: f.completedOn,
            forecastEnd: schedule.steps[key]?.forecastEnd ?? null,
          }
        : undefined;
    },
    today,
    cal,
  );
  const outcome = tracked
    ? projectHealth(route, schedule, {
        plannedLaunch,
        settings,
        milestones: milestoneHealth(milestones),
      })
    : { health: null, reasons: [] };

  await saveSchedule(
    tx,
    runId,
    rows.flatMap((row) => {
      const s = schedule.steps[row.stepKey];
      return s
        ? [
            {
              id: row.id,
              plannedStart: s.plannedStart,
              plannedEnd: s.plannedEnd,
              forecastStart: s.forecastStart,
              forecastEnd: s.forecastEnd,
              health: s.health,
            },
          ]
        : [];
    }),
    {
      plannedLaunch,
      forecastLaunch: schedule.forecastLaunch,
      health: outcome.health,
      healthReasons: outcome.reasons,
      scheduledOn: today,
      ...(options.baselineNo !== undefined && { baselineNo: options.baselineNo }),
    },
  );

  if (log) reportChanges(log, projectId, run, schedule, outcome.health);
  return { schedule, health: outcome.health, plannedLaunch };
}

function reportChanges(
  log: ChangeLog,
  projectId: string,
  before: RunRow,
  schedule: RunSchedule,
  health: 'green' | 'amber' | 'red' | null,
) {
  if (before.health !== health && (before.health !== null || health !== null)) {
    log.event({
      type: 'project.health_changed',
      projectId,
      payload: { from: before.health, to: health },
    });
  }
  if (before.forecastLaunch && before.forecastLaunch !== schedule.forecastLaunch) {
    log.event({
      type: 'forecast.changed',
      projectId,
      payload: { from: before.forecastLaunch, to: schedule.forecastLaunch },
    });
  }
}

/**
 * Refuses a late step's submission until someone has recorded why it is late (docs/dashboard.md#deviations).
 */
export async function assertDelayExplained(
  ex: Executor,
  runStepId: string,
  now: Date,
): Promise<void> {
  const row = await findRunStep(ex, runStepId);
  const today = dateOfInstant(now);
  if (!row?.plannedEnd || today <= row.plannedEnd) return;
  if ((await explainedSteps(ex, [row.id], today)).has(row.id)) return;
  throw new AppError(
    409,
    'DEVIATION_REQUIRED',
    `This step was due on ${row.plannedEnd}. Record why it is late, and the new date, before submitting it.`,
  );
}

/** Checks a list of plan items against the route and the steps' states. Throws with the first problem. */
export function validatePlanItems(
  route: RouteDefinition,
  statusOf: (key: StepKey) => string,
  items: readonly PlanItem[],
): void {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    const path = `items.${i}`;
    const step = route.steps.find((s) => s.key === item.stepKey);
    if (!step || step.done_at_go) {
      throw validationFailed(`There is no step ${item.stepKey} to plan.`, `${path}.stepKey`);
    }
    if ([...FINISHED_STATUSES, 'cancelled'].includes(statusOf(step.key))) {
      throw validationFailed(
        `Step ${step.key} is finished, so its dates are fixed.`,
        `${path}.stepKey`,
      );
    }
    const roleOk =
      ROLE_KEYS.has(item.roleKey) &&
      (step.doers.includes(item.roleKey) ||
        step.signer === item.roleKey ||
        step.doers.includes('team'));
    if (!roleOk) {
      throw validationFailed(
        `Step ${step.key} has no part for the role "${item.roleKey}".`,
        `${path}.roleKey`,
      );
    }
    const id = `${item.stepKey}|${item.roleKey}`;
    if (seen.has(id)) {
      throw validationFailed(`Step ${step.key} has the same role twice.`, `${path}.roleKey`);
    }
    seen.add(id);
  });
}

/** Replaces the plan being written. */
export async function replaceDraft(
  tx: Tx,
  orgId: string,
  runId: string,
  userId: string,
  items: readonly PlanItem[],
): Promise<void> {
  await tx
    .delete(timelineItems)
    .where(and(eq(timelineItems.runId, runId), eq(timelineItems.kind, 'draft')));
  if (items.length === 0) return;
  await tx.insert(timelineItems).values(
    items.map((i) => ({
      orgId,
      runId,
      kind: 'draft' as const,
      stepKey: i.stepKey,
      roleKey: i.roleKey,
      plannedStart: i.plannedStart,
      plannedEnd: i.plannedEnd,
      recordedBy: userId,
    })),
  );
}

/**
 * The Action Plan is signed: the draft becomes the baseline, and what it dates now applies to
 * the tasks that are already open. Returns how many dates it holds (zero: nothing was written).
 */
export async function adoptBaseline(
  tx: Tx,
  orgId: string,
  runId: string,
  userId: string,
  baselineNo: number,
): Promise<number> {
  const drafts = splitItems(await timelineRows(tx, runId)).draft;
  if (drafts.length === 0) return 0;
  await tx.insert(timelineItems).values(
    drafts.map((d) => ({
      orgId,
      runId,
      kind: 'baseline' as const,
      baselineNo,
      stepKey: d.stepKey,
      roleKey: d.roleKey,
      plannedStart: d.plannedStart,
      plannedEnd: d.plannedEnd,
      recordedBy: userId,
    })),
  );
  await tx
    .delete(timelineItems)
    .where(and(eq(timelineItems.runId, runId), eq(timelineItems.kind, 'draft')));
  for (const d of drafts) await moveDueDates(tx, runId, d.stepKey, d.roleKey, d.plannedEnd);
  return drafts.length;
}

export async function insertChange(
  tx: Tx,
  orgId: string,
  runId: string,
  userId: string,
  item: PlanItem & { reason: string },
): Promise<void> {
  await tx.insert(timelineItems).values({
    orgId,
    runId,
    kind: 'change',
    stepKey: item.stepKey,
    roleKey: item.roleKey,
    plannedStart: item.plannedStart,
    plannedEnd: item.plannedEnd,
    reason: item.reason,
    recordedBy: userId,
  });
  await moveDueDates(tx, runId, item.stepKey, item.roleKey, item.plannedEnd);
}
