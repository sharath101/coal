import { addWorkingDays, dateOfInstant, makeCalendar } from '@coal/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ORG_ID } from '../src/core/config';
import { auditEvents } from '../src/modules/audit/tables';
import { recomputeAll } from '../src/modules/schedule/nightly';
import { createTestApp, productLineId, type TestApp } from './helpers';
import { createWorld, type World } from './world';

let t: TestApp;
let w: World;
let spine: string;

/** The test clock: real time, moved forward by whole days when a test needs lateness. */
let daysAhead = 0;
const clock = () => new Date(Date.now() + daysAhead * 86_400_000);
const travel = (days: number) => {
  daysAhead = days;
};

beforeAll(async () => {
  t = await createTestApp();
  t.deps.now = clock;
  w = await createWorld(t);
  spine = await productLineId(t.app, 'SPN');
});
afterAll(async () => {
  await t?.close();
});

const call = (...args: Parameters<World['call']>) => w.call(...args);
const ok = (res: Promise<{ status: number; body: any }>) => w.ok(res);
const cal = makeCalendar();
const today = () => dateOfInstant(clock());
const inWorkingDays = (n: number) => addWorkingDays(cal, today(), n);

/** Go, as the VP, with milestones. */
async function goWith(name: string, milestones: unknown[]): Promise<any> {
  const body = await ok(
    call('POST', '/projects', 'vp', {
      name,
      productLineId: spine,
      teamUserIds: w.team(),
      milestones,
    }),
  );
  return body.project;
}

const project = (id: string, as = 'vp') => ok(call('GET', `/projects/${id}`, as));

describe('milestones at Go', () => {
  it('are saved with the project, in date order, and the preview saves none', async () => {
    travel(0);
    const preview = await ok(
      call('POST', '/projects?preview=true', 'vp', {
        name: 'Milestones preview',
        productLineId: spine,
        milestones: [{ stepKey: '4', targetDate: inWorkingDays(40) }],
      }),
    );
    expect(preview.project).toBeNull();

    const p = await goWith('Milestones at Go', [
      { stepKey: '25', targetDate: inWorkingDays(200) },
      { title: 'Surgeon advisory meeting', targetDate: inWorkingDays(20) },
      { stepKey: '4' },
    ]);
    expect(p.milestones).toMatchObject([
      {
        kind: 'own',
        stepKey: null,
        title: 'Surgeon advisory meeting',
        status: 'on_track',
        forecastDate: null,
      },
      { kind: 'step', stepKey: '25', title: 'Product launch', targetDate: inWorkingDays(200) },
      { kind: 'step', stepKey: '4', title: 'Board approval', targetDate: null, status: 'no_date' },
    ]);
    expect(p.milestones[1].forecastDate).toEqual(expect.any(String));
    expect(p.nextMilestone).toMatchObject({ title: 'Surgeon advisory meeting' });
    expect(p.can).toMatchObject({ editMilestones: true, reachMilestones: true });

    const [created] = await t.database.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'project.created'), eq(auditEvents.recordId, p.id)));
    expect((created?.after as any).milestones).toHaveLength(3);
  });

  it('can be left out', async () => {
    const p = await goWith('No milestones', []);
    expect(p.milestones).toEqual([]);
    expect(p.nextMilestone).toBeNull();
  });

  it.each([
    ['an unknown step', [{ stepKey: '99' }], 'milestones.0.stepKey'],
    ['the idea, which is done at Go', [{ stepKey: 'C' }], 'milestones.0.stepKey'],
    ['the same step twice', [{ stepKey: '4' }, { stepKey: '4' }], 'milestones.1.stepKey'],
    ['a step and a title', [{ stepKey: '4', title: 'Both' }], 'milestones.0.title'],
    ['neither a step nor a title', [{ targetDate: '2099-01-01' }], 'milestones.0.title'],
    [
      'a date that has passed',
      [{ title: 'Past', targetDate: '2020-01-01' }],
      'milestones.0.targetDate',
    ],
  ])('refuses %s', async (_name, milestones, path) => {
    const res = await call('POST', '/projects', 'vp', {
      name: 'Refused milestones',
      productLineId: spine,
      milestones,
    });
    expect(res.status).toBe(400);
    // The request's own check writes `body/milestones/0/title`; COAL's checks write `milestones.0.stepKey`.
    const paths = res.body.errors.map((e: any) =>
      e.path.replace(/^body\//, '').replaceAll('/', '.'),
    );
    expect(paths).toContain(path);
  });
});

