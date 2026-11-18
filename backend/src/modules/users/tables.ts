import { sql } from 'drizzle-orm';
import { foreignKey, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { idColumn, orgIdColumn, timestamps } from '../../core/db/columns';
import { roles } from '../org/tables';
import { productLines } from '../rnd/tables';

export const users = pgTable(
  'users',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    name: text('name').notNull(),
    roleKey: text('role_key').notNull(),
    /**
     * The one platform → department link: a Lead's product line, until the org chart
     * replaces it (docs/data-model.md#people-and-sessions).
     */
    productLineId: uuid('product_line_id').references(() => productLines.id),
    status: text('status', { enum: ['active', 'inactive'] })
      .notNull()
      .default('active'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('users_org_name_ci').on(t.orgId, sql`lower(${t.name})`),
    foreignKey({
      name: 'users_role_fk',
      columns: [t.orgId, t.roleKey],
      foreignColumns: [roles.orgId, roles.key],
    }),
  ],
);
