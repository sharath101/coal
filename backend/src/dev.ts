import { buildApp, loggerOptions } from './app';
import { createRuntime } from './runtime';
import { startWorker } from './jobs/worker';

/** Local development: the API and the worker in one process. */
const runtime = await createRuntime();
const app = await buildApp(runtime.deps, { logger: loggerOptions(runtime.deps.config.logLevel) });
const stopWorker = await startWorker(runtime);
await app.listen({ host: runtime.deps.config.host, port: runtime.deps.config.port });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void Promise.all([app.close(), stopWorker()]).then(() => runtime.pool.end());
  });
}
