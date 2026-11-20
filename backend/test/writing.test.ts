import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ORG_ID } from '../src/core/config';
import { systemContext } from '../src/core/http/context';
import { loadSampleTemplates } from '../src/modules/templates/service';
import { createTestApp, type TestApp } from './helpers';
import { ScriptedAi } from './fakes';
import { createWorld, type World } from './world';

let t: TestApp;
let w: World;
const ai = new ScriptedAi();
let projectId: string;

beforeAll(async () => {
  t = await createTestApp({ AI_MAX_TOOL_CALLS: '8' }, { ai });
  w = await createWorld(t);
  await loadSampleTemplates(t.deps, systemContext(DEFAULT_ORG_ID));
  projectId = await w.go('Quokka cervical plate');
}, 60_000);
afterAll(async () => {
  await t?.close();
});
afterEach(() => {
  expect(ai.pending).toBe(0);
});

const call = (...args: Parameters<World['call']>) => w.call(...args);
const ok = (res: Promise<{ status: number; body: any }>) => w.ok(res);
const newChat = async (as: string, context: Record<string, unknown> = {}) =>
  (await ok(call('POST', '/ai/chats', as, { context }))).id as string;
const send = (chatId: string, as: string, text: string, fileIds: string[] = []) =>
  call('POST', `/ai/chats/${chatId}/messages`, as, { text, fileIds });

/** A new draft of the Project Initiation Document, made as the person (not by the assistant). */
const makeDoc = async (as = 'lead') =>
  (
    await ok(
      call('POST', `/projects/${projectId}/documents`, as, { stepKey: '1', documentType: 'PID' }),
    )
  ).id as string;

const parts = (message: any, type: string) => message.parts.filter((p: any) => p.type === type);

