import { defineConfig } from 'drizzle-kit';

// Each module owns its tables in its own tables.ts.
export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/modules/*/tables.ts', './src/core/http/tables.ts'],
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://coal:coal@localhost:5432/coal' },
});
