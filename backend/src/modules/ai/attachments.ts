import {
  checkChatFile,
  chatFileKind,
  fileExtension,
  looksLikeImage,
  MAX_CHAT_FILES,
  type AttachmentText,
} from '@coal/shared';
import { getDocumentProxy } from 'unpdf';
import type { AppDeps } from '../../core/deps';
import type { Actor, RequestContext } from '../../core/http/context';
import { validationFailed } from '../../core/http/errors';
import {
  assertUsableEvidence,
  formatMegabytes,
  readFileBytes,
  scanStored,
  type FileRow,
} from '../files/service';
import { DocxError } from '../templates/docx';
import { indexDocx, outlineOf } from '../templates/sample-docx';
import type { ModelImage } from './provider';
import { attachedFileIds, type ChatRow, type MessageRow } from './service';

/** The most characters of one document the assistant is shown. */
export const MAX_TEXT_CHARS = 40_000;
/** The most pages of a PDF that are read. */
const MAX_PDF_PAGES = 60;
const PDF_TIMEOUT_MS = 20_000;
/** The most pictures the model is shown in one reply: the newest of the chat. */
export const MAX_IMAGES_SHOWN = 4;

const unusable = (message: string, path: string) => validationFailed(message, path);

/** Checks one file against the chat's rules: finished, the person's own, clean, a kind it can read, small enough. */
async function usableChatFile(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  id: string,
  path: string,
): Promise<{ row: FileRow; kind: 'document' | 'image' }> {
  const stored = await assertUsableEvidence(deps.db, ctx.orgId, actor, id, path);
  const row = await scanStored(deps, ctx, stored);
  if (row.scanStatus === 'infected') throw unusable('This file failed the virus scan.', path);
  const check = checkChatFile(row, deps.config.ai.uploadMaxBytes);
  if (!check.ok) {
    throw unusable(
      check.reason === 'size'
        ? `This file is larger than ${formatMegabytes(deps.config.ai.uploadMaxBytes)}.`
        : check.reason === 'type'
          ? 'The assistant can read PDF, Word, text and CSV files, and PNG, JPEG and WebP pictures.'
          : 'This file is empty.',
      path,
    );
  }
  return { row, kind: check.kind };
}

/** A picture, ready for the model: its bytes must be the picture its name says. */
async function imageOf(
  deps: AppDeps,
  row: FileRow,
  path: string | null,
): Promise<ModelImage | null> {
  const bytes = await readFileBytes(deps, row);
  if (!looksLikeImage(fileExtension(row.name), bytes)) {
    if (path)
      throw unusable(`This is not a real ${fileExtension(row.name).toUpperCase()} picture.`, path);
    return null;
  }
  return { name: row.name, mediaType: row.mimeType, data: bytes };
}

/**
 * The files on a new message, checked before anything is saved: the rows, and the pictures the
 * model will be shown with it.
 */
export async function checkChatFiles(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  ids: string[],
): Promise<{ files: FileRow[]; images: ModelImage[] }> {
  const files: FileRow[] = [];
  const images: ModelImage[] = [];
  for (const [i, id] of [...new Set(ids)].slice(0, MAX_CHAT_FILES).entries()) {
    const path = `fileIds.${i}`;
    const { row, kind } = await usableChatFile(deps, ctx, actor, id, path);
    files.push(row);
    if (kind === 'image') {
      const image = await imageOf(deps, row, path);
      if (image) images.push(image);
    }
  }
  return { files, images };
}

/** The ids of the files that are pictures, in the order the messages came. */
const pictureIds = (messages: MessageRow[]): string[] =>
  messages.flatMap((m) =>
    m.sender === 'user'
      ? m.parts.flatMap((p) =>
          p.type === 'file' && chatFileKind(p.name) === 'image' ? [p.fileId] : [],
        )
      : [],
  );

/**
 * The pictures of the earlier messages that the model is shown again: the person's own, still
 * usable, newest last. A picture that can no longer be read is left out without a fuss.
 */
