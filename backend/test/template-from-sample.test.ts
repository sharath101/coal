import { PrepareTemplateBody, TemplateSpec, checkPlaceholders } from '@coal/shared';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { aiToolDefs } from '../src/modules/ai/tools';
import { files } from '../src/modules/files/tables';
import { fillDocx, readTags } from '../src/modules/templates/docx';
import { buildDocx } from '../src/modules/templates/docx-builder';
import { applyPlan, indexDocx, outlineOf } from '../src/modules/templates/sample-docx';
import { pdfToDocx } from '../src/modules/templates/sample-pdf';
import { createTestApp, type TestApp } from './helpers';
import { ScriptedAi } from './fakes';
import { createWorld, type World } from './world';

/** A made-up filled-in form, with a blank value cell, example paragraphs and a table of people. */
const sampleForm = () =>
  buildDocx(
    [
      { type: 'title', text: 'Design Input Form' },
      { type: 'text', text: 'Fill in every box. Send to DARD after review.' },
      {
        type: 'rows',
        rows: [
          ['Project code', 'SPN-26-004'],
          ['Product', 'Anterior cervical plate'],
          ['Date', ''],
        ],
      },
      { type: 'heading', text: 'Clinical need' },
      { type: 'text', text: 'Surgeons need a low profile plate for fusion at C3 to C7.' },
      { type: 'text', text: 'The current plate is too thick and irritates the oesophagus.' },
      { type: 'heading', text: 'Team' },
      {
        type: 'table',
        rows: [
          ['Name', 'Role', 'Sign'],
          ['Asha Example', 'R&D Lead', ''],
          ['Om Example', 'PME', ''],
        ],
      },
    ],
    'Design Input Form v1',
  );

/** What the AI decides for that form. Part numbers are those of its outline. */
const plan = (
  fileId = '01a1f3ee-d447-7788-9b72-50005f0cd1de',
  extra: Record<string, unknown> = {},
) => ({
  fileId,
  documentType: 'DIF',
  template: 'Design Input Form',
  steps: ['4'],
  signatureRows: ['prepared', 'approved'],
  sections: [
    {
      id: 'header',
      kind: 'fields',
      fields: {
        project_code: { from: 'project.code', label: 'Project code', at: [{ part: 'p4' }] },
        product: { from: 'project.name', at: [{ part: 'p6', text: 'cervical' }] },
        date: { from: 'today', at: [{ part: 'p8' }] },
      },
    },
    {
      id: 'need',
      kind: 'written',
      title: 'Clinical need',
      instructions: 'Say the clinical need in 100 words.',
      required: true,
      replace: { from: 'p10', to: 'p11' },
    },
    {
      id: 'team',
      kind: 'fields',
      fields: { members: { from: 'project.team', cells: { name: 'p16', role: 'p17' } } },
    },
  ],
  dropRows: ['p19'],
  ...extra,
});

