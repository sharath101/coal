import { z } from 'zod';
import { defineEndpoint } from '../api/contract';
import { StepKey } from '../process/definition';
import { Id, IdParams, Timestamp } from './common';
import { StoredFile } from './files';
import { Person } from './projects';

/** Where an attachment or source belongs: a step, a document or a task of the project. */
const Target = z.object({
  stepKey: StepKey.nullable(),
  documentId: Id.nullable(),
  taskId: Id.nullable(),
});

const TargetInput = z.object({
  stepKey: StepKey.optional(),
  documentId: Id.optional(),
  taskId: Id.optional(),
});

const oneTarget = (value: z.infer<typeof TargetInput>) =>
  [value.stepKey, value.documentId, value.taskId].filter((v) => v !== undefined).length === 1;
const ONE_TARGET = { error: 'Choose exactly one of a step, a document or a task.' };

/** A source may also belong to the whole project: none of the three. */
const atMostOne = (value: z.infer<typeof TargetInput>) =>
  [value.stepKey, value.documentId, value.taskId].filter((v) => v !== undefined).length <= 1;
const AT_MOST_ONE = { error: 'Choose at most one of a step, a document or a task.' };

export const AttachmentView = z.object({
  id: Id,
  file: StoredFile,
  caption: z.string(),
  target: Target,
  addedBy: Person,
  addedAt: Timestamp,
});
export type AttachmentView = z.infer<typeof AttachmentView>;

export const TargetQuery = z.object({
  step: StepKey.optional(),
  document: Id.optional(),
  task: Id.optional(),
});

export const CreateAttachmentBody = TargetInput.extend({
  /** A finished upload (POST /files/upload-url): a file or a picture, including from a phone camera. */
  fileId: Id,
  caption: z.string().trim().max(300).default(''),
}).refine(oneTarget, ONE_TARGET);

export const createAttachment = defineEndpoint({
  id: 'attachments.create',
  method: 'POST',
  path: '/projects/{id}/attachments',
  summary: 'Attach a file or a picture to a step, a document or a task',
  auth: 'session',
  permission: 'attachments.write',
  aiTier: 'auto',
  params: IdParams,
  body: CreateAttachmentBody,
  response: AttachmentView,
  status: 201,
});

export const listAttachments = defineEndpoint({
  id: 'attachments.list',
  method: 'GET',
  path: '/projects/{id}/attachments',
  summary: 'Attachments of a project, for one step, document or task',
  auth: 'session',
  permission: 'attachments.read',
  aiTier: 'read',
  params: IdParams,
  query: TargetQuery,
  response: z.object({ items: z.array(AttachmentView) }),
});

export const SOURCE_KINDS = ['link', 'file', 'citation'] as const;

export const SourceView = z.object({
  id: Id,
  kind: z.enum(SOURCE_KINDS),
  title: z.string(),
  url: z.string().nullable(),
  file: StoredFile.nullable(),
  note: z.string(),
  target: Target,
  /** Kept from a research run: the result it was. */
  researchResultId: Id.nullable(),
  addedBy: Person,
  addedAt: Timestamp,
});
export type SourceView = z.infer<typeof SourceView>;

export const CreateSourceBody = TargetInput.extend({
  kind: z.enum(SOURCE_KINDS),
  title: z.string().trim().min(2).max(300),
  url: z
    .url({ protocol: /^https?$/ })
    .max(2000)
    .optional(),
  fileId: Id.optional(),
  note: z.string().trim().max(1000).default(''),
})
  .refine(atMostOne, AT_MOST_ONE)
  .refine((v) => v.kind !== 'link' || !!v.url, {
    error: 'A link needs its address.',
    path: ['url'],
  })
  .refine((v) => v.kind !== 'file' || !!v.fileId, {
    error: 'A file source needs the uploaded file.',
    path: ['fileId'],
  });

export const createSource = defineEndpoint({
  id: 'sources.create',
  method: 'POST',
  path: '/projects/{id}/sources',
  summary:
    'Add a source (a link, a file or a citation, with a note) to a step, a document or a task, or to the whole project (none of the three)',
  auth: 'session',
  permission: 'sources.write',
  aiTier: 'auto',
  params: IdParams,
  body: CreateSourceBody,
  response: SourceView,
  status: 201,
});

export const listSources = defineEndpoint({
  id: 'sources.list',
  method: 'GET',
  path: '/projects/{id}/sources',
  summary: 'Sources of a project, for one step, document or task',
  auth: 'session',
  permission: 'sources.read',
  aiTier: 'read',
  params: IdParams,
  query: TargetQuery,
  response: z.object({ items: z.array(SourceView) }),
});
