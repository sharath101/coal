import { z } from 'zod';

/**
 * The shape of a route definition (docs/architecture.md#the-process-engine). Routes are YAML
 * files in this folder, one per process and version, checked against this schema and by
 * `validateRoute` when they are loaded.
 */

/** A step's key: Jayon's own numbers, with a letter for added or split steps ("C", "13", "24a"). */
export const StepKey = z.string().regex(/^[A-Z0-9]{1,3}[a-z]?$/);
export type StepKey = z.infer<typeof StepKey>;

/**
 * The first step, "The idea", is done at Go and keyed `C` in the route file, the API and the
 * database. People see it as step 0, so it reads like the others ("Step 0 done") and sorts first
 * (P118). Anything that shows a step number to a person goes through `stepLabel`.
 */
export const START_STEP_KEY = 'C';
export const stepLabel = (key: string): string => (key === START_STEP_KEY ? '0' : key);

const Key = z.string().regex(/^[a-z][a-z0-9_]*$/);
/** A role key, as in the roles catalogue. */
const RoleKey = Key;
/** A doer: a role key, or `team` for the project team. */
export const TEAM = 'team';
/** An open question in docs/open-questions.md that the definition relies on. */
const QuestionId = z.string().regex(/^[A-Z]{1,2}\d+$/);

/**
 * Conditions are named rules, used by name in the route file:
 * - `step_approved`: the step's sign-off is done (steps with a signer);
 * - `step_done`: a doer marked the step done (steps without a signer);
 * - `milestone_reached`: the milestone is recorded (for its step's current iteration, if it is per iteration).
 *   The file's milestones are the prerequisites people record (docs/workflow.md#starting-steps), not a
 *   project's own milestones;
 * - `decision_equals` / `decision_recorded`: a decision at a step's current iteration;
 * - `no_open_corrective_actions`: every corrective action on the run is closed.
 */
export const Condition = z.union([
  z.strictObject({ step_approved: StepKey }),
  z.strictObject({ step_done: StepKey }),
  z.strictObject({ milestone_reached: Key }),
  z.strictObject({
    decision_equals: z.strictObject({ step: StepKey, decision: Key, value: Key }),
  }),
  z.strictObject({ decision_recorded: z.strictObject({ step: StepKey, decision: Key }) }),
  z.strictObject({ no_open_corrective_actions: z.literal(true) }),
]);
export type Condition = z.infer<typeof Condition>;

const Option = z.strictObject({ value: Key, name: z.string().min(1) });

export const DecisionDefinition = z.strictObject({
  key: Key,
  name: z.string().min(1),
  by: RoleKey,
  options: z.array(Option).min(2),
});
export type DecisionDefinition = z.infer<typeof DecisionDefinition>;

export const SendBackDefinition = z.strictObject({
  to: z.array(StepKey).min(1),
  decided_by: RoleKey,
});

export const PathDefinition = z.strictObject({
  decided_at: z.strictObject({ step: StepKey, decision: Key }),
  options: z
    .array(z.strictObject({ value: Key, name: z.string().min(1), outputs: z.array(z.string()) }))
    .min(2),
});

export const ExtraTask = z.strictObject({
  key: Key,
  name: z.string().min(1),
  role: RoleKey,
  /** Kept open when its step is reset by a send-back, like the step-20 follow-up (P16). */
  keep_on_reset: z.boolean().default(false),
});

export const StepDefinition = z.strictObject({
  key: StepKey,
  name: z.string().min(1),
  stage: z.number().int().min(1),
  /** A go or no-go point. Approving it records a `checkpoint` decision. */
  checkpoint: z.boolean().default(false),
  /** Added or split at the COAL meeting (2a, 24a, 24b). */
  new: z.boolean().default(false),
  /** The doers write each role's dates for the remaining steps here, and the sign-off makes them the baseline. */
  baseline: z.boolean().default(false),
  /** How long the step takes, in working days from when it opens, until the Action Plan sets dates (W14). */
  default_days: z.number().int().min(0).max(365),
  doers: z.array(Key).min(1),
  /** People outside COAL who take part, for information. */
  outside: z.array(z.string()).default([]),
  /** Empty for steps a doer marks done. */
  signer: RoleKey.nullable(),
  /** Every holder of the signer role must approve (the Board). Otherwise any one holder. */
  all_must_sign: z.boolean().default(false),
  /** The first step: done when the project is created (Go). */
  done_at_go: z.boolean().default(false),
  /** All must hold for the step to open. */
  starts_when: z.array(Condition),
  submit_requires: z.array(Condition).default([]),
  approve_requires: z.array(Condition).default([]),
  decisions: z.array(DecisionDefinition).default([]),
  send_back: z.array(SendBackDefinition).default([]),
  path: PathDefinition.optional(),
  /** Corrective actions can be raised at this step (step 16). */
  corrective_actions: z.boolean().default(false),
  /** Tasks besides one per doer role. */
  tasks: z.array(ExtraTask).default([]),
  outputs: z.array(z.string()),
  assumptions: z.array(QuestionId).default([]),
});
export type StepDefinition = z.infer<typeof StepDefinition>;

