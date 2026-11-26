import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parseRoute,
  dependentsOf,
  validateRoute,
  START_STEP_KEY,
  stepLabel,
  type RouteDefinition,
} from './definition';
import {
  apply,
  currentStage,
  runActionRoles,
  startRun,
  stepActions,
  waitsFor,
  type Action,
  type Effect,
  type RunState,
} from './engine';
import { loadRoute, loadRouteFiles } from './files';

const route = loadRoute('rnd-route', 2);
const BOARD = ['board-md', 'board-ceo'];

/** A run being walked through the route, step by step. */
class Walk {
  state: RunState;
  effects: Effect[] = [];
  constructor(readonly route: RouteDefinition) {
    const outcome = startRun(route);
    this.state = outcome.state;
    this.effects = outcome.effects;
  }

  do(action: Action): Effect[] {
    const outcome = apply(this.route, this.state, action);
    this.state = outcome.state;
    this.effects.push(...outcome.effects);
    return outcome.effects;
  }

  /** Submits and signs off a step, as its doers and signer would. */
  finish(key: string): this {
    const step = this.route.steps.find((s) => s.key === key)!;
    if (this.state.steps[key]!.status === 'ready') this.do({ type: 'start', step: key });
    if (!step.signer) {
      this.do({ type: 'submit', step: key });
      return this;
    }
    this.do({ type: 'submit', step: key, signers: step.all_must_sign ? BOARD : [] });
    for (const by of step.all_must_sign ? BOARD : ['signer'])
      this.do({ type: 'approve', step: key, by });
    return this;
  }

  status(key: string) {
    return this.state.steps[key]!.status;
  }

  iteration(key: string) {
    return this.state.steps[key]!.iteration;
  }

  /** The open steps, in route order. */
  open() {
    return this.route.steps
      .map((s) => s.key)
      .filter((k) => ['ready', 'in_progress', 'in_review', 'returned'].includes(this.status(k)));
  }

  milestone(key: string): this {
    this.do({ type: 'record_milestone', milestone: key });
    return this;
  }

  /** From Go to the review meeting (step 12) being open. */
  toReview(): this {
    for (const k of ['1', '2', '2a', '3', '4', '5', '6', '7', '8', '9']) this.finish(k);
    this.milestone('material_received_implant')
      .milestone('material_received_instrument')
      .milestone('test_licence_recorded');
    return this.finish('10').finish('11');
  }

  /** Records the review meeting's decisions and signs it off. */
  review(preclinical: 'yes' | 'no'): this {
    this.do({ type: 'decide', step: '12', decision: 'prototypes_ok', value: 'yes' });
    this.do({ type: 'decide', step: '12', decision: 'preclinical_needed', value: preclinical });
    return this.finish('12');
  }
}

const expectError = (fn: () => unknown, code: string) =>
  expect(fn).toThrow(expect.objectContaining({ name: 'EngineError', code }));

describe('the route file', () => {
  it('is valid, has 28 steps in 6 stages, and is the only version so far', () => {
    expect(loadRouteFiles().map((f) => f.file)).toEqual(['rnd-route.v2.yaml']);
    expect(route.steps).toHaveLength(28);
    expect(route.steps.map((s) => s.key)).toEqual([
      'C',
      '1',
      '2',
      '2a',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
      '13',
      '14',
      '15',
      '16',
      '17',
      '18',
      '19',
      '20',
      '21',
      '22',
      '23',
      '24a',
      '24b',
      '25',
    ]);
    expect(new Set(route.steps.map((s) => s.stage))).toEqual(new Set([1, 2, 3, 4, 5, 6]));
  });

  it('matches docs/workflow.md: 4 checkpoints and 25 sign-offs (Head 10, Lead 7, VP 6, Board 2)', () => {
    expect(route.steps.filter((s) => s.checkpoint).map((s) => s.key)).toEqual([
      '4',
      '12',
      '18',
      '23',
    ]);
    const signers = route.steps.flatMap((s) => (s.signer ? [s.signer] : []));
    expect(signers).toHaveLength(25);
    const count = (role: string) => signers.filter((s) => s === role).length;
    expect([count('rd_head'), count('rd_lead'), count('vp'), count('board')]).toEqual([
      10, 7, 6, 2,
    ]);
    expect(route.steps.filter((s) => !s.signer).map((s) => s.key)).toEqual(['C', '2a', '24a']);
  });

  it('only cites open questions that exist in docs/open-questions.md', () => {
    const doc = readFileSync(new URL('../../../docs/open-questions.md', import.meta.url), 'utf8');
    const known = new Set([...doc.matchAll(/^\| ([A-Z]{1,2}\d+) \|/gm)].map((m) => m[1]));
    const cited = [
      ...route.steps.flatMap((s) => s.assumptions),
      ...route.milestones.flatMap((m) => m.assumptions),
      ...route.run.assumptions,
    ];
    expect(cited.length).toBeGreaterThan(10);
    expect(cited.filter((id) => !known.has(id))).toEqual([]);
  });

  it('keeps rework on the implant design away from the instrument side', () => {
    const resets = dependentsOf(route, '7');
    expect(resets).toContain('10');
    expect(resets).toContain('13');
    expect(resets).not.toContain('8');
    expect(resets).not.toContain('11');
  });
});

