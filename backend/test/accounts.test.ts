import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc } from 'drizzle-orm';
import { auditEvents } from '../src/modules/audit/tables';
import { createTestApp, productLineId, sessionCookie, signUp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t?.close();
});

const inject = (options: InjectOptions) => t.app.inject(options);

describe('sign-up', () => {
  it('creates an account, starts a session and tidies the name', async () => {
    const res = await inject({
      method: 'POST',
      url: '/api/v1/auth/sign-up',
      payload: { name: '  Meera   Example ', roleKey: 'rd_ops' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().user).toMatchObject({
      name: 'Meera Example',
      role: { key: 'rd_ops', name: 'R&D Ops', departmentCode: 'RND' },
      productLine: null,
    });

    const cookie = res.cookies.find((c) => c.name === 'coal_session');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });

    const me = await inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: sessionCookie(res) },
    });
    expect(me.json().name).toBe('Meera Example');
  });

  it('refuses a name that differs only by case', async () => {
    await signUp(t.app, { name: 'Ravi Example', roleKey: 'pme' });
    const res = await inject({
      method: 'POST',
      url: '/api/v1/auth/sign-up',
      payload: { name: 'RAVI example', roleKey: 'dard' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json().code).toBe('NAME_TAKEN');
  });

  it('asks a Lead for a product line, and keeps it', async () => {
    const missing = await inject({
      method: 'POST',
      url: '/api/v1/auth/sign-up',
      payload: { name: 'Lead Without Line', roleKey: 'rd_lead' },
    });
    expect(missing.json().code).toBe('PRODUCT_LINE_REQUIRED');

    const spine = await productLineId(t.app, 'SPN');
    const { user } = await signUp(t.app, {
      name: 'Spine Lead',
      roleKey: 'rd_lead',
      productLineId: spine,
    });
    expect(user).toMatchObject({ productLine: { code: 'SPN', name: 'Spine' } });
  });

  it('ignores a product line for roles that have none', async () => {
    const spine = await productLineId(t.app, 'SPN');
    const { user } = await signUp(t.app, {
      name: 'Design Person',
      roleKey: 'design_engineer',
      productLineId: spine,
    });
    expect(user).toMatchObject({ productLine: null });
  });

  it('refuses unknown roles', async () => {
    const res = await inject({
      method: 'POST',
      url: '/api/v1/auth/sign-up',
      payload: { name: 'Nobody Example', roleKey: 'astronaut' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_FAILED', errors: [{ path: 'roleKey' }] });
  });
});

describe('sign-in and sign-out', () => {
  it('signs in by name in any case, and signs out', async () => {
    await signUp(t.app, { name: 'Anil Example', roleKey: 'aems' });

    const res = await inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      payload: { name: 'anil EXAMPLE' },
    });
    expect(res.statusCode).toBe(200);
    const cookie = sessionCookie(res);

    const out = await inject({ method: 'POST', url: '/api/v1/auth/sign-out', headers: { cookie } });
    expect(out.statusCode).toBe(204);

    const me = await inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
    expect(me.json().code).toBe('NOT_SIGNED_IN');
  });

  it('accepts the session as a bearer token, for the app later', async () => {
    const { cookie } = await signUp(t.app, { name: 'Bearer Example', roleKey: 'pme' });
    const token = cookie.split('=')[1];
    const me = await inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.json().name).toBe('Bearer Example');
  });

  it('says when no account has that name', async () => {
    const res = await inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      payload: { name: 'Nobody At All' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });
});

describe('my profile', () => {
  it('changes my role, and drops the product line when the new role has none', async () => {
    const trauma = await productLineId(t.app, 'TRM');
    const { cookie, user } = await signUp(t.app, {
      name: 'Changing Lead',
      roleKey: 'rd_lead',
      productLineId: trauma,
    });

    const res = await inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { cookie, 'if-match': user.updatedAt },
      payload: { roleKey: 'rd_head' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ role: { key: 'rd_head' }, productLine: null });
  });

  it('refuses an edit made from an old version', async () => {
    const { cookie, user } = await signUp(t.app, { name: 'Stale Editor', roleKey: 'dard' });
    await inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { cookie },
      payload: { name: 'Stale Editor Two' },
    });

    const res = await inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { cookie, 'if-match': user.updatedAt },
      payload: { name: 'Stale Editor Three' },
    });
    expect(res.statusCode).toBe(412);
    expect(res.json().code).toBe('VERSION_CONFLICT');
  });

  it('records sign-ups, sessions and profile changes in the audit trail', async () => {
    const { cookie, user } = await signUp(t.app, {
      name: 'Audited Person',
      roleKey: 'qc_inspector',
    });
    await inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { cookie },
      payload: { name: 'Audited Person B' },
    });

    const entries = await t.database.db.select().from(auditEvents).orderBy(asc(auditEvents.seq));
    const mine = entries.filter((e) => e.actorId === user.id);
    expect(mine.map((e) => e.action)).toEqual([
      'user.signed_up',
      'session.started',
      'user.updated',
    ]);
    expect(mine[2]).toMatchObject({
      actorType: 'user',
      before: { name: 'Audited Person' },
      after: { name: 'Audited Person B' },
    });
  });
});

describe('the directory', () => {
  it('lists people by name with cursor paging and a role filter', async () => {
    for (const name of ['Dir Alpha', 'Dir Beta', 'Dir Gamma'])
      await signUp(t.app, { name, roleKey: 'marketing' });
    const { cookie } = await signUp(t.app, { name: 'Dir Reader', roleKey: 'production' });

    const first = await inject({
      method: 'GET',
      url: '/api/v1/users?filter[role]=marketing&limit=2',
      headers: { cookie },
    });
    expect(first.json().items.map((u: { name: string }) => u.name)).toEqual([
      'Dir Alpha',
      'Dir Beta',
    ]);

    const next = await inject({
      method: 'GET',
      url: `/api/v1/users?filter[role]=marketing&limit=2&cursor=${first.json().nextCursor}`,
      headers: { cookie },
    });
    expect(next.json()).toMatchObject({ items: [{ name: 'Dir Gamma' }], nextCursor: null });
  });
});