export const MilestoneDefinition = z.strictObject({
  key: Key,
  name: z.string().min(1),
  /** The step it is recorded at, or null if it can be recorded any time the run is active. */
  recorded_at: StepKey.nullable(),
  recorded_by: z.array(RoleKey).min(1),
  /** Counts only for the iteration of `recorded_at` it was recorded in; a reset needs it again. */
  per_iteration: z.boolean(),
  assumptions: z.array(QuestionId).default([]),
});
export type MilestoneDefinition = z.infer<typeof MilestoneDefinition>;

export const RunRules = z.strictObject({
  /** When this holds, the run is complete (for R&D: launched). */
  completed_when: Condition,
  hold: z.array(RoleKey).min(1),
  resume: z.array(RoleKey).min(1),
  drop: z
    .array(
      z.strictObject({
        role: RoleKey,
        /** Only while one of these steps is open. */
        while_open: z.array(StepKey).optional(),
      }),
    )
    .min(1),
  assumptions: z.array(QuestionId).default([]),
});

/**
 * The words in a work message that COAL fills in. A template may use any of these, in braces.
 * `{inputs}`: what the step's input steps produce. `{team}`: the project's Lead. `{signer}`: the
 * role that signs. `{due}`: the due date. `{person}`: who a reminder is about. `{days}`: how late.
 */
export const MESSAGE_PLACEHOLDERS = [
  'project',
  'project_name',
  'step',
  'step_name',
  'team',
  'signer',
  'due',
  'inputs',
  'person',
  'days',
  'decision',
] as const;

/** Work messages are written from these templates (docs/dashboard.md#notifications-and-work-messages). */
export const MessageTemplates = z.strictObject({
  task_assigned: z.string().min(1),
  signature_requested: z.string().min(1),
  work_returned: z.string().min(1),
  checkpoint_decided: z.string().min(1),
  project_held: z.string().min(1),
  project_resumed: z.string().min(1),
  project_dropped: z.string().min(1),
  reminder_due_soon: z.string().min(1),
  reminder_due_today: z.string().min(1),
  escalation_late: z.string().min(1),
  signature_waiting: z.string().min(1),
  deviation_to_review: z.string().min(1),
  named_as_cause: z.string().min(1),
});
export type MessageKey = keyof z.infer<typeof MessageTemplates>;

export const RouteDefinition = z.strictObject({
  process: z.string().regex(/^[a-z][a-z0-9-]*$/),
  version: z.number().int().min(1),
  name: z.string().min(1),
  department: z.string().min(1),
  source: z.string().min(1),
  messages: MessageTemplates,
  stages: z.array(z.strictObject({ no: z.number().int().min(1), name: z.string().min(1) })).min(1),
  milestones: z.array(MilestoneDefinition).default([]),
  run: RunRules,
  steps: z.array(StepDefinition).min(1),
});
export type RouteDefinition = z.infer<typeof RouteDefinition>;
/** The route as written in the file, before defaults are filled in. */
export type RouteDefinitionInput = z.input<typeof RouteDefinition>;

/** The steps a condition waits for: the dependency graph's edges. */
export function conditionSteps(route: RouteDefinition, condition: Condition): StepKey[] {
  if ('step_approved' in condition) return [condition.step_approved];
  if ('step_done' in condition) return [condition.step_done];
  if ('decision_equals' in condition) return [condition.decision_equals.step];
  if ('decision_recorded' in condition) return [condition.decision_recorded.step];
  if ('milestone_reached' in condition) {
    const milestone = route.milestones.find((m) => m.key === condition.milestone_reached);
    return milestone?.recorded_at ? [milestone.recorded_at] : [];
  }
  return [];
}