describe('changing milestones after Go', () => {
  it('lets the VP and the Head add, change and remove them, and records each change', async () => {
    travel(0);
    const p = await goWith('Milestones later', []);
    const url = `/projects/${p.id}/milestones`;

    const added = await call('POST', url, 'head', {
      stepKey: '18',
      targetDate: inWorkingDays(120),
    });
    expect(added.status).toBe(201);
    expect(added.body.items).toMatchObject([{ stepKey: '18', title: 'Prototype approval' }]);
    const again = await call('POST', url, 'vp', { stepKey: '18' });
    expect(again.status).toBe(400);
    expect(again.body.detail).toMatch(/already a milestone/);

    const own = (await ok(call('POST', url, 'vp', { title: 'Trade show demo' }))).items.find(
      (m: any) => m.kind === 'own',
    );
    expect(own).toMatchObject({ status: 'no_date', targetDate: null });

    const changed = await ok(
      call('PATCH', `${url}/${own.id}`, 'head', {
        title: 'Trade show demo set',
        targetDate: inWorkingDays(30),
      }),
    );
    expect(changed.items.find((m: any) => m.id === own.id)).toMatchObject({
      title: 'Trade show demo set',
      targetDate: inWorkingDays(30),
      status: 'on_track',
    });
    const step = (await project(p.id)).milestones.find((m: any) => m.kind === 'step');
    const renamed = await call('PATCH', `${url}/${step.id}`, 'vp', { title: 'Another name' });
    expect(renamed.status).toBe(400);
    const cleared = await ok(call('PATCH', `${url}/${step.id}`, 'vp', { targetDate: null }));
    expect(cleared.items.find((m: any) => m.id === step.id).targetDate).toBeNull();
    const past = await call('PATCH', `${url}/${step.id}`, 'vp', { targetDate: '2020-01-01' });
    expect(past.status).toBe(400);

    const removed = await ok(call('DELETE', `${url}/${step.id}`, 'vp'));
    expect(removed.items.map((m: any) => m.id)).toEqual([own.id]);
    expect((await call('DELETE', `${url}/${step.id}`, 'vp')).status).toBe(404);
    // A removed step milestone can be added again.
    await ok(call('POST', url, 'vp', { stepKey: '18' }));

    const actions = (
      await t.database.db
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(eq(auditEvents.recordType, 'project_milestone'))
    ).map((a) => a.action);
    for (const action of ['added', 'changed', 'removed']) {
      expect(actions).toContain(`project_milestone.${action}`);
    }
    const activity = await ok(call('GET', `/projects/${p.id}/activity?limit=50`, 'designer'));
    expect(activity.items.map((e: any) => e.type)).toEqual(
      expect.arrayContaining(['project_milestone.added', 'project_milestone.removed']),
    );
  });

  it.each(['lead', 'designer', 'md', 'ops', 'outsider'])(
    'refuses %s, who sees them but may not change them',
    async (who) => {
      const p = await goWith(`Not for ${who}`, [{ title: 'Kick-off' }]);
      const res = await call('POST', `/projects/${p.id}/milestones`, who, { title: 'Mine' });
      expect(res.status).toBe(403);
      const seen = await project(p.id, who);
      expect(seen.milestones).toHaveLength(1);
      expect(seen.can).toMatchObject({ editMilestones: false, reachMilestones: false });
      const tick = await call(
        'PUT',
        `/projects/${p.id}/milestones/${seen.milestones[0].id}/reached`,
        who,
        { reached: true },
      );
      expect(tick.status).toBe(403);
    },
  );

  it('refuses changes once the project is dropped', async () => {
    const p = await goWith('Dropped with milestones', [{ title: 'Kick-off' }]);
    await ok(call('POST', `/projects/${p.id}/drop`, 'vp', { reason: 'Not needed any more' }));
    const res = await call('POST', `/projects/${p.id}/milestones`, 'vp', { title: 'Late add' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROJECT_NOT_ACTIVE');
    expect((await project(p.id)).can.editMilestones).toBe(false);
  });
});

describe('reaching milestones', () => {
  it('ticks off one in your own words, with a note, and can undo it', async () => {
    travel(0);
    const p = await goWith('Ticking', [{ title: 'Surgeon advisory meeting' }]);
    const url = `/projects/${p.id}/milestones/${p.milestones[0].id}/reached`;
    const ticked = await ok(
      call('PUT', url, 'head', { reached: true, note: 'Four surgeons came' }),
    );
    expect(ticked.items[0]).toMatchObject({
      status: 'reached',
      reachedOn: today(),
      reachedBy: { name: 'Hari Example' },
      note: 'Four surgeons came',
    });
    // The note is content: people outside the project's scope don't see it.
    const outside = await project(p.id, 'outsider');
    expect(outside.milestones[0]).toMatchObject({ status: 'reached', note: null });

    expect((await call('PUT', url, 'vp', { reached: true })).body.code).toBe('ALREADY_DONE');
    const undone = await ok(call('PUT', url, 'vp', { reached: false }));
    expect(undone.items[0]).toMatchObject({ status: 'no_date', reachedOn: null, note: null });
  });

  it('reaches a step milestone when its step is done, and never by hand', async () => {
    travel(0);
    const p = await goWith('Step reached', [{ stepKey: '2a', targetDate: inWorkingDays(20) }]);
    const tick = await call(
      'PUT',
      `/projects/${p.id}/milestones/${p.milestones[0].id}/reached`,
      'vp',
      {
        reached: true,
      },
    );
    expect(tick.status).toBe(409);
    expect(tick.body.code).toBe('USE_THE_STEP');

    await w.finish(p.id, '2a');
    const after = await project(p.id);
    expect(after.milestones[0]).toMatchObject({
      status: 'reached',
      reachedOn: today(),
      forecastDate: null,
    });
    expect(after.nextMilestone).toBeNull();
  });
});

describe('milestones and health', () => {
  it("is at risk when its step's forecast is after the target", async () => {
    travel(0);
    // Step 1 takes 5 working days from today, so a target of today can't be met.
    const p = await goWith('At risk', [{ stepKey: '1', targetDate: today() }]);
    expect(p.milestones[0]).toMatchObject({ status: 'at_risk', forecastDate: inWorkingDays(5) });
    expect(p.health).toBe('amber');
    expect(p.healthReasons).toContainEqual({
      code: 'milestone_at_risk',
      milestone: 'Project inception',
    });
    expect(p.nextMilestone).toMatchObject({ status: 'at_risk' });
  });

  it('turns the project amber when late, and red when more than 10 working days late', async () => {
    travel(0);
    const p = await goWith('Late milestone', [{ title: 'Design freeze', targetDate: today() }]);
    expect(p.health).toBe('green');

    travel(7);
    await recomputeAll(t.deps, DEFAULT_ORG_ID);
    const late = await project(p.id);
    expect(late.milestones[0]).toMatchObject({ status: 'late' });
    expect(late.milestones[0].daysLate).toBeGreaterThan(0);
    expect(late.healthReasons).toContainEqual(
      expect.objectContaining({ code: 'milestone_late', milestone: 'Design freeze' }),
    );

    travel(21);
    await recomputeAll(t.deps, DEFAULT_ORG_ID);
    const far = await project(p.id);
    expect(far.health).toBe('red');
    expect(far.healthReasons).toContainEqual(
      expect.objectContaining({ code: 'milestone_far_late', milestone: 'Design freeze' }),
    );

    // Delays and risks lists it beside the late steps, and counts it apart from them.
    const delays = await ok(
      call('GET', `/widgets/delays-risks?view=expanded&filter[project]=${p.id}`, 'vp'),
    );
    const row = delays.rows.find((r: any) => r.title === 'Milestone: Design freeze');
    expect(row).toMatchObject({
      badges: [{ label: 'Milestone' }, { tone: 'danger' }],
      cells: { project: far.code, planned: p.milestones[0].targetDate },
      group: { name: 'Spine' },
    });
    expect(row.cells.daysLate).toBeGreaterThan(10);
    expect(delays.counts.find((c: any) => c.key === 'lateMilestones').value).toBeGreaterThan(0);
    // The project list and My projects show it as the next milestone, late.
    const list = await ok(call('GET', '/projects?limit=100', 'designer'));
    expect(list.items.find((x: any) => x.id === p.id).nextMilestone).toMatchObject({
      title: 'Design freeze',
      status: 'late',
    });
    const mine = await ok(call('GET', '/widgets/my-projects?view=expanded', 'designer'));
    expect(mine.rows.find((r: any) => r.id === p.id)).toMatchObject({
      cells: { milestone: 'Design freeze', milestoneDue: p.milestones[0].targetDate },
      badges: expect.arrayContaining([{ label: 'Milestone late', tone: 'danger' }]),
    });

    // Ticking it off takes it out of health at once.
    await ok(
      call('PUT', `/projects/${p.id}/milestones/${p.milestones[0].id}/reached`, 'vp', {
        reached: true,
      }),
    );
    const done = await project(p.id);
    expect(done.milestones[0].status).toBe('reached');
    expect(done.healthReasons.some((r: any) => r.code.startsWith('milestone'))).toBe(false);
    travel(0);
  });
});
