import { boolean, foreignKey, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { idColumn, orgIdColumn, timestamps } from '../../core/db/columns';

export const departments = pgTable(
  'departments',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps(),
  },
  (t) => [unique('departments_org_code').on(t.orgId, t.code)],
);

export const roles = pgTable(
  'roles',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    /** Empty for the Board and the VP, who sit above departments. */
    departmentId: uuid('department_id').references(() => departments.id),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps(),
  },
  (t) => [unique('roles_org_key').on(t.orgId, t.key)],
);

/** The boxes of Jayon's org chart (docs/roles-and-access.md#the-org-chart). */
export const positions = pgTable(
  'positions',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    key: text('key').notNull(),
    title: text('title').notNull(),
    /** What the position may do on the route. */
    roleKey: text('role_key').notNull(),
    /** The position it reports to. Empty: the top of its line. */
    reportsToKey: text('reports_to_key'),
    /** The seats are counted for each product line. */
    perProductLine: boolean('per_product_line').notNull().default(false),
    /** Empty: no limit. */
    seats: integer('seats'),
    /** False for the demo admin, which can't be chosen at sign-up. */
    selfService: boolean('self_service').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    unique('positions_org_key').on(t.orgId, t.key),
    foreignKey({
      name: 'positions_role_fk',
      columns: [t.orgId, t.roleKey],
      foreignColumns: [roles.orgId, roles.key],
    }),
  ],
);
