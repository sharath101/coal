import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import type { DocumentContent, SignaturePlan } from '@coal/shared';
import { idColumn, orgIdColumn, timestamps, timestamptz } from '../../core/db/columns';
import { files } from '../files/tables';
import { processRuns, runSteps } from '../process/tables';
import { documentTypes, templates } from '../templates/tables';

/** Every document of a project, on the step that produces it (docs/data-model.md). */
export const documents = pgTable(
  'documents',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    runId: uuid('run_id')
      .notNull()
      .references(() => processRuns.id),
    stepKey: text('step_key').notNull(),
    documentTypeId: uuid('document_type_id')
      .notNull()
      .references(() => documentTypes.id),
    /** The template version it was made from. Null for an uploaded document. */
    templateId: uuid('template_id').references(() => templates.id),
    number: text('number').notNull(),
    title: text('title').notNull(),
    /** The rows it is signed in, fixed when it was made so a later template change can't alter them. */
    signaturePlan: jsonb('signature_plan').$type<SignaturePlan>().notNull(),
    createdBy: uuid('created_by').notNull(),
    ...timestamps(),
  },
  (t) => [
    unique('documents_org_number').on(t.orgId, t.number),
    index('documents_run_step').on(t.runId, t.stepKey),
  ],
);

/** Each saved draft and approved revision. Its content never changes once saved (see migration 0004). */
export const documentVersions = pgTable(
  'document_versions',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    runStepId: uuid('run_step_id')
      .notNull()
      .references(() => runSteps.id),
    /** The step's iteration it was made in. */
    iteration: integer('iteration').notNull(),
    versionNo: integer('version_no').notNull(),
    /** A, B, C… given when the version is approved. */
    revLabel: text('rev_label'),
    status: text('status', {
      enum: ['draft', 'in_review', 'returned', 'approved', 'superseded'],
    }).notNull(),
    content: jsonb('content').$type<DocumentContent>(),
    /** The hash of the content, or of the uploaded file. */
    contentSha256: text('content_sha256').notNull(),
    /** The uploaded file, for an uploaded document. */
    fileId: uuid('file_id').references(() => files.id),
    pdfFileId: uuid('pdf_file_id').references(() => files.id),
    pdfSha256: text('pdf_sha256'),
    searchText: text('search_text').notNull().default(''),
    note: text('note').notNull().default(''),
    createdBy: uuid('created_by').notNull(),
    viaAi: boolean('via_ai').notNull().default(false),
    aiRequestId: uuid('ai_request_id'),
    /** The written sections the assistant wrote and no person has changed since (docs/workstation-and-ai.md#drafting-a-document). */
    aiSections: jsonb('ai_sections').$type<string[]>().notNull().default([]),
    /** Set when a send-back copied this version forward unchanged. */
    carriedFromVersionId: uuid('carried_from_version_id'),
    ...timestamps(),
  },
  (t) => [
    unique('document_versions_doc_no').on(t.documentId, t.versionNo),
    index('document_versions_step').on(t.runStepId),
    // Search (GET /search) matches the words of each version.
    index('document_versions_search').using('gin', sql`to_tsvector('english', ${t.searchText})`),
  ],
);

/** Every signature a version needs, in order. A row opens once the one before it is signed. */
export const signatureRequests = pgTable(
  'signature_requests',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => documentVersions.id),
    meaning: text('meaning', { enum: ['prepared', 'reviewed', 'approved'] }).notNull(),
    /** Anyone with the role may sign, unless `assignee_id` names the person. */
    roleKeys: jsonb('role_keys').$type<string[]>().notNull(),
    assigneeId: uuid('assignee_id'),
    orderIndex: integer('order_index').notNull(),
    status: text('status', {
      enum: ['waiting', 'pending', 'signed', 'returned', 'cancelled'],
    }).notNull(),
    requestedAt: timestamptz('requested_at').notNull().defaultNow(),
    completedAt: timestamptz('completed_at'),
    returnedBy: uuid('returned_by'),
    returnComment: text('return_comment'),
    ...timestamps(),
  },
  (t) => [
    index('signature_requests_version').on(t.versionId, t.orderIndex),
    index('signature_requests_pending').on(t.orgId, t.status),
  ],
);

/** Each signature. Insert-only (migration 0004), tied to the content and PDF hashes. */
export const signatures = pgTable(
  'signatures',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    requestId: uuid('request_id').references(() => signatureRequests.id),
    subjectType: text('subject_type', { enum: ['document_version', 'decision'] }).notNull(),
    subjectId: uuid('subject_id').notNull(),
    contentSha256: text('content_sha256').notNull(),
    pdfSha256: text('pdf_sha256'),
    userId: uuid('user_id').notNull(),
    printedName: text('printed_name').notNull(),
    roleKey: text('role_key').notNull(),
    roleName: text('role_name').notNull(),
    meaning: text('meaning', { enum: ['prepared', 'reviewed', 'approved', 'decision'] }).notNull(),
    decision: text('decision'),
    reason: text('reason'),
    /** `click` until passkeys; then `passkey`, with the proof alongside. */
    method: text('method', { enum: ['click'] })
      .notNull()
      .default('click'),
    signedAt: timestamptz('signed_at').notNull().defaultNow(),
  },
  (t) => [index('signatures_subject').on(t.subjectType, t.subjectId)],
);
