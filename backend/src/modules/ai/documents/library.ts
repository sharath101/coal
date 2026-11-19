import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPdf } from './convert';

/**
 * Jayon's template library: one folder per R&D route step, named "<number> <step name>"
 * ("7 Example Step"), plus `_extra/` for documents outside the
 * route and `_letterhead.docx` at the top for new documents. Read from disk on every call, so
 * a changed template applies at once.
 */
export interface TemplateFile {
  /** Absolute path. */
  path: string;
  /** File name with extension. */
  name: string;
  /** The file's folder relative to the templates root, such as "7 Example Step/Drawings". */
  folder: string;
  /** The step number from the step folder's name ("24"), or '' for `_extra`. */
  stepNumber: string;
  kind: 'docx' | 'pdf' | 'xlsx' | 'note' | 'image' | 'other';
  /** For a note (.txt): its contents, trimmed. The file name usually carries the meaning. */
  note?: string;
}

const LETTERHEAD_FILE = '_letterhead.docx';
const EXTRA_FOLDER = '_extra';

/** Steps whose documents live in another step's folder. Unlisted letter keys have no folder. */
const FOLDER_FOR_STEP: Readonly<Record<string, string>> = { '24a': '24', '24b': '24' };

export function templatesRoot(): string {
  const fromEnv = process.env.COAL_TEMPLATES_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  // backend/src/modules/ai/documents → repo root
  return fileURLToPath(new URL('../../../../../private/templates', import.meta.url));
}

const byName = new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare;

function kindOf(name: string): TemplateFile['kind'] {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.docx') return 'docx';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.xlsx') return 'xlsx';
  if (ext === '.txt') return 'note';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff'].includes(ext))
    return 'image';
  return 'other';
}

/** Hidden files, Office lock files ("~$name.docx") and OS clutter aren't templates. */
function isJunk(name: string): boolean {
  return name.startsWith('.') || name.startsWith('~$') || name === 'Thumbs.db';
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function entries(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

/** The step number a folder name starts with ("24 Example Step" → "24"). */
function stepNumberOf(folderName: string): string | null {
  return /^(\d+)(?:\s|$)/.exec(folderName)?.[1] ?? null;
}

/** Every file under `dir`, subfolders included, sorted by folder then name. */
async function filesUnder(root: string, dir: string, stepNumber: string): Promise<TemplateFile[]> {
  const found: TemplateFile[] = [];
  const subfolders: string[] = [];
  for (const entry of (await entries(dir)).sort((a, b) => byName(a.name, b.name))) {
    if (isJunk(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      subfolders.push(full);
      continue;
    }
    if (!entry.isFile()) continue;
    const kind = kindOf(entry.name);
    const file: TemplateFile = {
      path: full,
      name: entry.name,
      folder: path.relative(root, dir).split(path.sep).join('/'),
      stepNumber,
      kind,
    };
    if (kind === 'note') file.note = (await readFile(full, 'utf8')).trim();
    found.push(file);
  }
  for (const sub of subfolders) found.push(...(await filesUnder(root, sub, stepNumber)));
  return found;
}

/** The step folders, in step order, then `_extra`. */
async function stepFolders(root: string): Promise<{ stepNumber: string; folder: string }[]> {
  const folders: { stepNumber: string; folder: string }[] = [];
  for (const entry of await entries(root)) {
    if (!entry.isDirectory() || isJunk(entry.name)) continue;
    const stepNumber = stepNumberOf(entry.name);
    if (stepNumber !== null) folders.push({ stepNumber, folder: entry.name });
    else if (entry.name === EXTRA_FOLDER) folders.push({ stepNumber: '', folder: entry.name });
  }
  const order = (f: { stepNumber: string }) =>
    f.stepNumber === '' ? Number.POSITIVE_INFINITY : Number(f.stepNumber);
  return folders.sort((a, b) => order(a) - order(b) || byName(a.folder, b.folder));
}

export async function listTemplateFolders(): Promise<
  { stepNumber: string; folder: string; files: TemplateFile[] }[]
> {
  const root = templatesRoot();
  const folders = await stepFolders(root);
  return Promise.all(
    folders.map(async ({ stepNumber, folder }) => ({
      stepNumber,
      folder,
      files: await filesUnder(root, path.join(root, folder), stepNumber),
    })),
  );
}

/**
 * The template files for a route step ('1'…'25', '24a' and '24b' share folder 24). A step
 * without a folder ('2a', 'C') gets []. Several folders with the same number are merged.
 */
export async function findTemplates(stepKey: string): Promise<TemplateFile[]> {
  const key = stepKey.trim().toLowerCase();
  const number = FOLDER_FOR_STEP[key] ?? (/^\d+$/.test(key) ? String(Number(key)) : null);
  if (number === null) return [];
  const root = templatesRoot();
  const found: TemplateFile[] = [];
  for (const { stepNumber, folder } of await stepFolders(root)) {
    if (stepNumber !== '' && Number(stepNumber) === Number(number))
      found.push(...(await filesUnder(root, path.join(root, folder), stepNumber)));
  }
  return found;
}

/** `_letterhead.docx` at the top of the templates folder: Jayon's header on an empty body. */
export async function letterheadDocx(): Promise<Buffer | null> {
  try {
    return await readFile(path.join(templatesRoot(), LETTERHEAD_FILE));
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** Converted PDFs by path, size and modification time; an edited file converts again. */
const pdfCache = new Map<string, Promise<Buffer>>();
const PDF_CACHE_LIMIT = 64;

async function cachedPdf(file: TemplateFile): Promise<Buffer> {
  const info = await stat(file.path);
  const key = `${file.path}\0${info.size}\0${info.mtimeMs}`;
  const hit = pdfCache.get(key);
  if (hit) return hit;
  for (const old of pdfCache.keys()) {
    if (old.startsWith(`${file.path}\0`)) pdfCache.delete(old);
  }
  while (pdfCache.size >= PDF_CACHE_LIMIT) {
    const oldest = pdfCache.keys().next().value;
    if (oldest === undefined) break;
    pdfCache.delete(oldest);
  }
  const pending = readFile(file.path).then((data) => toPdf(data, file.name));
  pdfCache.set(key, pending);
  pending.catch(() => pdfCache.delete(key));
  return pending;
}

function noteText(file: TemplateFile, contents: string): string {
  const title = path.basename(file.name, path.extname(file.name));
  return [
    `Note in the template folder "${file.folder}" (there may be no template document for this):`,
    `File name: ${title}`,
    contents ? `Contents:\n${contents}` : 'Contents: (empty)',
  ].join('\n');
}

/**
 * The template in a form the drafting model can read: PDFs as they are, office files and
 * images converted to PDF (cached until the file changes), notes as text.
 */
export async function templateForModel(
  file: TemplateFile,
): Promise<{ kind: 'pdf'; data: Buffer } | { kind: 'text'; text: string }> {
  switch (file.kind) {
    case 'pdf':
      return { kind: 'pdf', data: await readFile(file.path) };
    case 'note':
      return { kind: 'text', text: noteText(file, (await readFile(file.path, 'utf8')).trim()) };
    case 'docx':
    case 'xlsx':
    case 'image':
    case 'other':
      return { kind: 'pdf', data: await cachedPdf(file) };
  }
}