export async function earlierImages(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  messages: MessageRow[],
): Promise<ModelImage[]> {
  const images: ModelImage[] = [];
  for (const id of [...new Set(pictureIds(messages))].slice(-MAX_IMAGES_SHOWN)) {
    try {
      const { row } = await usableChatFile(deps, ctx, actor, id, 'fileId');
      const image = await imageOf(deps, row, null);
      if (image) images.push(image);
    } catch {
      // Not usable any more: the message still says it was attached.
    }
  }
  return images;
}

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(unusable(message, 'fileId')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

interface ReadText {
  text: string;
  pages: number | null;
  notes: string[];
}

async function pdfText(bytes: Buffer): Promise<ReadText> {
  const read = async (): Promise<ReadText> => {
    let doc;
    try {
      doc = await getDocumentProxy(new Uint8Array(bytes));
    } catch {
      throw unusable('This PDF cannot be opened. It may be damaged or protected.', 'fileId');
    }
    const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
    const out: string[] = [];
    for (let n = 1; n <= pages; n += 1) {
      const content = await (await doc.getPage(n)).getTextContent();
      const words = content.items.flatMap((item) =>
        'str' in item ? [item.str + (item.hasEOL ? '\n' : ' ')] : [],
      );
      out.push(
        `--- page ${n} ---\n${words
          .join('')
          .replace(/[ \t]+\n/g, '\n')
          .trim()}`,
      );
    }
    const notes: string[] = [];
    if (doc.numPages > pages) {
      notes.push(`This PDF has ${doc.numPages} pages: only the first ${pages} are read.`);
    }
    const characters = out
      .join('')
      .replace(/--- page \d+ ---/g, '')
      .trim().length;
    if (characters < 40 * pages) {
      notes.push(
        'This PDF has little or no text: it looks like a scan or a photo, so it cannot be read here. The person can attach photos of the pages as pictures instead.',
      );
    }
    return { text: out.join('\n\n'), pages: doc.numPages, notes };
  };
  return withTimeout(read(), PDF_TIMEOUT_MS, 'Reading this PDF took too long.');
}

function wordText(bytes: Buffer): ReadText {
  try {
    const { parts, notes } = outlineOf(indexDocx(bytes));
    return {
      text: parts
        .map((p) => p.text)
        .filter(Boolean)
        .join('\n'),
      pages: null,
      notes,
    };
  } catch (error) {
    if (error instanceof DocxError) throw unusable(error.problems.join(' '), 'fileId');
    throw unusable('This Word file cannot be read.', 'fileId');
  }
}

function plainText(bytes: Buffer): ReadText {
  const text = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
  const notes =
    (text.match(/\uFFFD/g)?.length ?? 0) > 20
      ? ['The file does not look like plain text: some characters could not be read.']
      : [];
  return { text, pages: null, notes };
}

/**
 * A document attached to a chat, as text for the assistant. Only a file attached to this very chat
 * is read, and only the person's own. The words are outside text: the caller says so to the model.
 */
export async function readChatDocument(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  chat: ChatRow,
  fileId: string,
): Promise<AttachmentText> {
  if (!(await attachedFileIds(deps.db, chat.id)).has(fileId)) {
    throw unusable('That file is not attached to this chat.', 'fileId');
  }
  const { row, kind } = await usableChatFile(deps, ctx, actor, fileId, 'fileId');
  if (kind === 'image') {
    throw unusable(
      'This is a picture: it is shown to you with the message, so there is no text to read.',
      'fileId',
    );
  }
  const bytes = await readFileBytes(deps, row);
  const extension = fileExtension(row.name);
  const read =
    extension === 'pdf'
      ? await pdfText(bytes)
      : extension === 'docx'
        ? wordText(bytes)
        : plainText(bytes);
  const truncated = read.text.length > MAX_TEXT_CHARS;
  return {
    file: { id: row.id, name: row.name, mimeType: row.mimeType, size: row.size },
    text: truncated ? read.text.slice(0, MAX_TEXT_CHARS) : read.text,
    pages: read.pages,
    truncated,
    notes: truncated
      ? [...read.notes, `The text is long: only the first ${MAX_TEXT_CHARS} characters are shown.`]
      : read.notes,
  };
}
