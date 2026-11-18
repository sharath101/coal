import { createHash } from 'node:crypto';
import {
  RouteDefinition,
  currentStage,
  type Effect,
  type RunState,
  type StepKey,
  type StepState,
} from '@coal/shared';
import { loadRouteFiles } from '@coal/shared/process-files';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Executor, Tx } from '../../core/db/client';
import { notFound } from '../../core/http/errors';
import { ROLES } from '../org/catalogue';
import { decisions, milestones, processRuns, processVersions, runSteps, sendBacks } from './tables';

export type RunRow = typeof processRuns.$inferSelect;
export type RunStepRow = typeof runSteps.$inferSelect;
type VersionRow = typeof processVersions.$inferSelect;

/** Loads the route files in shared/ into `process_versions`. Safe to run on every deploy. */
export async function loadProcessVersions(ex: Executor, orgId: string): Promise<void> {
  const files = loadRouteFiles({ roles: ROLES.map((r) => r.key) });
  for (const { route } of files) {
    const definition = JSON.stringify(route);
    const sha256 = createHash('sha256').update(definition).digest('hex');
    const [existing] = await ex
      .select({ sha256: processVersions.sha256 })
      .from(processVersions)
      .where(
        and(
          eq(processVersions.orgId, orgId),
          eq(processVersions.key, route.process),
          eq(processVersions.version, route.version),
        ),
      );
    if (existing && existing.sha256 !== sha256) {
      // Runs stay on the version they started with, so a version's content never changes.
      throw new Error(
        `${route.process} v${route.version} is already loaded with different content. ` +
          'Add a new version file instead of editing this one.',
      );
    }
    if (!existing) {
      await ex.insert(processVersions).values({
        orgId,
        key: route.process,
        version: route.version,
        departmentCode: route.department,
        definition: route,
        sha256,
      });
    }
  }
}

const parseVersion = (row: VersionRow) => ({
  id: row.id,
  key: row.key,
  version: row.version,
  route: RouteDefinition.parse(row.definition),
});
export type Version = ReturnType<typeof parseVersion>;

/** The latest version of each process. */
export async function listLatestVersions(ex: Executor, orgId: string): Promise<Version[]> {
  const rows = await ex
    .select()
    .from(processVersions)
    .where(eq(processVersions.orgId, orgId))
    .orderBy(asc(processVersions.key), desc(processVersions.version));
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.key) && seen.add(r.key)).map(parseVersion);
}

export async function latestVersion(ex: Executor, orgId: string, key: string) {
  const [row] = await ex
    .select()
    .from(processVersions)
    .where(and(eq(processVersions.orgId, orgId), eq(processVersions.key, key)))
    .orderBy(desc(processVersions.version))
    .limit(1);
  return row ? parseVersion(row) : null;
}

async function versionById(ex: Executor, id: string) {
  const [row] = await ex.select().from(processVersions).where(eq(processVersions.id, id));
  if (!row) throw notFound('process version');
  return parseVersion(row);
}

/** The columns of a step row that change as the step moves. */
const stepChanges = (s: StepState, now: Date, previous?: StepState) => ({
  status: s.status,
  path: s.path,
  signers: s.signers,
  approvedBy: s.approvedBy,
  ...(s.status === 'ready' && previous?.status !== 'ready' && { openedAt: now }),
  ...(s.status === 'in_review' && previous?.status !== 'in_review' && { submittedAt: now }),
  ...(['approved', 'done'].includes(s.status) &&
    !['approved', 'done'].includes(previous?.status ?? '') && { completedAt: now }),
});

const newStepRow = (orgId: string, runId: string, key: StepKey, s: StepState, now: Date) => ({
  orgId,
  runId,
  stepKey: key,
  iteration: s.iteration,
  ...stepChanges(s, now),
});

/** Creates a run on a version of its route, with every step in its starting state. */
export async function createRun(
  tx: Tx,
  orgId: string,
  version: Version,
  state: RunState,
): Promise<{ run: RunRow; stepIds: Map<StepKey, string> }> {
  const [run] = await tx
    .insert(processRuns)
    .values({
      orgId,
      processVersionId: version.id,
      status: state.status,
      stage: currentStage(version.route, state),
    })
    .returning();
  const now = new Date();
  const rows = await tx
    .insert(runSteps)
    .values(
      version.route.steps.map((step) =>
        newStepRow(orgId, (run as RunRow).id, step.key, state.steps[step.key] as StepState, now),
      ),
    )
    .returning({ id: runSteps.id, stepKey: runSteps.stepKey });
  return { run: run as RunRow, stepIds: new Map(rows.map((r) => [r.stepKey, r.id])) };
}