/** A one-page PDF with text, written by hand so no tool is needed to make it. */
function pdf(items: { text: string; x: number; y: number; size?: number; bold?: boolean }[]) {
  const content = items
    .map(
      (i) =>
        `BT /${i.bold ? 'F2' : 'F1'} ${i.size ?? 11} Tf 1 0 0 1 ${i.x} ${i.y} Tm (${i.text}) Tj ET`,
    )
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

describe('reading a sample', () => {
  it('numbers every part of a Word file, and the blank cells where a value may go', () => {
    const { parts } = outlineOf(indexDocx(sampleForm()));
    const show = (id: string) => parts.find((p) => p.id === id);
    expect(show('p1')).toMatchObject({ text: 'Design Input Form', style: 'title', where: 'body' });
    expect(show('p4')).toMatchObject({ text: 'SPN-26-004', where: 'table 1, row 1, column 2' });
    expect(show('p8')).toMatchObject({ text: '', where: 'table 1, row 3, column 2' });
    expect(show('p3')).toMatchObject({ bold: true });
    expect(show('p22')).toMatchObject({ where: 'footer' });
    // The same file always gives the same numbers, so the AI's plan still fits when it builds.
    expect(outlineOf(indexDocx(sampleForm())).parts).toEqual(parts);
  });

  it('refuses what is not a Word file', () => {
    expect(() => indexDocx(Buffer.from('not a word file'))).toThrow(/not a Word/);
  });

  it('reads a PDF with text as a plain Word form: headings, paragraphs and tables', async () => {
    const read = await pdfToDocx(
      pdf([
        { text: 'Design Input Form', x: 56, y: 780, size: 22, bold: true },
        { text: 'Fill in every box. Send to DARD after review.', x: 56, y: 750 },
        { text: 'Clinical need', x: 56, y: 710, size: 14, bold: true },
        { text: 'Surgeons need a low profile plate for fusion.', x: 56, y: 690 },
        { text: 'The current plate is too thick.', x: 56, y: 676 },
        { text: 'Name', x: 56, y: 630, bold: true },
        { text: 'Role', x: 260, y: 630, bold: true },
        { text: 'Asha Example', x: 56, y: 612 },
        { text: 'R&D Lead', x: 260, y: 612 },
        { text: 'Om Example', x: 56, y: 594 },
        { text: 'PME', x: 260, y: 594 },
        { text: 'Filler line so the page has enough text to be a real form.', x: 56, y: 560 },
      ]),
    );
    expect(read.pages).toBe(1);
    expect(read.notes.join(' ')).toMatch(/layout is rebuilt/);
    const { parts } = outlineOf(indexDocx(read.docx));
    const lines = parts.map((p) => `${p.style || '-'}|${p.where.split(',')[0]}|${p.text}`);
    expect(lines).toContain('title|body|Design Input Form');
    expect(lines).toContain('heading 1|body|Clinical need');
    // Two lines close together are one paragraph.
    expect(lines).toContain(
      '-|body|Surgeons need a low profile plate for fusion. The current plate is too thick.',
    );
    expect(lines).toContain('-|table 1|Asha Example');
    expect(lines).toContain('-|table 1|R&D Lead');
  });

  it('refuses a PDF with no text, such as a scan, and one that will not open', async () => {
    await expect(pdfToDocx(pdf([]))).rejects.toThrow(/no text|scan/);
    await expect(pdfToDocx(Buffer.from('%PDF-1.4 garbage'))).rejects.toThrow(/cannot be opened/);
  });
});

describe('putting placeholders into a sample', () => {
  it('turns values into fields, examples into a written section and a filled row into a loop', () => {
    const built = applyPlan(sampleForm(), PrepareTemplateBody.parse(plan()));
    expect(built.problems).toEqual([]);
    const spec = TemplateSpec.parse({
      template: 'Design Input Form',
      document_type: 'DIF',
      steps: ['4'],
      sections: [
        {
          id: 'header',
          kind: 'fields',
          fields: {
            project_code: { from: 'project.code' },
            product: { from: 'project.name' },
            date: { from: 'today' },
          },
        },
        { id: 'need', kind: 'written', instructions: 'x' },
        { id: 'team', kind: 'fields', fields: { members: { from: 'project.team' } } },
      ],
    });
    expect(checkPlaceholders(spec, readTags(built.docx)).problems).toEqual([]);

    const filled = fillDocx(built.docx, {
      project_code: 'SPN-26-009',
      product: 'Plate',
      date: '21 Nov 2026',
      need: 'First line\nSecond line',
      members: [
        { name: 'A', role: 'B' },
        { name: 'C', role: 'D' },
        { name: 'E', role: 'F' },
      ],
    });
    const text = outlineOf(indexDocx(filled)).parts.map((p) => p.text);
    // The words around a value stay; the sample's own example paragraphs and rows are gone.
    expect(text).toContain('Anterior Plate plate');
    expect(text).toContain('SPN-26-009');
    expect(text).toContain('First line\nSecond line');
    expect(text.join(' ')).not.toMatch(/Asha Example|Om Example|low profile|oesophagus/);
    expect(text.filter((t) => ['A', 'C', 'E'].includes(t))).toHaveLength(3);
    // Headings and labels stay, so the layout is the person's.
    expect(text).toEqual(expect.arrayContaining(['Clinical need', 'Team', 'Project code']));
  });

  it('says what is wrong, for the AI to fix, instead of guessing', () => {
    const bad = applyPlan(
      sampleForm(),
      PrepareTemplateBody.parse(
        plan(undefined, {
          sections: [
            {
              id: 'header',
              kind: 'fields',
              fields: {
                project_code: { from: 'project.code', at: [{ part: 'p4', text: 'not there' }] },
                product: { from: 'project.name', at: [{ part: 'p99' }] },
                date: { from: 'today' },
              },
            },
            // From a paragraph to one inside a table: not one place.
            { id: 'need', kind: 'written', instructions: 'x', replace: { from: 'p10', to: 'p16' } },
            { id: 'team', kind: 'fields', fields: { members: { from: 'project.team' } } },
          ],
          dropRows: [],
        }),
      ),
    );
    expect(bad.problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/p4 does not contain "not there"/),
        expect.stringMatching(/no part p99/),
        expect.stringMatching(/Say where \{date\} goes/),
        expect.stringMatching(/not in the same place/),
        expect.stringMatching(/team table: say which cell/),
      ]),
    );
  });
});

