import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import type { FoundTags } from '@coal/shared';

/** A Word file COAL can't use. `problems` are written for the person who prepared it. */
export class DocxError extends Error {
  constructor(readonly problems: string[]) {
    super(problems[0] ?? 'This Word file cannot be used.');
    this.name = 'DocxError';
  }
}

/** A Word file is a zip; refuse one that would unpack to something huge. */
const MAX_UNPACKED_BYTES = 60 * 1024 * 1024;

const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function open(docx: Buffer): PizZip {
  if (!docx.subarray(0, 4).equals(ZIP_SIGNATURE)) {
    throw new DocxError(['This is not a Word (.docx) file.']);
  }
  let zip: PizZip;
  try {
    zip = new PizZip(docx);
  } catch {
    throw new DocxError(['This is not a Word (.docx) file, or it is damaged.']);
  }
  let unpacked = 0;
  for (const entry of Object.values(zip.files)) {
    unpacked +=
      (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  }
  if (unpacked > MAX_UNPACKED_BYTES)
    throw new DocxError(['This Word file is too large once opened.']);
  if (!zip.file('word/document.xml')) {
    throw new DocxError(['This is a zip file, but not a Word document.']);
  }
  return zip;
}

function compile(docx: Buffer): Docxtemplater {
  const zip = open(docx);
  try {
    return new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      // Problems are reported to the person, not printed to the server's console.
      errorLogging: false,
      // A value that isn't there yet renders as nothing, not as "undefined".
      nullGetter: () => '',
    });
  } catch (error) {
    const errors = (error as { properties?: { errors?: unknown[] } }).properties?.errors;
    const explanations = (errors ?? [error])
      .map((e) => (e as { properties?: { explanation?: string } }).properties?.explanation)
      .filter((e): e is string => !!e);
    throw new DocxError(
      explanations.length > 0
        ? explanations.map((e) => `Word file: ${e}.`)
        : ['The placeholders in this Word file could not be read.'],
    );
  }
}

type TagTree = Record<string, unknown>;

function merge(into: TagTree, from: TagTree): void {
  for (const [name, inner] of Object.entries(from)) {
    const target = (into[name] ??= {}) as TagTree;
    merge(target, inner as TagTree);
  }
}

/** The placeholders in a Word file (body, headers and footers): each name, and the names inside a loop. */
export function readTags(docx: Buffer): FoundTags {
  const doc = compile(docx);
  const found = (
    doc as unknown as {
      getTags(): {
        document: { tags: TagTree };
        headers: { tags: TagTree }[];
        footers: { tags: TagTree }[];
      };
    }
  ).getTags();
  const all: TagTree = {};
  merge(all, found.document.tags);
  for (const part of [...found.headers, ...found.footers]) merge(all, part.tags);
  return all as FoundTags;
}

// Characters XML 1.0 forbids (everything below space except tab, newline and carriage return).
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

const clean = (value: unknown): unknown => {
  if (typeof value === 'string') return value.replace(FORBIDDEN, '');
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)]));
  }
  return value;
};

/** Fills the placeholders and returns the finished Word file. */
export function fillDocx(docx: Buffer, data: Record<string, unknown>): Buffer {
  const doc = compile(docx);
  try {
    doc.render(clean(data));
  } catch (error) {
    const errors = (error as { properties?: { errors?: unknown[] } }).properties?.errors;
    const explanations = (errors ?? [error])
      .map((e) => (e as { properties?: { explanation?: string } }).properties?.explanation)
      .filter((e): e is string => !!e);
    throw new DocxError(
      explanations.length > 0
        ? explanations.map((e) => `Word file: ${e}.`)
        : ['Filling the Word file failed.'],
    );
  }
  return (doc.getZip() as PizZip).generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}