describe('route validation', () => {
  const base = () => structuredClone(route);

  it('finds references to steps, milestones, decisions and roles that do not exist', () => {
    const broken = base();
    broken.steps[3]!.starts_when = [{ step_approved: '99' }];
    broken.steps[5]!.starts_when = [{ milestone_reached: 'nothing' }];
    broken.steps[6]!.doers = ['wizard'];
    expect(validateRoute(broken, { roles: ['vp', 'rd_head', 'rd_lead'] })).toEqual(
      expect.arrayContaining([
        'Step 2a starts_when: there is no step 99',
        'Step 4 starts_when: there is no milestone nothing',
        'Step 5 doers: there is no role "wizard"',
      ]),
    );
  });

  it('refuses a cycle', () => {
    const cyclic = base();
    cyclic.steps.find((s) => s.key === '5')!.starts_when.push({ step_approved: '7' });
    expect(validateRoute(cyclic).join()).toContain('cycle');
  });

  it('refuses a send-back to a step the sender does not depend on', () => {
    const wrong = base();
    wrong.steps.find((s) => s.key === '10')!.send_back = [{ to: ['8'], decided_by: 'rd_head' }];
    expect(validateRoute(wrong)).toEqual(["Step 10 send_back: step 10 doesn't depend on 8"]);
  });

  it('refuses step_approved on a step without a sign-off', () => {
    const wrong = base();
    wrong.steps.find((s) => s.key === '22')!.starts_when = [{ step_approved: '2a' }];
    expect(() => parseRoute(wrong)).toThrow(/step 2a has no sign-off, so use step_done/);
  });
});

describe('Go', () => {
  it('marks the idea done, records Go, and opens 1, 2 and 2a together', () => {
    const walk = new Walk(route);
    expect(walk.status('C')).toBe('done');
    expect(walk.open()).toEqual(['1', '2', '2a']);
    expect(walk.state.decisions).toEqual([
      { step: 'C', iteration: 1, decision: 'go', value: 'go' },
    ]);
    expect(walk.effects.filter((e) => e.type === 'step.ready').map((e) => e.step)).toEqual([
      '1',
      '2',
      '2a',
    ]);
  });

  it('shows the idea, the step done at Go, as step 0, and every other step as its own key', () => {
    const start = route.steps.find((s) => s.done_at_go);
    expect(start?.key).toBe(START_STEP_KEY);
    expect(stepLabel(START_STEP_KEY)).toBe('0');
    for (const step of route.steps.filter((s) => !s.done_at_go)) {
      expect(stepLabel(step.key)).toBe(step.key);
    }
  });
});

