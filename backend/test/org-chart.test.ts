import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditEvents } from '../src/modules/audit/tables';
import { resolveSession } from '../src/modules/auth/service';
import { nextUp, projectContext } from '../src/modules/notifications/audience';
import { findUser, createUser, placeUnplacedUsers } from '../src/modules/users/service';
import { users } from '../src/modules/users/tables';
import { createTestApp, productLineId, sessionCookie, signUp, type TestApp } from './helpers';
import { createWorld, type World } from './world';

/** Jayon's org chart: the seats of each position, who reports to whom, and the demo admin (docs/roles-and-access.md#the-org-chart). */

describe('seats', () => {
  let t: TestApp;
  let spine: string;
  let trauma: string;
  beforeAll(async () => {
    t = await createTestApp();
    spine = await productLineId(t.app, 'SPN');
    trauma = await productLineId(t.app, 'TRM');
  });
  afterAll(async () => {
    await t?.close();
  });

  const up = (body: Record<string, unknown>) =>
    t.app.inject({ method: 'POST', url: '/api/v1/auth/sign-up', payload: body });
  const roles = async () =>
    (await t.app.inject({ method: 'GET', url: '/api/v1/roles' })).json().positions as {
      key: string;
      full: boolean;
      fullProductLineIds: string[];
    }[];
  const position = async (key: string) => (await roles()).find((p) => p.key === key)!;

  it('gives a position with one seat to one person, and says so to the next', async () => {
    expect((await position('rd_head')).full).toBe(false);
    expect((await up({ name: 'Head One', positionKey: 'rd_head' })).statusCode).toBe(201);
    expect((await position('rd_head')).full).toBe(true);

    const second = await up({ name: 'Head Two', positionKey: 'rd_head' });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({
      code: 'POSITION_FULL',
      detail: 'The R&D Head seat is already taken.',
    });
  });

  it('counts the seats of a Lead and of the design engineers for each product line', async () => {
    expect(
      (await up({ name: 'Spine Lead', positionKey: 'rd_lead', productLineId: spine })).statusCode,
    ).toBe(201);
    const again = await up({
      name: 'Spine Lead Two',
      positionKey: 'rd_lead',
      productLineId: spine,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().detail).toBe('The R&D Lead on Spine seat is already taken.');
    expect(
      (await up({ name: 'Trauma Lead', positionKey: 'rd_lead', productLineId: trauma })).statusCode,
    ).toBe(201);

    const lead = await position('rd_lead');
    expect(lead.fullProductLineIds.sort()).toEqual([spine, trauma].sort());
    expect(lead.full).toBe(false);

    for (let n = 1; n <= 5; n++) {
      const res = await up({
        name: `Spine Designer ${n}`,
        positionKey: 'design_engineer',
        productLineId: spine,
      });
      expect(res.statusCode).toBe(201);
    }
    const sixth = await up({
      name: 'Spine Designer 6',
      positionKey: 'design_engineer',
      productLineId: spine,
    });
    expect(sixth.json()).toMatchObject({
      code: 'POSITION_FULL',
      detail: 'All 5 Design engineer seats on Spine are taken.',
    });
    expect(
      (
        await up({
          name: 'Trauma Designer 1',
          positionKey: 'design_engineer',
          productLineId: trauma,
        })
      ).statusCode,
    ).toBe(201);
    expect((await position('design_engineer')).fullProductLineIds).toEqual([spine]);
  });

  it('asks for a product line only where the position is counted by line', async () => {
    const missing = await up({ name: 'No Line Designer', positionKey: 'design_engineer' });
    expect(missing.json().code).toBe('PRODUCT_LINE_REQUIRED');
  });

  it('puts no limit on positions without a seat count', async () => {
    for (let n = 1; n <= 4; n++) {
      expect((await up({ name: `Staff ${n}`, positionKey: 'pme_staff' })).statusCode).toBe(201);
    }
    expect((await position('pme_staff')).full).toBe(false);
  });

  it('does not offer the admin position at sign-up', async () => {
    const res = await up({ name: 'Sneaky Admin', positionKey: 'admin' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_FAILED');
    expect((await roles()).map((p) => p.key)).not.toContain('admin');
  });

  it('checks the seat when someone changes position, and frees theirs', async () => {
    const mover = await signUp(t.app, { name: 'Mover', positionKey: 'qc_inspector' });
    const patch = (cookie: string, payload: object, version: string) =>
      t.app.inject({
        method: 'PATCH',
        url: '/api/v1/me',
        headers: { cookie, 'if-match': version },
        payload,
      });

    const full = await patch(mover.cookie, { positionKey: 'rd_head' }, mover.user.updatedAt);
    expect(full.statusCode).toBe(409);
    expect(full.json().code).toBe('POSITION_FULL');

    // A person in a full position can still change their name.
    const head = (
      await t.app.inject({
        method: 'POST',
        url: '/api/v1/auth/sign-in',
        payload: { name: 'Head One' },
      })
    ).json().user;
    const headCookie = sessionCookie(
      await t.app.inject({
        method: 'POST',
        url: '/api/v1/auth/sign-in',
        payload: { name: 'Head One' },
      }),
    );
    const renamed = await patch(headCookie, { name: 'Head One B' }, head.updatedAt);
    expect(renamed.statusCode).toBe(200);

    // Moving out frees the seat.
    const left = await patch(headCookie, { positionKey: 'pme_staff' }, renamed.json().updatedAt);
    expect(left.statusCode).toBe(200);
    expect((await position('rd_head')).full).toBe(false);
    expect(
      (await patch(mover.cookie, { positionKey: 'rd_head' }, mover.user.updatedAt)).statusCode,
    ).toBe(200);
  });

  it('does not count accounts that are switched off', async () => {
    const { user } = await signUp(t.app, { name: 'Leaver', positionKey: 'dard_lead' });
    expect((await position('dard_lead')).full).toBe(true);
    await t.deps.db.update(users).set({ status: 'inactive' }).where(eq(users.id, user.id));
    expect((await position('dard_lead')).full).toBe(false);
  });

  it('places accounts made before positions, by role, while seats last', async () => {
    const orgId = t.deps.config.orgId;
    const added = [];
    for (const name of ['Old Ops One', 'Old Ops Two']) {
      const [row] = await t.deps.db
        .insert(users)
        .values({ orgId, name, roleKey: 'rd_ops' })
        .returning();
      added.push(row!);
    }
    await t.deps.db.transaction((tx) => placeUnplacedUsers(tx, orgId));
    const placed = await Promise.all(added.map((u) => findUser(t.deps.db, orgId, u.id)));
    expect(placed.map((u) => u?.positionKey)).toEqual(['ops_manager', 'ops_analyst']);
  });
});

describe('who reports to whom', () => {
  let t: TestApp;
  let w: World;
  beforeAll(async () => {
    t = await createTestApp();
    w = await createWorld(t);
  });
  afterAll(async () => {
    await t?.close();
  });

  const me = async (as: string) => await w.ok(w.call('GET', '/me', as));

  it('shows each person who they report to, up the chart', async () => {
    const heads = ['Hari Example', 'Hana Example'];
    const reportsToHead = async (as: string) => {
      const boss = (await me(as)).reportsTo;
      expect(heads).toContain(boss.name);
      expect(boss.positionTitle).toBe('R&D Head');
    };
    expect((await me('designer')).reportsTo).toMatchObject({ name: 'Leela Example' });
    await reportsToHead('lead');
    // The test world has two Heads, because the seat was opened for it.
    expect((await me('head')).reportsTo).toMatchObject({ name: 'Vera Example' });
    expect((await me('vp')).reportsTo).toMatchObject({
      name: 'Mira Example',
      positionTitle: 'Managing Director',
    });
    expect((await me('md')).reportsTo).toBeNull();
    await reportsToHead('leadOther');
    // The managers' people come from the chart, not from the Lead.
    await reportsToHead('dard');
    await reportsToHead('ops');
    await reportsToHead('pme');
    expect((await me('qc')).reportsTo).toMatchObject({
      name: 'Dina Example',
      positionTitle: 'DARD Lead',
    });
  });

  it('lists every position with its people, to everyone signed in', async () => {
    const chart = (await w.ok(w.call('GET', '/org-chart', 'designer'))) as {
      positions: { key: string; holders: { name: string }[]; reportsTo: string | null }[];
    };
    const at = (key: string) => chart.positions.find((p) => p.key === key)!;
    expect(
      at('rd_lead')
        .holders.map((h) => h.name)
        .sort(),
    ).toEqual(['Leela Example', 'Lena Example']);
    expect(at('qc_inspector')).toMatchObject({ reportsTo: 'dard_lead' });
    expect(at('managing_director').holders.map((h) => h.name)).toEqual(['Mira Example']);
    expect(at('ceo').holders.map((h) => h.name)).toEqual(['Chet Example']);
    expect(chart.positions.map((p) => p.key)).not.toContain('admin');
    expect((await w.call('GET', '/org-chart', null)).status).toBe(401);
  });

  it('puts a metallurgy expert, not just any AEMS, on a project at Go', async () => {
    const aems2 = await signUp(t.app, { name: 'Fran Example', positionKey: 'fea_expert' });
    expect(aems2.user.name).toBe('Fran Example');
    const id = await w.go('Starting team', []);
    const team = (await w.ok(w.call('GET', `/projects/${id}/team`, 'vp'))).items.map(
      (m: any) => m.user.name,
    );
    expect(team).toContain('Asha Example');
    expect(team).not.toContain('Fran Example');
  });

  it('tells the people above someone when they are late: their manager, and the Lead of the line', async () => {
    const orgId = t.deps.config.orgId;
    const id = await w.go('Escalation');
    const ctx = (await projectContext(t.deps.db, orgId, id))!;
    const names = async (as: string) => {
      const row = (await findUser(t.deps.db, orgId, w.who[as]!.user.id))!;
      return (await nextUp(t.deps.db, orgId, ctx, row)).map((u) => u.name).sort();
    };
    const heads = ['Hana Example', 'Hari Example'];
    expect(await names('qc')).toEqual(['Dina Example', 'Leela Example']);
    expect(await names('designer')).toEqual(['Leela Example']);
    expect(await names('pme')).toEqual([...heads, 'Leela Example']);
    expect(await names('lead')).toEqual(heads);
    expect(await names('vp')).toEqual(['Chet Example', 'Mira Example']);
  });

  it('offers team workload to a manager, with the people who report to them', async () => {
    const layout = async (as: string) => (await w.ok(w.call('GET', '/widgets', as))).layout;
    expect(await layout('dard')).toContain('team-workload');
    expect(await layout('ops')).toContain('team-workload');
    expect(await layout('pme')).toContain('team-workload');
    expect(await layout('designer')).not.toContain('team-workload');
    expect(await layout('md')).not.toContain('team-workload');

    const workload = await w.ok(w.call('GET', '/widgets/team-workload?view=expanded', 'dard'));
    expect(workload.rows.map((r: any) => r.title)).toEqual(['Quin Example']);
    expect(workload.rows[0].actions).toEqual([]);
    expect((await w.call('GET', '/widgets/team-workload?view=expanded', 'designer')).status).toBe(
      403,
    );
  });

  it('lets a Lead assign to their own designers, and to others on their projects; a manager to their people', async () => {
    const kindOf = async (as: string, to: string) =>
      (
        await w.ok(
          w.call('POST', '/tasks?preview=true', as, {
            title: 'Check the drawing',
            assigneeId: w.who[to]!.user.id,
          }),
        )
      ).task.kind;
    expect(await kindOf('lead', 'designer')).toBe('work');
    // Quin is on a Spine project (made above), which the Lead runs.
    expect(await kindOf('lead', 'qc')).toBe('work');
    expect(await kindOf('lead', 'qa')).toBe('request');
    expect(await kindOf('dard', 'qc')).toBe('work');
    expect(await kindOf('qc', 'dard')).toBe('request');
  });
});

describe('the demo admin', () => {
  let t: TestApp;
  let off: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ ADMIN_SWITCHING: 'true' });
    off = await createTestApp();
    for (const app of [t, off]) {
      await app.deps.db.transaction((tx) =>
        createUser(
          tx,
          app.deps.config.orgId,
          { name: 'Admin', positionKey: 'admin' },
          { reserved: true },
        ),
      );
    }
    for (const [name, positionKey] of [
      ['Vera', 'vp'],
      ['Hari', 'rd_head'],
    ] as const) {
      await signUp(t.app, { name, positionKey });
    }
  });
  afterAll(async () => {
    await t?.close();
    await off?.close();
  });

  const post = (app: TestApp, url: string, cookie: string | null, payload?: object) =>
    app.app.inject({
      method: 'POST',
      url: `/api/v1${url}`,
      ...(cookie && { headers: { cookie } }),
      ...(payload && { payload }),
    });
  const signIn = async (app: TestApp, name: string) =>
    sessionCookie(await post(app, '/auth/sign-in', null, { name }));
  const me = async (app: TestApp, cookie: string) =>
    (await app.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } })).json();
  const idOf = async (name: string) => (await me(t, await signIn(t, name))).id as string;

  it('moves between people in one step, and stays able to, until the admin signs out', async () => {
    const adminCookie = await signIn(t, 'Admin');
    expect((await me(t, adminCookie)).switcher).toMatchObject({ name: 'Admin' });

    const veraId = await idOf('Vera');
    const toVera = await post(t, '/auth/switch', adminCookie, { userId: veraId });
    expect(toVera.statusCode).toBe(200);
    expect(toVera.json().user).toMatchObject({ name: 'Vera', position: { key: 'vp' } });
    const veraCookie = sessionCookie(toVera);
    expect(await me(t, veraCookie)).toMatchObject({
      name: 'Vera',
      switcher: { name: 'Admin' },
    });
    // The admin's session ended: the switch is one-way from that session.
    const old = await t.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: adminCookie },
    });
    expect(old.statusCode).toBe(401);

    // From Vera, on to Hari, and back to the admin.
    const toHari = await post(t, '/auth/switch', veraCookie, { userId: await idOf('Hari') });
    const hariCookie = sessionCookie(toHari);
    expect(await me(t, hariCookie)).toMatchObject({ name: 'Hari', switcher: { name: 'Admin' } });
    const back = await post(t, '/auth/switch', hariCookie, { userId: await idOf('Admin') });
    expect(back.statusCode).toBe(200);
    expect(back.json().user.name).toBe('Admin');
    expect(await me(t, sessionCookie(back))).toMatchObject({ switcher: { name: 'Admin' } });
  });

  it('acts as the person it switched to, and records the switch under the admin', async () => {
    const adminCookie = await signIn(t, 'Admin');
    const veraCookie = sessionCookie(
      await post(t, '/auth/switch', adminCookie, { userId: await idOf('Vera') }),
    );
    const mine = await t.app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { cookie: veraCookie },
    });
    expect(mine.statusCode).toBe(200);
    const trail = await t.deps.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'session.switched'));
    const admin = await findUser(t.deps.db, t.deps.config.orgId, await idOf('Admin'));
    expect(trail.length).toBeGreaterThan(0);
    expect(trail.every((e) => e.actorId === admin!.id && e.actorType === 'user')).toBe(true);
  });

  it('is not a way in for anyone else: a normal sign-in has no switcher and cannot switch', async () => {
    const veraCookie = await signIn(t, 'Vera');
    expect((await me(t, veraCookie)).switcher).toBeNull();
    const res = await post(t, '/auth/switch', veraCookie, { userId: await idOf('Hari') });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'NOT_ALLOWED' });
    expect((await post(t, '/auth/switch', null, { userId: await idOf('Hari') })).statusCode).toBe(
      401,
    );
  });

  it('keeps the admin out of the directory, the chart and the sign-up lists', async () => {
    const cookie = await signIn(t, 'Vera');
    const list = await t.app.inject({ method: 'GET', url: '/api/v1/users', headers: { cookie } });
    expect(list.json().items.map((u: { name: string }) => u.name)).not.toContain('Admin');
    const chart = await t.app.inject({
      method: 'GET',
      url: '/api/v1/org-chart',
      headers: { cookie },
    });
    expect(
      chart
        .json()
        .positions.flatMap((p: { holders: { name: string }[] }) => p.holders.map((h) => h.name)),
    ).not.toContain('Admin');
  });

  it('refuses a switch to someone whose account is switched off', async () => {
    const { user } = await signUp(t.app, { name: 'Gone', positionKey: 'pme_staff' });
    await t.deps.db.update(users).set({ status: 'inactive' }).where(eq(users.id, user.id));
    const res = await post(t, '/auth/switch', await signIn(t, 'Admin'), { userId: user.id });
    expect(res.statusCode).toBe(403);
  });

  it('is gone when the setting is off: no admin sign-in, no switching, and switched sessions end', async () => {
    const refused = await post(off, '/auth/sign-in', null, { name: 'Admin' });
    expect(refused.statusCode).toBe(403);

    // The same sessions, read with the setting off, are no longer anyone.
    const orgId = t.deps.config.orgId;
    const adminCookie = await signIn(t, 'Admin');
    const veraCookie = sessionCookie(
      await post(t, '/auth/switch', adminCookie, { userId: await idOf('Vera') }),
    );
    const token = (c: string) => c.split('=')[1]!;
    for (const switching of [true, false]) {
      const resolved = await resolveSession(t.deps.db, orgId, token(veraCookie), {
        adminSwitching: switching,
      });
      expect(resolved === null, `switching ${String(switching)}`).toBe(!switching);
    }
    // The admin's own session is no one either, with it off.
    expect(
      await resolveSession(t.deps.db, orgId, token(await signIn(t, 'Admin')), {
        adminSwitching: false,
      }),
    ).toBeNull();
  });

  it('is not offered in the sign-up form, with the setting on or off', async () => {
    for (const app of [t, off]) {
      const res = await app.app.inject({ method: 'GET', url: '/api/v1/roles' });
      expect(res.json().roles.map((r: { key: string }) => r.key)).not.toContain('admin');
    }
  });
});