export interface LoadedRun {
  run: RunRow;
  version: Version;
  route: RouteDefinition;
  state: RunState;
  /** The current iteration's row id for each step. */
  stepIds: Map<StepKey, string>;
}

/** Loads a run with its state. `forUpdate` locks the run, so actions on it happen one at a time. */
export async function loadRun(
  ex: Executor,
  orgId: string,
  runId: string,
  options: { forUpdate?: boolean } = {},
): Promise<LoadedRun> {
  const query = ex
    .select()
    .from(processRuns)
    .where(and(eq(processRuns.orgId, orgId), eq(processRuns.id, runId)));
  const [run] = options.forUpdate ? await query.for('update') : await query;
  if (!run) throw notFound('project');
  const version = await versionById(ex, run.processVersionId);

  const [rows, decisionRows, milestoneRows] = await Promise.all([
    ex
      .select()
      .from(runSteps)
      .where(and(eq(runSteps.runId, runId), sql`${runSteps.status} <> 'reset'`)),
    ex
      .select()
      .from(decisions)
      .where(eq(decisions.runId, runId))
      .orderBy(asc(decisions.createdAt), asc(decisions.id)),
    ex
      .select()
      .from(milestones)
      .where(eq(milestones.runId, runId))
      .orderBy(asc(milestones.recordedAt)),
  ]);

  const steps: Record<StepKey, StepState> = {};
  const stepIds = new Map<StepKey, string>();
  for (const row of rows) {
    steps[row.stepKey] = {
      iteration: row.iteration,
      status: row.status,
      path: row.path,
      signers: row.signers,
      approvedBy: row.approvedBy,
    };
    stepIds.set(row.stepKey, row.id);
  }
  const state: RunState = {
    status: run.status,
    steps,
    decisions: decisionRows.map((d) => ({
      step: d.stepKey,
      iteration: d.iteration,
      decision: d.decision,
      value: d.value,
    })),
    milestones: milestoneRows.map((m) => ({ milestone: m.milestone, iteration: m.iteration })),
    // Set by the caller, from the run's open corrective-action tasks.
    openCorrectiveActions: 0,
  };
  return { run, version, route: version.route, state, stepIds };
}

export interface Attribution {
  userId: string;
  reason?: string | undefined;
  note?: string | undefined;
  evidenceFileId?: string | undefined;
}

/** Records a send-back before the state moves, so the rows it closes can point at it. */
export async function recordSendBack(
  tx: Tx,
  orgId: string,
  loaded: LoadedRun,
  input: {
    fromStep: StepKey;
    toStep: StepKey;
    effects: Effect[];
    attribution: Attribution;
  },
): Promise<string> {
  const reset = input.effects
    .filter((e): e is Extract<Effect, { type: 'step.reset' }> => e.type === 'step.reset')
    .map((e) => loaded.stepIds.get(e.step) as string);
  const [row] = await tx
    .insert(sendBacks)
    .values({
      orgId,
      runId: loaded.run.id,
      fromRunStepId: loaded.stepIds.get(input.fromStep) as string,
      fromStepKey: input.fromStep,
      toStepKey: input.toStep,
      reason: input.attribution.reason ?? '',
      evidenceFileId: input.attribution.evidenceFileId ?? null,
      decidedBy: input.attribution.userId,
      resetRunStepIds: reset,
    })
    .returning({ id: sendBacks.id });
  return (row as { id: string }).id;
}

/**
 * Saves what an action did: the run's status, each step that changed (a send-back closes the
 * old iteration and adds a new one), and the decisions and milestones it recorded.
 * Returns each step's current row id.
 */
