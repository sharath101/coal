import { startWorker } from './jobs/worker';
import { createRuntime } from './runtime';

const runtime = await createRuntime();
const stop = await startWorker(runtime);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void stop().then(() => runtime.pool.end());
  });
}
