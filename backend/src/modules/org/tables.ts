import { boolean, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
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
    /** The reporting line until there's an org chart (P8). */
    reportsToKey: text('reports_to_key'),
    needsProductLine: boolean('needs_product_line').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps(),
  },
  (t) => [unique('roles_org_key').on(t.orgId, t.key)],
);
