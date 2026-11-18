import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export type Db = NodePgDatabase;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Services take either, so callers can run them inside their own transaction. */
export type Executor = Db | Tx;

export function createDb(
  databaseUrl: string,
  max = 10,
  onError: (error: Error) => void = (error) =>
    console.error('idle database connection failed', error),
) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max });
  // Without a listener, an idle connection dropped by the server would crash the process.
  pool.on('error', onError);
  return { db: drizzle(pool), pool };
}
