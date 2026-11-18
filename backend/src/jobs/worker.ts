import { OutboxDispatcher, startOutboxListener } from '../modules/events/dispatcher';
import { SUBSCRIPTIONS } from '../modules/events/subscriptions';
import type { createRuntime } from '../runtime';
import { startJobs } from '.';

/** Background work: the job queue and the outbox. Run one or more copies beside the API. */
export async function startWorker(runtime: Awaited<ReturnType<typeof createRuntime>>) {
  const { deps, log } = runtime;
  const boss = await startJobs(deps, log);
  const dispatcher = new OutboxDispatcher(deps.db, SUBSCRIPTIONS, log);
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