describe('a whole project, from Go to launch', () => {
  it('walks every step in order and finishes when the follow-up and outsourcing are done', () => {
    const walk = new Walk(route);
    walk.finish('1');
    expect(walk.open()).toEqual(['2', '2a']);
    walk.finish('2');
    expect(walk.open()).toEqual(['2a', '3']);
    walk.finish('3').finish('4');
    expect(walk.open()).toEqual(['2a', '5']);
    walk.finish('5');
    expect(walk.open()).toEqual(['2a', '6', '7', '8', '9']);

    // 10 and 11 wait for their design, their material and the test licence.
    walk.finish('6').finish('7').finish('8');
    expect(walk.status('10')).toBe('locked');
    expect(waitsFor(route, walk.state, '10')).toEqual([
      { milestone_reached: 'material_received_implant' },
      { milestone_reached: 'test_licence_recorded' },
    ]);
    walk.milestone('material_received_implant').milestone('test_licence_recorded');
    expect(walk.status('10')).toBe('ready');
    expect(walk.status('11')).toBe('locked');
    walk.milestone('material_received_instrument');
    expect(walk.status('11')).toBe('ready');

    walk.finish('10').finish('11').review('yes');
    expect(walk.open()).toEqual(['2a', '9', '13']);
    walk.finish('13');
    expect(walk.open()).toEqual(['2a', '9', '14', '15']);
    expect(walk.state.steps['15']!.path).toBe('yes');
    walk.finish('14').finish('15').finish('16').finish('17').finish('18');
    walk.finish('19');
    expect(currentStage(route, walk.state)).toBe(1); // 2a is still open

    walk.finish('2a');
    expect(currentStage(route, walk.state)).toBe(2); // so is 9
    walk.finish('9');
    expect(currentStage(route, walk.state)).toBe(5);

    // 21 starts at "surgeries complete", without waiting for the follow-up.
    walk.do({ type: 'start', step: '20' });
    walk.milestone('trial_surgeries_complete');
    expect(walk.open()).toEqual(['20', '21']);
    walk.finish('21').finish('22').finish('23');
    expect(walk.status('24a')).toBe('locked');
    walk.milestone('positive_feedback_threshold');
    walk.finish('24a').finish('24b').finish('25');

    expect(walk.state.status).toBe('completed');
    expect(walk.effects.at(-1)).toEqual({ type: 'run.completed' });
    expect(walk.open()).toEqual(['20']);

    // Step 20 is signed off once the year of follow-up is complete; then the run closes.
    expectError(() => walk.do({ type: 'submit', step: '20' }), 'STEP_NOT_READY');
    walk.milestone('follow_up_complete').finish('20');
    expect(walk.state.status).toBe('closed');
  });
});

describe('sign-offs', () => {
  it('lets the signer return the work to its authors, within the same iteration', () => {
    const walk = new Walk(route);
    walk.do({ type: 'submit', step: '1' });
    expect(walk.status('1')).toBe('in_review');
    walk.do({ type: 'return', step: '1', by: 'vp', comment: 'Name the AEMS expert' });
    expect(walk.status('1')).toBe('returned');
    expect(walk.iteration('1')).toBe(1);
    walk.do({ type: 'submit', step: '1' });
    walk.do({ type: 'approve', step: '1', by: 'vp' });
    expect(walk.status('1')).toBe('approved');
  });

  it('needs every Board member at a Board checkpoint, and records the checkpoint decision', () => {
    const walk = new Walk(route).finish('1').finish('2').finish('3');
    walk.do({ type: 'submit', step: '4', signers: BOARD });
    const first = walk.do({ type: 'approve', step: '4', by: 'board-md' });
    expect(first).toEqual([{ type: 'step.signed', step: '4', iteration: 1, by: 'board-md' }]);
    expect(walk.status('4')).toBe('in_review');
    expectError(() => walk.do({ type: 'approve', step: '4', by: 'board-md' }), 'ALREADY_DONE');
    expectError(() => walk.do({ type: 'approve', step: '4', by: 'someone-else' }), 'NOT_ALLOWED');

    walk.do({ type: 'approve', step: '4', by: 'board-ceo' });
    expect(walk.status('4')).toBe('approved');
    expect(walk.state.decisions.at(-1)).toEqual({
      step: '4',
      iteration: 1,
      decision: 'checkpoint',
      value: 'approved',
    });
    expect(walk.status('5')).toBe('ready');
  });

  it('lets any one Board member approve when no Board member had an account at submission', () => {
    const walk = new Walk(route).finish('1').finish('2').finish('3');
    walk.do({ type: 'submit', step: '4', signers: [] });
    walk.do({ type: 'approve', step: '4', by: 'board-md' });
    expect(walk.status('4')).toBe('approved');
  });

  it('returns the whole Board sign-off when one member returns it', () => {
    const walk = new Walk(route).finish('1').finish('2').finish('3');
    walk.do({ type: 'submit', step: '4', signers: BOARD });
    walk.do({ type: 'approve', step: '4', by: 'board-md' });
    walk.do({ type: 'return', step: '4', by: 'board-ceo', comment: 'Revise the budget' });
    expect(walk.state.steps['4']).toMatchObject({ status: 'returned', approvedBy: [] });
  });

  it('marks steps without a sign-off done when submitted', () => {
    const walk = new Walk(route);
    walk.do({ type: 'submit', step: '2a' });
    expect(walk.status('2a')).toBe('done');
  });

  it('refuses actions on a step that is not open', () => {
    const walk = new Walk(route);
    expectError(() => walk.do({ type: 'submit', step: '3' }), 'STEP_NOT_READY');
    expectError(() => walk.do({ type: 'approve', step: '1', by: 'vp' }), 'STEP_NOT_READY');
    expectError(() => walk.do({ type: 'start', step: '99' }), 'NOT_FOUND');
  });

  it('never changes the state it was given', () => {
    const walk = new Walk(route);
    const before = structuredClone(walk.state);
    apply(route, walk.state, { type: 'submit', step: '1' });
    expect(walk.state).toEqual(before);
  });
});