describe('drafting a document with the assistant', () => {
  it('starts one from the active template, as the person, and says what the template needs', async () => {
    const chat = await newChat('lead', { projectId });
    ai.reply(
      { tool: 'active_template', input: { documentType: 'PID' } },
      { tool: 'start_draft', input: { projectId, stepKey: '1', documentType: 'PID' } },
      { say: 'I started the draft.' },
    );
    await ok(send(chat, 'lead', 'Draft the PID for this project'));
    const started = JSON.parse(ai.results.at(-1)!).result;
    expect(started).toMatchObject({
      template: expect.stringContaining('Project Initiation'),
      number: expect.any(String),
    });
    expect(started.writtenSections.map((s: any) => s.id)).toContain('purpose');
    expect(started.fieldsThePersonGives.map((f: any) => f.name)).toContain('target_markets');
    // COAL fills what it holds records for, so the assistant never writes those.
    expect(started.filledByCoal).toContain('project_code');

    const doc = await ok(call('GET', `/documents/${started.documentId}`, 'lead'));
    expect(doc.createdBy.name).toBe('Leela Example');
    expect(doc.versions[0]).toMatchObject({ versionNo: 1, viaAi: true });
    expect(doc.current.aiSections).toEqual([]);
  });

  it('saves what it wrote, marks those sections, and keeps the marks until a person changes them', async () => {
    const id = await makeDoc();
    const chat = await newChat('lead', { projectId });
    ai.reply(
      {
        tool: 'save_draft',
        input: {
          documentId: id,
          sections: { purpose: 'Surgeons asked for a 2.4 mm plate for fusion at C3 to C7.' },
          fields: { target_markets: 'India and Nepal' },
        },
      },
      { say: 'Saved. The purpose section is from what you told me.' },
    );
    const reply = await ok(
      send(
        chat,
        'lead',
        'The plate should be 2.4 mm thick. Target markets are India and Nepal. Draft the purpose.',
      ),
    );
    const saved = JSON.parse(ai.results.at(-1)!).result;
    expect(saved).toMatchObject({ version: 2, status: 'draft', writtenByAssistant: ['purpose'] });
    expect(parts(reply.message, 'draft')).toEqual([
      expect.objectContaining({ documentId: id, versionNo: 2, projectId, gaps: expect.any(Array) }),
    ]);

    let doc = await ok(call('GET', `/documents/${id}`, 'lead'));
    expect(doc.current).toMatchObject({ versionNo: 2, viaAi: true, aiSections: ['purpose'] });
    expect(doc.current.content.sections.purpose).toMatch(/2\.4 mm/);
    expect(doc.current.content.fields.target_markets).toBe('India and Nepal');

    // A person's own change to another part keeps the mark; changing the section takes it away.
    doc = await ok(
      call('POST', `/documents/${id}/versions`, 'lead', { fields: { target_markets: 'India' } }),
    );
    expect(doc.current).toMatchObject({ versionNo: 3, viaAi: false, aiSections: ['purpose'] });
    doc = await ok(
      call('POST', `/documents/${id}/versions`, 'lead', { sections: { purpose: 'My own words.' } }),
    );
    expect(doc.current).toMatchObject({ versionNo: 4, aiSections: [] });
  });

  it('refuses a number no source gave, a field in words the person did not use, and a field COAL fills', async () => {
    const id = await makeDoc();
    const chat = await newChat('lead', { projectId });
    ai.reply(
      { tool: 'save_draft', input: { documentId: id, sections: { purpose: 'A 450 MPa plate.' } } },
      {
        tool: 'save_draft',
        input: { documentId: id, fields: { target_markets: 'Germany and Brazil' } },
      },
      { tool: 'save_draft', input: { documentId: id, fields: { project_code: 'SPN-26-009' } } },
      { say: 'I could not save that.' },
    );
    const reply = await ok(send(chat, 'lead', 'Draft the purpose for me'));
    const [number, words, record] = ai.results.slice(-3);
    expect(number).toMatch(/states 450, which no source gave/);
    expect(words).toMatch(/must be what the person told you/);
    expect(record).toMatch(/filled from COAL's records/);
    expect(parts(reply.message, 'draft')).toEqual([]);
    // Nothing was saved.
    const doc = await ok(call('GET', `/documents/${id}`, 'lead'));
    expect(doc.versions).toHaveLength(1);
  });

  it('lets a number through when a tool read it in this reply', async () => {
    const id = await makeDoc();
    const chat = await newChat('lead', { projectId });
    ai.reply(
      { tool: 'get_timeline', input: { projectId } },
      {
        tool: 'save_draft',
        input: { documentId: id, sections: { purpose: 'The plan has 25 steps.' } },
      },
      { say: 'Saved.' },
    );
    const timeline = JSON.stringify(
      await ok(call('GET', `/projects/${projectId}/timeline`, 'lead')),
    );
    expect(timeline).toContain('"key":"25"');
    await ok(send(chat, 'lead', 'Draft the purpose'));
    expect(JSON.parse(ai.results.at(-1)!).result.version).toBe(2);
  });

  it('is refused for someone who may not write on that step, and in a chat holding an outside file', async () => {
    const id = await makeDoc();
    const chat = await newChat('qa');
    ai.reply(
      { tool: 'save_draft', input: { documentId: id, sections: { purpose: 'Words.' } } },
      { say: 'I am not allowed.' },
    );
    await ok(send(chat, 'qa', 'Write the purpose'));
    expect(ai.results.at(-1)).toMatch(/Not allowed|Failed/);

    const file = await w.upload(
      'lead',
      'outside.docx',
      Buffer.from('PK\x03\x04 not really'),
      'outside',
    );
    const outside = await newChat('lead', { projectId });
    ai.reply(
      { tool: 'save_draft', input: { documentId: id, sections: { purpose: 'From the file.' } } },
      { say: 'I can only prepare cards now.' },
    );
    await ok(send(outside, 'lead', 'Use this file to write the purpose', [file]));
    expect(ai.results.at(-1)).toMatch(/holds a file from outside/);
    expect((await ok(call('GET', `/documents/${id}`, 'lead'))).versions).toHaveLength(1);
  });

  it('tells it what a document still lacks and which sections it wrote', async () => {
    const id = await makeDoc();
    await ok(
      call('POST', `/documents/${id}/versions`, 'lead', {
        sections: { purpose: 'A short purpose.' },
      }),
    );
    const chat = await newChat('lead', { projectId });
    ai.reply(
      { tool: 'read_document', input: { documentId: id } },
      { say: 'It lacks the target markets.' },
    );
    await ok(send(chat, 'lead', 'Is anything missing from this document?'));
    const read = JSON.parse(ai.results.at(-1)!).result;
    expect(read.current.gaps).toEqual(['Target markets']);
    expect(read.current.writtenByAssistant).toEqual([]);
  });
});

describe('turning an idea into a project', () => {
  const idea = (extra: Record<string, unknown> = {}) => ({
    name: 'Cervical plate, low profile',
    description: 'Need: a thinner plate. Target markets: India.',
    productLineId: w.spine,
    teamUserIds: [] as string[],
    ...extra,
  });

  it('previews what Go would do, for anyone to see, and creates nothing', async () => {
    const before = (await ok(call('GET', '/projects?limit=100', 'vp'))).items.length;
    const preview = await ok(call('POST', '/projects/preview', 'vp', idea()));
    expect(preview.preview.steps.length).toBeGreaterThan(0);
    expect(preview.preview.tasks.length).toBeGreaterThan(0);
    expect((await ok(call('GET', '/projects?limit=100', 'vp'))).items).toHaveLength(before);
    // Only those who may press Go can ask what it would do.
    expect((await call('POST', '/projects/preview', 'designer', idea())).status).toBe(403);
  });

  it('works the idea out for the VP as a card with the people who would get work, never creating it', async () => {
    const before = (await ok(call('GET', '/projects?limit=100', 'vp'))).items.length;
    const chat = await newChat('vp');
    ai.reply(
      { tool: 'list_product_lines', input: {} },
      { tool: 'preview_project', input: idea() },
      { say: 'I worked it out. Review it and press Go.' },
    );
    const reply = await ok(send(chat, 'vp', 'I have an idea: a thinner cervical plate for Spine'));
    const worked = JSON.parse(ai.results.at(-1)!).result;
    expect(worked.tasks.length).toBeGreaterThan(0);
    expect(worked.note).toMatch(/Nothing has been created/);
    const [card] = parts(reply.message, 'idea');
    expect(card).toMatchObject({
      name: 'Cervical plate, low profile',
      productLineId: w.spine,
      preview: { steps: expect.any(Array), tasks: expect.any(Array) },
    });
    expect((await ok(call('GET', '/projects?limit=100', 'vp'))).items).toHaveLength(before);
    // The card is kept with the chat.
    const saved = await ok(call('GET', `/ai/chats/${chat}`, 'vp'));
    expect(parts(saved.messages.at(-1), 'idea')).toHaveLength(1);
  });

  it('is refused for anyone but the VP, naming who can', async () => {
    const chat = await newChat('lead');
    ai.reply({ tool: 'preview_project', input: idea() }, { say: 'Only the VP can.' });
    await ok(send(chat, 'lead', 'I have an idea for a new product'));
    expect(ai.results.at(-1)).toMatch(/Not allowed/);
  });

  it('cannot create the project itself: Go is closed to the assistant', async () => {
    const chat = await newChat('vp');
    ai.reply(
      {
        tool: 'propose',
        input: { title: 'Go for it', actions: [{ endpoint: 'projects.create', body: idea() }] },
      },
      { say: 'I cannot press Go for you.' },
    );
    await ok(send(chat, 'vp', 'Create it'));
    expect(ai.results.at(-1)).toMatch(/can't be put on an action card/);
  });
});

describe('what the assistant is told', () => {
  it('has the writing rules and its tools in every chat', async () => {
    const chat = await newChat('lead');
    ai.reply({ say: 'Hello.' });
    await ok(send(chat, 'lead', 'Hello'));
    const turn = ai.turns.at(-2)!;
    expect(turn.system).toContain('DRAFTING A DOCUMENT');
    expect(turn.system).toContain('AN IDEA FOR A NEW PRODUCT');
    expect(turn.system).toContain('EXPLAINING AND CHECKING DOCUMENTS');
    expect(turn.tools.map((x) => x.name)).toEqual(
      expect.arrayContaining([
        'start_draft',
        'save_draft',
        'preview_project',
        'list_product_lines',
      ]),
    );
  });
});
