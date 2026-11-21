import { defineConfig } from 'vitest/config';

// Its own databases, so `pnpm test` can run while the exam is under way (test/databases.ts).
process.env.COAL_TEST_DB_PREFIX = 'coal_eval';

/** The AI's exam, against the real model: `pnpm eval:ai`. Not part of `pnpm test` or CI. */
export default defineConfig({
  test: {
    include: ['eval/**/*.eval.ts'],
    globalSetup: ['test/global-setup.ts'],
    env: { NODE_ENV: 'test', COAL_TEST_DB_PREFIX: 'coal_eval' },
    reporters: ['verbose'],
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 180_000,
  },
});
