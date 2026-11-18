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