describe('the tools for it', () => {
  it('are built on endpoints the AI may call without a card, and the card carries the rest', () => {
    const names = aiToolDefs().map((t) => `${t.name}:${t.endpoint.aiTier}`);
    expect(names).toEqual(
      expect.arrayContaining([
        'read_sample:read',
        'prepare_template:read',
        'list_document_types:read',
      ]),
    );
  });
});

let t: TestApp;
let w: World;
const ai = new ScriptedAi();

beforeAll(async () => {
  t = await createTestApp({ TEMPLATE_FILLING: 'true' }, { ai });
  w = await createWorld(t);
}, 60_000);
afterAll(async () => {
  await t?.close();
});
afterEach(() => {
  expect(ai.pending).toBe(0);
});

const call = (...args: Parameters<World['call']>) => w.call(...args);
const ok = (res: Promise<{ status: number; body: any }>) => w.ok(res);

describe('making a template from a sample, over the API', () => {
  let fileId: string;
  let prepared: { docxFileId: string; sampleFileId: string; layout: string; spec: any };

  beforeAll(async () => {
    fileId = await w.upload('vp', 'dif-sample.docx', sampleForm(), 'outside');
  });

  it('shows the outline to the VP and the Head, and refuses everyone else, saying who can', async () => {
    const outline = await ok(call('GET', `/templates/sample-outline?fileId=${fileId}`, 'vp'));
    expect(outline).toMatchObject({ layout: 'kept', file: { name: 'dif-sample.docx' } });
    expect(outline.parts[3]).toMatchObject({ id: 'p4', text: 'SPN-26-004' });
    const headsFile = await w.upload('head', 'heads.docx', sampleForm(), 'outside');
    await ok(call('GET', `/templates/sample-outline?fileId=${headsFile}`, 'head'));
    for (const as of ['lead', 'designer', 'qa']) {
      const res = await call('GET', `/templates/sample-outline?fileId=${fileId}`, as);
      expect(res.status, as).toBe(403);
    }
    expect((await call('POST', '/templates/prepare', 'lead', plan(fileId))).status).toBe(403);
  });

  it('refuses someone else’s file, and a file that is not Word or PDF', async () => {
    const mine = await w.upload('lead', 'lead-only.docx', sampleForm());
    expect((await call('GET', `/templates/sample-outline?fileId=${mine}`, 'vp')).status).toBe(403);
    const text = await w.upload('vp', 'notes.txt', Buffer.from('hello'));
    const res = await call('GET', `/templates/sample-outline?fileId=${text}`, 'vp');
    expect(res.status).toBe(400);
    expect(res.body.errors[0].message).toMatch(/Word \(.docx\) file or a PDF/);
  });

  it('prepares a template without adding one, and lists every problem when it cannot', async () => {
    const bad = await call('POST', '/templates/prepare', 'vp', {
      ...plan(fileId),
      sections: [
        {
          id: 'header',
          kind: 'fields',
          fields: { project_code: { from: 'project.code', at: [{ part: 'p4', text: 'nope' }] } },
        },
      ],
      dropRows: [],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.errors.map((e: any) => e.message).join(' ')).toMatch(/does not contain "nope"/);

    prepared = await ok(call('POST', '/templates/prepare', 'vp', plan(fileId)));
    expect(prepared).toMatchObject({ layout: 'kept' });
    expect(prepared.spec.sections.map((s: any) => s.id)).toEqual(['header', 'need', 'team']);
    // The sample is recorded as the source of the Word file, and the Word file of the PDF.
    const [docx] = await t.deps.db.select().from(files).where(eq(files.id, prepared.docxFileId));
    expect(docx).toMatchObject({ derivedFrom: fileId, uploadedBy: w.who.vp!.user.id });
    const [pdfRow] = await t.deps.db
      .select()
      .from(files)
      .where(eq(files.id, prepared.sampleFileId));
    expect(pdfRow).toMatchObject({ derivedFrom: prepared.docxFileId, mimeType: 'application/pdf' });
    // Nothing is in the library yet.
    const types = await ok(call('GET', '/document-types', 'vp'));
    expect(types.items.some((i: any) => i.code === 'DIF')).toBe(false);
  });

  it('checks the plan like an upload: roles, steps and the specification', async () => {
    const roles = await call('POST', '/templates/prepare', 'vp', {
      ...plan(fileId),
      signatureRows: ['prepared', 'reviewed', 'approved'],
      reviewedBy: ['no_such_role'],
    });
    expect(roles.status).toBe(400);
    expect(roles.body.errors.map((e: any) => e.message).join(' ')).toMatch(
      /"no_such_role" is not a role/,
    );
    const twice = await call('POST', '/templates/prepare', 'vp', {
      ...plan(fileId),
      sections: [...plan(fileId).sections, { id: 'need', kind: 'written', instructions: 'again' }],
    });
    expect(twice.status).toBe(400);
  });

  it('puts it on one card that adds the type and the draft, and shows the sections and the sample', async () => {
    const actions = [
      {
        endpoint: 'documentTypes.create',
        body: { code: 'DIF', name: 'Design Input Form', steps: ['4'] },
      },
      {
        endpoint: 'templates.create',
        body: {
          documentType: 'DIF',
          docxFileId: prepared.docxFileId,
          spec: prepared.spec,
          notes: 'From the old form',
        },
      },
    ];
    const card = await ok(
      call('POST', '/proposals', 'vp', { title: 'Design Input Form', actions }),
    );
    expect(card.preview.actions.map((a: any) => a.endpoint)).toEqual([
      'documentTypes.create',
      'templates.create',
    ]);
    const detail = card.preview.actions[1].detail;
    expect(detail).toMatchObject({
      kind: 'template',
      documentType: { code: 'DIF', name: 'Design Input Form', firstOfType: true },
      layout: 'kept',
      madeFrom: 'dif-sample.docx',
      sampleFileId: prepared.sampleFileId,
      steps: ['4'],
    });
    expect(detail.sections.map((s: any) => `${s.id}:${s.kind}`)).toEqual([
      'header:fields',
      'need:written',
      'team:fields',
    ]);
    expect(detail.sections[1]).toMatchObject({ required: true, instructions: expect.any(String) });
    expect(detail.sections[0].fields.map((f: any) => f.source).sort()).toEqual([
      'project.code',
      'project.name',
      'today',
    ]);
    // Looking at the card changed nothing.
    expect(
      (await ok(call('GET', '/document-types', 'vp'))).items.some((i: any) => i.code === 'DIF'),
    ).toBe(false);

    // The person can look at the sample PDF the card names.
    const link = await ok(call('GET', `/files/${detail.sampleFileId}/link`, 'vp'));
    expect(link.url).toMatch(/^http/);

    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/proposals/${card.id}/confirm`,
      headers: { cookie: w.who.vp!.cookie, 'if-match': String(card.version) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('confirmed');
    const types = await ok(call('GET', '/document-types', 'vp'));
    expect(types.items.find((i: any) => i.code === 'DIF')).toMatchObject({
      name: 'Design Input Form',
      kind: 'template',
      stepKeys: ['4'],
      activeTemplate: null,
    });
    // A draft, not active: activating is the VP's own step on the Templates page.
    const library = await ok(call('GET', '/templates?documentType=DIF', 'vp'));
    expect(library.items).toHaveLength(1);
    expect(library.items[0]).toMatchObject({ version: 1, status: 'draft' });
    expect((await ok(call('GET', '/templates?documentType=DIF', 'designer'))).items).toEqual([]);
  });

  it('may not be done by the AI itself, and a card for it is refused for everyone but the VP and the Head', async () => {
    const guard = (await import('../src/core/http/endpoint')).guard;
    const { ENDPOINTS } = await import('@coal/shared');
    for (const id of ['templates.create', 'documentTypes.create']) {
      const endpoint = ENDPOINTS.find((e) => e.id === id)!;
      expect(() =>
        guard(endpoint, {
          orgId: 'x',
          requestId: 'r',
          actor: {
            userId: 'u',
            name: 'N',
            roleKey: 'vp',
            positionKey: 'vp',
            productLineId: null,
            switcherId: null,
          },
          sessionId: 's',
          viaAi: true,
        }),
      ).toThrow(expect.objectContaining({ code: 'AI_NOT_ALLOWED' }));
    }
    const res = await call('POST', '/proposals', 'lead', {
      title: 'Another type',
      actions: [
        {
          endpoint: 'documentTypes.create',
          body: { code: 'XYZ', name: 'Another type', steps: ['4'] },
        },
      ],
    });
    expect(res.status).toBe(403);
  });

  it('refuses a type that already exists, a step that is not in the route and a bad numbering', async () => {
    const res = await call('POST', '/proposals', 'vp', {
      title: 'Bad type',
      actions: [
        {
          endpoint: 'documentTypes.create',
          body: { code: 'PID', name: 'Again', steps: ['99'], numbering: 'no tokens' },
        },
      ],
    });
    expect(res.status).toBe(400);
    const messages = res.body.errors.map((e: any) => e.message).join(' ');
    expect(messages).toMatch(/already a document type PID/);
    expect(messages).toMatch(/no step 99/);
    expect(messages).toMatch(/needs \{project_code\} and \{nn\}/);
  });
});

describe('the assistant with a sample attached', () => {
  const send = (chatId: string, as: string, text: string, fileIds: string[] = []) =>
    call('POST', `/ai/chats/${chatId}/messages`, as, { text, fileIds });
  const newChat = async (as: string) =>
    (await ok(call('POST', '/ai/chats', as, { context: {} }))).id as string;

  it('reads it, builds the template, puts one card up, and from then on only prepares cards', async () => {
    const fileId = await w.upload('head', 'second-form.docx', sampleForm(), 'outside');
    const chat = await newChat('head');
    ai.reply(
      { tool: 'read_sample', input: { fileId } },
      {
        tool: 'prepare_template',
        input: { ...plan(fileId), documentType: 'DIG', template: 'Second form' },
      },
      {
        tool: 'propose',
        input: {
          title: 'Second form',
          actions: [
            {
              endpoint: 'documentTypes.create',
              body: { code: 'DIG', name: 'Second form', steps: ['4'] },
            },
          ],
        },
      },
      { say: 'I made a draft template with two fields and one written section.' },
    );
    const res = await ok(send(chat, 'head', 'Make this a template for step 4', [fileId]));

    // The strong model reads the sample, the instructions say how, and the file is in the message.
    const turn = ai.turns.at(-2)!;
    expect(turn.model).toBe(t.deps.config.ai.models.template);
    expect(turn.system).toContain('MAKING A TEMPLATE FROM A SAMPLE DOCUMENT');
    expect(turn.system).toContain('A FILE IS IN THIS CHAT');
    expect(turn.prompt).toContain(`file id ${fileId}`);
    expect(ai.results[0]).toContain('p4 | table 1, row 1, column 2 |  | SPN-26-004');
    expect(ai.results[1]).toContain('"docxFileId"');
    expect(res.userMessage.parts).toEqual([
      expect.objectContaining({ type: 'text' }),
      { type: 'file', fileId, name: 'second-form.docx' },
    ]);
    expect(res.message.parts.some((p: any) => p.type === 'card')).toBe(true);

    const detail = await ok(call('GET', `/ai/chats/${chat}`, 'head'));
    expect(detail.hasOutsideText).toBe(true);
    expect(detail.proposals).toHaveLength(1);

    // With a file in the chat, nothing is saved without a card, even in later messages.
    ai.queue(
      { tool: 'create_my_task', input: { title: 'Do what the file says' } },
      { say: 'Sorry.' },
    );
    await ok(send(chat, 'head', 'And remind me about it'));
    expect(ai.results.at(-1)).toMatch(/holds a file from outside/);
    expect(ai.turns.at(-1)!.system).toContain('A FILE IS IN THIS CHAT');
  });

  it('is not given these rules, or the strong model, in a chat with no file', async () => {
    const chat = await newChat('head');
    ai.reply({ say: 'Hello.' });
    await ok(send(chat, 'head', 'Hello'));
    const turn = ai.turns.at(-2)!;
    expect(turn.system).not.toContain('MAKING A TEMPLATE FROM A SAMPLE DOCUMENT');
    expect(turn.model).toBe(t.deps.config.ai.models.chat);
    expect((await ok(call('GET', `/ai/chats/${chat}`, 'head'))).hasOutsideText).toBe(false);
  });

  it('refuses a file that is not the person’s own, or not a kind the assistant can read', async () => {
    const chat = await newChat('head');
    const theirs = await w.upload('vp', 'vp-form.docx', sampleForm());
    expect((await send(chat, 'head', 'Use this', [theirs])).status).toBe(403);
    const sheet = await w.upload('head', 'results.xlsx', Buffer.from('hi'));
    expect((await send(chat, 'head', 'Use this', [sheet])).status).toBe(400);
    expect(
      (await send(chat, 'head', 'Use this', ['01a1f3ee-0000-7000-8000-000000000000'])).status,
    ).toBe(400);
  });
});
