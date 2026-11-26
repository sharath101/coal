import {
  FINISHED_STATUSES,
  dateOfInstant,
  milestoneStatus,
  type DateKey,
  type MilestoneHealth,
  type MilestoneInput,
  type MilestoneStatus,
  type ProjectMilestone,
  type RouteDefinition,
  type StepKey,
  type StepStatus,
  type WorkCalendar,
} from '@coal/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Executor, Tx } from '../../core/db/client';
import { AppError, notFound, validationFailed } from '../../core/http/errors';
import { currentSteps, currentStepsOfRuns, type RunStepRow } from '../process/service';
import { findUsersByIds } from '../users/service';
import { loadCalendar } from './calendar';
import { runMilestones } from './tables';

/**
 * A project's milestones: the targets the VP sets for it (docs/dashboard.md#milestones). A step
 * milestone is reached when its step's current iteration is signed off or done, so a send-back
 * that reopens the step un-reaches it; one in the VP's own words is ticked off by hand.
 */

export type MilestoneRow = typeof runMilestones.$inferSelect;

/** ⚠ Who sets a project's milestones and ticks them off: the VP and the R&D Head (P117). */
export const MILESTONE_ROLES = ['vp', 'rd_head'];

/** What a milestone needs to know about its step. */
export interface StepOfMilestone {
  status: StepStatus;
  completedOn: DateKey | null;
  forecastEnd: DateKey | null;
}

export interface EvaluatedMilestone {
  row: MilestoneRow;
  title: string;
  status: MilestoneStatus;
  daysLate: number;
  forecastDate: DateKey | null;
  reachedOn: DateKey | null;
}

/** The milestones of some runs that are not removed, oldest first. */
export async function milestonesOfRuns(ex: Executor, runIds: string[]): Promise<MilestoneRow[]> {
  if (runIds.length === 0) return [];
  return ex
    .select()
    .from(runMilestones)
    .where(and(inArray(runMilestones.runId, runIds), isNull(runMilestones.removedAt)))
    .orderBy(asc(runMilestones.createdAt), asc(runMilestones.id));
}

export const stepOfRow = (row: RunStepRow): StepOfMilestone => ({
  status: row.status,
  completedOn: row.completedAt ? dateOfInstant(row.completedAt) : null,
  forecastEnd: row.forecastEnd,
});

export const milestoneTitle = (route: RouteDefinition, row: MilestoneRow) =>
  row.stepKey
    ? (route.steps.find((s) => s.key === row.stepKey)?.name ?? `Step ${row.stepKey}`)
    : (row.title ?? '');

/** Each milestone's state, by target date (those without one last), then in route order. */
export function evaluateMilestones(
  route: RouteDefinition,
  rows: readonly MilestoneRow[],
  stepOf: (key: StepKey) => StepOfMilestone | undefined,
  today: DateKey,
  cal: WorkCalendar,
): EvaluatedMilestone[] {
  const order = new Map(route.steps.map((s, i) => [s.key, i]));
  const evaluated = rows.map((row) => {
    const step = row.stepKey ? stepOf(row.stepKey) : undefined;
    const reachedOn = row.stepKey
      ? step && FINISHED_STATUSES.includes(step.status)
        ? step.completedOn
        : null
      : row.reachedAt
        ? dateOfInstant(row.reachedAt)
        : null;
    const forecastDate = row.stepKey && !reachedOn ? (step?.forecastEnd ?? null) : null;
    const { status, daysLate } = milestoneStatus(
      { targetDate: row.targetDate, reachedOn, forecastEnd: forecastDate },
      today,
      cal,
    );
    return { row, title: milestoneTitle(route, row), status, daysLate, forecastDate, reachedOn };
  });
  const sortKey = (m: EvaluatedMilestone) =>
    [
      m.row.targetDate ?? '9999-12-31',
      order.get(m.row.stepKey ?? '') ?? route.steps.length,
    ] as const;
  return evaluated.toSorted((a, b) => {
    const [ad, ai] = sortKey(a);
    const [bd, bi] = sortKey(b);
    return ad.localeCompare(bd) || ai - bi;
  });
}

/** What health counts: the milestones of a run, as `recompute` sees its steps. */
export const milestoneHealth = (evaluated: EvaluatedMilestone[]): MilestoneHealth[] =>
  evaluated.map((m) => ({ name: m.title, status: m.status, daysLate: m.daysLate }));

export const isReached = (m: EvaluatedMilestone) => m.status === 'reached';

/** The project page's list, with who ticked each off. The note is content: only for the project's scope. */
export async function presentMilestones(
  ex: Executor,
  input: { orgId: string; runId: string; route: RouteDefinition; seesContent: boolean },
  now: Date,
): Promise<ProjectMilestone[]> {
  const [rows, steps, cal] = await Promise.all([
    milestonesOfRuns(ex, [input.runId]),
    currentSteps(ex, input.runId),
    loadCalendar(ex, input.orgId),
  ]);
  if (rows.length === 0) return [];
  const byKey = new Map(steps.map((s) => [s.stepKey, stepOfRow(s)]));
  const evaluated = evaluateMilestones(
    input.route,
    rows,
    (key) => byKey.get(key),
    dateOfInstant(now),
    cal,
  );
  const people = await findUsersByIds(
    ex,
    input.orgId,
    rows.flatMap((r) => (r.reachedBy ? [r.reachedBy] : [])),
  );
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  return evaluated.map((m) => ({
    id: m.row.id,
    kind: m.row.stepKey ? ('step' as const) : ('own' as const),
    stepKey: m.row.stepKey,
    title: m.title,
    targetDate: m.row.targetDate,
    status: m.status,
    daysLate: m.daysLate,
    forecastDate: m.forecastDate,
    reachedOn: m.reachedOn,
    reachedBy:
      !m.row.stepKey && m.row.reachedAt && m.row.reachedBy
        ? { id: m.row.reachedBy, name: nameOf.get(m.row.reachedBy) ?? 'Unknown' }
        : null,
    note: input.seesContent && !m.row.stepKey && m.row.reachedAt ? m.row.note : null,
  }));
}

