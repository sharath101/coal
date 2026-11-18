import { pgTable, text, unique } from 'drizzle-orm/pg-core';
import { idColumn, orgIdColumn, timestamps } from '../../core/db/columns';

export const productLines = pgTable(
  'product_lines',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    ...timestamps(),
  },
  (t) => [unique('product_lines_org_code').on(t.orgId, t.code)],
);
