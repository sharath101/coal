import PizZip from 'pizzip';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ORG_ID } from '../src/core/config';
import { systemContext } from '../src/core/http/context';
import { aiToolDefs } from '../src/modules/ai/tools';
import { buildDocx, type Block } from '../src/modules/templates/docx-builder';
import { fillParts, formOutline } from '../src/modules/templates/sample-docx';
import { SAMPLE_TEMPLATES } from '../src/modules/templates/samples';
import { loadSampleTemplates } from '../src/modules/templates/service';
import { ScriptedAi } from './fakes';
import { createTestApp, type TestApp } from './helpers';
import { createWorld, type World } from './world';

/**
 * Templates are Jayon's Word forms as they are, and people (or the assistant) fill them in
 * (docs/documents-and-signing.md#the-template-library). Filling templates in COAL is parked, so
 * this app runs as it ships.
 */
let t: TestApp;
let w: World;
const ai = new ScriptedAi();

beforeAll(async () => {
  t = await createTestApp({ AI_MAX_TOOL_CALLS: '10' }, { ai });
  w = await createWorld(t);
  await loadSampleTemplates(t.deps, systemContext(DEFAULT_ORG_ID));
}, 60_000);
afterAll(async () => {
  await t?.close();
});
afterEach(() => {
  expect(ai.pending).toBe(0);
});

const call = (...args: Parameters<World['call']>) => w.call(...args);
const ok = (res: Promise<{ status: number; body: any }>) => w.ok(res);

/** A made-up form, the way a person writes one: headings, an instruction to replace, a table to fill. */
const FORM: Block[] = [
  { type: 'title', text: 'Project Initiation Document' },
  { type: 'heading', text: 'Purpose' },
  { type: 'text', text: '[Describe the clinical need here.]' },
  { type: 'heading', text: 'Scope' },
  {
    type: 'rows',
    rows: [
      ['Product name', ''],
      ['Target markets', ''],
    ],
  },
  { type: 'heading', text: 'Risks' },
];
const form = (extra: Block[] = []) => buildDocx([...FORM, ...extra], 'Made-up form');
const text = (docx: Buffer) =>
  (new PizZip(docx).file('word/document.xml')?.asText() ?? '').replace(/<[^>]+>/g, ' ');

const addTemplate = async (bytes: Buffer, as = 'vp', name = 'pid-form.docx') =>
  call('POST', '/templates', as, {
    documentType: 'PID',
    docxFileId: await w.upload(as, name, new Uint8Array(bytes)),
  });

const download = async (url: string) => Buffer.from(await (await fetch(url)).arrayBuffer());
const linksOf = (id: string, as: string) => call('GET', `/templates/${id}/links`, as);