export async function saveOutcome(
  tx: Tx,
  orgId: string,
  loaded: LoadedRun,
  after: RunState,
  effects: Effect[],
  attribution: Attribution,
  sendBackId?: string,
): Promise<Map<StepKey, string>> {
  const { run, route, state: before } = loaded;
  const stepIds = new Map(loaded.stepIds);
  const now = new Date();

  for (const step of route.steps) {
    const was = before.steps[step.key] as StepState;
    const is = after.steps[step.key] as StepState;
    const rowId = loaded.stepIds.get(step.key) as string;
    if (is.iteration > was.iteration) {
      await tx
        .update(runSteps)
        .set({ status: 'reset', resetBySendBackId: sendBackId ?? null, updatedAt: now })
        .where(eq(runSteps.id, rowId));
      const [created] = await tx
        .insert(runSteps)
        .values(newStepRow(orgId, run.id, step.key, is, now))
        .returning({ id: runSteps.id });
      stepIds.set(step.key, (created as { id: string }).id);
    } else if (
      is.status !== was.status ||
      is.path !== was.path ||
      JSON.stringify(is.approvedBy) !== JSON.stringify(was.approvedBy) ||
      JSON.stringify(is.signers) !== JSON.stringify(was.signers)
    ) {
      await tx
        .update(runSteps)
        .set({ ...stepChanges(is, now, was), updatedAt: now })
        .where(eq(runSteps.id, rowId));
    }
  }

  const stage = currentStage(route, after);
  if (after.status !== run.status || stage !== run.stage) {
    await tx
      .update(processRuns)
      .set({
        status: after.status,
        stage,
        // A run that launches with every step already finished goes straight to `closed`.
        ...(['completed', 'closed'].includes(after.status) &&
          !run.completedAt && { completedAt: now }),
        ...(after.status === 'on_hold' && { holdReason: attribution.reason ?? null }),
        ...(after.status === 'dropped' && { dropReason: attribution.reason ?? null }),
        ...(after.status === 'active' && run.status === 'on_hold' && { holdReason: null }),
        updatedAt: now,
      })
      .where(eq(processRuns.id, run.id));
  }

  for (const effect of effects) {
    if (effect.type === 'decision.recorded') {
      await recordDecision(tx, orgId, run.id, {
        runStepId: effect.step ? stepIds.get(effect.step) : undefined,
        stepKey: effect.step,
        iteration: effect.iteration,
        decision: effect.decision,
        value: effect.value,
        reason: attribution.reason,
        by: attribution.userId,
      });
    } else if (effect.type === 'milestone.recorded') {
      await tx.insert(milestones).values({
        orgId,
        runId: run.id,
        milestone: effect.milestone,
        stepKey: effect.step,
        iteration: effect.iteration,
        note: attribution.note ?? null,
        evidenceFileId: attribution.evidenceFileId ?? null,
        recordedBy: attribution.userId,
      });
    }
  }
  return stepIds;
}

/** Hold, resume and drop are decisions of the run, with their reason. */
export async function recordDecision(
  tx: Tx,
  orgId: string,
  runId: string,
  input: {
    runStepId?: string | undefined;
    stepKey?: string | null | undefined;
    iteration?: number | null | undefined;
    decision: string;
    value: string;
    reason?: string | null | undefined;
    by: string;
  },
): Promise<void> {
  await tx.insert(decisions).values({
    orgId,
    runId,
    runStepId: input.runStepId ?? null,
    stepKey: input.stepKey ?? null,
    iteration: input.iteration ?? null,
    decision: input.decision,
    value: input.value,
    reason: input.reason ?? null,
    decidedBy: input.by,
  });
}

export async function runsByStatus(ex: Executor, orgId: string, statuses: RunRow['status'][]) {
  const rows = await ex
    .select({ id: processRuns.id })
    .from(processRuns)
    .where(and(eq(processRuns.orgId, orgId), inArray(processRuns.status, statuses)));
  return rows.map((r) => r.id);
}

export async function getRuns(
  ex: Executor,
  orgId: string,
  ids: string[],
): Promise<Map<string, RunRow>> {
  if (ids.length === 0) return new Map();
  const rows = await ex
    .select()
    .from(processRuns)
    .where(and(eq(processRuns.orgId, orgId), inArray(processRuns.id, ids)));
  return new Map(rows.map((r) => [r.id, r]));
}

/** Every iteration of one step, newest last, with the reason a send-back closed it. */
export async function stepHistory(ex: Executor, runId: string, key: StepKey) {
  const rows = await ex
    .select({
      step: runSteps,
      resetReason: sendBacks.reason,
    })
    .from(runSteps)
    .leftJoin(sendBacks, eq(runSteps.resetBySendBackId, sendBacks.id))
    .where(and(eq(runSteps.runId, runId), eq(runSteps.stepKey, key)))
    .orderBy(asc(runSteps.iteration));
  const decisionRows = await ex
    .select()
    .from(decisions)
    .where(and(eq(decisions.runId, runId), eq(decisions.stepKey, key)))
    .orderBy(asc(decisions.createdAt), asc(decisions.id));
  return { iterations: rows, decisions: decisionRows };
}