describe('the review meeting (step 12)', () => {
  it("can't be approved until the Head has answered both questions", () => {
    const walk = new Walk(route).toReview();
    walk.do({ type: 'submit', step: '12' });
    expectError(() => walk.do({ type: 'approve', step: '12', by: 'head' }), 'DECISION_REQUIRED');
    walk.do({ type: 'decide', step: '12', decision: 'prototypes_ok', value: 'yes' });
    expectError(() => walk.do({ type: 'approve', step: '12', by: 'head' }), 'DECISION_REQUIRED');
    walk.do({ type: 'decide', step: '12', decision: 'preclinical_needed', value: 'no' });
    walk.do({ type: 'approve', step: '12', by: 'head' });
    expect(walk.status('13')).toBe('ready');
  });

  it("can't be approved when the prototypes aren't OK", () => {
    const walk = new Walk(route).toReview();
    walk.do({ type: 'decide', step: '12', decision: 'prototypes_ok', value: 'no' });
    walk.do({ type: 'decide', step: '12', decision: 'preclinical_needed', value: 'no' });
    walk.do({ type: 'submit', step: '12' });
    expectError(() => walk.do({ type: 'approve', step: '12', by: 'head' }), 'DECISION_REQUIRED');
    expect(stepActions(route, walk.state, '12').sendBack).toEqual(['7', '8']);
  });

  it('refuses an answer that is not an option', () => {
    const walk = new Walk(route).toReview();
    expectError(
      () => walk.do({ type: 'decide', step: '12', decision: 'prototypes_ok', value: 'maybe' }),
      'VALIDATION_FAILED',
    );
  });
});

describe('step 15 has two paths', () => {
  it.each([
    ['yes', 'yes'],
    ['no', 'no'],
  ] as const)('a pre-clinical answer of %s gives step 15 the %s path', (answer, path) => {
    const walk = new Walk(route).toReview().review(answer).finish('13');
    expect(walk.state.steps['15']).toMatchObject({ status: 'ready', path });
    expect(walk.effects.find((e) => e.type === 'step.ready' && e.step === '15')).toMatchObject({
      path,
    });
  });
});

describe('corrective actions from step 16', () => {
  it('stop step 18 being submitted while any is open', () => {
    const walk = new Walk(route).toReview().review('no');
    for (const k of ['13', '14', '15', '16', '17']) walk.finish(k);
    walk.state.openCorrectiveActions = 2;
    expect(stepActions(route, walk.state, '18').submitNeeds).toEqual([
      { no_open_corrective_actions: true },
    ]);
    expectError(() => walk.do({ type: 'submit', step: '18' }), 'CORRECTIVE_ACTIONS_OPEN');
    walk.state.openCorrectiveActions = 0;
    walk.finish('18');
    expect(walk.status('19')).toBe('ready');
  });
});