describe('a template is a Word form as it is', () => {
  it('is saved as a draft with no specification, with a PDF of the blank form', async () => {
    const res = await addTemplate(form());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'draft',
      spec: null,
      steps: ['1'],
      hasSample: true,
      documentType: { code: 'PID' },
      name: expect.stringContaining('pid-form'),
    });
    // The active one is unchanged, and nobody but the VP and the Head sees the draft.
    const seen = await ok(call('GET', '/templates?documentType=PID', 'designer'));
    expect(seen.items.every((x: any) => x.status === 'active')).toBe(true);
  });

  it('refuses what is not a Word file, a specification, and anyone but the VP or the Head', async () => {
    const notWord = await addTemplate(Buffer.from('just some words'), 'vp', 'notes.docx');
    expect(notWord.status).toBe(400);
    expect(notWord.body.errors[0].message).toMatch(/not a Word/);

    const spec = SAMPLE_TEMPLATES.find((s) => s.spec.document_type === 'PID')!.spec;
    const withSpec = await call('POST', '/templates', 'vp', {
      documentType: 'PID',
      docxFileId: await w.upload('vp', 'a.docx', new Uint8Array(form())),
      spec,
    });
    expect(withSpec.status).toBe(400);
    expect(withSpec.body.errors[0].message).toMatch(/switched off/);

    const designer = await addTemplate(form(), 'designer');
    expect(designer.status).toBe(403);
    expect(designer.body.whoCan).toEqual(['VP', 'R&D Head']);
  });

  it('is approved by the VP or the Head, replaces the old one and keeps it', async () => {
    const draft = (await addTemplate(form())).body;
    const before = (await ok(call('GET', '/templates/active?documentType=PID', 'designer'))).id;
    expect(before).not.toBe(draft.id);

    const approved = await ok(call('POST', `/templates/${draft.id}/activate`, 'head'));
    expect(approved).toMatchObject({ id: draft.id, status: 'active' });
    const all = (await ok(call('GET', '/templates?documentType=PID', 'vp'))).items;
    expect(all.find((x: any) => x.id === before).status).toBe('retired');
    expect((await ok(call('GET', '/templates/active?documentType=PID', 'designer'))).id).toBe(
      draft.id,
    );
  });

  it('gives everyone the approved blank form, with any placeholders emptied, and a draft only to the VP and the Head', async () => {
    const prepared = form([
      { type: 'text', text: 'Notes: {notes} and {#members}{name}{/members}' },
    ]);
    const draft = (await addTemplate(prepared, 'vp', 'prepared.docx')).body;

    // Not approved yet: the draft is for the people who manage the library.
    expect((await linksOf(draft.id, 'designer')).status).toBe(403);
    const mine = await ok(linksOf(draft.id, 'vp'));
    expect(text(await download(mine.form.url))).not.toContain('{');
    expect(text(await download(mine.form.url))).toContain('Purpose');
    // The Word file as it was uploaded is for the library's managers only.
    expect(text(await download(mine.docx.url))).toContain('{notes}');

    await ok(call('POST', `/templates/${draft.id}/activate`, 'vp'));
    const theirs = await ok(linksOf(draft.id, 'designer'));
    expect(text(await download(theirs.form.url))).toContain('Scope');
    expect(theirs.docx).toBeNull();
  });

  it('serves a form whose braces cannot be read as it is, instead of refusing it', async () => {
    const odd = form([{ type: 'text', text: 'Unclosed {brace in Jayon’s own wording' }]);
    const res = await addTemplate(odd, 'vp', 'odd.docx');
    expect(res.status).toBe(201);
    const links = await ok(linksOf(res.body.id, 'vp'));
    expect(text(await download(links.form.url))).toContain('Unclosed {brace');
  });
});

