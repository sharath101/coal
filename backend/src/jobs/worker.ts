import { OutboxDispatcher, startOutboxListener } from '../modules/events/dispatcher';
import { SUBSCRIPTIONS } from '../modules/events/subscriptions';
import { researchSubscriptions } from '../modules/research/jobs';
import type { createRuntime } from '../runtime';
import { sendResearch, startJobs } from '.';

/** Background work: the job queue and the outbox. Run one or more copies beside the API. */
export async function startWorker(runtime: Awaited<ReturnType<typeof createRuntime>>) {
  const { deps, log } = runtime;
  const boss = await startJobs(deps, log);
  // A confirmed research run goes to the job queue, which only this process holds.
  const dispatcher = new OutboxDispatcher(
    deps.db,
    [...SUBSCRIPTIONS, ...researchSubscriptions((runId) => sendResearch(boss, runId))],
    log,
  );
  const stopOutbox = await startOutboxListener(dispatcher, deps.config.databaseUrl, {
    pollMs: deps.config.outboxPollMs,
    log,
  });
  log.info('worker started');

  return async function stop() {
    await stopOutbox();
    await boss.stop({ graceful: true });
  };
}
