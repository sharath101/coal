import type { ChatContext, MessagePart } from '@coal/shared';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { idColumn, orgIdColumn, timestamps, timestamptz } from '../../core/db/columns';
import { users } from '../users/tables';

/** Each chat in someone's Workstation (docs/data-model.md#ai-and-proposals). Owner only. */
export const aiChats = pgTable(
  'ai_chats',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** The process run of the project the chat is about, for listing a project's chats. */
    runId: uuid('run_id'),
    channel: text('channel', { enum: ['website'] })
      .notNull()
      .default('website'),
    context: jsonb('context').$type<ChatContext>().notNull(),
    title: text('title').notNull().default(''),
    /** Set once a file from outside is attached, and never unset: from then on the AI only prepares cards. */
    hasOutsideText: boolean('has_outside_text').notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    index('ai_chats_user').on(t.orgId, t.userId, t.updatedAt),
    index('ai_chats_run').on(t.orgId, t.userId, t.runId),
  ],
);

export const aiMessages = pgTable(
  'ai_messages',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => aiChats.id),
    sender: text('sender', { enum: ['user', 'assistant'] }).notNull(),
    parts: jsonb('parts').$type<MessagePart[]>().notNull(),
    /** The model request that wrote an assistant message. */
    requestId: uuid('request_id'),
    stopped: boolean('stopped').notNull().default(false),
    ...timestamps(),
  },
  (t) => [index('ai_messages_chat').on(t.chatId, t.createdAt)],
);

/** One row for each message the AI answered: every model call it took, summed. Insert-only. */
export const aiRequests = pgTable(
  'ai_requests',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    chatId: uuid('chat_id'),
    userId: uuid('user_id').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    purpose: text('purpose').notNull(),
    /** The version of the instructions, which changes whenever their text does. */
    promptVersion: text('prompt_version').notNull(),
    modelCalls: integer('model_calls').notNull().default(0),
    toolCalls: integer('tool_calls').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    /** In US dollars, worked out from the token counts (docs/workstation-and-ai.md#ai-providers). */
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
    outcome: text('outcome', { enum: ['completed', 'stopped', 'error'] }).notNull(),
    errorCode: text('error_code'),
    durationMs: integer('duration_ms').notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('ai_requests_user_day').on(t.orgId, t.userId, t.createdAt)],
);

/** Each tool the AI used, and what it got back. Insert-only. */
export const aiToolCalls = pgTable(
  'ai_tool_calls',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    requestId: uuid('request_id').notNull(),
    tool: text('tool').notNull(),
    /** The endpoint it calls, and that endpoint's AI tier. */
    endpoint: text('endpoint').notNull(),
    tier: text('tier').notNull(),
    allowed: boolean('allowed').notNull(),
    denialReason: text('denial_reason'),
    /** What the AI asked for, cut short. */
    input: jsonb('input'),
    /** The records it returned: type, id and version. */
    recordsReturned: jsonb('records_returned')
      .$type<{ type: string; id: string; version?: number }[]>()
      .notNull(),
    proposalId: uuid('proposal_id'),
    durationMs: integer('duration_ms').notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('ai_tool_calls_request').on(t.requestId)],
);

export const aiFeedback = pgTable(
  'ai_feedback',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => aiMessages.id),
    userId: uuid('user_id').notNull(),
    rating: text('rating', { enum: ['up', 'down'] }).notNull(),
    comment: text('comment'),
    ...timestamps(),
  },
  (t) => [unique('ai_feedback_message_user').on(t.messageId, t.userId)],
);