describe('a document is a copy of the form, filled in Word or with the assistant', () => {
  let projectId: string;
  beforeAll(async () => {
    // The approved form is the made-up one, with placeholders that must not show.
    const draft = (await addTemplate(form([{ type: 'text', text: 'Code: {code}' }]))).body;
    await ok(call('POST', `/templates/${draft.id}/activate`, 'vp'));
    projectId = await w.go('Quokka cervical plate');
  });

  const start = (as = 'head', body: Record<string, unknown> = { fromForm: true }) =>
    call('POST', `/projects/${projectId}/documents`, as, {
      stepKey: '1',
      documentType: 'PID',
      ...body,
    });
  const step = async () => w.stepOf(projectId, '1', 'head');
  const formOf = (id: string, as = 'head') => call('GET', `/documents/${id}/form`, as);

  it('needs the filled file or a copy of the form, and says so', async () => {
    const bare = await start('head', {});
    expect(bare.status).toBe(400);
    expect(bare.body.errors[0].message).toMatch(
      /Download the blank Project Initiation Document form/,
    );
  });

  it('starts as a copy of the blank form with its PDF, which is not yet something to hand in', async () => {
    const res = await start();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'draft',
      template: null,
      spec: null,
      type: { code: 'PID', kind: 'template' },
      current: { versionNo: 1, hasPdf: true, file: { name: expect.stringMatching(/\.docx$/) } },
    });
    // The copy has no placeholders, and is still the blank form.
    const outline = (await ok(formOf(res.body.id))).parts.map((p: any) => p.text).join(' ');
    expect(outline).toContain('Purpose');
    expect(outline).not.toContain('{');
    expect((await step()).documentNeeds).toEqual([expect.stringMatching(/still the blank form/)]);
    const blocked = await call('POST', `/projects/${projectId}/steps/1/submit`, 'head');
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('DOCUMENTS_NEEDED');
  });

  it('is filled in place: the new version keeps the layout, has its PDF, and the old one stays', async () => {
    const doc = (await start('lead')).body;
    const read = await ok(formOf(doc.id, 'lead'));
    expect(read).toMatchObject({ versionNo: 1, documentId: doc.id });
    const part = (words: string) => read.parts.find((p: any) => p.text.includes(words)).id;

    const filled = await ok(
      call('POST', `/documents/${doc.id}/fill`, 'lead', {
        versionNo: 1,
        fills: [
          { part: part('Describe the clinical need'), text: 'Surgeons need a low-profile plate.' },
          { part: part('Product name'), mode: 'append', text: 'Cervical plate' },
          { part: part('Scope'), mode: 'after', text: 'First line.\n\nSecond line.' },
        ],
      }),
    );
    expect(filled.current).toMatchObject({
      versionNo: 2,
      status: 'draft',
      viaAi: false,
      hasPdf: true,
    });
    expect(filled.versions.map((v: any) => v.versionNo)).toEqual([2, 1]);

    const again = (await ok(formOf(doc.id, 'lead'))).parts.map((p: any) => p.text);
    expect(again).toContain('Surgeons need a low-profile plate.');
    expect(
      again.some((x: string) => x.startsWith('Product name') && x.includes('Cervical plate')),
    ).toBe(true);
    const scope = again.indexOf('Scope');
    expect(again.slice(scope + 1, scope + 3)).toEqual(['First line.', 'Second line.']);
    // The example text is gone; the headings and the table are as they were.
    expect(again.join(' ')).not.toContain('Describe the clinical need');
    expect(again).toContain('Risks');

    // Its words are found by search, and the earlier version's file is unchanged.
    const hits = (await ok(call('GET', '/search?q=low-profile&types=document', 'lead'))).items;
    expect(hits.map((h: any) => h.title)).toContain(`${doc.number} · ${doc.title}`);
    const v1 = await ok(call('GET', `/documents/${doc.id}?version=1`, 'lead'));
    expect(v1.current.hasPdf).toBe(true);
  });

  it('is refused for a stale version, headers, a missing part, a signer’s version and people who may not write or read', async () => {
    const doc = (await start('lead')).body;
    const read = await ok(formOf(doc.id, 'lead'));
    const body = (fills: unknown[], versionNo = 1) => ({ versionNo, fills });
    const fill = (as: string, b: unknown) => call('POST', `/documents/${doc.id}/fill`, as, b);

    await ok(fill('lead', body([{ part: read.parts[1].id, text: 'First.' }])));
    const stale = await fill('lead', body([{ part: read.parts[1].id, text: 'Again.' }]));
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('VERSION_CONFLICT');

    const missing = await fill('lead', body([{ part: 'p999', text: 'Nowhere.' }], 2));
    expect(missing.status).toBe(400);
    expect(missing.body.errors[0].message).toMatch(/no part p999/);

    // Someone who may read it but is not a doer of the step may not fill it in.
    const readOnly = await fill('designer', body([{ part: read.parts[1].id, text: 'No.' }], 2));
    expect(readOnly.status).toBe(403);
    // Someone who may not read it at all, nothing.
    for (const as of ['outsider', 'md']) {
      expect([403, 404]).toContain((await formOf(doc.id, as)).status);
      expect([403, 404]).toContain((await fill(as, body([{ part: 'p1', text: 'No.' }], 2))).status);
    }
  });

  it('turns an uploaded Word file into a PDF when it is saved, and takes it as the filled-in form', async () => {
    const own = form([{ type: 'text', text: 'Filled in Word by a person.' }]);
    const fileId = await w.upload('head', 'filled.docx', new Uint8Array(own));
    const doc = await ok(start('head', { fileId }));
    expect(doc.current).toMatchObject({ hasPdf: true, file: { name: 'filled.docx' } });
    // Different from the blank form, so it counts as filled in.
    expect((await step()).documentNeeds).toEqual([]);
    const hits = (await ok(call('GET', '/search?q=Filled+in+Word&types=document', 'head'))).items;
    expect(hits.length).toBeGreaterThan(0);

    // A new version uploaded the same way gets its PDF too.
    const next = await w.upload(
      'head',
      'filled-2.docx',
      new Uint8Array(form([{ type: 'text', text: 'Second.' }])),
    );
    const saved = await ok(call('POST', `/documents/${doc.id}/versions`, 'head', { fileId: next }));
    expect(saved.current).toMatchObject({ versionNo: 2, hasPdf: true });
  });
});

