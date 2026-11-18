import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { idColumn, orgIdColumn, timestamps, timestamptz } from '../../core/db/columns';
import { users } from '../users/tables';

export const sessions = pgTable(
  'sessions',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** SHA-256 of the token. The token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    device: text('device'),
    expiresAt: timestamptz('expires_at').notNull(),
    revokedAt: timestamptz('revoked_at'),
    ...timestamps(),
  },
  (t) => [index('sessions_user').on(t.userId)],
);
