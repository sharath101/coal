import { sql } from 'drizzle-orm';
import { foreignKey, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { idColumn, orgIdColumn, timestamps } from '../../core/db/columns';
import { positions, roles } from '../org/tables';
import { productLines } from '../rnd/tables';

export const users = pgTable(
  'users',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    name: text('name').notNull(),
    /** What the person may do: the role of their position. */
    roleKey: text('role_key').notNull(),
    /**
     * Their box on the org chart. Empty only for an account made before positions, until the
     * loader places it (docs/data-model.md#people-and-sessions).
     */
    positionKey: text('position_key'),
    /**
     * The one platform → department link: the product line of a Lead or a design engineer
     * (docs/data-model.md#people-and-sessions).
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
    foreignKey({
      name: 'users_position_fk',
      columns: [t.orgId, t.positionKey],
      foreignColumns: [positions.orgId, positions.key],
    }),
  ],
);
