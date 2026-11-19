import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { toPdf } from './convert';
import {
  findTemplates,
  letterheadDocx,
  listTemplateFolders,
  templateForModel,
  templatesRoot,
} from './library';

vi.mock('./convert', () => ({
  toPdf: vi.fn(async (file: Buffer, filename: string) =>
    Buffer.from(`%PDF- converted ${filename} (${file.length} bytes)`),
  ),
}));

/** A made-up template folder: step folders, a nested folder, notes, junk and a letterhead. */
const FILES: Record<string, string> = {
  '1 Example Start/Kick-off form.docx': 'docx bytes',
  '1 Example Start/Kick-off guide.pdf': '%PDF- guide',
  '1 Example Start/.DS_Store': 'junk',
  '1 Example Start/~$Kick-off form.docx': 'lock file',
  '2 Example Survey/No standard form, done by phone.txt': '',
  '2 Example Survey/Call script.txt': '  Ask about sizes.  \n',
  '10 Example Prototype/Run sheet.xlsx': 'xlsx bytes',
  '20 Example Trials/Protocol/Plan.pdf': '%PDF- plan',
  '20 Example Trials/Overview.pdf': '%PDF- overview',
  '24 Example Transfer/Handover.docx': 'handover bytes',
  '_extra/Machine log.jpeg': 'jpeg bytes',
  'Loose notes/ignored.pdf': '%PDF- not a step folder',
  '_letterhead.docx': 'letterhead bytes',
};

let root: string;
const saved = process.env.COAL_TEMPLATES_DIR;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'coal-templates-'));
  for (const [name, contents] of Object.entries(FILES)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), contents);
  }
});

beforeEach(() => {
  process.env.COAL_TEMPLATES_DIR = root;
  vi.mocked(toPdf).mockClear();
});

afterAll(async () => {
  if (saved === undefined) delete process.env.COAL_TEMPLATES_DIR;
  else process.env.COAL_TEMPLATES_DIR = saved;
  await rm(root, { recursive: true, force: true });
});

const names = (files: { name: string }[]) => files.map((f) => f.name);

describe('templatesRoot', () => {
  it('uses COAL_TEMPLATES_DIR, else private/templates at the repo root', () => {
    expect(templatesRoot()).toBe(root);
    delete process.env.COAL_TEMPLATES_DIR;
    const fallback = templatesRoot();
    expect(path.isAbsolute(fallback)).toBe(true);
    expect(fallback.endsWith(path.join('private', 'templates'))).toBe(true);
    expect(path.dirname(path.dirname(fallback))).toBe(
      path.resolve(import.meta.dirname, '../../../../..'),
    );
  });
});

describe('findTemplates', () => {
  it("returns one step's files, not a step whose number starts the same", async () => {
    const files = await findTemplates('1');
    expect(names(files)).toEqual(['Kick-off form.docx', 'Kick-off guide.pdf']);
    expect(files[0]).toEqual({
      path: path.join(root, '1 Example Start', 'Kick-off form.docx'),
      name: 'Kick-off form.docx',
      folder: '1 Example Start',
      stepNumber: '1',
      kind: 'docx',
    });
    expect(names(await findTemplates('10'))).toEqual(['Run sheet.xlsx']);
  });

  it('maps 24a and 24b to folder 24', async () => {
    for (const key of ['24', '24a', '24b', ' 24A ']) {
      expect(names(await findTemplates(key))).toEqual(['Handover.docx']);
    }
  });

  it('returns nothing for steps without a folder', async () => {
    for (const key of ['2a', 'C', '99', '', 'follow_up']) {
      expect(await findTemplates(key)).toEqual([]);
    }
  });

  it('reads notes, whose file name carries the meaning', async () => {
    const files = await findTemplates('2');
    expect(files.map((f) => [f.name, f.kind, f.note])).toEqual([
      ['Call script.txt', 'note', 'Ask about sizes.'],
      ['No standard form, done by phone.txt', 'note', ''],
    ]);
  });

  it('includes files in subfolders, with their folder', async () => {
    const files = await findTemplates('20');
    expect(files.map((f) => [f.folder, f.name])).toEqual([
      ['20 Example Trials', 'Overview.pdf'],
      ['20 Example Trials/Protocol', 'Plan.pdf'],
    ]);
  });

  it('reads the disk on every call', async () => {
    expect(names(await findTemplates('24'))).toEqual(['Handover.docx']);
    const added = path.join(root, '24 Example Transfer', 'Checklist.pdf');
    await writeFile(added, '%PDF- checklist');
    try {
      expect(names(await findTemplates('24'))).toEqual(['Checklist.pdf', 'Handover.docx']);
    } finally {
      await rm(added);
    }
  });

  it('returns nothing when the templates folder is missing', async () => {
    process.env.COAL_TEMPLATES_DIR = path.join(root, 'missing');
    expect(await findTemplates('1')).toEqual([]);
    expect(await listTemplateFolders()).toEqual([]);
    expect(await letterheadDocx()).toBeNull();
  });
});

