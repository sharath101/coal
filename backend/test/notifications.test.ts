import { addWorkingDays, makeCalendar } from '@coal/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ORG_ID } from '../src/core/config';
import { OutboxDispatcher } from '../src/modules/events/dispatcher';
import { SUBSCRIPTIONS } from '../src/modules/events/subscriptions';
import { runReminders } from '../src/modules/notifications/reminders';
import { createTestApp, type TestApp } from './helpers';
import { createWorld, type World } from './world';

let t: TestApp;
let w: World;
beforeAll(async () => {
  t = await createTestApp();
  w = await createWorld(t);
});
afterAll(async () => {
  await t?.close();
});

const call = (...args: Parameters<World['call']>) => w.call(...args);
const ok = (res: Promise<{ status: number; body: any }>) => w.ok(res);
const drain = () => new OutboxDispatcher(t.deps.db, SUBSCRIPTIONS).drain();
const inbox = async (as: string, query = '') =>
  (await ok(call('GET', `/notifications?limit=100${query}`, as))) as {
    items: any[];
    unread: number;
  };
const texts = async (as: string) => (await inbox(as)).items.map((n) => n.body as string);
const cal = makeCalendar();
/** Midday in India on a date: the instant the reminders run at. */
const noon = (date: string) => new Date(`${date}T06:30:00Z`);
const fresh = (name: string) => `${name} ${Math.random().toString(36).slice(2, 7)}`;

describe('work messages', () => {
  it('tells each person their part, written from the route template', async () => {
    const id = await w.go(fresh('Messages'));
    await drain();
    const lead = await inbox('lead');
    const own = lead.items.find((n) => n.projectId === id && n.stepKey === '1');
    expect(own.body).toMatch(
      /^Your part on SPN-\d\d-\d+: step 1, Project inception, with the Spine Lead\. The VP signs\. Due \d+ \w{3}\. Input: Product concept\.$/,
    );
    expect(own.link).toBe(`/projects/${id}?step=1`);
    expect(own.kind).toBe('work_message');
    expect(own.readAt).toBeNull();

    // Step 2 is the R&D Ops person's.
    expect((await texts('ops')).some((b) => b.includes('step 2, Market study'))).toBe(true);
    // A role with two holders puts the task in its queue, and both are told.
    for (const as of ['head', 'head2']) {
      expect((await texts(as)).some((b) => b.includes('step 1, Project inception'))).toBe(true);
    }
    // Nobody is told about work that isn't theirs.
    expect((await texts('designer')).some((b) => b.includes('step 1,'))).toBe(false);
  });

  it('sends a notification once, however often the events are delivered', async () => {
    const id = await w.go(fresh('Once'));
    await drain();
    const first = (await inbox('lead')).items.filter((n) => n.projectId === id).length;
    expect(first).toBeGreaterThan(0);
    await drain();
    expect((await inbox('lead')).items.filter((n) => n.projectId === id).length).toBe(first);
  });

  it('asks the signer to sign, and tells the doers when work is returned', async () => {
    const id = await w.go(fresh('Sign and return'));
    await w.attach(id, '2');
    await ok(call('POST', `/projects/${id}/steps/2/submit`, 'ops'));
    await drain();
    expect(
      (await texts('vp')).some((b) =>
        /^Your signature is needed on SPN-\d\d-\d+: step 2, Market study\. Please sign by \d+ \w{3}\.$/.test(
          b,
        ),
      ),
    ).toBe(true);

    await ok(
      call('POST', `/projects/${id}/steps/2/return`, 'vp', { comment: 'Please redo the sizing.' }),
    );
    await drain();
    const returned = (await inbox('ops')).items.find((n) => n.title === 'Step 2 was returned');
    expect(returned.kind).toBe('alert');
    expect(returned.body).toContain('was returned for rework');
    // The comment is content: the message doesn't carry it.
    expect(returned.body).not.toContain('sizing');
  });

  it('tells the team about checkpoints, holds and drops', async () => {
    const id = await w.go(fresh('Team news'));
    await ok(call('POST', `/projects/${id}/hold`, 'vp', { reason: 'Waiting for funds.' }));
    await ok(call('POST', `/projects/${id}/resume`, 'vp', { reason: 'Funds arrived.' }));
    await w.advance(id, '4');
    await ok(call('POST', `/projects/${id}/drop`, 'vp', { reason: 'Not needed.' }));
    await drain();
    const seen = await texts('designer');
    expect(seen.some((b) => /is on hold\.$/.test(b))).toBe(true);
    expect(seen.some((b) => /is running again\.$/.test(b))).toBe(true);
    expect(seen.some((b) => /the decision at step 4, Board approval, is recorded/.test(b))).toBe(
      true,
    );
    expect(seen.some((b) => /has been dropped\.$/.test(b))).toBe(true);
    // A person who isn't on the team isn't told.
    expect((await texts('outsider')).length).toBe(0);
  });

  it('asks the next role up to review a deviation, and tells the person named', async () => {
    const id = await w.go(fresh('Deviation news'));
    const task = (await w.stepOf(id, '2')).tasks[0];
    await ok(
      call('POST', '/deviations', 'ops', {
        taskId: task.id,
        reasonCode: 'test_lab_delay',
        reasonText: 'The lab is booked.',
        causeType: 'person',
        causeUserId: w.who.dard!.user.id,
        newDate: addWorkingDays(cal, new Date().toISOString().slice(0, 10), 5),
      }),
    );
    await drain();
    expect(
      (await texts('lead')).some((b) =>
        /^Om Example gave a new date, \d+ \w{3}, for step 2, Market study/.test(b),
      ),
    ).toBe(true);
    const dard = await texts('dard');
    expect(dard.some((b) => b.includes('named you as the cause'))).toBe(true);
    // The explanation is content: the message to the person named doesn't carry it.
    expect(dard.some((b) => b.includes('booked'))).toBe(false);
  });
});