/** The steps a step directly depends on: what its `starts_when` and its path wait for. */
export function directInputs(route: RouteDefinition, step: StepDefinition): StepKey[] {
  const keys = step.starts_when.flatMap((c) => conditionSteps(route, c));
  if (step.path) keys.push(step.path.decided_at.step);
  return [...new Set(keys)];
}

/** The steps that wait for a prerequisite (the route file's milestone): to open, submit or be approved. */
export function stepsWaitingFor(route: RouteDefinition, milestoneKey: string): StepKey[] {
  const names = (c: Condition) => 'milestone_reached' in c && c.milestone_reached === milestoneKey;
  return route.steps
    .filter((s) => [...s.starts_when, ...s.submit_requires, ...s.approve_requires].some(names))
    .map((s) => s.key);
}

/** Every step that depends on `key`, directly or indirectly (not including `key`). */
export function dependentsOf(route: RouteDefinition, key: StepKey): StepKey[] {
  const found = new Set<StepKey>();
  const queue = [key];
  while (queue.length > 0) {
    const current = queue.shift() as StepKey;
    for (const step of route.steps) {
      if (!found.has(step.key) && directInputs(route, step).includes(current)) {
        found.add(step.key);
        queue.push(step.key);
      }
    }
  }
  return route.steps.map((s) => s.key).filter((k) => found.has(k));
}

/** Every step `key` depends on, directly or indirectly. */
export function ancestorsOf(route: RouteDefinition, key: StepKey): StepKey[] {
  return route.steps.map((s) => s.key).filter((k) => dependentsOf(route, k).includes(key));
}

export function stepOf(route: RouteDefinition, key: string): StepDefinition | undefined {
  return route.steps.find((s) => s.key === key);
}

/**
 * Checks what the schema can't: every reference exists, the graph has no cycles, and every
 * send-back goes to a step the sender depends on. Returns the problems found (empty when valid).
 * Pass `roles` to also check every role key.
 */
