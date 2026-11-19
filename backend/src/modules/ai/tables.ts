import {
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { idColumn, orgIdColumn, timestamps, timestamptz } from '../../core/db/columns';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/** A person's chat with the assistant (docs/data-model.md#the-assistant). */
export const aiChats = pgTable(
  'ai_chats',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    userId: uuid('user_id').notNull(),
    title: text('title').notNull(),
    projectId: uuid('project_id'),
    ...timestamps(),
  },
  (t) => [index('ai_chats_user').on(t.orgId, t.userId, t.updatedAt)],
);

/**
 * Every message sent to and received from the model, in order and never edited, so a chat can be
 * replayed exactly. `content` is the provider's message content; `display` is what a channel
 * shows, set on the user's message and on the last assistant message of each turn.
 */
export const aiMessages = pgTable(
  'ai_messages',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => aiChats.id),
    seq: integer('seq').notNull(),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    content: jsonb('content').notNull(),
    display: jsonb('display'),
    model: text('model'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('ai_messages_chat').on(t.chatId, t.seq)],
);

/** Every model call: who, which model and purpose, tokens and cost (docs/workstation-and-ai.md#ai-providers). */
export const aiCalls = pgTable(
  'ai_calls',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    userId: uuid('user_id').notNull(),
    chatId: uuid('chat_id'),
    purpose: text('purpose').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    costUsd: doublePrecision('cost_usd').notNull(),
    ms: integer('ms').notNull(),
    stopReason: text('stop_reason'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('ai_calls_user_day').on(t.orgId, t.userId, t.createdAt)],
);

/** Action cards: actions the AI prepared that only their person may carry out (docs/api.md#proposals-and-action-cards). */
export const aiProposals = pgTable('ai_proposals', {
  id: idColumn(),
  orgId: orgIdColumn(),
  userId: uuid('user_id').notNull(),
  chatId: uuid('chat_id').notNull(),
  kind: text('kind', { enum: ['proposal', 'link'] }).notNull(),
  title: text('title').notNull(),
  /** The endpoint calls to make on confirm: `{ endpointId, params, query, body }`. */
  actions: jsonb('actions').notNull(),
  lines: jsonb('lines').notNull(),
  warnings: jsonb('warnings').notNull(),
  href: text('href'),
  status: text('status', { enum: ['pending', 'confirmed', 'rejected', 'failed'] })
    .notNull()
    .default('pending'),
  result: text('result'),
  decidedAt: timestamptz('decided_at'),
  ...timestamps(),
});

/** Documents the AI drafted, with the template, model and content that made them. */
export const aiDrafts = pgTable('ai_drafts', {
  id: idColumn(),
  orgId: orgIdColumn(),
  userId: uuid('user_id').notNull(),
  chatId: uuid('chat_id').notNull(),
  projectId: uuid('project_id'),
  stepKey: text('step_key'),
  title: text('title').notNull(),
  /** The template file it followed, relative to the template folder; null when letterhead only. */
  template: text('template'),
  model: text('model').notNull(),
  content: jsonb('content').notNull(),
  gaps: jsonb('gaps').notNull(),
  docx: bytea('docx').notNull(),
  pdf: bytea('pdf'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});
