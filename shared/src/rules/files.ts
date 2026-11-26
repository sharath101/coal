/**
 * Upload limits (docs/documents-and-signing.md#files-pictures-and-sources).
 * ⚠ The allowed types and the size limit are assumptions until Jayon's file needs are known
 * (docs/open-questions.md, I9).
 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** File extension → the content type COAL stores and serves it with. */
export const UPLOAD_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  txt: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
  step: 'model/step',
  stp: 'model/step',
};

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export type UploadCheck =
  { ok: true; contentType: string } | { ok: false; reason: 'type' | 'size' | 'empty' };

export function checkUpload(file: { name: string; size: number }): UploadCheck {
  const contentType = UPLOAD_TYPES[fileExtension(file.name)];
  if (!contentType) return { ok: false, reason: 'type' };
  if (file.size <= 0) return { ok: false, reason: 'empty' };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, reason: 'size' };
  return { ok: true, contentType };
}

/**
 * What may be attached to an AI chat (docs/workstation-and-ai.md#what-the-ai-does): documents COAL
 * reads as text for the assistant, and pictures the model looks at. ⚠ The kinds are assumptions
 * until Jayon's needs are known (docs/open-questions.md, I9).
 */
export const CHAT_DOCUMENT_EXTENSIONS = ['pdf', 'docx', 'txt', 'csv'] as const;
export const CHAT_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;
/** The most files on one message. */
export const MAX_CHAT_FILES = 3;
/** The size limit when `AI_UPLOAD_MAX_MB` is not set. */
export const DEFAULT_CHAT_UPLOAD_MB = 10;

export type ChatFileKind = 'document' | 'image';

export function chatFileKind(name: string): ChatFileKind | null {
  const extension = fileExtension(name);
  if ((CHAT_DOCUMENT_EXTENSIONS as readonly string[]).includes(extension)) return 'document';
  if ((CHAT_IMAGE_EXTENSIONS as readonly string[]).includes(extension)) return 'image';
  return null;
}

export type ChatFileCheck =
  { ok: true; kind: ChatFileKind } | { ok: false; reason: 'type' | 'size' | 'empty' };

/** Whether a file may ride with a chat message: a kind the assistant can read, and within the limit. */
export function checkChatFile(
  file: { name: string; size: number },
  maxBytes: number,
): ChatFileCheck {
  const kind = chatFileKind(file.name);
  if (!kind) return { ok: false, reason: 'type' };
  if (file.size <= 0) return { ok: false, reason: 'empty' };
  if (file.size > Math.min(maxBytes, MAX_UPLOAD_BYTES)) return { ok: false, reason: 'size' };
  return { ok: true, kind };
}

/** A picture's bytes must start the way its type says: a file renamed to .png is not one. */
export function looksLikeImage(extension: string, bytes: Uint8Array): boolean {
  const at = (offset: number, text: string) =>
    [...text].every((c, i) => bytes[offset + i] === c.charCodeAt(0));
  switch (extension.toLowerCase()) {
    case 'png':
      return bytes[0] === 0x89 && at(1, 'PNG');
    case 'jpg':
    case 'jpeg':
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'webp':
      return at(0, 'RIFF') && at(8, 'WEBP');
    default:
      return false;
  }
}