describe('reading notifications', () => {
  it('marks one, or all, as read, and only for the person they were sent to', async () => {
    await w.go(fresh('Reading'));
    await drain();
    const before = await inbox('lead');
    expect(before.unread).toBeGreaterThan(1);
    const one = before.items[0];
    expect((await call('POST', `/notifications/${one.id}/read`, 'vp')).status).toBe(403);
    const read = await ok(call('POST', `/notifications/${one.id}/read`, 'lead'));
    expect(read.readAt).toBeTruthy();
    expect((await inbox('lead')).unread).toBe(before.unread - 1);
    expect((await inbox('lead', '&filter[unread]=true')).items.every((n) => !n.readAt)).toBe(true);

    const all = await ok(call('POST', '/notifications/read-all', 'lead'));
    expect(all.marked).toBe(before.unread - 1);
    expect((await inbox('lead')).unread).toBe(0);
    expect((await call('GET', '/notifications', null)).status).toBe(401);
  });

  it('pages through a long list without skipping any', async () => {
    const seen = new Set<string>();
    let cursor = '';
    let pages = 0;
    do {
      const page = await ok(call('GET', `/notifications?limit=3${cursor}`, 'lead'));
      for (const n of page.items) {
        expect(seen.has(n.id)).toBe(false);
        seen.add(n.id);
      }
      cursor = page.nextCursor ? `&cursor=${page.nextCursor}` : '';
      pages += 1;
    } while (cursor && pages < 50);
    expect(seen.size).toBe((await inbox('lead')).items.length);
  });
});

