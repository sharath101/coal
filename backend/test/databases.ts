import { randomUUID } from 'node:crypto';
import pg from 'pg';

/** The tests create throwaway databases on this server (see .env.example). */
export const ADMIN_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://coal:coal@localhost:5432/postgres';
/**
 * The AI exam has its own prefix, so running `pnpm test` while the exam is under way does not
 * drop the exam's databases (each run clears its own leftovers when it starts).
 */
export const DB_PREFIX = process.env.COAL_TEST_DB_PREFIX ?? 'coal_test';
export const TEMPLATE_DB = `${DB_PREFIX}_template`;

export function databaseUrl(name: string): string {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

export async function withAdmin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export const newTestDbName = () => `${DB_PREFIX}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
