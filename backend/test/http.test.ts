import { ENDPOINTS, fillPath } from '@coal/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signUp, type SignedIn, type TestApp } from './helpers';

let t: TestApp;
let person: SignedIn;
beforeAll(async () => {
  t = await createTestApp();
  person = await signUp(t.app, { name: 'Http Person', roleKey: 'rd_ops' });
});
afterAll(async () => {
  await t.close();
});

const SOME_ID = '01936b2e-7c3a-7cc0-8000-000000000001';
const urlOf = (path: string) => `/api/v1${fillPath(path, { id: SOME_ID })}`;

describe('every endpoint', () => {
  it.each(ENDPOINTS.filter((e) => e.auth === 'session').map((e) => [e.id, e] as const))(
    '%s refuses anyone not signed in',
    async (_, endpoint) => {
      const res = await t.app.inject({
        method: endpoint.method,
        url: urlOf(endpoint.path),
        payload: {},
      });
      expect(res.statusCode).toBe(401);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.json()).toMatchObject({ code: 'NOT_SIGNED_IN', status: 401 });
    },
  );

  it('appears in the OpenAPI spec with its permission and AI tier', async () => {
    const spec = (await t.app.inject({ method: 'GET', url: '/api/v1/openapi.json' })).json();
    const operations = Object.values(
      spec.paths as Record<string, Record<string, Record<string, string>>>,
    ).flatMap((methods) => Object.values(methods));
    for (const endpoint of ENDPOINTS) {
      expect(operations).toContainEqual(
        expect.objectContaining({
          operationId: endpoint.id,
          'x-permission': endpoint.permission,
          'x-ai-tier': endpoint.aiTier,
        }),
      );
    }
  });
});

describe('the public lists for the sign-up form', () => {
  it('give departments and their roles as data', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/roles' });
    const body = res.json();
    expect(body.departments.map((d: { code: string }) => d.code)).toEqual([
      'RND',
      'QA',
      'QC',
      'PROD',
      'MKT',
    ]);
    expect(body.roles).toHaveLength(14);
    expect(body.roles).toContainEqual({
      key: 'rd_lead',
      name: 'R&D Lead',
      departmentCode: 'RND',
      reportsTo: 'rd_head',
      needsProductLine: true,
    });
    expect(body.roles).toContainEqual(
      expect.objectContaining({ key: 'board', departmentCode: null }),
    );
  });

  it('give the product lines', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/product-lines' });
    expect(res.json().items.map((p: { name: string }) => p.name)).toEqual([
      'Arthroscopy',
      'Spine',
      'Trauma',
    ]);
  });
});

describe('problems', () => {
  it('reports invalid input with the field', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-up',
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_FAILED');
    expect(res.json().errors.map((e: { path: string }) => e.path)).toEqual(
      expect.arrayContaining(['body/name', 'body/roleKey']),
    );
  });

  it('reports unknown endpoints and records as not found', async () => {
    const route = await t.app.inject({ method: 'GET', url: '/api/v1/nothing-here' });
    expect(route.json().code).toBe('NOT_FOUND');
    const user = await t.app.inject({
      method: 'GET',
      url: urlOf('/users/{id}'),
      headers: { cookie: person.cookie },
    });
    expect(user.statusCode).toBe(404);
  });
});

describe('Idempotency-Key', () => {
  it('replays the first response instead of repeating the action', async () => {
    const send = (payload: object) =>
      t.app.inject({
        method: 'POST',
        url: '/api/v1/files/upload-url',
        headers: { cookie: person.cookie, 'idempotency-key': 'upload-once-1' },
        payload,
      });
    const first = await send({ name: 'a.pdf', size: 5 });
    const retry = await send({ name: 'a.pdf', size: 5 });
    expect(retry.statusCode).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.json().file.id).toBe(first.json().file.id);

    const different = await send({ name: 'b.pdf', size: 5 });
    expect(different.statusCode).toBe(422);
    expect(different.json().code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('runs the action once when retries arrive while the first is still running', async () => {
    const send = () =>
      t.app.inject({
        method: 'POST',
        url: '/api/v1/files/upload-url',
        headers: { cookie: person.cookie, 'idempotency-key': 'concurrent-key-1' },
        payload: { name: 'once.pdf', size: 5 },
      });
    const responses = await Promise.all([send(), send(), send(), send()]);

    const created = new Set(
      responses.filter((r) => r.statusCode === 201).map((r) => r.json().file.id as string),
    );
    expect(created.size).toBe(1);
    for (const r of responses.filter((r) => r.statusCode !== 201)) {
      expect(r.json().code).toBe('IDEMPOTENCY_IN_PROGRESS');
    }
    const rows = await t.database.db.execute(
      sql`select count(*)::int as n from files where name = 'once.pdf'`,
    );
    expect(rows.rows[0]).toEqual({ n: 1 });
  });

  it('releases the key when the request fails, so a corrected retry can use it', async () => {
    const send = (payload: object) =>
      t.app.inject({
        method: 'POST',
        url: '/api/v1/files/upload-url',
        headers: { cookie: person.cookie, 'idempotency-key': 'retry-after-error' },
        payload,
      });
    expect((await send({ name: 'bad.exe', size: 5 })).statusCode).toBe(400);
    expect((await send({ name: 'good.pdf', size: 5 })).statusCode).toBe(201);
  });
});

describe('rate limits', () => {
  it("ignore a client's own X-Forwarded-For when no proxy is trusted", async () => {
    const limited = await createTestApp({ SIGN_IN_LIMIT_PER_MINUTE: '2' });
    try {
      const statuses: number[] = [];
      for (const ip of ['10.0.0.1', '10.0.0.2', '10.0.0.3']) {
        const res = await limited.app.inject({
          method: 'POST',
          url: '/api/v1/auth/sign-in',
          headers: { 'x-forwarded-for': ip },
          payload: { name: 'Nobody' },
        });
        statuses.push(res.statusCode);
      }
      expect(statuses).toEqual([404, 404, 429]);
    } finally {
      await limited.close();
    }
  });

  it('count per person behind a trusted reverse proxy', async () => {
    // inject() connects from 127.0.0.1, standing in for the reverse proxy.
    const limited = await createTestApp({
      SIGN_IN_LIMIT_PER_MINUTE: '2',
      TRUST_PROXY: '127.0.0.1',
    });
    try {
      const signInFrom = (ip: string) =>
        limited.app.inject({
          method: 'POST',
          url: '/api/v1/auth/sign-in',
          headers: { 'x-forwarded-for': ip },
          payload: { name: 'Nobody' },
        });
      expect((await signInFrom('10.0.0.1')).statusCode).toBe(404);
      expect((await signInFrom('10.0.0.1')).statusCode).toBe(404);
      const third = await signInFrom('10.0.0.1');
      expect(third.statusCode).toBe(429);
      expect(third.json().code).toBe('RATE_LIMITED');
      expect((await signInFrom('10.0.0.2')).statusCode).toBe(404);
    } finally {
      await limited.close();
    }
  });
});
