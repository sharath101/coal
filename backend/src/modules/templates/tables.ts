import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { SignaturePlan, TemplateSpec } from '@coal/shared';
import { idColumn, orgIdColumn, timestamps, timestamptz } from '../../core/db/columns';
import { files } from '../files/tables';

/** Each kind of document and its rules (docs/data-model.md#documents-templates-signatures-and-files). */
export const documentTypes = pgTable(
  'document_types',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    departmentCode: text('department_code'),
    /** `template`: made from a template; `upload`: a person uploads it; `record`: COAL generates it. */
    kind: text('kind', { enum: ['template', 'upload', 'record'] }).notNull(),
    /** `budget` documents are need-to-know (docs/roles-and-access.md). */
    sensitivity: text('sensitivity', { enum: ['normal', 'budget'] })
      .notNull()
      .default('normal'),
    stepKeys: jsonb('step_keys').$type<string[]>().notNull().default([]),
    numberingPattern: text('numbering_pattern').notNull(),
    signaturePlan: jsonb('signature_plan').$type<SignaturePlan>().notNull(),
    ...timestamps(),
  },
  (t) => [unique('document_types_org_code').on(t.orgId, t.code)],
);

/** The template library. Each row is one version of one type's template. */
export const templates = pgTable(
  'templates',
  {
    id: idColumn(),
    orgId: orgIdColumn(),
    documentTypeId: uuid('document_type_id')
      .notNull()
      .references(() => documentTypes.id),
    version: integer('version').notNull(),
    status: text('status', { enum: ['draft', 'active', 'retired'] }).notNull(),
    name: text('name').notNull(),
    spec: jsonb('spec').$type<TemplateSpec>().notNull(),
    /** The tags COAL read from the Word file. */
    placeholders: jsonb('placeholders').$type<string[]>().notNull().default([]),
    docxFileId: uuid('docx_file_id')
      .notNull()
      .references(() => files.id),
    samplePdfFileId: uuid('sample_pdf_file_id').references(() => files.id),
    notes: text('notes').notNull().default(''),
    /** Null for the sample templates COAL loads itself. */
    addedBy: uuid('added_by'),
    activatedBy: uuid('activated_by'),
    activatedAt: timestamptz('activated_at'),
    retiredAt: timestamptz('retired_at'),
    ...timestamps(),
  },
  (t) => [
    unique('templates_type_version').on(t.documentTypeId, t.version),
    // At most one active version per type.
    uniqueIndex('templates_one_active')
      .on(t.documentTypeId)
      .where(sql`${t.status} = 'active'`),
    index('templates_status').on(t.orgId, t.status),
  ],
);