/** Every milestone of some runs, evaluated, by run: for lists and the Dashboard. */
export async function evaluateRuns(
  ex: Executor,
  orgId: string,
  runs: readonly { runId: string; route: RouteDefinition }[],
  now: Date,
): Promise<Map<string, EvaluatedMilestone[]>> {
  const rows = await milestonesOfRuns(
    ex,
    runs.map((r) => r.runId),
  );
  if (rows.length === 0) return new Map();
  const withMilestones = runs.filter((r) => rows.some((m) => m.runId === r.runId));
  const [steps, cal] = await Promise.all([
    currentStepsOfRuns(
      ex,
      withMilestones.map((r) => r.runId),
    ),
    loadCalendar(ex, orgId),
  ]);
  const today = dateOfInstant(now);
  const byRun = new Map<string, EvaluatedMilestone[]>();
  for (const run of withMilestones) {
    const byKey = new Map(
      steps.filter((s) => s.runId === run.runId).map((s) => [s.stepKey, stepOfRow(s)]),
    );
    byRun.set(
      run.runId,
      evaluateMilestones(
        run.route,
        rows.filter((m) => m.runId === run.runId),
        (key) => byKey.get(key),
        today,
        cal,
      ),
    );
  }
  return byRun;
}

/** The first milestone not reached yet of each running run, for project cards and lists. */
export async function nextMilestones(
  ex: Executor,
  orgId: string,
  runs: readonly { runId: string; route: RouteDefinition; running: boolean }[],
  now: Date,
): Promise<Map<string, EvaluatedMilestone>> {
  const all = await evaluateRuns(
    ex,
    orgId,
    runs.filter((r) => r.running),
    now,
  );
  const next = new Map<string, EvaluatedMilestone>();
  for (const [runId, milestones] of all) {
    const first = milestones.find((m) => !isReached(m));
    if (first) next.set(runId, first);
  }
  return next;
}

/**
 * Refuses a milestone that can't be set: a step that isn't on the route or is done at Go, a step
 * that is already a milestone, or a target date that has passed.
 */
export function checkMilestoneInput(
  route: RouteDefinition,
  input: MilestoneInput,
  context: { today: DateKey; takenSteps: ReadonlySet<StepKey>; path: string },
): void {
  if (input.stepKey !== undefined) {
    const step = route.steps.find((s) => s.key === input.stepKey);
    if (!step) {
      throw validationFailed(`There is no step ${input.stepKey}.`, `${context.path}stepKey`);
    }
    if (step.done_at_go) {
      throw validationFailed(
        `Step ${step.key}, ${step.name}, is done at Go, so it can't be a milestone.`,
        `${context.path}stepKey`,
      );
    }
    if (context.takenSteps.has(step.key)) {
      throw validationFailed(
        `Step ${step.key}, ${step.name}, is already a milestone of this project.`,
        `${context.path}stepKey`,
      );
    }
  }
  if (input.targetDate !== undefined) checkTargetDate(input.targetDate, context);
}

export function checkTargetDate(targetDate: DateKey, context: { today: DateKey; path: string }) {
  if (targetDate < context.today) {
    throw validationFailed(
      'The target date has passed. Choose today or a later day.',
      `${context.path}targetDate`,
    );
  }
}

/** Saves new milestones on a run. They have been checked. */
export async function insertMilestones(
  tx: Tx,
  orgId: string,
  runId: string,
  createdBy: string,
  inputs: readonly MilestoneInput[],
): Promise<MilestoneRow[]> {
  if (inputs.length === 0) return [];
  return tx
    .insert(runMilestones)
    .values(
      inputs.map((m) => ({
        orgId,
        runId,
        createdBy,
        stepKey: m.stepKey ?? null,
        title: m.stepKey === undefined ? (m.title ?? null) : null,
        targetDate: m.targetDate ?? null,
      })),
    )
    .returning();
}

/** One milestone of a run, locked for a change, or 404. */
export async function lockMilestone(tx: Tx, runId: string, id: string): Promise<MilestoneRow> {
  const [row] = await tx
    .select()
    .from(runMilestones)
    .where(
      and(
        eq(runMilestones.id, id),
        eq(runMilestones.runId, runId),
        isNull(runMilestones.removedAt),
      ),
    )
    .for('update');
  if (!row) throw notFound('milestone');
  return row;
}

export async function updateMilestoneRow(
  tx: Tx,
  id: string,
  set: Partial<
    Pick<MilestoneRow, 'title' | 'targetDate' | 'reachedAt' | 'reachedBy' | 'note' | 'removedAt'>
  >,
): Promise<void> {
  await tx.update(runMilestones).set(set).where(eq(runMilestones.id, id));
}

/** A step milestone follows its step: it can't be ticked off by hand. */
export function refuseStepMilestone(route: RouteDefinition, row: MilestoneRow): void {
  if (!row.stepKey) return;
  const step = route.steps.find((s) => s.key === row.stepKey);
  throw new AppError(
    409,
    'USE_THE_STEP',
    `"${step?.name ?? row.stepKey}" is reached when step ${row.stepKey} is ${step?.signer ? 'signed off' : 'marked done'}, not by hand.`,
  );
}
