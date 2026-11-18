import { bigint, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { idColumn, orgIdColumn, timestamps } from '../../core/db/columns';
import { users } from '../users/tables';

export const files = pgTable('files', {
  id: idColumn(),
  orgId: orgIdColumn(),
  storageKey: text('storage_key').notNull().unique(),
  name: text('name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  sha256: text('sha256'),
  status: text('status', { enum: ['pending', 'uploaded'] })
    .notNull()
    .default('pending'),
  scanStatus: text('scan_status', { enum: ['not_scanned', 'clean', 'infected'] })
    .notNull()
    .default('not_scanned'),
  origin: text('origin', { enum: ['internal', 'outside'] }).notNull(),
  uploadedBy: uuid('uploaded_by')
    .notNull()
    .references(() => users.id),
  ...timestamps(),
});