export function validateRoute(
  route: RouteDefinition,
  options: { roles?: string[] } = {},
): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  for (const step of route.steps) {
    if (keys.has(step.key)) problems.push(`Step ${step.key} is defined twice`);
    keys.add(step.key);
  }
  const milestones = new Map(route.milestones.map((m) => [m.key, m]));
  const stages = new Set(route.stages.map((s) => s.no));
  const roles = options.roles ? new Set(options.roles) : null;
  const checkRole = (role: string, where: string, allowTeam = false) => {
    if (allowTeam && role === TEAM) return;
    if (roles && !roles.has(role)) problems.push(`${where}: there is no role "${role}"`);
  };

  const known = new Set<string>(MESSAGE_PLACEHOLDERS);
  for (const [name, text] of Object.entries(route.messages)) {
    for (const [, word] of text.matchAll(/\{([^}]*)\}/g)) {
      if (!known.has(word as string)) problems.push(`Message ${name}: unknown word {${word}}`);
    }
  }

  const starts = route.steps.filter((s) => s.done_at_go);
  if (starts.length !== 1) problems.push('Exactly one step must be done at Go');
  for (const step of starts) {
    if (step.starts_when.length > 0)
      problems.push(`Step ${step.key} is done at Go, so it waits for nothing`);
    if (step.signer) problems.push(`Step ${step.key} is done at Go, so it has no signer`);
  }

  const checkCondition = (condition: Condition, where: string) => {
    if ('step_approved' in condition) {
      const target = stepOf(route, condition.step_approved);
      if (!target) problems.push(`${where}: there is no step ${condition.step_approved}`);
      else if (!target.signer) {
        problems.push(`${where}: step ${target.key} has no sign-off, so use step_done`);
      }
    } else if ('step_done' in condition) {
      const target = stepOf(route, condition.step_done);
      if (!target) problems.push(`${where}: there is no step ${condition.step_done}`);
      else if (target.signer) {
        problems.push(`${where}: step ${target.key} has a sign-off, so use step_approved`);
      }
    } else if ('milestone_reached' in condition) {
      if (!milestones.has(condition.milestone_reached)) {
        problems.push(`${where}: there is no milestone ${condition.milestone_reached}`);
      }
    } else if ('decision_equals' in condition || 'decision_recorded' in condition) {
      const ref =
        'decision_equals' in condition ? condition.decision_equals : condition.decision_recorded;
      const decision = stepOf(route, ref.step)?.decisions.find((d) => d.key === ref.decision);
      if (!decision) problems.push(`${where}: step ${ref.step} has no decision ${ref.decision}`);
      else if (
        'decision_equals' in condition &&
        !decision.options.some((o) => o.value === condition.decision_equals.value)
      ) {
        problems.push(`${where}: ${ref.decision} has no option ${condition.decision_equals.value}`);
      }
    }
  };

  for (const step of route.steps) {
    const where = `Step ${step.key}`;
    if (!stages.has(step.stage)) problems.push(`${where}: there is no stage ${step.stage}`);
    step.doers.forEach((d) => checkRole(d, `${where} doers`, true));
    if (step.signer) checkRole(step.signer, `${where} signer`);
    if (step.all_must_sign && !step.signer) problems.push(`${where}: all_must_sign needs a signer`);
    if (!step.done_at_go && step.starts_when.length === 0) {
      problems.push(`${where} waits for nothing; only the first step may`);
    }
    step.starts_when.forEach((c) => checkCondition(c, `${where} starts_when`));
    step.submit_requires.forEach((c) => checkCondition(c, `${where} submit_requires`));
    step.approve_requires.forEach((c) => checkCondition(c, `${where} approve_requires`));
    if (!step.signer && step.approve_requires.length > 0) {
      problems.push(`${where}: approve_requires needs a signer`);
    }
    step.decisions.forEach((d) => checkRole(d.by, `${where} decision ${d.key}`));
    step.tasks.forEach((t) => checkRole(t.role, `${where} task ${t.key}`));
    if (step.path) {
      const { step: at, decision } = step.path.decided_at;
      const def = stepOf(route, at)?.decisions.find((d) => d.key === decision);
      if (!def) problems.push(`${where} path: step ${at} has no decision ${decision}`);
      else {
        const values = new Set(step.path.options.map((o) => o.value));
        for (const option of def.options) {
          if (!values.has(option.value)) {
            problems.push(`${where} path: no path for ${decision} = ${option.value}`);
          }
        }
      }
    }
    step.send_back.forEach((s) => checkRole(s.decided_by, `${where} send_back`));
  }

  for (const milestone of route.milestones) {
    const where = `Milestone ${milestone.key}`;
    if (milestone.recorded_at && !keys.has(milestone.recorded_at)) {
      problems.push(`${where}: there is no step ${milestone.recorded_at}`);
    }
    if (milestone.per_iteration && !milestone.recorded_at) {
      problems.push(`${where}: per_iteration needs recorded_at`);
    }
    milestone.recorded_by.forEach((r) => checkRole(r, where));
  }

  checkCondition(route.run.completed_when, 'run completed_when');
  route.run.hold.forEach((r) => checkRole(r, 'run hold'));
  route.run.resume.forEach((r) => checkRole(r, 'run resume'));
  for (const rule of route.run.drop) {
    checkRole(rule.role, 'run drop');
    rule.while_open?.forEach((k) => {
      if (!keys.has(k)) problems.push(`run drop: there is no step ${k}`);
    });
  }

  if (problems.length > 0) return problems;

  // The graph must have no cycles, so every step can eventually open.
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (key: string, trail: string[]): void => {
    if (done.has(key)) return;
    if (visiting.has(key)) {
      problems.push(`The route has a cycle: ${[...trail, key].join(' → ')}`);
      return;
    }
    visiting.add(key);
    const step = stepOf(route, key) as StepDefinition;
    for (const input of directInputs(route, step)) visit(input, [...trail, key]);
    visiting.delete(key);
    done.add(key);
  };
  route.steps.forEach((s) => visit(s.key, []));
  if (problems.length > 0) return problems;

  for (const step of route.steps) {
    const ancestors = new Set(ancestorsOf(route, step.key));
    for (const rule of step.send_back) {
      for (const to of rule.to) {
        if (!keys.has(to)) problems.push(`Step ${step.key} send_back: there is no step ${to}`);
        else if (!ancestors.has(to)) {
          problems.push(`Step ${step.key} send_back: step ${step.key} doesn't depend on ${to}`);
        }
      }
    }
  }
  return problems;
}

/** Parses and validates a route; throws with every problem found. */
export function parseRoute(input: unknown, options: { roles?: string[] } = {}): RouteDefinition {
  const route = RouteDefinition.parse(input);
  const problems = validateRoute(route, options);
  if (problems.length > 0) {
    throw new Error(
      `The route ${route.process} v${route.version} is not valid:\n- ${problems.join('\n- ')}`,
    );
  }
  return route;
}
