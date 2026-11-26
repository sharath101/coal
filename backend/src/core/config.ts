import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CHAT_UPLOAD_MB } from '@coal/shared';
import { z } from 'zod';

const repoEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (process.env.NODE_ENV !== 'test' && existsSync(repoEnvFile)) process.loadEnvFile(repoEnvFile);

/** What the AI is asked for; each can use its own model (docs/workstation-and-ai.md#ai-providers). */
export const AI_PURPOSES = ['chat', 'title', 'draft_write', 'template', 'research'] as const;
export type AiPurpose = (typeof AI_PURPOSES)[number];
export const AI_PROVIDERS = ['anthropic', 'copilot', 'none'] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];

/** Each provider names its models its own way. */
const DEFAULT_MODELS: Record<'anthropic' | 'copilot', Record<AiPurpose, string>> = {
  anthropic: {
    chat: 'claude-sonnet-5-5',
    title: 'claude-haiku-5-5',
    draft_write: 'claude-sonnet-5-5',
    template: 'claude-sonnet-5-5',
    research: 'claude-sonnet-5-5',
  },
  copilot: {
    chat: 'claude-sonnet-5.5',
    title: 'claude-haiku-5.5',
    draft_write: 'claude-sonnet-5.5',
    template: 'claude-sonnet-5.5',
    research: 'claude-sonnet-5.5',
  },
};

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
  /**
   * Filling templates in COAL (fields from records, the document form, the assistant drafting
   * a template's sections) is parked until Jayon says how its templates will look
   * (docs/documents-and-signing.md#parked-filling-templates-in-coal). Off, a template is Jayon's
   * Word form as it is, and people fill it in Word.
   */
  TEMPLATE_FILLING: flag.default(false),
  /**
   * Demo only, to be removed before the hand-off (docs/roles-and-access.md#switching-people-for-the-demo).
   * On, an admin account can take the place of anyone, in one click, without signing out. Off (the
   * default), there is no way to switch: the admin account can't sign in, and a session that was
   * reached by switching ends.
   */
  ADMIN_SWITCHING: flag.default(false),
  /** Gotenberg turns the filled Word files into PDFs. */
  GOTENBERG_URL: z.string().default('http://localhost:3100'),
  // A PDF is made while a version is saved, holding the project's lock, so a stuck service must give up soon.
  PDF_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  /**
   * The ClamAV daemon that scans uploads. Unset, uploads stay "not scanned" and can be opened,
   * which is fine only while COAL holds made-up data (docs/documents-and-signing.md#files-pictures-and-sources).
   */
  CLAMAV_HOST: z.string().default(''),
  CLAMAV_PORT: z.coerce.number().int().default(3310),
  /** How long an action card waits to be confirmed before it expires ⚠ (AI9). */
  PROPOSAL_EXPIRY_HOURS: z.coerce.number().int().positive().default(72),
  /** Left out: Anthropic when its key is set, otherwise no AI. */
  AI_PROVIDER: z.enum(AI_PROVIDERS).optional(),
  ANTHROPIC_API_KEY: z.string().default(''),
  /** The Anthropic key isn't tied to one workspace, so every call names it. */
  ANTHROPIC_WORKSPACE_ID: z.string().default(''),
  /** Temporary stand-in on one laptop (D19): a fine-grained token with the Copilot Requests permission. */
  COPILOT_GITHUB_TOKEN: z.string().default(''),
  AI_DAILY_BUDGET_USD: z.coerce.number().positive().default(5),
  /** The most tools one reply may use. */
  AI_MAX_TOOL_CALLS: z.coerce.number().int().positive().default(20),
  AI_TURN_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  /** How many earlier messages of a chat the AI is shown. */
  AI_HISTORY_MESSAGES: z.coerce.number().int().min(0).default(20),
  /**
   * The largest file, in megabytes, that may be attached to a message in the AI chat: a document the
   * assistant reads or a picture it looks at (docs/workstation-and-ai.md#what-the-ai-does).
   */
  AI_UPLOAD_MAX_MB: z.coerce.number().positive().max(100).default(DEFAULT_CHAT_UPLOAD_MB),
  AI_MODEL_CHAT: z.string().default(''),
  AI_MODEL_TITLE: z.string().default(''),
  AI_MODEL_DRAFT_WRITE: z.string().default(''),
  AI_MODEL_TEMPLATE: z.string().default(''),
  AI_MODEL_RESEARCH: z.string().default(''),
  /**
   * Research (docs/workstation-and-ai.md#researching-what-already-exists). The keys are free and
   * optional: they raise the sources' limits. NCBI and Crossref ask for a contact address.
   */
  NCBI_API_KEY: z.string().default(''),
  OPENFDA_API_KEY: z.string().default(''),
  RESEARCH_CONTACT_EMAIL: z.string().default(''),
  /** The most searches one research run may send outside. */
  RESEARCH_MAX_SEARCHES: z.coerce.number().int().positive().default(20),
  RESEARCH_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = Env.parse(env);
  if (e.NODE_ENV === 'production' && e.S3_SECRET_ACCESS_KEY === 'coal-local-only') {
    throw new Error('Set real storage credentials for production.');
  }
  if (e.NODE_ENV === 'production' && !e.CLAMAV_HOST) {
    throw new Error('Set CLAMAV_HOST so uploads are scanned for viruses in production.');
  }
  const provider: AiProviderName = e.AI_PROVIDER ?? (e.ANTHROPIC_API_KEY ? 'anthropic' : 'none');
  if (e.NODE_ENV === 'production' && provider === 'copilot') {
    throw new Error('The Copilot stand-in is for local development only (D19). Use Anthropic.');
  }
  const overrides: Record<AiPurpose, string> = {
    chat: e.AI_MODEL_CHAT,
    title: e.AI_MODEL_TITLE,
    draft_write: e.AI_MODEL_DRAFT_WRITE,
    template: e.AI_MODEL_TEMPLATE,
    research: e.AI_MODEL_RESEARCH,
  };
  const defaults = provider === 'none' ? DEFAULT_MODELS.anthropic : DEFAULT_MODELS[provider];
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
    templateFilling: e.TEMPLATE_FILLING,
    adminSwitching: e.ADMIN_SWITCHING,
    outboxPollMs: e.OUTBOX_POLL_MS,
    pdf: { url: e.GOTENBERG_URL, timeoutMs: e.PDF_TIMEOUT_MS },
    scan: e.CLAMAV_HOST ? { host: e.CLAMAV_HOST, port: e.CLAMAV_PORT } : null,
    proposals: { expiryHours: e.PROPOSAL_EXPIRY_HOURS },
    ai: {
      provider,
      anthropic: { apiKey: e.ANTHROPIC_API_KEY, workspaceId: e.ANTHROPIC_WORKSPACE_ID },
      copilotToken: e.COPILOT_GITHUB_TOKEN,
      dailyBudgetUsd: e.AI_DAILY_BUDGET_USD,
      maxToolCalls: e.AI_MAX_TOOL_CALLS,
      turnTimeoutMs: e.AI_TURN_TIMEOUT_MS,
      historyMessages: e.AI_HISTORY_MESSAGES,
      uploadMaxBytes: Math.round(e.AI_UPLOAD_MAX_MB * 1024 * 1024),
      models: Object.fromEntries(
        AI_PURPOSES.map((p) => [p, overrides[p] || defaults[p]]),
      ) as Record<AiPurpose, string>,
    },
    research: {
      ncbiApiKey: e.NCBI_API_KEY,
      openFdaApiKey: e.OPENFDA_API_KEY,
      contactEmail: e.RESEARCH_CONTACT_EMAIL,
      maxSearches: e.RESEARCH_MAX_SEARCHES,
      timeoutMs: e.RESEARCH_TIMEOUT_MS,
    },
  };
}
