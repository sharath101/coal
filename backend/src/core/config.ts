import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const repoEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (process.env.NODE_ENV !== 'test' && existsSync(repoEnvFile)) process.loadEnvFile(repoEnvFile);

const flag = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/** The single organisation for now (docs/data-model.md#conventions). */
export const DEFAULT_ORG_ID = '00000000-0000-7000-8000-000000000001';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().default('postgres://coal:coal@localhost:5432/coal'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().default(4000),
  /**
   * Addresses of the reverse proxies in front of the API (comma-separated IPs or CIDRs), whose
   * X-Forwarded-For is believed. Only name a proxy that overwrites that header with the
   * connecting address: the website's own rewrite passes a browser's header through, so it
   * must not be trusted. Empty (the default): trust none.
   */
  TRUST_PROXY: z.string().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ORG_ID: z.uuid().default(DEFAULT_ORG_ID),
  COOKIE_SECURE: flag.default(false),
  SESSION_DAYS: z.coerce.number().int().positive().default(14),
  SIGN_IN_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('ap-south-1'),
  S3_BUCKET: z.string().default('coal-files'),
  S3_ACCESS_KEY_ID: z.string().default('coal'),
  S3_SECRET_ACCESS_KEY: z.string().default('coal-local-only'),
  S3_FORCE_PATH_STYLE: flag.default(true),
  S3_CREATE_BUCKET: flag.default(false),
  FILE_LINK_SECONDS: z.coerce.number().int().positive().default(300),
  OUTBOX_POLL_MS: z.coerce.number().int().positive().default(5000),
  /** The assistant (docs/workstation-and-ai.md#ai-providers). Without a key it says it's off. */
  ANTHROPIC_API_KEY: z.string().default(''),
  /** Only for a key not scoped to a workspace (`sk-ant-usr-…`): the workspace to use. */
  ANTHROPIC_WORKSPACE_ID: z.string().default(''),
  AI_DAILY_BUDGET_USD: z.coerce.number().positive().default(5),
});

/** `AI_MODEL_<PURPOSE>=<model id>` overrides one row of the model table (backend/src/modules/ai/models.ts). */
function modelOverrides(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    const m = /^AI_MODEL_([A-Z_]+)$/.exec(name);
    if (m && value) out[m[1]!.toLowerCase()] = value.trim();
  }
  return out;
}

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = Env.parse(env);
  if (e.NODE_ENV === 'production' && e.S3_SECRET_ACCESS_KEY === 'coal-local-only') {
    throw new Error('Set real storage credentials for production.');
  }
  return {
    env: e.NODE_ENV,
    databaseUrl: e.DATABASE_URL,
    host: e.API_HOST,
    port: e.API_PORT,
    trustProxy: e.TRUST_PROXY.trim() || false,
    logLevel: e.LOG_LEVEL,
    orgId: e.ORG_ID,
    session: {
      cookieSecure: e.COOKIE_SECURE,
      days: e.SESSION_DAYS,
      signInLimitPerMinute: e.SIGN_IN_LIMIT_PER_MINUTE,
    },
    storage: {
      endpoint: e.S3_ENDPOINT,
      region: e.S3_REGION,
      bucket: e.S3_BUCKET,
      accessKeyId: e.S3_ACCESS_KEY_ID,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
      createBucket: e.S3_CREATE_BUCKET,
      linkSeconds: e.FILE_LINK_SECONDS,
    },
    outboxPollMs: e.OUTBOX_POLL_MS,
    ai: {
      apiKey: e.ANTHROPIC_API_KEY.trim(),
      workspaceId: e.ANTHROPIC_WORKSPACE_ID.trim(),
      dailyBudgetUsd: e.AI_DAILY_BUDGET_USD,
      modelOverrides: modelOverrides(env),
    },
  };
}
