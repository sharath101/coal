import type { ActionPreview, ProposalAction } from '@coal/shared';
import { boolean, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { idColumn, orgIdColumn, timestamps, timestamptz } from '../../core/db/columns';
import { users } from '../users/tables';

/** Actions waiting for the person to confirm them: the action cards (docs/api.md#proposals-and-action-cards). */
export const proposals = pgTable(
  'proposals',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    /** Only this person may confirm it, from their own session. */
    forUserId: uuid('for_user_id')
      .notNull()
      .references(() => users.id),
    /** The AI chat that prepared it (the chats come with the AI module). */
    chatId: uuid('chat_id'),
    preparedByAi: boolean('prepared_by_ai').notNull().default(false),
    /** Prepared in a chat that used the web: the card tells the person to check its facts. */
    fromWeb: boolean('from_web').notNull().default(false),
    version: integer('version').notNull().default(1),
    title: text('title').notNull(),
    actions: jsonb('actions').$type<ProposalAction[]>().notNull(),
    preview: jsonb('preview').$type<{ actions: ActionPreview[] }>().notNull(),
    status: text('status', { enum: ['pending', 'confirmed', 'rejected', 'expired', 'failed'] })
      .notNull()
      .default('pending'),
    expiresAt: timestamptz('expires_at').notNull(),
    confirmedAt: timestamptz('confirmed_at'),
    /** What each action returned when it was carried out. */
    result: jsonb('result').$type<unknown[]>(),
    ...timestamps(),
  },
  (t) => [index('proposals_user').on(t.orgId, t.forUserId, t.status, t.createdAt)],
);
