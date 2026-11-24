import { dateOfInstant } from '@coal/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditEvents } from '../src/modules/audit/tables';
import { OutboxDispatcher } from '../src/modules/events/dispatcher';
import { SUBSCRIPTIONS } from '../src/modules/events/subscriptions';
import { createTestApp, type TestApp } from './helpers';
import { createWorld, type World } from './world';

let t: TestApp;
let w: World;
const clock = { now: new Date() };

beforeAll(async () => {
  t = await createTestApp({}, { now: () => clock.now });
  w = await createWorld(t);
});
afterAll(async () => {
  await t?.close();
});

const call = (...args: Parameters<World['call']>) => w.call(...args);
const ok = (res: Promise<{ status: number; body: any }>) => w.ok(res);
const drain = () => new OutboxDispatcher(t.deps.db, SUBSCRIPTIONS).drain();
const inbox = async (as: string) =>
  (await ok(call('GET', '/notifications?limit=100', as))).items as any[];
const fresh = (name: string) => `${name} ${Math.random().toString(36).slice(2, 7)}`;
const id = (as: string) => w.who[as]!.user.id;
const give = (as: string, body: Record<string, unknown>, preview = false) =>
  call('POST', `/tasks${preview ? '?preview=true' : ''}`, as, body);
const tasksOf = async (as: string, query = '') =>
  (await ok(call('GET', `/tasks?limit=100${query}`, as))).items as any[];
const later = (days: number) =>
  dateOfInstant(new Date(clock.now.getTime() + days * 24 * 3_600_000));

