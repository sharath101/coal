import { integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { idColumn, orgIdColumn, timestamptz } from '../db/columns';

/** Stored responses for safe retries of POST requests (docs/api.md#conventions). */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    key: text('key').notNull(),
    userId: uuid('user_id').notNull(),
    requestHash: text('request_hash').notNull(),
    /** Empty while the first request is still running. */
    responseStatus: integer('response_status'),
    response: jsonb('response'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [unique('idempotency_keys_user_key').on(t.userId, t.key)],
);
