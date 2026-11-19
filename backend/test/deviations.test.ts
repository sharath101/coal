import { addWorkingDays, dateOfInstant, makeCalendar } from '@coal/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
const later = addWorkingDays(makeCalendar(), dateOfInstant(new Date()), 4);

/** Step 2's task of the R&D Ops person, in a fresh project. */
async function opsTask() {
  const id = await w.go(`Deviations ${Math.random().toString(36).slice(2, 7)}`);
  const task = (await w.stepOf(id, '2')).tasks[0];
  return { id, task };
}

const body = (taskId: string, extra: Record<string, unknown> = {}) => ({
  taskId,
  reasonCode: 'test_lab_delay',
  reasonText: 'The lab is booked until next week.',
  causeType: 'person',
  causeUserId: w.who.dard!.user.id,
  newDate: later,
  ...extra,
});

describe('recording a deviation', () => {
  it('lets the assignee, the Lead and the Head record one, and moves the task and the forecast', async () => {
    const { id, task } = await opsTask();
    const before = await ok(call('GET', `/projects/${id}/timeline`, 'vp'));
    const recorded = await ok(call('POST', '/deviations', 'ops', body(task.id)));
    expect(recorded).toMatchObject({
      kind: 'forecast_slip',
      newDate: later,
      stepKey: '2',
      review: null,
      cause: { type: 'person', named: true, name: 'Dina Example' },
      recordedBy: { name: 'Om Example' },
    });
    const moved = (await w.stepOf(id, '2')).tasks[0];
    expect(moved.dueOn).toBe(later);
    expect(
      (await ok(call('GET', `/projects/${id}/timeline`, 'vp'))).forecastLaunch >=
        before.forecastLaunch,
    ).toBe(true);

    expect((await call('POST', '/deviations', 'lead', body(task.id))).status).toBe(201);
    expect((await call('POST', '/deviations', 'head', body(task.id))).status).toBe(201);
  });

  it('ignores a kind sent by the client: "rework" is the system’s record, with nothing to confirm', async () => {
    const { id, task } = await opsTask();
    const recorded = await ok(
      call('POST', '/deviations', 'ops', body(task.id, { kind: 'rework' })),
    );
    expect(recorded.kind).toBe('forecast_slip');
    expect(recorded.can.review).toBe(false);
    const waiting = (
      await ok(call('GET', `/deviations?filter[project]=${id}&filter[state]=review`, 'lead'))
    ).items;
    expect(waiting.map((d: any) => d.id)).toEqual([recorded.id]);
  });

  it('shows the task’s title only to people in the project’s scope', async () => {
    const { id, task } = await opsTask();
    await ok(call('POST', '/deviations', 'ops', body(task.id)));
    const title = async (as: string) =>
      (await ok(call('GET', `/deviations?filter[project]=${id}`, as))).items[0].taskTitle;
    expect(await title('lead')).toBe('Work on step 2: Market study');
    expect(await title('outsider')).toBeNull();
  });

  it('refuses people who are not the assignee, the Lead of the line or the Head', async () => {
    const { task } = await opsTask();
    for (const as of ['pme', 'dard', 'vp', 'leadOther', 'qa']) {
      const res = await call('POST', '/deviations', as, body(task.id));
      expect(res.status, as).toBe(403);
    }
    expect((await call('POST', '/deviations', null, body(task.id))).status).toBe(401);
  });

  it('checks the date, the cause and that the task is still open', async () => {
    const { id, task } = await opsTask();
    expect(
      (await call('POST', '/deviations', 'ops', body(task.id, { newDate: '2020-01-01' }))).status,
    ).toBe(400);
    expect(
      (
        await call(
          'POST',
          '/deviations',
          'ops',
          body(task.id, { causeType: 'person', causeUserId: undefined }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          'POST',
          '/deviations',
          'ops',
          body(task.id, { causeType: 'role', causeRole: 'wizard' }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          'POST',
          '/deviations',
          'ops',
          body(task.id, { causeType: 'outside', causeParty: 'A vendor' }),
        )
      ).status,
    ).toBe(201);
    await ok(call('PATCH', `/tasks/${task.id}`, 'ops', { status: 'done' }));
    expect((await call('POST', '/deviations', 'ops', body(task.id))).status).toBe(409);
    expect((await call('GET', `/projects/${id}/timeline`, 'vp')).status).toBe(200);
  });
});

describe('reviewing a deviation', () => {
  it('lets the next role up confirm it, once', async () => {
    const { task } = await opsTask();
    const dev = await ok(call('POST', '/deviations', 'ops', body(task.id)));
    expect(
      (await call('POST', `/deviations/${dev.id}/review`, 'ops', { outcome: 'confirmed' })).status,
    ).toBe(403);
    expect(
      (await call('POST', `/deviations/${dev.id}/review`, 'pme', { outcome: 'confirmed' })).status,
    ).toBe(403);

    const reviewed = await ok(
      call('POST', `/deviations/${dev.id}/review`, 'lead', {
        outcome: 'confirmed',
        note: 'Agreed.',
      }),
    );
    expect(reviewed.review).toMatchObject({
      outcome: 'confirmed',
      reviewer: { name: 'Leela Example' },
    });
    const again = await call('POST', `/deviations/${dev.id}/review`, 'head', {
      outcome: 'confirmed',
    });
    expect(again.status).toBe(409);
  });

  it('records a correction as a new deviation that points at the old one', async () => {
    const { id, task } = await opsTask();
    const dev = await ok(call('POST', '/deviations', 'ops', body(task.id)));
    const sooner = addWorkingDays(makeCalendar(), dateOfInstant(new Date()), 2);
    const corrected = await ok(
      call('POST', `/deviations/${dev.id}/review`, 'head', {
        outcome: 'corrected',
        reasonCode: 'vendor_delay',
        reasonText: 'It was the vendor, not the lab.',
        causeType: 'outside',
        causeParty: 'A made-up vendor',
        newDate: sooner,
      }),
    );
    expect(corrected.review).toMatchObject({ outcome: 'corrected' });
    expect(corrected.correctedBy).toBeTruthy();
    const list = (await ok(call('GET', `/deviations?filter[project]=${id}`, 'vp'))).items;
    const newer = list.find((d: any) => d.corrects === dev.id);
    expect(newer).toMatchObject({ reasonCode: 'vendor_delay', newDate: sooner });
    expect(list.find((d: any) => d.id === dev.id).correctedBy).toBe(newer.id);
    // The task follows the corrected date.
    expect((await w.stepOf(id, '2')).tasks[0].dueOn).toBe(sooner);
    // The correction is the reviewer's own: nothing more to review.
    const waiting = (
      await ok(call('GET', `/deviations?filter[project]=${id}&filter[state]=review`, 'vp'))
    ).items;
    expect(waiting).toHaveLength(0);
  });

  it('lists what waits for review', async () => {
    const { id, task } = await opsTask();
    const dev = await ok(call('POST', '/deviations', 'ops', body(task.id)));
    const waiting = (
      await ok(call('GET', `/deviations?filter[project]=${id}&filter[state]=review`, 'lead'))
    ).items;
    expect(waiting.map((d: any) => d.id)).toEqual([dev.id]);
    expect(waiting[0].can.review).toBe(true);
    const mine = (await ok(call('GET', `/deviations?filter[project]=${id}`, 'ops'))).items;
    expect(mine[0].can.review).toBe(false);
  });
});

describe('who sees the cause', () => {
  it('shows the named cause only to those allowed, and the sentence only to the project', async () => {
    const { id, task } = await opsTask();
    await ok(call('POST', '/deviations', 'ops', body(task.id)));
    const seen = async (as: string) =>
      (await ok(call('GET', `/deviations?filter[project]=${id}`, as))).items[0];

    for (const as of ['vp', 'head', 'lead', 'dard']) {
      const d = await seen(as);
      expect(d.cause, as).toMatchObject({ named: true, name: 'Dina Example' });
    }
    for (const as of ['pme', 'md', 'qa', 'outsider']) {
      const d = await seen(as);
      expect(d.cause, as).toMatchObject({ named: false, name: null, role: { name: 'DARD' } });
    }
    // The category and the dates are status; the sentence is content.
    expect((await seen('pme')).reasonText).toBe('The lab is booked until next week.');
    for (const as of ['qa', 'outsider', 'leadOther']) {
      const d = await seen(as);
      expect(d.reasonText, as).toBeNull();
      expect(d.reasonCode).toBe('test_lab_delay');
    }
    expect((await seen('leadOther')).cause.named).toBe(false);
  });

  it('lets only the person named add a comment, and shows it to the project', async () => {
    const { id, task } = await opsTask();
    const dev = await ok(call('POST', '/deviations', 'ops', body(task.id)));
    expect(
      (await call('POST', `/deviations/${dev.id}/comments`, 'pme', { body: 'Not me.' })).status,
    ).toBe(403);
    expect(
      (await call('POST', `/deviations/${dev.id}/comments`, 'vp', { body: 'Hmm.' })).status,
    ).toBe(403);
    const commented = await ok(
      call('POST', `/deviations/${dev.id}/comments`, 'dard', { body: 'The lab told us late.' }),
    );
    expect(commented.comments).toMatchObject([
      { body: 'The lab told us late.', user: { name: 'Dina Example' } },
    ]);
    const forOutsider = (await ok(call('GET', `/deviations?filter[project]=${id}`, 'outsider')))
      .items[0];
    expect(forOutsider.comments).toEqual([]);
  });

  it('lets a role named as the cause comment, for anyone holding it on the project', async () => {
    const { task } = await opsTask();
    const dev = await ok(
      call(
        'POST',
        '/deviations',
        'ops',
        body(task.id, { causeType: 'role', causeRole: 'dard', causeUserId: undefined }),
      ),
    );
    expect(dev.cause).toMatchObject({ type: 'role', named: true, role: { name: 'DARD' } });
    expect(
      (await call('POST', `/deviations/${dev.id}/comments`, 'dard', { body: 'Noted.' })).status,
    ).toBe(201);
    expect(
      (await call('POST', `/deviations/${dev.id}/comments`, 'pme', { body: 'Noted.' })).status,
    ).toBe(403);
  });
});
