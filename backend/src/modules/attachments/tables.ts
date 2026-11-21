import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { idColumn, orgIdColumn, timestamptz } from '../../core/db/columns';
import { files } from '../files/tables';
import { processRuns } from '../process/tables';
import { researchResults } from '../research/tables';

/** Files and pictures on a step, a document or a task of a project. */
export const attachments = pgTable(
  'attachments',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    runId: uuid('run_id')
      .notNull()
      .references(() => processRuns.id),
    stepKey: text('step_key'),
    documentId: uuid('document_id'),
    taskId: uuid('task_id'),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id),
    caption: text('caption').notNull().default(''),
    addedBy: uuid('added_by').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('attachments_run').on(t.runId, t.stepKey)],
);

/** A link, a file or a citation, with a note, on a step, a document or a task. */
export const sources = pgTable(
  'sources',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    runId: uuid('run_id')
      .notNull()
      .references(() => processRuns.id),
    stepKey: text('step_key'),
    documentId: uuid('document_id'),
    taskId: uuid('task_id'),
    kind: text('kind', { enum: ['link', 'file', 'citation'] }).notNull(),
    title: text('title').notNull(),
    url: text('url'),
    fileId: uuid('file_id').references(() => files.id),
    note: text('note').notNull().default(''),
    /** Kept from a research run (docs/workstation-and-ai.md#researching-what-already-exists). */
    researchResultId: uuid('research_result_id').references(() => researchResults.id),
    addedBy: uuid('added_by').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('sources_run').on(t.runId, t.stepKey)],
);
