import { sql } from 'drizzle-orm';
import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { idColumn, orgIdColumn, timestamps, timestamptz } from '../../core/db/columns';

/** Each version of each process's route, loaded from shared/ on deploy (docs/data-model.md). */
export const processVersions = pgTable(
  'process_versions',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    key: text('key').notNull(),
    version: integer('version').notNull(),
    departmentCode: text('department_code').notNull(),
    definition: jsonb('definition').notNull(),
    sha256: text('sha256').notNull(),
    loadedAt: timestamptz('loaded_at').notNull().defaultNow(),
  },
  (t) => [unique('process_versions_org_key_version').on(t.orgId, t.key, t.version)],
);

/** One run of a process's route. For R&D, one per project. */
export const processRuns = pgTable(
  'process_runs',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    processVersionId: uuid('process_version_id')
      .notNull()
      .references(() => processVersions.id),
    status: text('status', { enum: ['active', 'on_hold', 'dropped', 'completed', 'closed'] })
      .notNull()
      .default('active'),
    stage: integer('stage').notNull().default(1),
    holdReason: text('hold_reason'),
    dropReason: text('drop_reason'),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    completedAt: timestamptz('completed_at'),
    /** Planned and forecast launch, and health, are worked out by the schedule module (docs/dashboard.md). */
    plannedLaunch: date('planned_launch', { mode: 'string' }),
    forecastLaunch: date('forecast_launch', { mode: 'string' }),
    health: text('health', { enum: ['green', 'amber', 'red'] }),
    healthReasons: jsonb('health_reasons').$type<unknown[]>().notNull().default([]),
    /** The first baseline is 1; 0 until the Action Plan is signed. */
    baselineNo: integer('baseline_no').notNull().default(0),
    scheduledOn: date('scheduled_on', { mode: 'string' }),
    ...timestamps(),
  },
  (t) => [index('process_runs_status').on(t.orgId, t.status)],
);

/** Each step of each run, once per iteration. */
export const runSteps = pgTable(
  'run_steps',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    runId: uuid('run_id')
      .notNull()
      .references(() => processRuns.id),
    stepKey: text('step_key').notNull(),
    iteration: integer('iteration').notNull(),
    status: text('status', {
      enum: [
        'locked',
        'ready',
        'in_progress',
        'in_review',
        'returned',
        'approved',
        'done',
        'reset',
        'cancelled',
      ],
    }).notNull(),
    path: text('path'),
    signers: jsonb('signers').$type<string[]>().notNull().default([]),
    approvedBy: jsonb('approved_by').$type<string[]>().notNull().default([]),
    openedAt: timestamptz('opened_at'),
    submittedAt: timestamptz('submitted_at'),
    completedAt: timestamptz('completed_at'),
    /** Set when a send-back closed this iteration. */
    resetBySendBackId: uuid('reset_by_send_back_id'),
    plannedStart: date('planned_start', { mode: 'string' }),
    plannedEnd: date('planned_end', { mode: 'string' }),
    forecastStart: date('forecast_start', { mode: 'string' }),
    forecastEnd: date('forecast_end', { mode: 'string' }),
    health: text('health', { enum: ['ok', 'at_risk', 'overdue'] }),
    ...timestamps(),
  },
  (t) => [
    unique('run_steps_run_step_iteration').on(t.runId, t.stepKey, t.iteration),
    // A step has one current iteration; the ones a send-back closed are `reset`.
    uniqueIndex('run_steps_one_current')
      .on(t.runId, t.stepKey)
      .where(sql`${t.status} <> 'reset'`),
  ],
);

/** Go, checkpoint and step decisions, and hold, resume and drop. Insert-only. */
export const decisions = pgTable(
  'decisions',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    runId: uuid('run_id')
      .notNull()
      .references(() => processRuns.id),
    runStepId: uuid('run_step_id').references(() => runSteps.id),
    stepKey: text('step_key'),
    iteration: integer('iteration'),
    decision: text('decision').notNull(),
    value: text('value').notNull(),
    reason: text('reason'),
    decidedBy: uuid('decided_by').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('decisions_run').on(t.runId)],
);

/** Prerequisites recorded, such as material received (the route file calls them milestones). Insert-only. */
export const milestones = pgTable(
  'milestones',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    runId: uuid('run_id')
      .notNull()
      .references(() => processRuns.id),
    milestone: text('milestone').notNull(),
    stepKey: text('step_key'),
    iteration: integer('iteration'),
    note: text('note'),
    evidenceFileId: uuid('evidence_file_id'),
    recordedBy: uuid('recorded_by').notNull(),
    recordedAt: timestamptz('recorded_at').notNull().defaultNow(),
  },
  (t) => [index('milestones_run').on(t.runId)],
);

/** Each time work is sent back to an earlier step. Insert-only. */
export const sendBacks = pgTable(
  'send_backs',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    runId: uuid('run_id')
      .notNull()
      .references(() => processRuns.id),
    fromRunStepId: uuid('from_run_step_id')
      .notNull()
      .references(() => runSteps.id),
    fromStepKey: text('from_step_key').notNull(),
    toStepKey: text('to_step_key').notNull(),
    reason: text('reason').notNull(),
    evidenceFileId: uuid('evidence_file_id'),
    decidedBy: uuid('decided_by').notNull(),
    /** The run steps whose iteration this send-back closed. */
    resetRunStepIds: jsonb('reset_run_step_ids').$type<string[]>().notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('send_backs_run').on(t.runId)],
);
