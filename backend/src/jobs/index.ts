import { PgBoss } from 'pg-boss';
import type { Logger } from 'pino';
import type { Db } from '../core/db/client';
import type { AppDeps } from '../core/deps';
import { deleteOldIdempotencyKeys } from '../core/http/idempotency';
import { verifyAuditChain } from '../modules/audit/service';

/**
 * Background jobs (docs/architecture.md#background-jobs). Each job is safe to run twice.
 * Reminders, the forecast, rendering, virus scanning and notifications join as their blocks land.
 */
export const JOBS = {
  auditChainCheck: 'audit.verify-chain',
  idempotencyCleanup: 'platform.idempotency-cleanup',
} as const;

export async function runAuditChainCheck(db: Db, log: Logger) {
  const result = await verifyAuditChain(db);
  if (result.ok) log.info({ checked: result.checked }, 'audit chain intact');
  else log.error(result, 'AUDIT CHAIN BROKEN');
  return result;
}

export async function startJobs(deps: AppDeps, log: Logger) {
  const boss = new PgBoss({
    connectionString: deps.config.databaseUrl,
    application_name: 'coal-jobs',
  });
  boss.on('error', (error) => log.error({ err: error }, 'job queue error'));
  await boss.start();

  await boss.createQueue(JOBS.auditChainCheck);
  await boss.createQueue(JOBS.idempotencyCleanup);
  await boss.schedule(JOBS.auditChainCheck, '30 2 * * *', null, { tz: 'Asia/Kolkata' });
  await boss.schedule(JOBS.idempotencyCleanup, '0 * * * *', null, { tz: 'Asia/Kolkata' });

  await boss.work(JOBS.auditChainCheck, async () => {
    await runAuditChainCheck(deps.db, log);
  });
  await boss.work(JOBS.idempotencyCleanup, async () => {
    await deleteOldIdempotencyKeys(deps.db);
  });

  return boss;
}
