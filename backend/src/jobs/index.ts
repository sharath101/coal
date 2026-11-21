import { PgBoss } from 'pg-boss';
import type { Logger } from 'pino';
import type { Db } from '../core/db/client';
import type { AppDeps } from '../core/deps';
import { deleteOldIdempotencyKeys } from '../core/http/idempotency';
import { systemContext } from '../core/http/context';
import { verifyAuditChain } from '../modules/audit/service';
import { scanPending } from '../modules/files/service';
import { runReminders } from '../modules/notifications/reminders';
import { runResearch } from '../modules/research/assistant';
import { sweepResearch } from '../modules/research/jobs';
import { recomputeAll } from '../modules/schedule/nightly';

/**
 * Background jobs (docs/architecture.md#background-jobs). Each job is safe to run twice.
 */
export const JOBS = {
  auditChainCheck: 'audit.verify-chain',
  idempotencyCleanup: 'platform.idempotency-cleanup',
  scanPendingFiles: 'files.scan-pending',
  recomputeSchedules: 'schedule.recompute',
  sendReminders: 'notifications.reminders',
  runResearch: 'research.run',
  sweepResearch: 'research.sweep',
} as const;

export async function runAuditChainCheck(db: Db, log: Logger) {
  const result = await verifyAuditChain(db);
  if (result.ok) log.info({ checked: result.checked }, 'audit chain intact');
  else log.error(result, 'AUDIT CHAIN BROKEN');
  return result;
}

/** Queues a research run once: a second send for the same run is dropped. */
export async function sendResearch(boss: PgBoss, runId: string): Promise<void> {
  await boss.send(JOBS.runResearch, { runId }, { singletonKey: runId });
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
  await boss.createQueue(JOBS.scanPendingFiles);
  await boss.createQueue(JOBS.recomputeSchedules);
  await boss.createQueue(JOBS.sendReminders);
  // A research run is taken only while it is queued, so a repeat does nothing.
  await boss.createQueue(JOBS.runResearch, {
    retryLimit: 0,
    expireInSeconds: Math.ceil(deps.config.research.timeoutMs / 1000) + 120,
  });
  await boss.createQueue(JOBS.sweepResearch);
  await boss.schedule(JOBS.auditChainCheck, '30 2 * * *', null, { tz: 'Asia/Kolkata' });
  await boss.schedule(JOBS.idempotencyCleanup, '0 * * * *', null, { tz: 'Asia/Kolkata' });
  // Uploads whose scan didn't finish (the scanner was down) are tried again.
  await boss.schedule(JOBS.scanPendingFiles, '* * * * *', null, { tz: 'Asia/Kolkata' });
  // Time passing makes steps late: dates and health are worked out again after midnight, and
  // the day's reminders go out at the start of the working day.
  await boss.schedule(JOBS.recomputeSchedules, '10 0 * * *', null, { tz: 'Asia/Kolkata' });
  await boss.schedule(JOBS.sendReminders, '30 8 * * *', null, { tz: 'Asia/Kolkata' });
  await boss.schedule(JOBS.sweepResearch, '* * * * *', null, { tz: 'Asia/Kolkata' });

  await boss.work(JOBS.auditChainCheck, async () => {
    await runAuditChainCheck(deps.db, log);
  });
  await boss.work(JOBS.idempotencyCleanup, async () => {
    await deleteOldIdempotencyKeys(deps.db);
  });
  await boss.work(JOBS.scanPendingFiles, async () => {
    const scanned = await scanPending(deps, systemContext(deps.config.orgId, 'job'));
    if (scanned > 0) log.info({ scanned }, 'scanned waiting uploads');
  });
  await boss.work(JOBS.recomputeSchedules, async () => {
    const projects = await recomputeAll(deps, deps.config.orgId);
    log.info({ projects }, 'worked out the schedules again');
  });
  await boss.work(JOBS.sendReminders, async () => {
    // Dates first, so a midnight run that was missed (the computer was off) is made up for.
    await recomputeAll(deps, deps.config.orgId);
    const sent = await runReminders(deps, deps.config.orgId);
    if (sent > 0) log.info({ sent }, 'sent reminders');
  });
  await boss.work<{ runId: string }>(JOBS.runResearch, { localConcurrency: 2 }, async (jobs) => {
    for (const job of jobs) {
      const status = await runResearch(deps, job.data.runId);
      log.info({ runId: job.data.runId, status }, 'research run ended');
    }
  });
  await boss.work(JOBS.sweepResearch, async () => {
    const swept = await sweepResearch(deps, (runId) => sendResearch(boss, runId));
    if (swept.resent + swept.abandoned > 0) log.info(swept, 'swept research runs');
  });

  // Starting up also makes up for a missed midnight run.
  try {
    await recomputeAll(deps, deps.config.orgId);
  } catch (error) {
    log.warn({ err: error }, 'could not work the schedules out at start');
  }

  return boss;
}
