import { buildApp, loggerOptions } from './app';
import { createRuntime } from './runtime';

const { deps, pool } = await createRuntime();
const app = await buildApp(deps, { logger: loggerOptions(deps.config.logLevel) });
await app.listen({ host: deps.config.host, port: deps.config.port });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => pool.end());
  });
}