describe('the assistant fills a form', () => {
  let projectId: string;
  beforeAll(async () => {
    projectId = await w.go('Quokka lumbar cage');
  });

  const newChat = async (as: string, context: Record<string, unknown> = {}) =>
    (await ok(call('POST', '/ai/chats', as, { context }))).id as string;
  const send = (chatId: string, as: string, words: string, fileIds: string[] = []) =>
    call('POST', `/ai/chats/${chatId}/messages`, as, { text: words, fileIds });
  const parts = (message: any, type: string) => message.parts.filter((p: any) => p.type === type);
  /** A copy of the form, made as the person, and the id of the part that holds the instruction. */
  const makeForm = async (as = 'lead') => {
    const doc = await ok(
      call('POST', `/projects/${projectId}/documents`, as, {
        stepKey: '1',
        documentType: 'PID',
        fromForm: true,
      }),
    );
    const outline = await ok(call('GET', `/documents/${doc.id}/form`, as));
    const instruction = outline.parts.find((p: any) => p.text.includes('Describe the clinical'));
    return { id: doc.id as string, instruction: instruction.id as string };
  };

  it('has the form tools and the form rules, and not the parked ones', async () => {
    const chat = await newChat('lead', { projectId });
    ai.reply({ say: 'Hello.' });
    await ok(send(chat, 'lead', 'Hello'));
    const turn = ai.turns.at(-2)!;
    const names = turn.tools.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(['start_form', 'read_form', 'fill_form']));
    for (const parked of ['start_draft', 'save_draft', 'read_sample', 'prepare_template']) {
      expect(names).not.toContain(parked);
    }
    expect(aiToolDefs({ filling: false }).map((x) => x.name)).toEqual(names);
    expect(aiToolDefs().length).toBeGreaterThan(names.length);
    expect(turn.system).toContain('FILLING A FORM');
    expect(turn.system).not.toContain('DRAFTING A DOCUMENT');
  });

  it('starts a form as the person, from the approved blank form', async () => {
    const chat = await newChat('lead', { projectId });
    ai.reply(
      { tool: 'start_form', input: { projectId, stepKey: '1', documentType: 'PID' } },
      { say: 'I started the form.' },
    );
    await ok(send(chat, 'lead', 'Start the PID for this project'));
    const started = JSON.parse(ai.results.at(-1)!).result;
    expect(started).toMatchObject({ versionNo: 1, number: expect.any(String) });
    const doc = await ok(call('GET', `/documents/${started.documentId}`, 'lead'));
    expect(doc.createdBy.name).toBe('Leela Example');
    expect(doc.versions[0]).toMatchObject({ versionNo: 1, viaAi: true });
  });

  it('reads the form and fills it from what the person said, as a new draft the person can open', async () => {
    const { id, instruction } = await makeForm();
    const chat = await newChat('lead', { projectId });
    ai.reply(
      { tool: 'read_form', input: { documentId: id } },
      {
        tool: 'fill_form',
        input: {
          documentId: id,
          versionNo: 1,
          fills: [{ part: instruction, text: 'The plate should be 2.4 mm thick, for C3 to C7.' }],
        },
      },
      { say: 'I filled in the purpose from what you told me.' },
    );
    const reply = await ok(
      send(chat, 'lead', 'The plate should be 2.4 mm thick, for C3 to C7. Fill in the purpose.'),
    );
    const read = JSON.parse(ai.results.at(-2)!).result;
    expect(read.parts.some((p: string) => p.includes('Describe the clinical need'))).toBe(true);
    expect(JSON.parse(ai.results.at(-1)!).result).toMatchObject({ version: 2, status: 'draft' });
    expect(parts(reply.message, 'draft')).toEqual([
      expect.objectContaining({ documentId: id, versionNo: 2, projectId }),
    ]);
    const doc = await ok(call('GET', `/documents/${id}`, 'lead'));
    expect(doc.current).toMatchObject({ versionNo: 2, viaAi: true, hasPdf: true });
    const words = (await ok(call('GET', `/documents/${id}/form`, 'lead'))).parts.map(
      (p: any) => p.text,
    );
    expect(words).toContain('The plate should be 2.4 mm thick, for C3 to C7.');
  });

  it('refuses a number no source gave, and saves nothing', async () => {
    const { id, instruction } = await makeForm();
    const chat = await newChat('lead', { projectId });
    ai.reply(
      {
        tool: 'fill_form',
        input: {
          documentId: id,
          versionNo: 1,
          fills: [{ part: instruction, text: 'A 450 MPa plate.' }],
        },
      },
      { say: 'I could not save that.' },
    );
    const reply = await ok(send(chat, 'lead', 'Fill in the purpose'));
    expect(ai.results.at(-1)).toMatch(/states 450, which no source gave/);
    expect(parts(reply.message, 'draft')).toEqual([]);
    expect((await ok(call('GET', `/documents/${id}`, 'lead'))).versions).toHaveLength(1);
  });

  it('lets a number through when a tool read it in this reply', async () => {
    const { id, instruction } = await makeForm();
    const chat = await newChat('lead', { projectId });
    ai.reply(
      { tool: 'get_timeline', input: { projectId } },
      {
        tool: 'fill_form',
        input: {
          documentId: id,
          versionNo: 1,
          fills: [{ part: instruction, text: 'The plan has 25 steps.' }],
        },
      },
      { say: 'Filled.' },
    );
    await ok(send(chat, 'lead', 'Fill in the purpose'));
    expect(JSON.parse(ai.results.at(-1)!).result.version).toBe(2);
  });

  it('is refused for someone who may not write on that step, and in a chat holding an outside file', async () => {
    const { id, instruction } = await makeForm();
    const fill = (text: string) => ({
      tool: 'fill_form',
      input: { documentId: id, versionNo: 1, fills: [{ part: instruction, text }] },
    });
    const chat = await newChat('designer');
    ai.reply(fill('Words.'), { say: 'I am not allowed.' });
    await ok(send(chat, 'designer', 'Fill in the purpose'));
    expect(ai.results.at(-1)).toMatch(/Not allowed|Failed/);

    const file = await w.upload(
      'lead',
      'outside.docx',
      Buffer.from('PK\x03\x04 not really'),
      'outside',
    );
    const outside = await newChat('lead', { projectId });
    ai.reply(fill('From the file.'), { say: 'I can only prepare cards now.' });
    await ok(send(outside, 'lead', 'Use this file to fill in the purpose', [file]));
    expect(ai.results.at(-1)).toMatch(/holds a file from outside/);
    expect((await ok(call('GET', `/documents/${id}`, 'lead'))).versions).toHaveLength(1);
  });

  it('reads a form for someone who may open the document, and not for someone who may not', async () => {
    const { id } = await makeForm();
    const chat = await newChat('outsider');
    ai.reply({ tool: 'read_form', input: { documentId: id } }, { say: 'I could not open it.' });
    await ok(send(chat, 'outsider', 'Read that form'));
    expect(ai.results.at(-1)).toMatch(/Not allowed|Failed/);
    expect(ai.results.at(-1)).not.toContain('Purpose');
  });
});

