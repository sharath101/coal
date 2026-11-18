import { bigint, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { idColumn, orgIdColumn, timestamptz } from '../../core/db/columns';

/**
 * Insert-only and hash-chained (docs/documents-and-signing.md#audit-trail).
 * A trigger in the migrations refuses UPDATE, DELETE and TRUNCATE.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: idColumn(),
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity().notNull().unique(),
    orgId: orgIdColumn(),
    at: timestamptz('at').notNull(),
    actorType: text('actor_type', { enum: ['user', 'user_via_ai', 'system'] }).notNull(),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    recordType: text('record_type').notNull(),
    recordId: text('record_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    requestId: text('request_id'),
    prevHash: text('prev_hash').notNull(),
    hash: text('hash').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('audit_events_record').on(t.recordType, t.recordId)],
);
