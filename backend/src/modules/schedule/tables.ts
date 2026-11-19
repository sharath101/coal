import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { idColumn, orgIdColumn, timestamptz } from '../../core/db/columns';
import { processRuns } from '../process/tables';

/** Jayon's holidays and working Saturdays (docs/data-model.md#processes-and-the-calendar). */
export const workCalendar = pgTable(
  'work_calendar',
  {
    orgId: orgIdColumn(),
    date: date('date', { mode: 'string' }).notNull(),
    isWorkingDay: boolean('is_working_day').notNull(),
    note: text('note').notNull().default(''),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.date] })],
);

/** Thresholds and timings, one JSON value per key (docs/dashboard.md): `schedule` is the main one. */
export const settings = pgTable(
  'settings',
  {
    orgId: orgIdColumn(),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    updatedBy: uuid('updated_by'),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.key] })],
);

/**
 * Planned dates per step and role. A `draft` is the plan being written at step 5; the VP's
 * signature turns it into the `baseline`. Later date changes are `change` rows. Baseline and
 * change rows are never altered (a trigger refuses it); the newest row for a step and role wins.
 */
export const timelineItems = pgTable(
  'timeline_items',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    runId: uuid('run_id')
      .notNull()
      .references(() => processRuns.id),
    kind: text('kind', { enum: ['draft', 'baseline', 'change'] }).notNull(),
    /** 1 for the first baseline; 0 for drafts and changes. */
    baselineNo: integer('baseline_no').notNull().default(0),
    stepKey: text('step_key').notNull(),
    roleKey: text('role_key').notNull(),
    plannedStart: date('planned_start', { mode: 'string' }).notNull(),
    plannedEnd: date('planned_end', { mode: 'string' }).notNull(),
    reason: text('reason'),
    recordedBy: uuid('recorded_by').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('timeline_items_run').on(t.runId, t.stepKey),
    index('timeline_items_drafts')
      .on(t.runId)
      .where(sql`${t.kind} = 'draft'`),
  ],
);