describe('putting text into a form', () => {
  const docx = form();
  const outline = formOutline(docx);
  const id = (words: string) => outline.parts.find((p) => p.text.includes(words))!.id;

  it('replaces, appends and adds paragraphs without touching anything else', () => {
    const { docx: out, problems } = fillParts(docx, [
      { part: id('Describe'), mode: 'replace', text: 'Real need.' },
      { part: id('Product name'), mode: 'append', text: 'Plate' },
      { part: id('Risks'), mode: 'after', text: 'A.\nB.' },
    ]);
    expect(problems).toEqual([]);
    const texts = formOutline(out).parts.map((p) => p.text);
    expect(texts).toEqual(expect.arrayContaining(['Real need.', 'A.', 'B.']));
    expect(texts.join('|')).toContain('Product name Plate');
    expect(texts.join('|')).not.toContain('[Describe');
    // The headings are still headings.
    expect(formOutline(out).parts.find((p) => p.text === 'Risks')?.style).toMatch(/heading/);
    // Text added after a heading is body text, not another heading.
    expect(formOutline(out).parts.find((p) => p.text === 'A.')?.style).toBe('');
  });

  it('reports every problem and changes nothing', () => {
    const { docx: out, problems } = fillParts(docx, [
      { part: 'p999', mode: 'replace', text: 'x' },
      { part: id('Risks'), mode: 'replace', text: '   ' },
    ]);
    expect(problems).toHaveLength(2);
    expect(out).toBe(docx);
  });
});