/** POST with an If-Match header, which the world's `call` doesn't send. */
async function confirm(proposalId: string, as: string, version?: number | string) {
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/v1/proposals/${proposalId}/confirm`,
    headers: {
      cookie: w.who[as]!.cookie,
      ...(version !== undefined && { 'if-match': String(version) }),
    },
  });
  return { status: res.statusCode, body: res.json() };
}

const propose = (as: string, title: string, actions: unknown[]) =>
  call('POST', '/proposals', as, { title, actions });
const newTask = (body: Record<string, unknown>) => ({ endpoint: 'tasks.create', body });

describe('giving work (POST /tasks)', () => {
  it('makes my own task, which tells nobody', async () => {
    const title = fresh('Read the cage test standard');
    const made = await give('pme', { title });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({
      saved: true,
      warnings: [],
      task: { kind: 'own', title, assignee: { id: id('pme') }, assignedBy: null, request: null },
    });
    expect((await tasksOf('pme')).map((x) => x.title)).toContain(title);
    await drain();
    expect((await inbox('pme')).some((n) => n.title === title)).toBe(false);
  });

  it('assigns work down the ladder, and makes anything else a request', async () => {
    const title = fresh('Rerun the FEA on the cage');
    const assigned = await ok(give('head', { title, assigneeId: id('designer'), dueOn: later(5) }));
    expect(assigned.task).toMatchObject({
      kind: 'work',
      assignee: { id: id('designer') },
      assignedBy: { id: id('head'), name: 'Hari Example' },
      viaAi: false,
      dueOn: later(5),
    });

    const asked = await ok(
      give('designer', { title: fresh('Lend me the fixture'), assigneeId: id('ops') }),
    );
    expect(asked.task).toMatchObject({ kind: 'request', request: { state: 'pending' } });
    expect(asked.warnings[0]).toMatch(/goes as a request/);
    // Outside R&D, even the VP asks.
    expect(
      (await ok(give('vp', { title: fresh('Check the label'), assigneeId: id('qa') }))).task.kind,
    ).toBe('request');
    // Up the ladder is always a request.
    expect(
      (await ok(give('designer', { title: fresh('Approve leave'), assigneeId: id('lead') }))).task
        .kind,
    ).toBe('request');

    await drain();
    const told = (await inbox('designer')).find((n) => n.title === title);
    expect(told).toMatchObject({ kind: 'work_message', link: '/tasks' });
    expect(told.body).toMatch(/^Hari Example assigned this to you\. Due \d+ \w{3}\.$/);
    // The giver sees what they gave.
    expect((await tasksOf('head', '&scope=sent')).map((x) => x.title)).toContain(title);
  });

  it("lets a Lead assign only to people on their line's projects", async () => {
    const project = await w.go(fresh('Lead work'));
    const onTeam = await ok(
      give('lead', {
        title: fresh('Update the drawing'),
        assigneeId: id('designer'),
        projectId: project,
      }),
    );
    expect(onTeam.task).toMatchObject({ kind: 'work', subject: { type: 'project', id: project } });
    // The Trauma Lead has no project with the designer on it.
    const other = await ok(
      give('leadOther', { title: fresh('Help me'), assigneeId: id('designer') }),
    );
    expect(other.task.kind).toBe('request');
  });

  it('previews without saving, and checks the project, step and date', async () => {
    const title = fresh('Preview only');
    const preview = await ok(give('head', { title, assigneeId: id('aems') }, true));
    expect(preview).toMatchObject({ saved: false, task: { kind: 'work' } });
    expect((await tasksOf('aems')).map((x) => x.title)).not.toContain(title);

    const project = await w.go(fresh('Links'));
    expect(
      (await give('pme', { title: fresh('On a step'), projectId: project, stepKey: '7' })).status,
    ).toBe(201);
    const outsider = await give('outsider', { title: fresh('Not mine'), projectId: project });
    expect(outsider.status).toBe(403);
    expect(outsider.body.whoCan).toEqual(['Members of this project']);
    expect(
      (await give('pme', { title: fresh('Bad step'), projectId: project, stepKey: '99' })).status,
    ).toBe(400);
    expect((await give('pme', { title: fresh('No project'), stepKey: '7' })).status).toBe(400);
    expect((await give('pme', { title: fresh('Too late'), dueOn: later(-2) })).status).toBe(400);
  });
});

describe('answering a request', () => {
  it('lets the person accept it, and tells the one who asked', async () => {
    const title = fresh('Measure the screws');
    const { task } = await ok(give('designer', { title, assigneeId: id('ops') }));
    expect((await call('POST', `/tasks/${task.id}/accept`, 'pme')).status).toBe(403);
    const accepted = await ok(call('POST', `/tasks/${task.id}/accept`, 'ops'));
    expect(accepted.request).toEqual({ state: 'accepted', declineReason: null });
    const again = await call('POST', `/tasks/${task.id}/accept`, 'ops');
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ALREADY_DONE');

    await drain();
    expect(
      (await inbox('designer')).find((n) => n.title === `Om Example accepted: ${title}`),
    ).toMatchObject({
      link: '/tasks?scope=sent',
    });
  });

  it('lets the person decline it with a reason that only the task shows', async () => {
    const title = fresh('Rush the order');
    const { task } = await ok(give('designer', { title, assigneeId: id('ops') }));
    const declined = await ok(
      call('POST', `/tasks/${task.id}/decline`, 'ops', {
        reason: 'The vendor is closed this week',
      }),
    );
    expect(declined).toMatchObject({
      status: 'declined',
      request: { state: 'declined', declineReason: 'The vendor is closed this week' },
    });
    const sent = await tasksOf('designer', '&scope=sent&filter[status]=closed');
    expect(sent.find((x) => x.id === task.id)?.request.declineReason).toBe(
      'The vendor is closed this week',
    );
    expect((await ok(call('GET', `/tasks/${task.id}`, 'designer'))).status).toBe('declined');

    await drain();
    const told = (await inbox('designer')).find((n) => n.title === `Om Example declined: ${title}`);
    expect(told.kind).toBe('alert');
    expect(told.body).not.toContain('vendor');
  });

  it('accepts a request when its work starts, and answers only requests', async () => {
    const { task } = await ok(
      give('designer', { title: fresh('Start me'), assigneeId: id('ops') }),
    );
    const started = await ok(call('PATCH', `/tasks/${task.id}`, 'ops', { status: 'in_progress' }));
    expect(started.request.state).toBe('accepted');

    const { task: work } = await ok(
      give('head', { title: fresh('Plain work'), assigneeId: id('ops') }),
    );
    expect((await call('POST', `/tasks/${work.id}/accept`, 'ops')).status).toBe(400);
  });

  it('closes given work after its date without a deviation: it is not on the plan', async () => {
    const { task } = await ok(
      give('head', { title: fresh('Late but fine'), assigneeId: id('ops'), dueOn: later(0) }),
    );
    const saved = clock.now;
    clock.now = new Date(saved.getTime() + 4 * 24 * 3_600_000);
    try {
      expect((await call('PATCH', `/tasks/${task.id}`, 'ops', { status: 'done' })).status).toBe(
        200,
      );
    } finally {
      clock.now = saved;
    }
  });
});

describe('proposals (action cards)', () => {
  it('previews several actions together and saves nothing until the person confirms', async () => {
    const fea = fresh('Rerun the FEA');
    const label = fresh('Check the label');
    const card = await ok(
      propose('head', 'Two things for the cage', [
        newTask({ title: fea, assigneeId: id('designer'), dueOn: later(3) }),
        newTask({ title: label, assigneeId: id('qa') }),
      ]),
    );
    expect(card).toMatchObject({
      version: 1,
      status: 'pending',
      preparedByAi: false,
      chatId: null,
    });
    const [first, second] = card.preview.actions;
    expect(first.summary).toMatch(new RegExp(`^Assign to Dev Example: ${fea}, due \\d+ \\w{3}$`));
    expect(first.notified).toEqual([{ id: id('designer'), name: 'Dev Example' }]);
    expect(first.effects.tasks[0]).toMatchObject({
      kind: 'work',
      assignee: { id: id('designer') },
    });
    expect(second.summary).toBe(`Ask Quinn Example: ${label}`);
    expect(second.effects.warnings[0]).toMatch(/request/);
    // Nothing happened yet.
    expect((await tasksOf('designer')).map((x) => x.title)).not.toContain(fea);
    expect(
      (await ok(call('GET', '/proposals?status=pending', 'head'))).items.map((p: any) => p.id),
    ).toContain(card.id);
    expect((await call('GET', `/proposals/${card.id}`, 'vp')).status).toBe(403);

    // Confirming needs the version the person saw.
    expect((await confirm(card.id, 'head')).status).toBe(400);
    expect((await confirm(card.id, 'head', 7)).status).toBe(412);
    expect((await confirm(card.id, 'vp', 1)).status).toBe(403);
    const done = await confirm(card.id, 'head', 1);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'confirmed' });
    expect((await tasksOf('designer')).find((x) => x.title === fea)).toMatchObject({
      assignedBy: { id: id('head') },
      viaAi: false,
    });
    expect((await tasksOf('qa')).find((x) => x.title === label)?.kind).toBe('request');

    const again = await confirm(card.id, 'head', 1);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ALREADY_DONE');

    const [entry] = await t.deps.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'proposal.confirmed'), eq(auditEvents.recordId, card.id)));
    expect(entry).toMatchObject({ actorType: 'user', actorId: id('head') });
  });

  it('previews an edit as a new version, and refuses a confirm of the old one', async () => {
    const title = fresh('Edit me');
    const card = await ok(
      propose('head', 'One task', [newTask({ title, assigneeId: id('designer') })]),
    );
    const edited = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/proposals/${card.id}`,
      headers: { cookie: w.who.head!.cookie, 'if-match': '1' },
      payload: { actions: [newTask({ title, assigneeId: id('aems') })] },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ version: 2 });
    expect(edited.json().preview.actions[0].summary).toBe(`Assign to Asha Example: ${title}`);
    expect((await confirm(card.id, 'head', 1)).status).toBe(412);
    expect((await confirm(card.id, 'head', 2)).status).toBe(200);
    expect((await tasksOf('aems')).map((x) => x.title)).toContain(title);
    expect((await tasksOf('designer')).map((x) => x.title)).not.toContain(title);
  });

  it('can be discarded', async () => {
    const card = await ok(
      propose('head', 'Not needed', [
        newTask({ title: fresh('Drop me'), assigneeId: id('designer') }),
      ]),
    );
    expect((await ok(call('POST', `/proposals/${card.id}/reject`, 'head'))).status).toBe(
      'rejected',
    );
    expect((await confirm(card.id, 'head', 1)).status).toBe(409);
  });

  it("refuses what can't go on a card, and saves no card when an action is refused", async () => {
    const project = await w.go(fresh('Cards'));
    const approve = await propose('head', 'Sign it', [
      { endpoint: 'steps.approve', params: { id: project, key: '1' } },
    ]);
    expect(approve.status).toBe(400);
    expect(approve.body.errors[0].path).toBe('actions.0.endpoint');
    expect((await propose('head', 'Made up', [{ endpoint: 'nothing.here' }])).status).toBe(400);
    const invalid = await propose('head', 'Bad body', [newTask({ title: 'x' })]);
    expect(invalid.status).toBe(400);
    expect(invalid.body.errors[0].path).toBe('actions.0.body.title');

    const before = (await ok(call('GET', '/proposals', 'designer'))).items.length;
    const refused = await propose('designer', 'Not mine to start', [
      { endpoint: 'steps.start', params: { id: project, key: '2' } },
    ]);
    expect(refused.status).toBe(403);
    expect(refused.body.detail).toMatch(/^Action 1: /);
    expect((await ok(call('GET', '/proposals', 'designer'))).items.length).toBe(before);
  });

  it('describes a step action from the route', async () => {
    const project = await w.go(fresh('Start by card'));
    const card = await ok(
      propose('ops', 'Start the market study', [
        { endpoint: 'steps.start', params: { id: project, key: '2' } },
      ]),
    );
    expect(card.preview.actions[0]).toMatchObject({
      summary: 'Start step 2, Market study',
      effects: { steps: [{ key: '2', change: 'started' }] },
    });
    expect((await confirm(card.id, 'ops', 1)).status).toBe(200);
    expect((await w.stepOf(project, '2')).status).toBe('in_progress');
  });

  it('puts a step on a card for submitting only once its documents are in, and asks before it is sent', async () => {
    const project = await w.go(fresh('Submit by card'));
    const submitCard = (as: string) =>
      propose(as, 'Submit the inception', [
        { endpoint: 'steps.submit', params: { id: project, key: '1' } },
      ]);
    const refused = await submitCard('head');
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('DOCUMENTS_NEEDED');
    expect((await w.stepOf(project, '1')).status).toBe('ready');

    await w.attach(project, '1');
    const card = await ok(submitCard('head'));
    expect(card.preview.actions[0]).toMatchObject({
      summary: 'Submit for sign-off: step 1, Project inception',
    });
    // Nothing is handed in until the person confirms the card.
    expect((await w.stepOf(project, '1')).status).toBe('ready');
    expect((await confirm(card.id, 'head', 1)).status).toBe(200);
    expect((await w.stepOf(project, '1')).status).toBe('in_review');
  });

  it('shows the card again when what it would do has changed, and does nothing', async () => {
    const project = await w.go(fresh('Changed'));
    const title = fresh('Draw rev C');
    const card = await ok(
      propose('lead', 'Drawing', [newTask({ title, assigneeId: id('pme'), projectId: project })]),
    );
    expect(card.preview.actions[0].summary).toMatch(/^Assign to Pia Example/);
    // Pia leaves the team, so the Lead, who runs only the people on their line's teams, can only ask now.
    const team = (await ok(call('GET', `/projects/${project}/team`, 'lead'))).items.map(
      (m: any) => m.user.id,
    );
    await ok(
      call('PUT', `/projects/${project}/team`, 'lead', {
        userIds: team.filter((u: string) => u !== id('pme')),
      }),
    );
    const changed = await confirm(card.id, 'lead', 1);
    expect(changed.status).toBe(409);
    expect(changed.body.code).toBe('PREVIEW_CHANGED');
    expect((await tasksOf('pme')).map((x) => x.title)).not.toContain(title);

    const now = await ok(call('GET', `/proposals/${card.id}`, 'lead'));
    expect(now.version).toBe(2);
    expect(now.preview.actions[0].summary).toMatch(/^Ask Pia Example/);
    expect((await confirm(card.id, 'lead', 2)).status).toBe(200);
    expect((await tasksOf('pme')).find((x) => x.title === title)?.kind).toBe('request');
  });

  it('carries out every action or none', async () => {
    const { task: request } = await ok(
      give('designer', { title: fresh('Lend a jig'), assigneeId: id('ops') }),
    );
    const own = fresh('Clean the jig');
    const card = await ok(
      propose('ops', 'Take it on', [
        newTask({ title: own }),
        { endpoint: 'tasks.accept', params: { id: request.id } },
      ]),
    );
    expect(card.preview.actions[1].notified).toEqual([{ id: id('designer'), name: 'Dev Example' }]);
    await ok(call('POST', `/tasks/${request.id}/decline`, 'ops', { reason: 'Changed my mind' }));
    const failed = await confirm(card.id, 'ops', 1);
    expect(failed.status).toBe(409);
    expect(failed.body.detail).toMatch(/^Action 2: /);
    expect((await tasksOf('ops')).map((x) => x.title)).not.toContain(own);
    expect((await ok(call('GET', `/proposals/${card.id}`, 'ops'))).status).toBe('pending');
  });

  it('expires when nobody confirms it in time', async () => {
    const card = await ok(
      propose('head', 'Old card', [
        newTask({ title: fresh('Too slow'), assigneeId: id('designer') }),
      ]),
    );
    const saved = clock.now;
    clock.now = new Date(saved.getTime() + 73 * 3_600_000);
    try {
      const late = await confirm(card.id, 'head', 1);
      expect(late.status).toBe(409);
      expect(late.body.code).toBe('PROPOSAL_EXPIRED');
      expect((await ok(call('GET', `/proposals/${card.id}`, 'head'))).status).toBe('expired');
      const expired = (await ok(call('GET', '/proposals?status=expired', 'head'))).items;
      expect(expired.map((p: any) => p.id)).toContain(card.id);
    } finally {
      clock.now = saved;
    }
  });
});