describe('sending work back', () => {
  /** A project at testing (step 13), with every earlier step done. */
  const atTesting = () => new Walk(route).toReview().review('yes');

  it('13 → 7 reopens 7 and resets only what depends on it', () => {
    const walk = atTesting();
    walk.do({ type: 'start', step: '13' });
    const effects = walk.do({ type: 'send_back', from: '13', to: '7' });

    expect(effects.filter((e) => e.type === 'step.reset')).toEqual([
      { type: 'step.reset', step: '7', iteration: 1, newIteration: 2, reopened: true },
      { type: 'step.reset', step: '10', iteration: 1, newIteration: 2, reopened: false },
      { type: 'step.reset', step: '12', iteration: 1, newIteration: 2, reopened: false },
      { type: 'step.reset', step: '13', iteration: 1, newIteration: 2, reopened: false },
    ]);
    expect(walk.state.steps['7']).toMatchObject({ iteration: 2, status: 'ready' });
    expect(walk.state.steps['13']).toMatchObject({ iteration: 2, status: 'locked' });
    // The instrument side, the material and outsourcing carry on.
    for (const k of ['6', '8', '11'])
      expect(walk.state.steps[k]).toMatchObject({ iteration: 1, status: 'approved' });
    expect(walk.status('9')).toBe('approved');

    // The rework flows forward again: the material is still in, so 10 opens once 7 is approved.
    walk.finish('7');
    expect(walk.state.steps['10']).toMatchObject({ iteration: 2, status: 'ready' });
    walk.finish('10');
    expect(walk.state.steps['12']).toMatchObject({ iteration: 2, status: 'ready' });
    // The review's decisions belong to the earlier iteration, so they're needed again.
    walk.do({ type: 'submit', step: '12' });
    expectError(() => walk.do({ type: 'approve', step: '12', by: 'head' }), 'DECISION_REQUIRED');
  });

  it('18 → 16 resets 16, 17 and 18 only', () => {
    const walk = atTesting();
    for (const k of ['13', '14', '15', '16', '17']) walk.finish(k);
    walk.do({ type: 'submit', step: '18' });
    walk.do({ type: 'send_back', from: '18', to: '16' });
    const resets = walk.effects.filter((e) => e.type === 'step.reset').map((e) => e.step);
    expect(resets).toEqual(['16', '17', '18']);
    expect(walk.open()).toEqual(['16']);
  });

  it('20 → 10 after the trials resets stage 3 onwards, including steps already open', () => {
    const walk = atTesting();
    for (const k of ['13', '14', '15', '16', '17', '18', '19']) walk.finish(k);
    walk.milestone('trial_surgeries_complete');
    expect(walk.status('21')).toBe('ready');

    walk.do({ type: 'send_back', from: '20', to: '10' });
    const resets = walk.effects.filter((e) => e.type === 'step.reset').map((e) => e.step);
    expect(resets).toEqual(['10', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21']);
    expect(walk.state.steps['11']).toMatchObject({ iteration: 1, status: 'approved' });
    // The surgeries are needed again in the new iteration of step 20.
    expect(stepActions(route, walk.state, '20')).toMatchObject({ start: false, submit: false });
  });

  it('refuses a target the route does not allow, and a step that has no send-back', () => {
    const walk = atTesting();
    expectError(() => walk.do({ type: 'send_back', from: '13', to: '10' }), 'VALIDATION_FAILED');
    expectError(() => walk.do({ type: 'send_back', from: '9', to: '5' }), 'VALIDATION_FAILED');
  });

  it('refuses a send-back from a step that is not open', () => {
    const walk = atTesting();
    expectError(() => walk.do({ type: 'send_back', from: '12', to: '7' }), 'STEP_NOT_READY');
  });
});

describe('milestones', () => {
  it('are recorded at their step once it has opened, and only once', () => {
    const walk = new Walk(route);
    expectError(() => walk.milestone('material_received_implant'), 'STEP_NOT_READY');
    walk.milestone('test_licence_recorded'); // not tied to a step
    expectError(() => walk.milestone('test_licence_recorded'), 'ALREADY_DONE');
    expectError(() => walk.milestone('unknown'), 'NOT_FOUND');
  });
});

describe('hold and drop', () => {
  it('a project on hold refuses step work until it is resumed', () => {
    const walk = new Walk(route);
    walk.do({ type: 'hold' });
    expect(walk.state.status).toBe('on_hold');
    expectError(() => walk.do({ type: 'submit', step: '1' }), 'PROJECT_NOT_ACTIVE');
    expectError(() => walk.do({ type: 'hold' }), 'PROJECT_NOT_ACTIVE');
    expect(stepActions(route, walk.state, '1').submit).toBe(false);
    walk.do({ type: 'resume' });
    walk.do({ type: 'submit', step: '1' });
    expect(walk.status('1')).toBe('in_review');
  });

  it('dropping cancels the open steps and keeps the finished ones', () => {
    const walk = new Walk(route).finish('1');
    walk.do({ type: 'drop' });
    expect(walk.state.status).toBe('dropped');
    expect([walk.status('1'), walk.status('2'), walk.status('3')]).toEqual([
      'approved',
      'cancelled',
      'locked',
    ]);
    expectError(() => walk.do({ type: 'resume' }), 'PROJECT_NOT_ACTIVE');
  });

  it('the Board may drop only while step 4 or 23 is open; the VP any time', () => {
    const walk = new Walk(route);
    expect(runActionRoles(route, walk.state)).toEqual({ hold: ['vp'], resume: [], drop: ['vp'] });
    walk.finish('1').finish('2');
    walk.finish('3');
    expect(runActionRoles(route, walk.state).drop).toEqual(['vp', 'board']);
    walk.do({ type: 'hold' });
    expect(runActionRoles(route, walk.state)).toEqual({
      hold: [],
      resume: ['vp'],
      drop: ['vp', 'board'],
    });
  });
});
