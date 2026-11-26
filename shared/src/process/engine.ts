import type { ErrorCode } from '../api/problem';
import {
  dependentsOf,
  stepOf,
  type Condition,
  type RouteDefinition,
  type StepDefinition,
  type StepKey,
} from './definition';

/**
 * The process engine (docs/architecture.md#the-process-engine): one pure function. Given a
 * route, a run's state and an action, `apply` returns the new state and the effects. It
 * touches nothing else; the backend saves the state and turns the effects into tasks, events
 * and audit entries, in one transaction. A preview runs the same function without saving.
 */

export const STEP_STATUSES = [
  'locked',
  'ready',
  'in_progress',
  'in_review',
  'returned',
  'approved',
  'done',
  'reset',
  'cancelled',
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

/** A step someone can work on: opened and not finished. */
export const OPEN_STATUSES: readonly StepStatus[] = [
  'ready',
  'in_progress',
  'in_review',
  'returned',
];
export const FINISHED_STATUSES: readonly StepStatus[] = ['approved', 'done'];

export const RUN_STATUSES = ['active', 'on_hold', 'dropped', 'completed', 'closed'] as const;
/** `completed`: the route's end is reached (for R&D, launched). `closed`: every step is finished too. */
export type RunStatus = (typeof RUN_STATUSES)[number];

/** The current iteration of one step. Earlier iterations are history, kept by the backend. */
export interface StepState {
  iteration: number;
  status: StepStatus;
  /** The path chosen for a step with two paths (step 15). */
  path: string | null;
  /** Who must approve: every one of these (the Board), or any holder of the signer role if empty. */
  signers: string[];
  approvedBy: string[];
}

export interface DecisionRecord {
  step: StepKey | null;
  /** The step's iteration when it was recorded. A reset makes earlier decisions stop counting. */
  iteration: number | null;
  decision: string;
  value: string;
}

export interface MilestoneRecord {
  milestone: string;
  /** The iteration of the milestone's step when it was recorded, if it has one. */
  iteration: number | null;
}

export interface RunState {
  status: RunStatus;
  steps: Record<StepKey, StepState>;
  /** In the order recorded; the latest for a step, iteration and decision counts. */
  decisions: DecisionRecord[];
  milestones: MilestoneRecord[];
  /** Corrective-action tasks on the run that are still open. */
  openCorrectiveActions: number;
}

export type Action =
  | { type: 'start'; step: StepKey }
  /** `signers`: for steps every holder must sign, the people holding the role now. */
  | { type: 'submit'; step: StepKey; signers?: string[] }
  | { type: 'approve'; step: StepKey; by: string }
  | { type: 'return'; step: StepKey; by: string; comment: string }
  | { type: 'decide'; step: StepKey; decision: string; value: string }
  | { type: 'record_milestone'; milestone: string }
  | { type: 'send_back'; from: StepKey; to: StepKey }
  | { type: 'hold' }
  | { type: 'resume' }
  | { type: 'drop' };

export type Effect =
  | { type: 'step.ready'; step: StepKey; iteration: number; path: string | null }
  | { type: 'step.started'; step: StepKey; iteration: number }
  | { type: 'step.submitted'; step: StepKey; iteration: number; signers: string[] }
  /** One of several required approvals (the Board). */
  | { type: 'step.signed'; step: StepKey; iteration: number; by: string }
  | { type: 'step.approved'; step: StepKey; iteration: number; by: string }
  | { type: 'step.done'; step: StepKey; iteration: number }
  | { type: 'step.returned'; step: StepKey; iteration: number; by: string; comment: string }
  /** The iteration is closed and a new one starts: `ready` when reopened, else `locked`. */
  | {
      type: 'step.reset';
      step: StepKey;
      iteration: number;
      newIteration: number;
      reopened: boolean;
    }
  | { type: 'step.cancelled'; step: StepKey; iteration: number }
  | {
      type: 'decision.recorded';
      step: StepKey | null;
      iteration: number | null;
      decision: string;
      value: string;
    }
  | {
      type: 'milestone.recorded';
      milestone: string;
      step: StepKey | null;
      iteration: number | null;
    }
  | { type: 'run.held' }
  | { type: 'run.resumed' }
  | { type: 'run.dropped' }
  | { type: 'run.completed' }
  | { type: 'run.closed' };

export interface Outcome {
  state: RunState;
  effects: Effect[];
}

/** A refusal, with the API's problem code. */
export class EngineError extends Error {
  constructor(
    readonly code: Extract<
      ErrorCode,
      | 'STEP_NOT_READY'
      | 'PROJECT_NOT_ACTIVE'
      | 'DECISION_REQUIRED'
      | 'CORRECTIVE_ACTIONS_OPEN'
      | 'ALREADY_DONE'
      | 'NOT_ALLOWED'
      | 'VALIDATION_FAILED'
      | 'NOT_FOUND'
    >,
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

const isOpen = (status: StepStatus) => OPEN_STATUSES.includes(status);
const isFinished = (status: StepStatus) => FINISHED_STATUSES.includes(status);
/** Opened in its current iteration, finished or not. */
const hasOpened = (status: StepStatus) => isOpen(status) || isFinished(status);

function clone(state: RunState): RunState {
  return {
    status: state.status,
    steps: Object.fromEntries(
      Object.entries(state.steps).map(([k, s]) => [
        k,
        { ...s, signers: [...s.signers], approvedBy: [...s.approvedBy] },
      ]),
    ),
    decisions: [...state.decisions],
    milestones: [...state.milestones],
    openCorrectiveActions: state.openCorrectiveActions,
  };
}

function requireStep(route: RouteDefinition, key: StepKey): StepDefinition {
  const step = stepOf(route, key);
  if (!step) throw new EngineError('NOT_FOUND', `There is no step ${key}.`);
  return step;
}

function stepState(state: RunState, key: StepKey): StepState {
  const s = state.steps[key];
  if (!s) throw new EngineError('NOT_FOUND', `There is no step ${key} in this run.`);
  return s;
}

/** The latest value of a decision at a step's current iteration. */
export function decisionValue(
  state: RunState,
  step: StepKey,
  decision: string,
): string | undefined {
  const iteration = state.steps[step]?.iteration;
  for (let i = state.decisions.length - 1; i >= 0; i--) {
    const d = state.decisions[i] as DecisionRecord;
    if (d.step === step && d.iteration === iteration && d.decision === decision) return d.value;
  }
  return undefined;
}

export function milestoneReached(route: RouteDefinition, state: RunState, key: string): boolean {
  const def = route.milestones.find((m) => m.key === key);
  if (!def) return false;
  const iteration =
    def.per_iteration && def.recorded_at ? state.steps[def.recorded_at]?.iteration : undefined;
  return state.milestones.some(
    (m) => m.milestone === key && (iteration === undefined || m.iteration === iteration),
  );
}

export function conditionHolds(route: RouteDefinition, state: RunState, c: Condition): boolean {
  if ('step_approved' in c) return state.steps[c.step_approved]?.status === 'approved';
  if ('step_done' in c) return state.steps[c.step_done]?.status === 'done';
  if ('milestone_reached' in c) return milestoneReached(route, state, c.milestone_reached);
  if ('decision_equals' in c) {
    const { step, decision, value } = c.decision_equals;
    return decisionValue(state, step, decision) === value;
  }
  if ('decision_recorded' in c) {
    const { step, decision } = c.decision_recorded;
    return decisionValue(state, step, decision) !== undefined;
  }
  return state.openCorrectiveActions === 0;
}

/** The conditions a step still waits for before it can open. */
export function waitsFor(route: RouteDefinition, state: RunState, key: StepKey): Condition[] {
  return requireStep(route, key).starts_when.filter((c) => !conditionHolds(route, state, c));
}

function pathFor(route: RouteDefinition, state: RunState, step: StepDefinition): string | null {
  if (!step.path) return null;
  const { step: at, decision } = step.path.decided_at;
  return decisionValue(state, at, decision) ?? null;
}

/** The route's stage the run is at: the earliest stage with an open step. */
export function currentStage(route: RouteDefinition, state: RunState): number {
  const open = route.steps.filter((s) => isOpen(stepState(state, s.key).status));
  if (open.length > 0) return Math.min(...open.map((s) => s.stage));
  const finished = route.steps.filter((s) => isFinished(stepState(state, s.key).status));
  return finished.length > 0 ? Math.max(...finished.map((s) => s.stage)) : 1;
}

/** Opens every step whose conditions hold, until nothing changes; then checks for the end. */
function evaluate(route: RouteDefinition, state: RunState, effects: Effect[]): void {
  if (state.status !== 'active' && state.status !== 'completed') return;
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of route.steps) {
      const s = stepState(state, step.key);
      if (s.status !== 'locked' || step.done_at_go) continue;
      if (step.starts_when.every((c) => conditionHolds(route, state, c))) {
        s.status = 'ready';
        s.path = pathFor(route, state, step);
        effects.push({ type: 'step.ready', step: step.key, iteration: s.iteration, path: s.path });
        changed = true;
      }
    }
  }
  if (state.status === 'active' && conditionHolds(route, state, route.run.completed_when)) {
    state.status = 'completed';
    effects.push({ type: 'run.completed' });
  }
  if (
    state.status === 'completed' &&
    route.steps.every((s) => isFinished(stepState(state, s.key).status))
  ) {
    state.status = 'closed';
    effects.push({ type: 'run.closed' });
  }
}

const RUN_STATUS_TEXT: Record<RunStatus, string> = {
  active: 'active',
  on_hold: 'on hold',
  dropped: 'dropped',
  completed: 'launched',
  closed: 'closed',
};

function requireRunStatus(state: RunState, allowed: RunStatus[]): void {
  if (!allowed.includes(state.status)) {
    throw new EngineError(
      'PROJECT_NOT_ACTIVE',
      `The project is ${RUN_STATUS_TEXT[state.status]}, so this can't be done now.`,
    );
  }
}

/** Step work goes on while the run is active, and after launch for steps still open (step 20). */
const WORKING: RunStatus[] = ['active', 'completed'];

/** Is the run in a state where step work (and so document work) can go on? */
export const isWorking = (state: RunState): boolean => WORKING.includes(state.status);

function requireOpen(key: StepKey, s: StepState): void {
  if (!isOpen(s.status)) {
    throw new EngineError(
      'STEP_NOT_READY',
      `Step ${key} isn't open (it is ${s.status.replace('_', ' ')}).`,
    );
  }
}

/** Describes a condition in plain words, for error messages. Clients use their own text. */
export function conditionText(route: RouteDefinition, c: Condition): string {
  if ('step_approved' in c) return `step ${c.step_approved} approved`;
  if ('step_done' in c) return `step ${c.step_done} done`;
  if ('milestone_reached' in c) {
    const name = route.milestones.find((m) => m.key === c.milestone_reached)?.name;
    return `"${name ?? c.milestone_reached}" recorded`;
  }
  if ('decision_equals' in c) {
    const { step, decision, value } = c.decision_equals;
    const def = stepOf(route, step)?.decisions.find((d) => d.key === decision);
    return `"${def?.name ?? decision}" answered ${value}`;
  }
  if ('decision_recorded' in c) {
    const { step, decision } = c.decision_recorded;
    const def = stepOf(route, step)?.decisions.find((d) => d.key === decision);
    return `"${def?.name ?? decision}" answered`;
  }
  return 'every corrective action closed';
}

/** The first step's state at Go: it is done, and the steps after it open. */
export function startRun(route: RouteDefinition): Outcome {
  const state: RunState = {
    status: 'active',
    steps: Object.fromEntries(
      route.steps.map((s): [StepKey, StepState] => [
        s.key,
        { iteration: 1, status: 'locked', path: null, signers: [], approvedBy: [] },
      ]),
    ),
    decisions: [],
    milestones: [],
    openCorrectiveActions: 0,
  };
  const effects: Effect[] = [];
  const first = route.steps.find((s) => s.done_at_go) as StepDefinition;
  stepState(state, first.key).status = 'done';
  effects.push({ type: 'step.done', step: first.key, iteration: 1 });
  state.decisions.push({ step: first.key, iteration: 1, decision: 'go', value: 'go' });
  effects.push({
    type: 'decision.recorded',
    step: first.key,
    iteration: 1,
    decision: 'go',
    value: 'go',
  });
  evaluate(route, state, effects);
  return { state, effects };
}

/** Applies an action. Throws an EngineError, and changes nothing, if it isn't possible now. */
export function apply(route: RouteDefinition, current: RunState, action: Action): Outcome {
  const state = clone(current);
  const effects: Effect[] = [];

  switch (action.type) {
    case 'start': {
      requireRunStatus(state, WORKING);
      requireStep(route, action.step);
      const s = stepState(state, action.step);
      if (s.status !== 'ready') {
        throw new EngineError(
          'STEP_NOT_READY',
          `Step ${action.step} can be started only when it is ready.`,
        );
      }
      s.status = 'in_progress';
      effects.push({ type: 'step.started', step: action.step, iteration: s.iteration });
      break;
    }

    case 'submit': {
      requireRunStatus(state, WORKING);
      const step = requireStep(route, action.step);
      const s = stepState(state, action.step);
      if (!['ready', 'in_progress', 'returned'].includes(s.status)) {
        throw new EngineError(
          'STEP_NOT_READY',
          s.status === 'in_review'
            ? `Step ${action.step} is already waiting for its sign-off.`
            : `Step ${action.step} isn't open (it is ${s.status.replace('_', ' ')}).`,
        );
      }
      const missing = step.submit_requires.filter((c) => !conditionHolds(route, state, c));
      if (missing.some((c) => 'no_open_corrective_actions' in c)) {
        throw new EngineError(
          'CORRECTIVE_ACTIONS_OPEN',
          `Step ${action.step} can't be submitted while a corrective action is open.`,
        );
      }
      if (missing.length > 0) {
        throw new EngineError(
          'STEP_NOT_READY',
          `Step ${action.step} needs ${missing.map((c) => conditionText(route, c)).join(' and ')} first.`,
        );
      }
      if (step.signer) {
        s.status = 'in_review';
        s.signers = step.all_must_sign ? [...new Set(action.signers ?? [])] : [];
        s.approvedBy = [];
        effects.push({
          type: 'step.submitted',
          step: step.key,
          iteration: s.iteration,
          signers: s.signers,
        });
      } else {
        s.status = 'done';
        effects.push({ type: 'step.done', step: step.key, iteration: s.iteration });
      }
      break;
    }

    case 'approve': {
      requireRunStatus(state, WORKING);
      const step = requireStep(route, action.step);
      const s = stepState(state, action.step);
      if (s.status !== 'in_review') {
        throw new EngineError(
          'STEP_NOT_READY',
          `Step ${action.step} isn't waiting for a sign-off.`,
        );
      }
      if (s.signers.length > 0 && !s.signers.includes(action.by)) {
        throw new EngineError('NOT_ALLOWED', `You weren't asked to sign off step ${action.step}.`);
      }
      if (s.approvedBy.includes(action.by)) {
        throw new EngineError('ALREADY_DONE', `You have already approved step ${action.step}.`);
      }
      const missing = step.approve_requires.filter((c) => !conditionHolds(route, state, c));
      if (missing.length > 0) {
        throw new EngineError(
          'DECISION_REQUIRED',
          `Step ${action.step} needs ${missing.map((c) => conditionText(route, c)).join(' and ')} before it can be approved.`,
        );
      }
      s.approvedBy.push(action.by);
      if (s.signers.length > 0 && !s.signers.every((id) => s.approvedBy.includes(id))) {
        effects.push({
          type: 'step.signed',
          step: step.key,
          iteration: s.iteration,
          by: action.by,
        });
        break;
      }
      s.status = 'approved';
      effects.push({
        type: 'step.approved',
        step: step.key,
        iteration: s.iteration,
        by: action.by,
      });
      if (step.checkpoint) {
        const record = {
          step: step.key,
          iteration: s.iteration,
          decision: 'checkpoint',
          value: 'approved',
        };
        state.decisions.push(record);
        effects.push({ type: 'decision.recorded', ...record });
      }
      break;
    }

    case 'return': {
      requireRunStatus(state, WORKING);
      requireStep(route, action.step);
      const s = stepState(state, action.step);
      if (s.status !== 'in_review') {
        throw new EngineError(
          'STEP_NOT_READY',
          `Step ${action.step} isn't waiting for a sign-off.`,
        );
      }
      if (s.signers.length > 0 && !s.signers.includes(action.by)) {
        throw new EngineError('NOT_ALLOWED', `You weren't asked to sign off step ${action.step}.`);
      }
      s.status = 'returned';
      s.approvedBy = [];
      effects.push({
        type: 'step.returned',
        step: action.step,
        iteration: s.iteration,
        by: action.by,
        comment: action.comment,
      });
      break;
    }

    case 'decide': {
      requireRunStatus(state, WORKING);
      const step = requireStep(route, action.step);
      const def = step.decisions.find((d) => d.key === action.decision);
      if (!def) {
        throw new EngineError(
          'VALIDATION_FAILED',
          `Step ${action.step} has no decision "${action.decision}".`,
        );
      }
      if (!def.options.some((o) => o.value === action.value)) {
        throw new EngineError(
          'VALIDATION_FAILED',
          `"${def.name}" can be answered only with ${def.options.map((o) => o.value).join(' or ')}.`,
        );
      }
      const s = stepState(state, action.step);
      requireOpen(action.step, s);
      const record = {
        step: step.key,
        iteration: s.iteration,
        decision: def.key,
        value: action.value,
      };
      state.decisions.push(record);
      effects.push({ type: 'decision.recorded', ...record });
      break;
    }

    case 'record_milestone': {
      requireRunStatus(state, WORKING);
      const def = route.milestones.find((m) => m.key === action.milestone);
      if (!def) {
        throw new EngineError('NOT_FOUND', `There is no prerequisite "${action.milestone}".`);
      }
      const at = def.recorded_at ? stepState(state, def.recorded_at) : null;
      if (def.recorded_at && at && !hasOpened(at.status)) {
        throw new EngineError(
          'STEP_NOT_READY',
          `"${def.name}" is recorded at step ${def.recorded_at}, which hasn't opened yet.`,
        );
      }
      if (milestoneReached(route, state, def.key)) {
        throw new EngineError('ALREADY_DONE', `"${def.name}" is already recorded.`);
      }
      const record = { milestone: def.key, iteration: at ? at.iteration : null };
      state.milestones.push(record);
      effects.push({ type: 'milestone.recorded', ...record, step: def.recorded_at });
      break;
    }

    case 'send_back': {
      requireRunStatus(state, ['active']);
      const from = requireStep(route, action.from);
      requireStep(route, action.to);
      const targets = from.send_back.flatMap((r) => r.to);
      if (!targets.includes(action.to)) {
        throw new EngineError(
          'VALIDATION_FAILED',
          targets.length === 0
            ? `Work can't be sent back from step ${from.key}. The signer can return it to its authors instead.`
            : `From step ${from.key}, work can go back only to step ${targets.join(', ')}.`,
        );
      }
      requireOpen(from.key, stepState(state, from.key));

      const target = stepState(state, action.to);
      const reopened = target.iteration + 1;
      effects.push({
        type: 'step.reset',
        step: action.to,
        iteration: target.iteration,
        newIteration: reopened,
        reopened: true,
      });
      state.steps[action.to] = {
        iteration: reopened,
        status: 'locked',
        path: null,
        signers: [],
        approvedBy: [],
      };

      for (const key of dependentsOf(route, action.to)) {
        const s = stepState(state, key);
        if (s.status === 'locked') continue;
        effects.push({
          type: 'step.reset',
          step: key,
          iteration: s.iteration,
          newIteration: s.iteration + 1,
          reopened: false,
        });
        state.steps[key] = {
          iteration: s.iteration + 1,
          status: 'locked',
          path: null,
          signers: [],
          approvedBy: [],
        };
      }

      // The reopened step's own inputs are upstream and untouched, so it opens at once.
      const reopenedStep = stepState(state, action.to);
      reopenedStep.status = 'ready';
      reopenedStep.path = pathFor(route, state, requireStep(route, action.to));
      effects.push({
        type: 'step.ready',
        step: action.to,
        iteration: reopened,
        path: reopenedStep.path,
      });
      break;
    }

    case 'hold': {
      requireRunStatus(state, ['active']);
      state.status = 'on_hold';
      effects.push({ type: 'run.held' });
      break;
    }

    case 'resume': {
      if (state.status !== 'on_hold') {
        throw new EngineError('PROJECT_NOT_ACTIVE', "The project isn't on hold.");
      }
      state.status = 'active';
      effects.push({ type: 'run.resumed' });
      break;
    }

    case 'drop': {
      requireRunStatus(state, ['active', 'on_hold']);
      state.status = 'dropped';
      for (const step of route.steps) {
        const s = stepState(state, step.key);
        if (isOpen(s.status)) {
          s.status = 'cancelled';
          effects.push({ type: 'step.cancelled', step: step.key, iteration: s.iteration });
        }
      }
      effects.push({ type: 'run.dropped' });
      break;
    }
  }

  evaluate(route, state, effects);
  return { state, effects };
}

/** What can happen at a step now, by its state alone. Who may do it is the permission module's call. */
export interface StepActions {
  start: boolean;
  submit: boolean;
  approve: boolean;
  return: boolean;
  /** Decisions that can be recorded now. */
  decide: string[];
  /** Steps the work can be sent back to now. */
  sendBack: StepKey[];
  correctiveActions: boolean;
  /** What submitting or approving still needs, so the client can say so. */
  submitNeeds: Condition[];
  approveNeeds: Condition[];
}

export function stepActions(route: RouteDefinition, state: RunState, key: StepKey): StepActions {
  const step = requireStep(route, key);
  const s = stepState(state, key);
  const working = WORKING.includes(state.status);
  const open = working && isOpen(s.status);
  return {
    start: working && s.status === 'ready',
    submit: working && ['ready', 'in_progress', 'returned'].includes(s.status),
    approve: working && s.status === 'in_review',
    return: working && s.status === 'in_review',
    decide: open ? step.decisions.map((d) => d.key) : [],
    sendBack:
      state.status === 'active' && isOpen(s.status) ? step.send_back.flatMap((r) => r.to) : [],
    correctiveActions: open && step.corrective_actions,
    submitNeeds: step.submit_requires.filter((c) => !conditionHolds(route, state, c)),
    approveNeeds: step.approve_requires.filter((c) => !conditionHolds(route, state, c)),
  };
}

/** Can a prerequisite (the route file's `milestones`) be recorded now? */
export function milestoneOpen(route: RouteDefinition, state: RunState, key: string): boolean {
  const def = route.milestones.find((m) => m.key === key);
  if (!def || !WORKING.includes(state.status) || milestoneReached(route, state, key)) return false;
  if (!def.recorded_at) return true;
  return hasOpened(stepState(state, def.recorded_at).status);
}

/** The roles that may hold, resume or drop the run now (docs/workflow.md#hold-and-drop). */
export function runActionRoles(
  route: RouteDefinition,
  state: RunState,
): { hold: string[]; resume: string[]; drop: string[] } {
  const drop = route.run.drop
    .filter(
      (rule) => !rule.while_open || rule.while_open.some((k) => isOpen(stepState(state, k).status)),
    )
    .map((rule) => rule.role);
  return {
    hold: state.status === 'active' ? route.run.hold : [],
    resume: state.status === 'on_hold' ? route.run.resume : [],
    drop: ['active', 'on_hold'].includes(state.status) ? [...new Set(drop)] : [],
  };
}
