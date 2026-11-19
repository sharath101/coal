import { buildApp, loggerOptions } from './app';
import { systemContext } from './core/http/context';
import { createRuntime } from './runtime';
import { startWorker } from './jobs/worker';
import { loadSampleTemplates } from './modules/templates/service';

/** Local development: the API and the worker in one process. */
const runtime = await createRuntime();
// So there is something to make documents from. Real templates replace the samples as new versions.
try {
  const added = await loadSampleTemplates(
    runtime.deps,
    systemContext(runtime.deps.config.orgId, 'dev'),
  );
  if (added.length > 0) runtime.log.info({ added }, 'loaded the sample templates');
} catch (error) {
  runtime.log.warn({ err: error }, 'could not load the sample templates (is Gotenberg running?)');
}
const app = await buildApp(runtime.deps, { logger: loggerOptions(runtime.deps.config.logLevel) });
const stopWorker = await startWorker(runtime);
await app.listen({ host: runtime.deps.config.host, port: runtime.deps.config.port });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void Promise.all([app.close(), stopWorker()]).then(() => runtime.pool.end());
  });
}
