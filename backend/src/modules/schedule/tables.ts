import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { idColumn, orgIdColumn, timestamps, timestamptz } from '../../core/db/columns';
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

/**
 * A project's milestones: the targets the VP sets for it, at Go or later (docs/dashboard.md#milestones).
 * One is a route step, reached when the step is signed off, or a title in the VP's own words, ticked
 * off by hand. A removed one keeps its row, with `removed_at` set.
 */
export const runMilestones = pgTable(
  'run_milestones',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    runId: uuid('run_id')
      .notNull()
      .references(() => processRuns.id),
    stepKey: text('step_key'),
    title: text('title'),
    targetDate: date('target_date', { mode: 'string' }),
    /** Own-words milestones only: a step milestone is reached by its step. */
    reachedAt: timestamptz('reached_at'),
    reachedBy: uuid('reached_by'),
    note: text('note'),
    createdBy: uuid('created_by').notNull(),
    removedAt: timestamptz('removed_at'),
    ...timestamps(),
  },
  (t) => [
    index('run_milestones_run').on(t.runId),
    uniqueIndex('run_milestones_step')
      .on(t.runId, t.stepKey)
      .where(sql`${t.removedAt} is null and ${t.stepKey} is not null`),
    check('run_milestones_kind', sql`(${t.stepKey} is null) <> (${t.title} is null)`),
  ],
);
