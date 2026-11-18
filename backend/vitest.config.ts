import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    env: { NODE_ENV: 'test' },
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
