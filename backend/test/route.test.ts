import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyAuditChain } from '../src/modules/audit/service';
import { auditEvents } from '../src/modules/audit/tables';
import { decisions, milestones, processRuns, sendBacks } from '../src/modules/process/tables';
import { createTestApp, productLineId, signUp, type SignedIn, type TestApp } from './helpers';

let t: TestApp;
let spine: string;
const who: Record<string, SignedIn> = {};

const PEOPLE = {
  vp: ['Vera Example', 'vp'],
  head: ['Hari Example', 'rd_head'],
  lead: ['Leela Example', 'rd_lead'],
  designer: ['Dev Example', 'design_engineer'],
  aems: ['Asha Example', 'aems'],
  pme: ['Pia Example', 'pme'],
  ops: ['Om Example', 'rd_ops'],
  dard: ['Dina Example', 'dard'],
  qc: ['Quin Example', 'qc_inspector'],
  md: ['Mira Example', 'board'],
  ceo: ['Chet Example', 'board'],
  outsider: ['Olga Example', 'marketing'],
} as const;

beforeAll(async () => {
  t = await createTestApp();
  spine = await productLineId(t.app, 'SPN');
  for (const [key, [name, roleKey]] of Object.entries(PEOPLE)) {
    who[key] = await signUp(t.app, {
      name,
      roleKey,
      ...(roleKey === 'rd_lead' && { productLineId: spine }),
    });
  }
});
afterAll(async () => {
  await t?.close();
});

interface Res {
  status: number;
  body: any;
}

async function call(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  url: string,
  as: string | null,
  payload?: unknown,
): Promise<Res> {
  const res = await t.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: as ? { cookie: who[as]!.cookie } : {},
    ...(payload !== undefined && { payload: payload as object }),
  });
  return { status: res.statusCode, body: res.body ? res.json() : null };
}

