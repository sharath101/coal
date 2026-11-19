import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { idColumn, orgIdColumn, timestamptz } from '../../core/db/columns';

/** Work messages and alerts (docs/data-model.md#notifications-and-platform). In-app for now. */
export const notifications = pgTable(
  'notifications',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    userId: uuid('user_id').notNull(),
    kind: text('kind', { enum: ['work_message', 'reminder', 'escalation', 'alert'] }).notNull(),
    eventType: text('event_type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** A path on the website. */
    link: text('link'),
    projectId: uuid('project_id'),
    stepKey: text('step_key'),
    channels: jsonb('channels').$type<string[]>().notNull().default(['in_app']),
    /** Stops the same reminder going to the same person twice. */
    dedupeKey: text('dedupe_key'),
    sentAt: timestamptz('sent_at').notNull().defaultNow(),
    readAt: timestamptz('read_at'),
  },
  (t) => [
    index('notifications_user').on(t.userId, t.sentAt),
    uniqueIndex('notifications_dedupe')
      .on(t.userId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
  ],
);
