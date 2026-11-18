import pino from 'pino';
import { loadConfig } from './core/config';
import { createDb } from './core/db/client';
import type { AppDeps } from './core/deps';
import { S3FileStorage } from './modules/files/storage';

/** Builds what the API and the worker both need. */
export async function createRuntime() {
  const config = loadConfig();
  const log = pino({ level: config.logLevel });
  const { db, pool } = createDb(config.databaseUrl, 10, (error) =>
    log.error({ err: error }, 'idle database connection failed'),
  );
  const storage = new S3FileStorage(config.storage);
  if (config.storage.createBucket) await storage.ensureBucket();
  const deps: AppDeps = { config, db, storage };
  return { deps, pool, log };
}
