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
  /** Null for files COAL made itself with no person behind them, such as a sample template's PDF. */
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  /** The file this one was made from: a built template's Word file points at the sample it came from. */
  derivedFrom: uuid('derived_from'),
  ...timestamps(),
});
