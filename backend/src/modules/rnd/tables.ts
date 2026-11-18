import { sql } from 'drizzle-orm';
import { index, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { idColumn, orgIdColumn, timestamps, timestamptz } from '../../core/db/columns';
import { processRuns } from '../process/tables';

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

/** One per product idea. Its status, stage and launch are its run's (docs/data-model.md#r-d). */
export const projects = pgTable(
  'projects',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    /** For example SPN-26-004. */
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    productLineId: uuid('product_line_id')
      .notNull()
      .references(() => productLines.id),
    processRunId: uuid('process_run_id')
      .notNull()
      .references(() => processRuns.id),
    createdBy: uuid('created_by').notNull(),
    ...timestamps(),
  },
  (t) => [
    unique('projects_org_code').on(t.orgId, t.code),
    unique('projects_run').on(t.processRunId),
    index('projects_created').on(t.orgId, t.createdAt),
  ],
);

/** The project team. A removed member keeps their row, with `removed_at` set. */
export const projectMembers = pgTable(
  'project_members',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    userId: uuid('user_id').notNull(),
    roleKey: text('role_key').notNull(),
    addedBy: uuid('added_by').notNull(),
    addedAt: timestamptz('added_at').notNull().defaultNow(),
    removedAt: timestamptz('removed_at'),
  },
  (t) => [
    uniqueIndex('project_members_active')
      .on(t.projectId, t.userId)
      .where(sql`${t.removedAt} is null`),
  ],
);
