import { sql } from 'drizzle-orm';
import { date, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { idColumn, orgIdColumn, timestamptz } from '../../core/db/columns';
import { processRuns, runSteps } from '../process/tables';
import { tasks } from '../tasks/tables';

/**
 * Late work, with the reason and the cause (docs/dashboard.md#deadlines-alerts-and-deviations).
 * Insert-only: a correction is a new row pointing at the old one.
 */
export const deviations = pgTable(
  'deviations',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    runId: uuid('run_id')
      .notNull()
      .references(() => processRuns.id),
    runStepId: uuid('run_step_id').references(() => runSteps.id),
    stepKey: text('step_key'),
    taskId: uuid('task_id').references(() => tasks.id),
    kind: text('kind', { enum: ['late', 'forecast_slip', 'rework'] }).notNull(),
    /** The due date it missed or will miss. */
    plannedDate: date('planned_date', { mode: 'string' }),
    /** The new expected date. */
    newDate: date('new_date', { mode: 'string' }),
    reasonCode: text('reason_code', {
      enum: [
        'waiting_for_step',
        'vendor_delay',
        'test_lab_delay',
        'rework',
        'person_unavailable',
        'scope_change',
        'other',
      ],
    }).notNull(),
    reasonText: text('reason_text').notNull(),
    causeType: text('cause_type', { enum: ['person', 'role', 'outside'] }).notNull(),
    causeUserId: uuid('cause_user_id'),
    causeRole: text('cause_role'),
    causeParty: text('cause_party'),
    recordedBy: uuid('recorded_by').notNull(),
    /** The deviation this one corrects, when a reviewer changes it. */
    correctsId: uuid('corrects_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('deviations_run').on(t.runId, t.createdAt),
    index('deviations_task').on(t.taskId),
    index('deviations_step').on(t.runStepId),
    uniqueIndex('deviations_one_correction')
      .on(t.correctsId)
      .where(sql`${t.correctsId} is not null`),
  ],
);

/** The next role up confirms or corrects a deviation. Insert-only. */
export const deviationReviews = pgTable(
  'deviation_reviews',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    deviationId: uuid('deviation_id')
      .notNull()
      .references(() => deviations.id),
    reviewerId: uuid('reviewer_id').notNull(),
    outcome: text('outcome', { enum: ['confirmed', 'corrected'] }).notNull(),
    /** The new deviation, when the reviewer corrected it. */
    correctedById: uuid('corrected_by_id').references(() => deviations.id),
    note: text('note').notNull().default(''),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('deviation_reviews_one').on(t.deviationId)],
);

/** Comments from the person named as the cause. Insert-only. */
export const deviationComments = pgTable(
  'deviation_comments',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    deviationId: uuid('deviation_id')
      .notNull()
      .references(() => deviations.id),
    userId: uuid('user_id').notNull(),
    body: text('body').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('deviation_comments_deviation').on(t.deviationId, t.createdAt)],
);
