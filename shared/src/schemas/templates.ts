import { z } from 'zod';
import { defineEndpoint } from '../api/contract';
import { StepKey } from '../process/definition';
import { TemplateSpec } from '../rules/templates';
import { Id, IdParams, Timestamp } from './common';
import { FileLink } from './files';
import { Person } from './projects';

export const DocumentKind = z.enum(['template', 'upload', 'record']);
export type DocumentKind = z.infer<typeof DocumentKind>;

/** `budget` documents are need-to-know: a separate annex, so the rest can be shared. */
export const Sensitivity = z.enum(['normal', 'budget']);

export const TemplateStatus = z.enum(['draft', 'active', 'retired']);
export type TemplateStatus = z.infer<typeof TemplateStatus>;

const TypeRef = z.object({ code: z.string(), name: z.string() });

export const DocumentTypeView = TypeRef.extend({
  kind: DocumentKind,
  sensitivity: Sensitivity,
  stepKeys: z.array(StepKey),
  signatureRows: z.array(z.string()),
  /** The version people use to make new documents, if the library has one. */
  activeTemplate: z.object({ id: Id, version: z.number().int(), name: z.string() }).nullable(),
});
export type DocumentTypeView = z.infer<typeof DocumentTypeView>;

export const listDocumentTypes = defineEndpoint({
  id: 'documentTypes.list',
  method: 'GET',
  path: '/document-types',
  summary: 'Each kind of document, with its active template if it has one',
  auth: 'session',
  permission: 'documentTypes.read',
  aiTier: 'read',
  response: z.object({ items: z.array(DocumentTypeView) }),
});

// The template library

export const TemplateSummary = z.object({
  id: Id,
  documentType: TypeRef,
  name: z.string(),
  version: z.number().int(),
  status: TemplateStatus,
  steps: z.array(StepKey),
  addedBy: Person,
  addedAt: Timestamp,
  activatedBy: Person.nullable(),
  activatedAt: Timestamp.nullable(),
  hasSample: z.boolean(),
});
export type TemplateSummary = z.infer<typeof TemplateSummary>;

export const TemplateDetail = TemplateSummary.extend({
  spec: TemplateSpec,
  notes: z.string(),
  can: z.object({ activate: z.boolean() }),
});
export type TemplateDetail = z.infer<typeof TemplateDetail>;

export const TemplatesQuery = z.object({
  documentType: z.string().max(24).optional(),
  status: TemplateStatus.optional(),
});

export const listTemplates = defineEndpoint({
  id: 'templates.list',
  method: 'GET',
  path: '/templates',
  summary:
    'The template library. Everyone sees the active templates; the VP and the R&D Head also see drafts and retired versions',
  auth: 'session',
  permission: 'templates.read',
  aiTier: 'read',
  query: TemplatesQuery,
  response: z.object({ items: z.array(TemplateSummary) }),
});

export const getActiveTemplate = defineEndpoint({
  id: 'templates.active',
  method: 'GET',
  path: '/templates/active',
  summary: 'The active template for a document type. The AI calls this every time it drafts',
  auth: 'session',
  permission: 'templates.read',
  aiTier: 'read',
  query: z.object({ documentType: z.string().min(1).max(24) }),
  response: TemplateDetail,
});

export const getTemplate = defineEndpoint({
  id: 'templates.get',
  method: 'GET',
  path: '/templates/{id}',
  summary: 'One template version, with its specification',
  auth: 'session',
  permission: 'templates.read',
  aiTier: 'read',
  params: IdParams,
  response: TemplateDetail,
});

export const CreateTemplateBody = z.object({
  documentType: z.string().min(1).max(24),
  /** The Word file, uploaded first (POST /files/upload-url). */
  docxFileId: Id,
  /**
   * Left out, the new version keeps the previous version's specification, so the VP uploads
   * only the Word file. The first template of a type needs one.
   */
  spec: TemplateSpec.optional(),
  notes: z.string().trim().max(1000).default(''),
});

export const createTemplate = defineEndpoint({
  id: 'templates.create',
  method: 'POST',
  path: '/templates',
  summary:
    'Add a template version. COAL checks the file and makes a sample PDF; it is saved as a draft until it is activated',
  auth: 'session',
  permission: 'templates.write',
  aiTier: 'none',
  body: CreateTemplateBody,
  response: TemplateDetail,
  status: 201,
});

export const activateTemplate = defineEndpoint({
  id: 'templates.activate',
  method: 'POST',
  path: '/templates/{id}/activate',
  summary: 'Make a draft version active. The previous active version is retired, and kept',
  auth: 'session',
  permission: 'templates.activate',
  aiTier: 'never',
  params: IdParams,
  response: TemplateDetail,
});

export const getTemplateLinks = defineEndpoint({
  id: 'templates.links',
  method: 'GET',
  path: '/templates/{id}/links',
  summary:
    "Short-lived links to a template's sample PDF, and its Word file for the VP and the Head",
  auth: 'session',
  permission: 'templates.read',
  aiTier: 'read',
  params: IdParams,
  response: z.object({ sample: FileLink.nullable(), docx: FileLink.nullable() }),
});