describe('reminders and escalation', () => {
  /** A project, and the date its step-1 task is due. */
  async function project() {
    const id = await w.go(fresh('Reminders'));
    const task = (await w.stepOf(id, '2')).tasks[0];
    return { id, task, due: task.dueOn as string };
  }
  const sent = async (as: string, id: string, kind: string) =>
    (await inbox(as)).items.filter((n) => n.projectId === id && n.kind === kind);
  /** Step 1 and 2a are due sooner than step 2, so the tests look at step 2's messages only. */
  const onStep2 = async (as: string, id: string, kind: string) =>
    (await sent(as, id, kind)).filter((n) => n.stepKey === '2');

  it('reminds two working days before, on the due date, and escalates when late', async () => {
    const { id, due } = await project();
    await runReminders(t.deps, DEFAULT_ORG_ID, noon(addWorkingDays(cal, due, -3)));
    expect(await onStep2('ops', id, 'reminder')).toHaveLength(0);

    // Two working days before: the person whose task it is.
    await runReminders(t.deps, DEFAULT_ORG_ID, noon(addWorkingDays(cal, due, -2)));
    const soon = await onStep2('ops', id, 'reminder');
    expect(soon).toHaveLength(1);
    expect(soon[0].body).toMatch(
      /^Reminder: step 2, Market study, on SPN-\d\d-\d+ is due \d+ \w{3}\.$/,
    );
    // The same reminder isn't sent twice.
    expect(await runReminders(t.deps, DEFAULT_ORG_ID, noon(addWorkingDays(cal, due, -2)))).toBe(0);

    // On the due date: the person, and the step's signer.
    await runReminders(t.deps, DEFAULT_ORG_ID, noon(due));
    expect(
      (await onStep2('ops', id, 'reminder')).some((n) => n.title === 'Step 2 is due today'),
    ).toBe(true);
    expect(
      (await onStep2('vp', id, 'reminder')).some((n) => n.title === 'Step 2 is due today'),
    ).toBe(true);

    // Two working days late: the next role up. Five: the Head and the VP's exception list.
    await runReminders(t.deps, DEFAULT_ORG_ID, noon(addWorkingDays(cal, due, 2)));
    const ladder = await onStep2('lead', id, 'escalation');
    expect(ladder).toHaveLength(1);
    expect(ladder[0].body).toMatch(
      /^Om Example is 2 working days late on step 2, Market study, of SPN-/,
    );
    expect(await onStep2('vp', id, 'escalation')).toHaveLength(0);

    await runReminders(t.deps, DEFAULT_ORG_ID, noon(addWorkingDays(cal, due, 5)));
    for (const as of ['head', 'head2', 'vp']) {
      const list = await onStep2(as, id, 'escalation');
      expect(
        list.some((n) => n.title === 'On the exception list: step 2'),
        as,
      ).toBe(true);
    }
  });

  it('sends nothing on a day off, or for a project on hold', async () => {
    const { id, due } = await project();
    const sunday = new Date(noon(due).getTime());
    while (sunday.getUTCDay() !== 0) sunday.setUTCDate(sunday.getUTCDate() + 1);
    expect(await runReminders(t.deps, DEFAULT_ORG_ID, sunday)).toBe(0);

    await ok(call('POST', `/projects/${id}/hold`, 'vp', { reason: 'Paused.' }));
    await runReminders(t.deps, DEFAULT_ORG_ID, noon(due));
    expect(await sent('ops', id, 'reminder')).toHaveLength(0);
  });

  it('reminds a signer, and tells the people who asked when a VP signature is overdue', async () => {
    const id = await w.go(fresh('Signature wait'));
    await w.attach(id, '2');
    await ok(call('POST', `/projects/${id}/steps/2/submit`, 'ops'));
    const signTask = (await ok(call('GET', '/tasks?limit=100', 'vp'))).items.find(
      (x: any) => x.kind === 'sign' && x.subject?.id === id,
    );
    expect(signTask.dueOn).toBeTruthy();
    await runReminders(t.deps, DEFAULT_ORG_ID, noon(signTask.dueOn));
    expect((await sent('vp', id, 'reminder')).some((n) => n.title.includes('waiting'))).toBe(true);

    // Two working days past due: reminded again, and the requester is told. Nothing goes above the VP.
    await runReminders(t.deps, DEFAULT_ORG_ID, noon(addWorkingDays(cal, signTask.dueOn, 2)));
    expect(
      (await sent('ops', id, 'alert')).some((n) => n.title.includes('signature request')),
    ).toBe(true);
    expect(await sent('md', id, 'escalation')).toHaveLength(0);
  });
});

describe('the live stream', () => {
  it('needs a session, and sends hints, never content', async () => {
    const address = await t.app.listen({ host: '127.0.0.1', port: 0 });
    const anonymous = await fetch(`${address}/api/v1/stream`);
    expect(anonymous.status).toBe(401);
    await anonymous.body?.cancel();

    const abort = new AbortController();
    const res = await fetch(`${address}/api/v1/stream`, {
      headers: { cookie: w.who.lead!.cookie },
      signal: abort.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = '';
    const readUntil = async (needle: string, ms: number) => {
      const deadline = Date.now() + ms;
      while (!text.includes(needle) && Date.now() < deadline) {
        const next = await Promise.race([
          reader.read(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 200)),
        ]);
        if (next && !next.done) text += decoder.decode(next.value);
      }
      return text.includes(needle);
    };
    expect(await readUntil(': connected', 3000)).toBe(true);
    // Give the listener time to start before something changes.
    await new Promise((resolve) => setTimeout(resolve, 500));

    await w.go(fresh('Live'));
    await drain();
    expect(await readUntil('"type":"notification"', 5000)).toBe(true);
    expect(await readUntil('"type":"widgets"', 5000)).toBe(true);
    // Only hints: no titles, no names, no project codes.
    expect(text).not.toMatch(/SPN-|Project inception|Leela/);
    abort.abort();
    await reader.cancel().catch(() => undefined);
  });
});
