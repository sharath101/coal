import { timestamp, uuid } from 'drizzle-orm/pg-core';
import { v7 } from 'uuid';

export const newId = (): string => v7();

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