describe('listTemplateFolders', () => {
  it('lists step folders in step order, then _extra', async () => {
    const folders = await listTemplateFolders();
    expect(folders.map((f) => [f.stepNumber, f.folder, f.files.length])).toEqual([
      ['1', '1 Example Start', 2],
      ['2', '2 Example Survey', 2],
      ['10', '10 Example Prototype', 1],
      ['20', '20 Example Trials', 2],
      ['24', '24 Example Transfer', 1],
      ['', '_extra', 1],
    ]);
    expect(folders.at(-1)!.files[0]).toMatchObject({ kind: 'image', stepNumber: '' });
  });
});

describe('letterheadDocx', () => {
  it('reads _letterhead.docx', async () => {
    expect((await letterheadDocx())?.toString()).toBe('letterhead bytes');
  });
});

describe('templateForModel', () => {
  it('passes PDFs through as they are', async () => {
    const [, pdf] = await findTemplates('1');
    expect(await templateForModel(pdf!)).toEqual({ kind: 'pdf', data: Buffer.from('%PDF- guide') });
    expect(toPdf).not.toHaveBeenCalled();
  });

  it('gives a note as text, with its file name', async () => {
    const [script, empty] = await findTemplates('2');
    const result = await templateForModel(empty!);
    expect(result.kind).toBe('text');
    expect(result.kind === 'text' && result.text).toContain('No standard form, done by phone');
    expect(await templateForModel(script!)).toMatchObject({
      text: expect.stringContaining('Ask about sizes.'),
    });
  });

  it('converts office files and images to PDF, once until the file changes', async () => {
    const [docx] = await findTemplates('1');
    const first = await templateForModel(docx!);
    expect(first).toEqual({
      kind: 'pdf',
      data: Buffer.from('%PDF- converted Kick-off form.docx (10 bytes)'),
    });
    await templateForModel(docx!);
    expect(toPdf).toHaveBeenCalledTimes(1);

    await writeFile(docx!.path, 'changed docx bytes');
    const later = new Date(Date.now() + 5000);
    await utimes(docx!.path, later, later);
    const changed = await templateForModel(docx!);
    expect(changed.kind === 'pdf' && changed.data.toString()).toContain('(18 bytes)');
    expect(toPdf).toHaveBeenCalledTimes(2);

    const [sheet] = await findTemplates('10');
    await templateForModel(sheet!);
    const [image] = (await listTemplateFolders()).at(-1)!.files;
    await templateForModel(image!);
    expect(vi.mocked(toPdf).mock.calls.map(([, name]) => name)).toEqual([
      'Kick-off form.docx',
      'Kick-off form.docx',
      'Run sheet.xlsx',
      'Machine log.jpeg',
    ]);
  });
});
