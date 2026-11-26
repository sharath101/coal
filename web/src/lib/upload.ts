import {
  CHAT_DOCUMENT_EXTENSIONS,
  CHAT_IMAGE_EXTENSIONS,
  DEFAULT_CHAT_UPLOAD_MB,
  UPLOAD_TYPES,
  checkChatFile,
  checkUpload,
  completeUpload,
  createUpload,
  type StoredFile,
} from '@coal/shared';
import { api } from './api';

type Origin = 'internal' | 'outside';

/** The kinds of file the AI chat takes, for a message that names them. */
export const CHAT_TYPES = [...CHAT_DOCUMENT_EXTENSIONS, ...CHAT_IMAGE_EXTENSIONS]
  .map((extension) => extension.toUpperCase())
  .join(', ');

/** What a file input for the AI chat accepts. */
export const CHAT_ACCEPT = [...CHAT_DOCUMENT_EXTENSIONS, ...CHAT_IMAGE_EXTENSIONS]
  .map((extension) => `.${extension}`)
  .join(',');

/**
 * The browser refused the file before sending it: wrong type, empty, or too big. A file for the
 * chat carries its own limit and kinds, so the message names those.
 */
export class UploadCheckError extends Error {
  constructor(
    readonly reason: 'type' | 'size' | 'empty',
    readonly chat?: { maxBytes: number },
  ) {
    super(`Upload refused: ${reason}`);
    this.name = 'UploadCheckError';
  }
}

/** The storage service didn't take the bytes. */
export class UploadTransferError extends Error {
  constructor() {
    super('The upload to storage failed');
    this.name = 'UploadTransferError';
  }
}

/**
 * The three steps of an upload, in one place: ask COAL for an upload link, send the bytes there
 * with exactly the headers COAL gave, then tell COAL it is finished (so it can check the file).
 * A file for the AI chat (`outside`) must be one the assistant can read, within `chatMaxBytes`.
 */
export async function uploadFile(
  file: File,
  origin: Origin = 'internal',
  chatMaxBytes: number = DEFAULT_CHAT_UPLOAD_MB * 1024 * 1024,
): Promise<StoredFile> {
  const check = origin === 'outside' ? checkChatFile(file, chatMaxBytes) : checkUpload(file);
  if (!check.ok) {
    throw new UploadCheckError(
      check.reason,
      origin === 'outside' ? { maxBytes: chatMaxBytes } : undefined,
    );
  }
  const { file: started, upload } = await api(createUpload, {
    body: { name: file.name, size: file.size, origin },
  });
  let response: Response;
  try {
    response = await fetch(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body: file,
    });
  } catch {
    throw new UploadTransferError();
  }
  if (!response.ok) throw new UploadTransferError();
  return api(completeUpload, { params: { id: started.id } });
}

/** What a file input accepts, from the allowed types in shared/. */
export const ACCEPT_ALL = Object.keys(UPLOAD_TYPES)
  .map((extension) => `.${extension}`)
  .join(',');
export const ACCEPT_IMAGES = Object.entries(UPLOAD_TYPES)
  .filter(([, type]) => type.startsWith('image/'))
  .map(([extension]) => `.${extension}`)
  .join(',');
export const ALLOWED_EXTENSIONS = Object.keys(UPLOAD_TYPES)
  .map((extension) => extension.toUpperCase())
  .join(', ');