async function ok(res: Promise<Res>): Promise<any> {
  const r = await res;
  if (r.status >= 300) throw new Error(`Unexpected ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
}

const ids = (...keys: string[]) => keys.map((k) => who[k]!.user.id);
const team = () => ids('designer', 'pme', 'ops', 'dard', 'qc');

async function go(name: string, teamUserIds = team()): Promise<string> {
  const body = await ok(
    call('POST', '/projects', 'vp', { name, productLineId: spine, teamUserIds }),
  );
  return body.project.id;
}

const route = (id: string, as = 'vp') => ok(call('GET', `/projects/${id}/route`, as));
const stepOf = async (id: string, key: string, as = 'vp') =>
  (await route(id, as)).steps.find((s: { key: string }) => s.key === key);

const COOKIE_OF_ROLE: Record<string, string> = {
  vp: 'vp',
  rd_head: 'head',
  rd_lead: 'lead',
  design_engineer: 'designer',
  aems: 'aems',
  pme: 'pme',
  rd_ops: 'ops',
  dard: 'dard',
  qc_inspector: 'qc',
};

/** Submits a step as its first doer, then signs it off as its signer (both Board members at 4 and 23). */
async function finish(id: string, key: string) {
  const step = await stepOf(id, key);
  await ok(call('POST', `/projects/${id}/steps/${key}/submit`, COOKIE_OF_ROLE[step.doers[0].key]!));
  if (!step.signer) return;
  for (const as of step.signer.key === 'board'
    ? ['md', 'ceo']
    : [COOKIE_OF_ROLE[step.signer.key]!]) {
    await ok(call('POST', `/projects/${id}/steps/${key}/approve`, as));
  }
}

const milestone = (id: string, key: string, as: string) =>
  ok(call('POST', `/projects/${id}/milestones`, as, { milestone: key }));

const decide = (id: string, step: string, decision: string, value: string) =>
  ok(call('POST', `/projects/${id}/steps/${step}/decisions`, 'head', { decision, value }));

/** Walks a project through the route as far as `through` (a step key from the list below). */
async function advance(id: string, through: string, options: { preclinical?: 'yes' | 'no' } = {}) {
  const order = [
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
  ];
  for (const key of order) {
    if (key === '10') {
      await milestone(id, 'material_received_implant', 'ops');
      await milestone(id, 'material_received_instrument', 'ops');
      await milestone(id, 'test_licence_recorded', 'dard');
    }
    if (key === '12') {
      await decide(id, '12', 'prototypes_ok', 'yes');
      await decide(id, '12', 'preclinical_needed', options.preclinical ?? 'no');
    }
    await finish(id, key);
    if (key === through) return;
  }
}

/** Every page of a project's activity, newest first. */
async function allActivity(id: string) {
  const items: any[] = [];
  let cursor = '';
  do {
    const page = await ok(call('GET', `/projects/${id}/activity?limit=100${cursor}`, 'pme'));
    items.push(...page.items);
    cursor = page.nextCursor ? `&cursor=${page.nextCursor}` : '';
  } while (cursor);
  return items;
}

const myTasks = async (as: string, scope = 'mine') =>
  (await ok(call('GET', `/tasks?scope=${scope}&limit=100`, as))).items;

describe('Go', () => {
  it('previews what would open and who gets the tasks, and saves nothing', async () => {
    const res = await call('POST', '/projects?preview=true', 'vp', {
      name: 'Spine plate',
      productLineId: spine,
      teamUserIds: team(),
    });
    expect(res.status).toBe(201);
    expect(res.body.saved).toBe(false);
    expect(res.body.project).toBeNull();
    expect(res.body.preview.steps).toEqual([
      { key: 'C', name: 'The idea', iteration: 1, change: 'done' },
      { key: '1', name: 'Project inception', iteration: 1, change: 'ready' },
      { key: '2', name: 'Market study', iteration: 1, change: 'ready' },
      { key: '2a', name: 'Regulatory planning', iteration: 1, change: 'ready' },
    ]);
    const tasks = res.body.preview.tasks.map((x: any) => [
      x.stepKey,
      x.assignee?.name ?? x.queueRole?.name,
    ]);
    expect(tasks).toEqual([
      ['1', 'Hari Example'],
      ['1', 'Leela Example'],
      ['2', 'Om Example'],
      ['2a', 'Leela Example'],
      ['2a', 'Dina Example'],
    ]);
    expect(res.body.preview.team.map((p: any) => p.name).sort()).toEqual(
      [
        'Asha Example',
        'Dev Example',
        'Dina Example',
        'Hari Example',
        'Leela Example',
        'Om Example',
        'Pia Example',
        'Quin Example',
      ].sort(),
    );
    expect(res.body.preview.warnings).toEqual([]);
    expect((await ok(call('GET', '/projects', 'vp'))).items).toEqual([]);
    expect(await myTasks('head')).toEqual([]);
  });

  it('creates the project, its team and its first tasks', async () => {
    const res = await call('POST', '/projects', 'vp', {
      name: 'Spine plate',
      description: 'A made-up plate',
      productLineId: spine,
      teamUserIds: team(),
    });
    expect(res.status).toBe(201);
    expect(res.body.saved).toBe(true);
    expect(res.body.project).toMatchObject({
      name: 'Spine plate',
      status: 'active',
      stage: 1,
      productLine: { code: 'SPN' },
      createdBy: 'Vera Example',
      can: { hold: true, resume: false, drop: true, editTeam: false },
    });
    expect(res.body.project.code).toMatch(/^SPN-\d{2}-001$/);

    const id = res.body.project.id;
    const view = await route(id);
    expect(view.steps.filter((s: any) => s.status === 'ready').map((s: any) => s.key)).toEqual([
      '1',
      '2',
      '2a',
    ]);
    expect(view.steps.find((s: any) => s.key === 'C').status).toBe('done');
    expect(view.steps.find((s: any) => s.key === '3').waitsFor).toEqual([
      { step_approved: '1' },
      { step_approved: '2' },
    ]);

    const tasks = await myTasks('ops');
    expect(tasks).toMatchObject([
      {
        title: 'Work on step 2: Market study',
        stepKey: '2',
        status: 'open',
        subject: { type: 'project', id },
      },
    ]);
    // The second project takes the next number.
    const second = await go('Another plate');
    expect((await ok(call('GET', `/projects/${second}`, 'vp'))).code).toMatch(/-002$/);
  });

  it('is only for the VP', async () => {
    const body = { name: 'Not allowed', productLineId: spine };
    const asLead = await call('POST', '/projects', 'lead', body);
    expect(asLead.status).toBe(403);
    expect(asLead.body).toMatchObject({ code: 'NOT_ALLOWED', whoCan: ['VP'] });
    const asNobody = await call('POST', '/projects', null, body);
    expect(asNobody.status).toBe(401);
  });

  it('is refused for an unknown product line and for people without an account', async () => {
    const line = await call('POST', '/projects', 'vp', {
      name: 'No such line',
      productLineId: crypto.randomUUID(),
    });
    expect(line.body.code).toBe('VALIDATION_FAILED');
    const person = await call('POST', '/projects', 'vp', {
      name: 'Ghost team',
      productLineId: spine,
      teamUserIds: [crypto.randomUUID()],
    });
    expect(person.body.code).toBe('VALIDATION_FAILED');
  });

  it('is listed for everyone, and filtered by status', async () => {
    const all = await ok(call('GET', '/projects', 'pme'));
    expect(all.items.length).toBeGreaterThanOrEqual(2);
    const held = await ok(call('GET', '/projects?filter[status]=on_hold', 'pme'));
    expect(held.items).toEqual([]);
    const page = await ok(call('GET', '/projects?limit=1', 'pme'));
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();
    const next = await ok(call('GET', `/projects?limit=1&cursor=${page.nextCursor}`, 'pme'));
    expect(next.items[0].id).not.toBe(page.items[0].id);
  });
});

describe('a whole project, from Go to launch', () => {
  it('goes through every step, with both Board members and the step-20 follow-up', async () => {
    const id = await go('Full walk');
    await advance(id, '19', { preclinical: 'yes' });

    const view = await route(id);
    expect(view.steps.find((s: any) => s.key === '15').path).toBe('yes');
    expect(
      view.steps
        .find((s: any) => s.key === '4')
        .approvedBy.map((p: any) => p.name)
        .sort(),
    ).toEqual(['Chet Example', 'Mira Example']);
    expect(view.steps.find((s: any) => s.key === '20').status).toBe('ready');

    await ok(call('POST', `/projects/${id}/steps/20/start`, 'lead'));
    await milestone(id, 'trial_surgeries_complete', 'lead');
    expect((await stepOf(id, '21')).status).toBe('ready');
    await finish(id, '21');
    await finish(id, '22');
    // 22 waited for the regulatory plan (2a), which was done long ago.
    await finish(id, '23');
    expect((await stepOf(id, '24a')).status).toBe('locked');
    await milestone(id, 'positive_feedback_threshold', 'lead');
    await finish(id, '24a');
    await finish(id, '24b');
    await finish(id, '25');
    expect((await ok(call('GET', `/projects/${id}`, 'vp'))).status).toBe('completed');

    // Step 20 is signed off after the follow-up; then the project closes.
    const early = await call('POST', `/projects/${id}/steps/20/submit`, 'lead');
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('STEP_NOT_READY');
    await milestone(id, 'follow_up_complete', 'ops');
    await finish(id, '20');
    expect((await ok(call('GET', `/projects/${id}`, 'vp'))).status).toBe('closed');

    const events = await allActivity(id);
    const types = new Set(events.map((e: any) => e.type));
    for (const type of [
      'project.created',
      'step.ready',
      'step.submitted',
      'step.approved',
      'decision.recorded',
      'milestone.recorded',
      'project.launched',
    ]) {
      expect(types).toContain(type);
    }
    expect(events[0].actor.name).toBeTruthy();

    // Every change left audit entries, and the chain is intact.
    expect(await verifyAuditChain(t.deps.db)).toMatchObject({ ok: true });
  });

  it('refuses sign-off by anyone who is not the signer, and names who can', async () => {
    const id = await go('Sign-off rules');
    await ok(call('POST', `/projects/${id}/steps/1/submit`, 'head'));
    const wrong = await call('POST', `/projects/${id}/steps/1/approve`, 'head');
    expect(wrong.status).toBe(403);
    expect(wrong.body).toMatchObject({ code: 'NOT_ALLOWED', whoCan: ['VP'] });
    const returned = await call('POST', `/projects/${id}/steps/1/return`, 'vp', {
      comment: 'Name the AEMS expert',
    });
    expect(returned.status).toBe(200);
    expect((await stepOf(id, '1')).status).toBe('returned');
    await ok(call('POST', `/projects/${id}/steps/1/submit`, 'head'));
    await ok(call('POST', `/projects/${id}/steps/1/approve`, 'vp'));
    expect((await stepOf(id, '1')).status).toBe('approved');
    // The sign-off task went away with the approval, and the audit trail says so.
    expect((await myTasks('vp')).filter((x: any) => x.kind === 'sign')).toEqual([]);
    const closedTasks = await t.deps.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'task.done'));
    expect(closedTasks.length).toBeGreaterThan(0);

    // The return comment is content: the team sees it, a stranger sees only the status.
    const events = (as: string) => ok(call('GET', `/projects/${id}/activity?limit=100`, as));
    const returnedEvent = (page: any) => page.items.find((e: any) => e.type === 'step.returned');
    expect(returnedEvent(await events('pme')).payload.comment).toBe('Name the AEMS expert');
    expect(returnedEvent(await events('outsider')).payload).toEqual({ step: '1', iteration: 1 });
  });

  it('needs both Board members at step 4', async () => {
    const id = await go('Board rules');
    await advance(id, '3');
    await ok(call('POST', `/projects/${id}/steps/4/submit`, 'vp'));
    const signTasks = (await myTasks('md')).filter((x: any) => x.kind === 'sign');
    expect(signTasks).toHaveLength(1);
    await ok(call('POST', `/projects/${id}/steps/4/approve`, 'md'));
    const view = await stepOf(id, '4');
    expect(view.status).toBe('in_review');
    expect(view.actions.approve).toBe(false);
    const again = await call('POST', `/projects/${id}/steps/4/approve`, 'md');
    expect(again.body.code).toBe('ALREADY_DONE');
    expect((await stepOf(id, '4', 'ceo')).actions.approve).toBe(true);
    await ok(call('POST', `/projects/${id}/steps/4/approve`, 'ceo'));
    expect((await stepOf(id, '4')).status).toBe('approved');
  });

  it('refuses a step that is not open, with its code', async () => {
    const id = await go('Not ready');
    const res = await call('POST', `/projects/${id}/steps/7/submit`, 'designer');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('STEP_NOT_READY');
  });

  it('shows what the signed-in person may do now', async () => {
    const id = await go('Actions');
    expect((await stepOf(id, '2', 'ops')).actions).toMatchObject({ submit: true, approve: false });
    expect((await stepOf(id, '2', 'pme')).actions).toMatchObject({ submit: false, approve: false });
    expect((await stepOf(id, '2', 'vp')).actions).toMatchObject({ submit: false });
  });
});

describe('step 12 and step 15', () => {
  it('needs both answers, and the path of step 15 follows the pre-clinical answer', async () => {
    const id = await go('Pre-clinical no');
    await advance(id, '11');
    await ok(call('POST', `/projects/${id}/steps/12/submit`, 'lead'));
    const early = await call('POST', `/projects/${id}/steps/12/approve`, 'head');
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('DECISION_REQUIRED');

    const wrongOption = await call('POST', `/projects/${id}/steps/12/decisions`, 'head', {
      decision: 'prototypes_ok',
      value: 'maybe',
    });
    expect(wrongOption.body.code).toBe('VALIDATION_FAILED');
    const notHead = await call('POST', `/projects/${id}/steps/12/decisions`, 'lead', {
      decision: 'prototypes_ok',
      value: 'yes',
    });
    expect(notHead.body).toMatchObject({ code: 'NOT_ALLOWED', whoCan: ['R&D Head'] });

    await decide(id, '12', 'prototypes_ok', 'yes');
    await decide(id, '12', 'preclinical_needed', 'no');
    await ok(call('POST', `/projects/${id}/steps/12/approve`, 'head'));
    await finish(id, '13');
    const fifteen = await stepOf(id, '15');
    expect(fifteen).toMatchObject({
      status: 'ready',
      path: 'no',
      outputs: ['Justification that no study is needed'],
    });
    expect(
      (await ok(call('GET', `/projects/${id}/steps/12`, 'vp'))).decisions.map((d: any) => [
        d.decision,
        d.value,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ['prototypes_ok', 'yes'],
        ['preclinical_needed', 'no'],
        ['checkpoint', 'approved'],
      ]),
    );
  });
});

describe('sending work back', () => {
  it('13 → 7 previews, then resets only what depends on 7', async () => {
    const id = await go('Send back');
    await advance(id, '12');
    await ok(call('POST', `/projects/${id}/steps/13/start`, 'ops'));
    const body = { to: '7', reason: 'The lab test failed on the plate' };

    const preview = await ok(
      call('POST', `/projects/${id}/steps/13/send-back?preview=true`, 'head', body),
    );
    expect(preview.saved).toBe(false);
    expect(preview.preview.steps).toEqual([
      { key: '7', name: 'Implant design', iteration: 2, change: 'reset' },
      { key: '10', name: 'Implant prototype', iteration: 2, change: 'reset' },
      { key: '12', name: 'Review meeting', iteration: 2, change: 'reset' },
      { key: '13', name: 'Testing and validation', iteration: 2, change: 'reset' },
      { key: '7', name: 'Implant design', iteration: 2, change: 'ready' },
    ]);
    expect(preview.preview.cancelledTasks).toBeGreaterThan(0);
    // Nothing was saved.
    expect(await stepOf(id, '7')).toMatchObject({ status: 'approved', iteration: 1 });

    const done = await ok(call('POST', `/projects/${id}/steps/13/send-back`, 'head', body));
    expect(done.saved).toBe(true);
    const view = await route(id);
    const byKey = Object.fromEntries(view.steps.map((s: any) => [s.key, s]));
    expect([byKey['7'].iteration, byKey['7'].status]).toEqual([2, 'ready']);
    expect([byKey['10'].iteration, byKey['10'].status]).toEqual([2, 'locked']);
    expect([byKey['13'].iteration, byKey['13'].status]).toEqual([2, 'locked']);
    // The instrument side carries on.
    for (const key of ['6', '8', '9', '11'])
      expect([byKey[key].iteration, byKey[key].status]).toEqual([1, 'approved']);
    // The review's answers belong to the old iteration.
    expect(byKey['12'].decisions.map((d: any) => d.answer)).toEqual([null, null]);
    expect(byKey['7'].tasks.map((x: any) => x.title)).toEqual([
      'Work on step 7: Implant design',
      'Work on step 7: Implant design',
    ]);

    const stranger = await ok(call('GET', `/projects/${id}/steps/7`, 'outsider'));
    expect(stranger.iterations.map((i: any) => [i.iteration, i.status, i.resetReason])).toEqual([
      [1, 'reset', null],
      [2, 'ready', null],
    ]);
    const history = await ok(call('GET', `/projects/${id}/steps/7`, 'vp'));
    expect(history.iterations.map((i: any) => [i.iteration, i.status, i.resetReason])).toEqual([
      [1, 'reset', 'The lab test failed on the plate'],
      [2, 'ready', null],
    ]);

    const [row] = await t.deps.db
      .select()
      .from(sendBacks)
      .where(sql`${sendBacks.runId} is not null and ${sendBacks.toStepKey} = '7'`);
    expect(row).toMatchObject({ fromStepKey: '13', toStepKey: '7' });
    expect(row!.resetRunStepIds).toHaveLength(4);

    // The rework flows forward again.
    await finish(id, '7');
    expect((await stepOf(id, '10')).status).toBe('ready');
    expect((await stepOf(id, '10')).iteration).toBe(2);
  });

  it('is the Head only, and only to a step the route allows', async () => {
    const id = await go('Send back rules');
    await advance(id, '12');
    await ok(call('POST', `/projects/${id}/steps/13/start`, 'ops'));
    const asLead = await call('POST', `/projects/${id}/steps/13/send-back`, 'lead', {
      to: '7',
      reason: 'Because',
    });
    expect(asLead.body).toMatchObject({ code: 'NOT_ALLOWED', whoCan: ['R&D Head'] });
    const wrongTarget = await call('POST', `/projects/${id}/steps/13/send-back`, 'head', {
      to: '10',
      reason: 'Because',
    });
    expect(wrongTarget).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } });
    expect(wrongTarget.body.detail ?? wrongTarget.body.title).toContain('only to step 7, 8');
    const noSendBack = await call('POST', `/projects/${id}/steps/14/send-back`, 'head', {
      to: '7',
      reason: 'Because',
    });
    expect(noSendBack.body.code).toBe('VALIDATION_FAILED');
    expect((await stepOf(id, '13', 'head')).actions.sendBack).toEqual(['7', '8']);
    expect((await stepOf(id, '13', 'lead')).actions.sendBack).toEqual([]);
  });

  it('20 → 10 resets stage 3 onwards, but never the patient follow-up', async () => {
    const id = await go('Trials');
    await advance(id, '19');
    await ok(call('POST', `/projects/${id}/steps/20/start`, 'lead'));
    const followUp = (await myTasks('ops')).filter((x: any) => x.title.startsWith('Follow up'));
    expect(followUp).toHaveLength(1);

    const preview = await ok(
      call('POST', `/projects/${id}/steps/20/send-back?preview=true`, 'head', {
        to: '10',
        reason: 'Design change',
      }),
    );
    expect(
      preview.preview.steps.filter((s: any) => s.change === 'reset').map((s: any) => s.key),
    ).toEqual(['10', '12', '13', '14', '15', '16', '17', '18', '19', '20']);
    await ok(
      call('POST', `/projects/${id}/steps/20/send-back`, 'head', {
        to: '10',
        reason: 'Design change',
      }),
    );

    const after = (await myTasks('ops')).filter((x: any) => x.title.startsWith('Follow up'));
    expect(after.map((x: any) => x.id)).toEqual(followUp.map((x: any) => x.id));
    expect((await stepOf(id, '10')).status).toBe('ready');
    expect((await stepOf(id, '11')).status).toBe('approved');
    // Reopening step 20 later doesn't repeat the follow-up task.
    expect((await myTasks('ops')).filter((x: any) => x.title.startsWith('Follow up'))).toHaveLength(
      1,
    );
  });
});

describe('corrective actions', () => {
  it('stop step 18 until every one is closed', async () => {
    const id = await go('Corrective');
    await advance(id, '15');
    const raised = await call('POST', `/projects/${id}/corrective-actions`, 'lead', {
      title: 'Re-run the fatigue test',
    });
    expect(raised.status).toBe(201);
    expect(raised.body.preview.tasks[0]).toMatchObject({
      kind: 'corrective_action',
      assignee: { name: 'Leela Example' },
    });
    expect((await route(id)).openCorrectiveActions).toBe(1);
    const titleOf = async (as: string) =>
      (await stepOf(id, '16', as)).tasks.find((x: any) => x.kind === 'corrective_action').title;
    expect(await titleOf('pme')).toBe('Re-run the fatigue test');
    expect(await titleOf('outsider')).toBe('Corrective action');

    await finish(id, '16');
    await finish(id, '17');
    const blocked = await call('POST', `/projects/${id}/steps/18/submit`, 'lead');
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('CORRECTIVE_ACTIONS_OPEN');
    expect((await stepOf(id, '18')).submitNeeds).toEqual([{ no_open_corrective_actions: true }]);

    const task = (await myTasks('lead')).find((x: any) => x.kind === 'corrective_action');
    expect((await call('PATCH', `/tasks/${task.id}`, 'ops', { status: 'done' })).status).toBe(403);
    await ok(call('PATCH', `/tasks/${task.id}`, 'lead', { status: 'done' }));
    await finish(id, '18');
    expect((await stepOf(id, '19')).status).toBe('ready');
  });

  it('cannot be raised while the project is on hold', async () => {
    const id = await go('Corrective on hold');
    await advance(id, '15');
    await ok(call('POST', `/projects/${id}/hold`, 'vp', { reason: 'Waiting for the budget' }));
    const held = await call('POST', `/projects/${id}/corrective-actions`, 'lead', {
      title: 'While held',
    });
    expect(held.status).toBe(409);
    expect(held.body.code).toBe('PROJECT_NOT_ACTIVE');
    expect((await route(id)).openCorrectiveActions).toBe(0);
  });

  it('can be raised only by the Lead, and only while the case study is open', async () => {
    const id = await go('Corrective rules');
    const early = await call('POST', `/projects/${id}/corrective-actions`, 'lead', {
      title: 'Too early',
    });
    expect(early.body.code).toBe('STEP_NOT_READY');
    const asHead = await call('POST', `/projects/${id}/corrective-actions`, 'head', {
      title: 'Not mine',
    });
    expect(asHead.status).toBe(403);
  });
});

describe('milestones', () => {
  it('are recorded once, by the right role, when their step has opened', async () => {
    const id = await go('Milestones');
    const early = await call('POST', `/projects/${id}/milestones`, 'ops', {
      milestone: 'material_received_implant',
    });
    expect(early.body.code).toBe('STEP_NOT_READY');
    const wrongRole = await call('POST', `/projects/${id}/milestones`, 'lead', {
      milestone: 'test_licence_recorded',
    });
    expect(wrongRole.body).toMatchObject({ code: 'NOT_ALLOWED', whoCan: ['DARD'] });
    await ok(
      call('POST', `/projects/${id}/milestones`, 'dard', {
        milestone: 'test_licence_recorded',
        note: 'Applied on 3 March',
      }),
    );
    const again = await call('POST', `/projects/${id}/milestones`, 'dard', {
      milestone: 'test_licence_recorded',
    });
    expect(again.body.code).toBe('ALREADY_DONE');
    const unknown = await call('POST', `/projects/${id}/milestones`, 'dard', {
      milestone: 'nothing',
    });
    expect(unknown.status).toBe(404);
    const [row] = await t.deps.db
      .select()
      .from(milestones)
      .where(sql`${milestones.note} = 'Applied on 3 March'`);
    expect(row).toMatchObject({ milestone: 'test_licence_recorded', stepKey: null });
    expect(
      (await route(id)).milestones.find((m: any) => m.key === 'test_licence_recorded'),
    ).toMatchObject({ reached: true, canRecord: false });
  });
});

describe('hold, resume and drop', () => {
  it('pause the project, with a reason, and keep every record', async () => {
    const id = await go('Hold and drop');
    const asLead = await call('POST', `/projects/${id}/hold`, 'lead', {
      reason: 'Waiting for budget',
    });
    expect(asLead.body).toMatchObject({ code: 'NOT_ALLOWED', whoCan: ['VP'] });
    expect((await call('POST', `/projects/${id}/hold`, 'vp', { reason: 'no' })).body.code).toBe(
      'VALIDATION_FAILED',
    );

    await ok(call('POST', `/projects/${id}/hold`, 'vp', { reason: 'Waiting for the budget' }));
    const held = await ok(call('GET', `/projects/${id}`, 'vp'));
    expect(held).toMatchObject({
      status: 'on_hold',
      holdReason: 'Waiting for the budget',
      can: { hold: false, resume: true, drop: true },
    });
    const blocked = await call('POST', `/projects/${id}/steps/1/submit`, 'head');
    expect(blocked.body.code).toBe('PROJECT_NOT_ACTIVE');
    expect(
      (await call('POST', `/projects/${id}/hold`, 'vp', { reason: 'Again please' })).body.code,
    ).toBe('PROJECT_NOT_ACTIVE');

    await ok(call('POST', `/projects/${id}/resume`, 'vp', { reason: 'Budget approved' }));
    expect((await ok(call('GET', `/projects/${id}`, 'vp'))).status).toBe('active');
    await ok(call('POST', `/projects/${id}/steps/1/submit`, 'head'));

    const dropped = await ok(
      call('POST', `/projects/${id}/drop`, 'vp', { reason: 'Market has moved' }),
    );
    expect(dropped.preview.cancelledTasks).toBeGreaterThan(0);
    expect(await ok(call('GET', `/projects/${id}`, 'vp'))).toMatchObject({
      status: 'dropped',
      dropReason: 'Market has moved',
    });
    expect((await myTasks('ops')).filter((x: any) => x.subject.id === id)).toEqual([]);
    const cancelled = await t.deps.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'task.cancelled'));
    expect(cancelled.length).toBeGreaterThanOrEqual(dropped.preview.cancelledTasks);
    expect((await allActivity(id)).map((e: any) => e.type)).toContain('task.cancelled');
    expect(
      (await call('POST', `/projects/${id}/resume`, 'vp', { reason: 'Too late now' })).body.code,
    ).toBe('PROJECT_NOT_ACTIVE');

    const rows = await t.deps.db
      .select()
      .from(decisions)
      .where(sql`${decisions.runId} = (select process_run_id from projects where id = ${id})`);
    expect(
      rows
        .filter((r) => ['go', 'hold', 'resume', 'drop'].includes(r.decision))
        .map((r) => r.decision),
    ).toEqual(['go', 'hold', 'resume', 'drop']);
  });

  it('lets the Board drop only at the two Board checkpoints', async () => {
    const id = await go('Board drop');
    const early = await call('POST', `/projects/${id}/drop`, 'md', { reason: 'Not convinced' });
    expect(early.body).toMatchObject({ code: 'NOT_ALLOWED', whoCan: ['VP'] });
    expect((await ok(call('GET', `/projects/${id}`, 'md'))).can.drop).toBe(false);

    await advance(id, '3');
    expect((await ok(call('GET', `/projects/${id}`, 'md'))).can.drop).toBe(true);
    await ok(call('POST', `/projects/${id}/drop`, 'md', { reason: 'Not convinced' }));
    expect((await ok(call('GET', `/projects/${id}`, 'vp'))).status).toBe('dropped');
  });
});

describe('role queues, claims and reassigning', () => {
  it('sends a task to the queue when nobody on the team holds the role, and the claimer joins the team', async () => {
    const second = await signUp(t.app, { name: 'Dana Example', roleKey: 'dard' });
    who.dard2 = second;
    const id = await go('Queue', ids('designer', 'pme', 'ops', 'qc'));

    const dardTasks = (await myTasks('dard', 'queue')).filter((x: any) => x.subject.id === id);
    expect(dardTasks.map((x: any) => x.stepKey)).toEqual(['2a']);
    expect(dardTasks[0].queueRole).toEqual({ key: 'dard', name: 'DARD' });
    expect(dardTasks[0].assignee).toBeNull();

    const preview = await ok(
      call('POST', '/projects?preview=true', 'vp', {
        name: 'Queue preview',
        productLineId: spine,
        teamUserIds: ids('ops'),
      }),
    );
    expect(preview.preview.warnings).toContain(
      'No DARD is on the team, so this goes to the DARD queue.',
    );

    expect((await call('POST', `/tasks/${dardTasks[0].id}/claim`, 'ops')).status).toBe(403);
    const claimed = await ok(call('POST', `/tasks/${dardTasks[0].id}/claim`, 'dard2'));
    expect(claimed.assignee.name).toBe('Dana Example');
    expect(claimed.queueRole).toBeNull();
    expect(
      (await ok(call('GET', `/projects/${id}/team`, 'vp'))).items.map((m: any) => m.user.name),
    ).toContain('Dana Example');
    expect((await call('POST', `/tasks/${dardTasks[0].id}/claim`, 'dard')).status).toBe(403);
    // The claimer may now act on the step.
    expect((await stepOf(id, '2a', 'dard2')).actions.submit).toBe(true);
  });

  it('lets the Head reassign to anyone with the role, and the Lead only within the team', async () => {
    const id = await go('Reassign', ids('designer', 'pme', 'ops', 'qc'));
    const task = (await myTasks('dard', 'queue')).find((x: any) => x.subject.id === id);

    const toOps = await call('POST', `/tasks/${task.id}/reassign`, 'head', {
      assigneeId: who.ops!.user.id,
    });
    expect(toOps.body.code).toBe('VALIDATION_FAILED');
    const byLead = await call('POST', `/tasks/${task.id}/reassign`, 'lead', {
      assigneeId: who.dard!.user.id,
    });
    expect(byLead.body.code).toBe('VALIDATION_FAILED');
    expect(
      (await call('POST', `/tasks/${task.id}/reassign`, 'ops', { assigneeId: who.dard!.user.id }))
        .status,
    ).toBe(403);

    const byHead = await ok(
      call('POST', `/tasks/${task.id}/reassign`, 'head', { assigneeId: who.dard!.user.id }),
    );
    expect(byHead.assignee.name).toBe('Dina Example');
    expect((await myTasks('dard')).some((x: any) => x.id === task.id)).toBe(true);
  });

  it('lets people change the status of their own tasks only', async () => {
    const id = await go('Own tasks');
    const task = (await myTasks('ops')).find((x: any) => x.subject.id === id);
    expect((await call('GET', `/tasks/${task.id}`, 'pme')).status).toBe(403);
    expect((await call('PATCH', `/tasks/${task.id}`, 'pme', { status: 'done' })).status).toBe(403);
    const started = await ok(call('PATCH', `/tasks/${task.id}`, 'ops', { status: 'in_progress' }));
    expect(started.status).toBe('in_progress');
    await ok(call('PATCH', `/tasks/${task.id}`, 'ops', { status: 'done' }));
    expect((await call('PATCH', `/tasks/${task.id}`, 'ops', { status: 'open' })).body.code).toBe(
      'ALREADY_DONE',
    );
    expect((await myTasks('ops')).some((x: any) => x.id === task.id)).toBe(false);
    const closed = await ok(call('GET', '/tasks?filter[status]=closed&limit=100', 'ops'));
    expect(closed.items.some((x: any) => x.id === task.id)).toBe(true);
  });
});

describe('the team', () => {
  it('is changed by the Lead of its line or the Head, and every change is recorded', async () => {
    const id = await go('Team');
    const team = await ok(call('GET', `/projects/${id}/team`, 'pme'));
    const current = team.items.map((m: any) => m.user.id);

    expect((await call('PUT', `/projects/${id}/team`, 'pme', { userIds: current })).status).toBe(
      403,
    );
    const withoutQc = current.filter((x: string) => x !== who.qc!.user.id);
    const changed = await ok(call('PUT', `/projects/${id}/team`, 'lead', { userIds: withoutQc }));
    expect(changed.items.map((m: any) => m.user.id)).not.toContain(who.qc!.user.id);
    expect(
      (
        await call('PUT', `/projects/${id}/team`, 'head', {
          userIds: [...withoutQc, crypto.randomUUID()],
        })
      ).body.code,
    ).toBe('VALIDATION_FAILED');
    expect((await ok(call('GET', `/projects/${id}`, 'lead'))).can.editTeam).toBe(true);
    expect((await ok(call('GET', `/projects/${id}`, 'pme'))).can.editTeam).toBe(false);

    const activity = await ok(call('GET', `/projects/${id}/activity`, 'vp'));
    expect(activity.items.map((e: any) => e.type)).toContain('project.team_changed');
  });
});

describe('processes', () => {
  it('lists the R&D route and serves its definition', async () => {
    const list = await ok(call('GET', '/processes', 'pme'));
    expect(list.items).toEqual([
      { key: 'rnd-route', version: 2, name: 'R&D route', departmentCode: 'RND', stepCount: 28 },
    ]);
    const definition = await ok(call('GET', '/processes/rnd-route', 'pme'));
    expect(definition.steps).toHaveLength(28);
    const step = await ok(call('GET', '/processes/rnd-route/steps/24b', 'pme'));
    expect(step).toMatchObject({ key: '24b', signer: 'rd_head', new: true });
    expect((await call('GET', '/processes/nothing', 'pme')).status).toBe(404);
    expect((await call('GET', '/processes', null)).status).toBe(401);
  });
});

describe('previews', () => {
  it('work on every workflow action and change nothing', async () => {
    const id = await go('Previews');
    const status = async () => (await ok(call('GET', `/projects/${id}`, 'vp'))).status;

    const hold = await ok(
      call('POST', `/projects/${id}/hold?preview=true`, 'vp', { reason: 'Just looking' }),
    );
    expect(hold.saved).toBe(false);
    expect(await status()).toBe('active');
    const drop = await ok(
      call('POST', `/projects/${id}/drop?preview=true`, 'vp', { reason: 'Just looking' }),
    );
    expect(drop).toMatchObject({ saved: false, preview: { cancelledTasks: expect.any(Number) } });
    expect(drop.preview.cancelledTasks).toBeGreaterThan(0);
    expect(await status()).toBe('active');

    const start = await ok(call('POST', `/projects/${id}/steps/1/start?preview=true`, 'head'));
    expect(start.saved).toBe(false);
    expect((await stepOf(id, '1')).status).toBe('ready');
    const comment = { comment: 'Not yet please' };
    await ok(call('POST', `/projects/${id}/steps/1/submit`, 'head'));
    const returned = await ok(
      call('POST', `/projects/${id}/steps/1/return?preview=true`, 'vp', comment),
    );
    expect(returned.saved).toBe(false);
    expect((await stepOf(id, '1')).status).toBe('in_review');
  });

  it('are refused where there is nothing to preview, instead of being ignored', async () => {
    const id = await go('No preview');
    const team = (await ok(call('GET', `/projects/${id}/team`, 'vp'))).items.map(
      (m: any) => m.user.id,
    );
    const res = await call('PUT', `/projects/${id}/team?preview=true`, 'lead', {
      userIds: [team[0]],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect((await ok(call('GET', `/projects/${id}/team`, 'vp'))).items).toHaveLength(team.length);
    const task = (await myTasks('ops')).find((x: any) => x.subject.id === id);
    expect(
      (await call('PATCH', `/tasks/${task.id}?preview=true`, 'ops', { status: 'done' })).status,
    ).toBe(400);
    expect((await myTasks('ops')).some((x: any) => x.id === task.id)).toBe(true);
  });
});

describe('closing at launch', () => {
  it('records the launch date and a closed event when every step is already finished', async () => {
    const id = await go('Close at launch');
    await advance(id, '19');
    await ok(call('POST', `/projects/${id}/steps/20/start`, 'lead'));
    await milestone(id, 'trial_surgeries_complete', 'lead');
    await milestone(id, 'follow_up_complete', 'ops');
    await finish(id, '20');
    for (const key of ['21', '22', '23']) await finish(id, key);
    await milestone(id, 'positive_feedback_threshold', 'lead');
    for (const key of ['24a', '24b', '25']) await finish(id, key);

    expect((await ok(call('GET', `/projects/${id}`, 'vp'))).status).toBe('closed');
    const [run] = await t.deps.db
      .select()
      .from(processRuns)
      .where(sql`${processRuns.id} = (select process_run_id from projects where id = ${id})`);
    expect(run!.completedAt).not.toBeNull();
    const types = (await allActivity(id)).map((e: any) => e.type);
    expect(types).toContain('project.launched');
    expect(types).toContain('project.closed');
  });
});

describe('claiming from a Lead queue', () => {
  it('does not let a Lead from another product line join the project', async () => {
    const trauma = await productLineId(t.app, 'TRM');
    who.lead2 = await signUp(t.app, {
      name: 'Lena Example',
      roleKey: 'rd_lead',
      productLineId: spine,
    });
    who.traumaLead = await signUp(t.app, {
      name: 'Tess Example',
      roleKey: 'rd_lead',
      productLineId: trauma,
    });
    // Two Spine Leads, so the Lead's task waits in the Lead queue.
    const id = await go('Lead queue');
    const queued = (await myTasks('traumaLead', 'queue')).find(
      (x: any) => x.subject.id === id && x.stepKey === '1',
    );
    expect(queued).toMatchObject({ queueRole: { key: 'rd_lead' }, stepKey: '1' });

    const refused = await call('POST', `/tasks/${queued.id}/claim`, 'traumaLead');
    expect(refused).toMatchObject({
      status: 403,
      body: { code: 'NOT_ALLOWED', whoCan: ['The R&D Lead of this product line'] },
    });
    expect((await call('POST', `/projects/${id}/steps/1/submit`, 'traumaLead')).status).toBe(403);
    expect(
      (await ok(call('GET', `/projects/${id}/team`, 'vp'))).items.map((m: any) => m.user.name),
    ).not.toContain('Tess Example');

    const claimed = await ok(call('POST', `/tasks/${queued.id}/claim`, 'lead2'));
    expect(claimed.assignee.name).toBe('Lena Example');
    const types = (await allActivity(id)).map((e: any) => e.type);
    expect(types).toContain('project.team_changed');
  });
});
