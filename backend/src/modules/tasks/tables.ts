import { boolean, date, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { idColumn, orgIdColumn, timestamps, timestamptz } from '../../core/db/columns';
import { processRuns, runSteps } from '../process/tables';

/** Every task and request (docs/data-model.md#work). */
export const tasks = pgTable(
  'tasks',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    runId: uuid('run_id').references(() => processRuns.id),
    runStepId: uuid('run_step_id').references(() => runSteps.id),
    stepKey: text('step_key'),
    /** Names a task a step makes beyond one per doer role, such as the step-20 follow-up. */
    taskKey: text('task_key'),
    kind: text('kind', {
      enum: ['work', 'review', 'sign', 'decision', 'corrective_action', 'request', 'own'],
    }).notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    /** The role the work is for. A queued task can be claimed by anyone with it. */
    roleKey: text('role_key'),
    assigneeId: uuid('assignee_id'),
    queueRole: text('queue_role'),
    assignedBy: uuid('assigned_by'),
    viaAi: boolean('via_ai').notNull().default(false),
    status: text('status', {
      enum: ['open', 'in_progress', 'waiting', 'done', 'declined', 'cancelled'],
    })
      .notNull()
      .default('open'),
    /** A step's follow-up that a send-back never cancels (P16). */
    keepOnReset: boolean('keep_on_reset').notNull().default(false),
    /** What the task belongs to (a project, for R&D), for linking. */
    subjectType: text('subject_type'),
    subjectId: uuid('subject_id'),
    subjectLabel: text('subject_label'),
    doneAt: timestamptz('done_at'),
    /** When the doers handed the step in, while it waits for its signer: the measures stop the clock here. */
    handedInAt: timestamptz('handed_in_at'),
    /** When it is due now, and when it was first due: the on-time rate counts the first (docs/dashboard.md#measures). */
    dueOn: date('due_on', { mode: 'string' }),
    firstDueOn: date('first_due_on', { mode: 'string' }),
    ...timestamps(),
  },
  (t) => [
    index('tasks_assignee').on(t.orgId, t.assigneeId, t.status),
    index('tasks_queue').on(t.orgId, t.queueRole, t.status),
    index('tasks_run').on(t.runId, t.stepKey),
    index('tasks_due').on(t.orgId, t.dueOn),
  ],
);
