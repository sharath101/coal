import type { SignUpBody } from '@coal/shared';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/core/config';
import { createDb } from '../src/core/db/client';
import type { AppDeps } from '../src/core/deps';
import { S3FileStorage } from '../src/modules/files/storage';
import { FakePdfRenderer } from './fakes';
import { TEMPLATE_DB, databaseUrl, newTestDbName, withAdmin } from './databases';

/** A fresh copy of the template database, for one test file. */
export async function createTestDatabase() {
  const name = newTestDbName();
  await withAdmin((admin) => admin.query(`create database "${name}" template "${TEMPLATE_DB}"`));
  const url = databaseUrl(name);
  const { db, pool } = createDb(url, 5);
  return {
    db,
    pool,
    url,
    async drop() {
      await pool.end();
      await withAdmin((admin) => admin.query(`drop database if exists "${name}" with (force)`));
    },
  };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;

export async function createTestApp(
  env: Record<string, string> = {},
  overrides: Partial<Pick<AppDeps, 'scanner' | 'now'>> = {},
) {
  const database = await createTestDatabase();
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: database.url,
    S3_BUCKET: 'coal-files-test',
    SIGN_IN_LIMIT_PER_MINUTE: '1000',
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    ...env,
  });
  const storage = new S3FileStorage(config.storage);
  await storage.ensureBucket();
  const pdf = new FakePdfRenderer();
  const deps: AppDeps = {
    config,
    db: database.db,
    storage,
    pdf,
    scanner: null,
    now: () => new Date(),
    ...overrides,
  };
  const app = await buildApp(deps);
  return {
    app,
    deps,
    pdf,
    database,
    async close() {
      await app.close();
      await database.drop();
    },
  };
}

export interface SignedIn {
  cookie: string;
  user: { id: string; name: string; updatedAt: string };
}

export function sessionCookie(response: { cookies: { name: string; value: string }[] }) {
  const cookie = response.cookies.find((c) => c.name === 'coal_session');
  if (!cookie) throw new Error('No session cookie');
  return `coal_session=${cookie.value}`;
}

export async function productLineId(app: FastifyInstance, code: string): Promise<string> {
  const res = await app.inject({ method: 'GET', url: '/api/v1/product-lines' });
  const line = res
    .json<{ items: { id: string; code: string }[] }>()
    .items.find((l) => l.code === code);
  if (!line) throw new Error(`No product line ${code}`);
  return line.id;
}

export async function signUp(app: FastifyInstance, body: SignUpBody): Promise<SignedIn> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/sign-up', payload: body });
  if (res.statusCode !== 201) throw new Error(`Sign-up failed: ${res.statusCode} ${res.body}`);
  return { cookie: sessionCookie(res), user: res.json<{ user: SignedIn['user'] }>().user };
}
