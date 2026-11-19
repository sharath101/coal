import { sql, type AnyColumn } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';
import { v7 } from 'uuid';

export const newId = (): string => v7();

/**
 * A timestamp column cut to milliseconds. Cursors carry a JavaScript date, which keeps only
 * milliseconds, so lists compare and order by this: rows made in one transaction share a
 * microsecond timestamp, and a cursor must not skip the ones that follow the page's last row.
 */
export const msOf = (column: AnyColumn) => sql`date_trunc('milliseconds', ${column})`;

/** Common columns (docs/data-model.md#conventions). */
export const idColumn = () => uuid('id').primaryKey().$defaultFn(newId);
export const orgIdColumn = () => uuid('org_id').notNull();
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const timestamps = () => ({
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
