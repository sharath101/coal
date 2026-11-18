import { z } from 'zod';
import { defineEndpoint } from '../api/contract';
import { Id, IdParams, Timestamp } from './common';

/** Outside documents (lab reports, vendor PDFs) get extra care from the AI. */
export const FileOrigin = z.enum(['internal', 'outside']);
export const FileStatus = z.enum(['pending', 'uploaded']);
/** ⚠ No virus scanner yet: uploads stay `not_scanned` until the scanning job exists. */
export const ScanStatus = z.enum(['not_scanned', 'clean', 'infected']);

export const StoredFile = z.object({
  id: Id,
  name: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
  sha256: z.string().nullable(),
  status: FileStatus,
  scanStatus: ScanStatus,
  origin: FileOrigin,
  createdAt: Timestamp,
});
export type StoredFile = z.infer<typeof StoredFile>;

export const CreateUploadBody = z.object({
  name: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
  origin: FileOrigin.default('internal'),
});

export const CreateUploadResponse = z.object({
  file: StoredFile,
  upload: z.object({
    url: z.url(),
    method: z.literal('PUT'),
    /** Send exactly these headers with the upload. */
    headers: z.record(z.string(), z.string()),
    expiresAt: Timestamp,
  }),
});

export const FileLink = z.object({
  url: z.url(),
  expiresAt: Timestamp,
});

export const createUpload = defineEndpoint({
  id: 'files.createUpload',
  method: 'POST',
  path: '/files/upload-url',
  summary: 'Start an upload: checks the type and size, returns a short-lived upload link',
  auth: 'session',
  permission: 'files.upload',
  aiTier: 'auto',
  body: CreateUploadBody,
  response: CreateUploadResponse,
  status: 201,
});

export const completeUpload = defineEndpoint({
  id: 'files.completeUpload',
  method: 'POST',
  path: '/files/{id}/complete',
  summary: 'Finish an upload: COAL checks the stored file and records its size and hash',
  auth: 'session',
  permission: 'files.upload',
  aiTier: 'auto',
  params: IdParams,
  response: StoredFile,
});

export const getFileLink = defineEndpoint({
  id: 'files.getLink',
  method: 'GET',
  path: '/files/{id}/link',
  summary: 'A short-lived link to download a file',
  auth: 'session',
  permission: 'files.read',
  aiTier: 'read',
  params: IdParams,
  response: FileLink,
});
