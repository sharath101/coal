import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { idColumn, orgIdColumn, timestamptz } from '../../core/db/columns';

/**
 * Events waiting to be delivered (docs/architecture.md#events-and-live-updates).
 * Written in the same transaction as the change; a trigger sends NOTIFY coal_outbox.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    type: text('type').notNull(),
    actorType: text('actor_type', { enum: ['user', 'user_via_ai', 'system'] }).notNull(),
    actorId: uuid('actor_id'),
    projectId: uuid('project_id'),
    stepKey: text('step_key'),
    payload: jsonb('payload').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    availableAt: timestamptz('available_at').notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    deliveredAt: timestamptz('delivered_at'),
  },
  (t) => [
    index('outbox_events_pending')
      .on(t.availableAt)
      .where(sql`${t.deliveredAt} is null`),
  ],
);
