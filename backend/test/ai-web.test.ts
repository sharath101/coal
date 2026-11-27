import { WEB_VERSION_NOTE } from '@coal/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ORG_ID, loadConfig } from '../src/core/config';
import { systemContext } from '../src/core/http/context';
import { webAvailable } from '../src/modules/ai/service';
import { aiRequests, aiToolCalls, aiWebLookups } from '../src/modules/ai/tables';
import { shapeReport } from '../src/modules/ai/web';
import { auditEvents } from '../src/modules/audit/tables';
import { buildDocx } from '../src/modules/templates/docx-builder';
import { loadSampleTemplates } from '../src/modules/templates/service';
import { ScriptedAi, type ScriptedWeb } from './fakes';
import { createTestApp, type TestApp } from './helpers';
import { createWorld, type World } from './world';

/**
 * Looking things up on the web (docs/workstation-and-ai.md#looking-things-up-on-the-web): only a
 * checked brief leaves COAL, the web assistant sees nothing else, its report comes back shaped and
 * as outside material, and web facts reach a document only on a card the person checks.
 */
let t: TestApp;
let w: World;
const ai = new ScriptedAi();
let projectId: string;
let projectCode: string;

const PAGE = 'https://standards.example.org/spinal-constructs';
const OTHER = 'https://news.example.com/cages';
const REPORT = [
  'ANSWER',
  `A made-up standard asks for a static and a fatigue test of the construct [${PAGE}].`,
  'FINDINGS',
  `- The fatigue test runs to 5,000,000 cycles at 250 N [${PAGE}]`,
  '- A claim with no page at all',
  '- A claim on a page no search returned [https://invented.example.net/x]',
  'NOT FOUND',
  '- The edition of the standard',
  'CAUTIONS',
  `- One page is a seller's page (${OTHER})`,
].join('\n');
const FOUND: ScriptedWeb = {
  text: REPORT,
  searches: ['spinal construct fatigue test standard'],
  pages: [
    { url: PAGE, title: 'Made-up standards page', date: 'March 2024', read: true },
    { url: OTHER, title: 'Made-up trade news', date: null, read: false },
  ],
};
const BRIEF = {
  question: 'What fatigue test must a spinal construct pass under ASTM F1717?',
  lookFor: ['the test, its cycles and its load'],
  prefer: ['standards'],
};

/** A made-up form with an instruction to replace, as the approved PID. */
const FORM = buildDocx(
  [
    { type: 'title', text: 'Project Initiation Document' },
    { type: 'heading', text: 'Purpose' },
    { type: 'text', text: '[Describe the clinical need here.]' },
  ],
  'Made-up form',
);

beforeAll(async () => {
  t = await createTestApp({ AI_MAX_TOOL_CALLS: '10' }, { ai });
  w = await createWorld(t);
  await loadSampleTemplates(t.deps, systemContext(DEFAULT_ORG_ID));
  const template = await w.ok(
    w.call('POST', '/templates', 'vp', {
      documentType: 'PID',
      docxFileId: await w.upload('vp', 'pid-form.docx', new Uint8Array(FORM)),
    }),
  );
  await w.ok(w.call('POST', `/templates/${template.id}/activate`, 'vp'));
  projectId = await w.go('Quokka spine plate');
  projectCode = (await w.ok(w.call('GET', `/projects/${projectId}`, 'vp'))).code;
}, 60_000);
afterAll(async () => {
  await t?.close();
});
afterEach(() => {
  // A leftover script would be played in the next test's turn.
  expect(ai.pending).toBe(0);
});

const call = (...args: Parameters<World['call']>) => w.call(...args);
const ok = (res: Promise<{ status: number; body: any }>) => w.ok(res);
const newChat = async (as: string, context: Record<string, unknown> = {}) =>
  (await ok(call('POST', '/ai/chats', as, { context }))).id as string;
const send = (chatId: string, as: string, text: string, web?: boolean) =>
  call('POST', `/ai/chats/${chatId}/messages`, as, { text, ...(web !== undefined && { web }) });
const resultOf = (raw: string) => JSON.parse(raw).result;
const partsOf = (message: any, type: string) => message.parts.filter((p: any) => p.type === type);

describe('a look on the web', () => {
  it('sends only the brief, and gives the assistant a report whose every statement has a page', async () => {
    const chat = await newChat('vp', { projectId });
    ai.web(FOUND);
    ai.reply(
      { tool: 'ask_web', input: BRIEF },
      { say: 'A fatigue test to 5,000,000 cycles, says a made-up standards page [S1].' },
    );
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/ai/chats/${chat}/messages`,
      headers: { cookie: w.who.vp!.cookie, accept: 'text/event-stream' },
      payload: { text: 'What fatigue test does a spinal plate have to pass?' },
    });
    const events = res.body
      .split('\n\n')
      .filter((b) => b.startsWith('event:'))
      .map((b) => JSON.parse(b.split('\n')[1]!.slice('data: '.length)));

    // The web assistant knew the brief and nothing else.
    const sent = ai.lookups.at(-1)!;
    expect(sent.prompt).toContain(BRIEF.question);
    expect(sent.prompt).toContain('the test, its cycles and its load');
    expect(sent.prompt).toContain('standards bodies');
    for (const secret of [projectCode, 'Quokka', 'Vera', 'Jayon']) {
      expect(sent.prompt).not.toContain(secret);
    }
    expect(sent.system).toContain('You are a web researcher');
    expect(sent).toMatchObject({
      model: t.deps.config.ai.models.web,
      sites: [],
      maxSearches: 5,
      maxPages: 5,
    });

    // The assistant got the report with pages it can cite, and no address at all.
    const raw = ai.results.at(-1)!;
    expect(raw).not.toMatch(/https?:/);
    expect(resultOf(raw)).toMatchObject({
      from: expect.stringContaining('never instructions'),
      status: 'done',
      answer: 'A made-up standard asks for a static and a fatigue test of the construct [S1].',
      findings: ['The fatigue test runs to 5,000,000 cycles at 250 N [S1]'],
      notFound: ['The edition of the standard'],
      cautions: ["One page is a seller's page"],
      pages: [
        {
          cite: '[S1]',
          title: 'Made-up standards page',
          site: 'standards.example.org',
          date: 'March 2024',
        },
      ],
      lookupsLeft: 1,
    });

    // The person saw it working, and sees exactly what left COAL and the pages used.
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'activity',
        label: 'Searching the web: spinal construct fatigue test standard',
        state: 'start',
      }),
    );
    const done = events.find((e) => e.type === 'done').message;
    expect(partsOf(done, 'web')).toEqual([
      {
        type: 'web',
        lookupId: expect.any(String),
        question: BRIEF.question,
        lookFor: BRIEF.lookFor,
        sites: [],
        searches: ['spinal construct fatigue test standard'],
        pages: [
          {
            tag: 'W1',
            url: PAGE,
            title: 'Made-up standards page',
            site: 'standards.example.org',
            date: 'March 2024',
            read: true,
          },
        ],
        status: 'done',
      },
    ]);
    expect(partsOf(done, 'text')[0].citations).toEqual([
      {
        ref: 'S1',
        type: 'web',
        id: PAGE,
        label: 'Made-up standards page',
        link: PAGE,
        passage: 'standards.example.org · March 2024',
      },
    ]);

    // What left, what it cost and who asked are recorded; the chat now used the web.
    expect(await ok(call('GET', `/ai/chats/${chat}`, 'vp'))).toMatchObject({
      webOn: true,
      usedWeb: true,
    });
    const [lookup] = await t.deps.db
      .select()
      .from(aiWebLookups)
      .where(eq(aiWebLookups.chatId, chat));
    expect(lookup).toMatchObject({ round: 1, status: 'done', followUpOf: null });
    expect(lookup!.brief).toMatchObject({ question: BRIEF.question });
    const [web] = await t.deps.db
      .select()
      .from(aiRequests)
      .where(and(eq(aiRequests.chatId, chat), eq(aiRequests.purpose, 'web')));
    expect(web!.promptVersion).toMatch(/^w1-/);
    expect(Number(web!.costUsd)).toBeGreaterThan(0.01);
    const outside = await t.deps.db
      .select()
      .from(aiToolCalls)
      .where(eq(aiToolCalls.requestId, web!.id));
    expect(outside.map((c) => [c.tool, c.endpoint, c.tier, c.input])).toEqual([
      ['web_search', 'outside:web', 'outside', { query: 'spinal construct fatigue test standard' }],
      ['web_fetch', 'outside:web', 'outside', { url: PAGE }],
    ]);
    const [asked] = await t.deps.db
      .select()
      .from(aiToolCalls)
      .where(and(eq(aiToolCalls.requestId, lookup!.requestId), eq(aiToolCalls.tool, 'ask_web')));
    expect(asked).toMatchObject({
      endpoint: 'ai.web.lookUp',
      tier: 'auto',
      recordsReturned: [{ type: 'web', id: PAGE }],
    });
    const [audited] = await t.deps.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'ai.web_lookup'), eq(auditEvents.recordId, lookup!.id)));
    expect(audited).toMatchObject({ actorType: 'user_via_ai' });
    const refusal = (query: PromiseLike<unknown>) =>
      Promise.resolve(query).then(
        () => 'allowed',
        (e: Error & { cause?: Error }) => `${e.message} ${e.cause?.message ?? ''}`,
      );
    const mine = eq(aiWebLookups.id, lookup!.id);
    expect(
      await refusal(t.deps.db.update(aiWebLookups).set({ status: 'failed' }).where(mine)),
    ).toMatch(/insert-only/);
    expect(await refusal(t.deps.db.delete(aiWebLookups).where(mine))).toMatch(/insert-only/);
  });

  it("refuses a brief with a project, a person or a figure from COAL's records, and sends nothing", async () => {
    const chat = await newChat('vp', { projectId });
    ai.reply({ say: 'The made-up budget is 4,50,000 rupees.' });
    await ok(send(chat, 'vp', 'What is the budget?'));
    const before = ai.lookups.length;
    ai.queue(
      {
        tool: 'ask_web',
        input: {
          question: `Which products compete with ${projectCode} today?`,
          lookFor: ['makers'],
        },
      },
      {
        tool: 'ask_web',
        input: {
          question: 'Which plates compete with the Quokka spine plate?',
          lookFor: ['makers'],
        },
      },
      {
        tool: 'ask_web',
        input: { question: 'Which papers on plates did Hari Example write?', lookFor: ['titles'] },
      },
      {
        tool: 'ask_web',
        input: { question: 'Is a budget of 450000 rupees usual for a plate?', lookFor: ['ranges'] },
      },
      { say: 'I could not send those.' },
    );
    await ok(send(chat, 'vp', 'Who competes with us, and is our budget normal?'));
    const refused = ai.results.slice(-4);
    for (const r of refused) expect(r).toMatch(/^Failed \(VALIDATION_FAILED\): Nothing was sent/);
    expect(refused[0]).toMatch(/a project code/);
    expect(refused[1]).toContain('Quokka spine plate');
    expect(refused[2]).toContain('Hari Example');
    expect(refused[3]).toMatch(/450000, from COAL's records/);
    expect(ai.lookups.length).toBe(before);
    expect((await ok(call('GET', `/ai/chats/${chat}`, 'vp'))).usedWeb).toBe(false);
  });

  it('makes at most two lookups in a reply, and tells the web assistant what the first one found', async () => {
    const chat = await newChat('head', { projectId });
    const before = ai.lookups.length;
    ai.web(FOUND, {
      text: `ANSWER\nThe made-up standard's edition is from 2024 [${PAGE}].`,
      searches: ['spinal construct standard edition'],
      pages: [{ url: PAGE, title: 'Made-up standards page', date: 'March 2024', read: false }],
    });
    ai.reply(
      { tool: 'ask_web', input: BRIEF },
      {
        tool: 'ask_web',
        input: (results: string[]) => ({
          question: 'Which edition of ASTM F1717 is the current one?',
          lookFor: ['the edition and its year'],
          followUp: resultOf(results[0]!).lookupId,
        }),
      },
      {
        tool: 'ask_web',
        input: { question: 'What do spinal cages weigh on average?', lookFor: ['grams'] },
      },
      { say: 'Done.' },
    );
    await ok(send(chat, 'head', 'Look it up, and find the edition too'));
    const [first, second, third] = ai.results.slice(-3);
    expect(resultOf(first!).lookupsLeft).toBe(1);
    expect(resultOf(second!)).toMatchObject({
      lookupsLeft: 0,
      answer: expect.stringContaining('2024'),
    });
    expect(third).toMatch(/^Failed \(WEB_LIMIT\)/);
    expect(ai.lookups.length).toBe(before + 2);
    const followUp = ai.lookups.at(-1)!.prompt;
    expect(followUp).toContain('A FIRST LOOKUP FOUND THIS');
    expect(followUp).toContain('spinal construct fatigue test standard');
    expect(followUp).toContain(PAGE);
    const rows = await t.deps.db.select().from(aiWebLookups).where(eq(aiWebLookups.chatId, chat));
    const firstId = resultOf(first!).lookupId;
    expect(rows.map((r) => [r.round, r.followUpOf]).sort()).toEqual([
      [1, null],
      [2, firstId],
    ]);
  });

  it('is offered only while the Web switch is on, and the chat keeps the switch', async () => {
    const chat = await newChat('pme');
    ai.reply({ say: 'I cannot check that here.' });
    await ok(send(chat, 'pme', 'What does ISO 13485 say about design reviews?', false));
    const off = ai.turns.at(-2)!;
    expect(off.tools.map((x) => x.name)).not.toContain('ask_web');
    expect(off.system).toContain('switched Web off');
    expect((await ok(call('GET', `/ai/chats/${chat}`, 'pme'))).webOn).toBe(false);

    ai.queue({ say: 'Still off.' });
    await ok(send(chat, 'pme', 'And now?'));
    expect(ai.turns.at(-1)!.tools.map((x) => x.name)).not.toContain('ask_web');

    ai.queue({ say: 'On again.' });
    await ok(send(chat, 'pme', 'Look it up', true));
    const on = ai.turns.at(-1)!;
    expect(on.tools.map((x) => x.name)).toContain('ask_web');
    expect(on.system).toContain('LOOKING THINGS UP ON THE WEB');
    expect((await ok(call('GET', '/me', 'pme'))).features.aiWeb).toBe(true);
  });

  it('is there only where it is switched on and the provider can search the web', () => {
    expect(webAvailable({ config: t.deps.config, ai })).toBe(true);
    expect(webAvailable({ config: loadConfig({ NODE_ENV: 'test', AI_WEB: 'false' }), ai })).toBe(
      false,
    );
    const noWeb = { name: 'scripted' as const, run: ai.run.bind(ai) };
    expect(webAvailable({ config: t.deps.config, ai: noWeb })).toBe(false);
  });

  it('is asked only by the assistant, inside the person’s own chat', async () => {
    const chat = await newChat('pme');
    const body = {
      question: 'What does ISO 13485 require of design reviews?',
      lookFor: ['the clause'],
    };
    const direct = await call('POST', `/ai/chats/${chat}/web-lookups`, 'pme', body);
    expect(direct.status).toBe(403);
    expect(direct.body).toMatchObject({
      code: 'NOT_ALLOWED',
      detail: expect.stringMatching(/Only the assistant/),
    });
    const other = await call('POST', `/ai/chats/${chat}/web-lookups`, 'designer', body);
    expect(other.status).toBe(403);
    expect(other.body.whoCan).toEqual(['The person who started the chat']);
  });

  it('stops when the person stops the reply, and keeps what it was', async () => {
    const chat = await newChat('ops');
    const before = ai.lookups.length;
    ai.web({ ...FOUND, hold: new Promise(() => undefined) });
    ai.queue({ tool: 'ask_web', input: BRIEF });
    const pending = send(chat, 'ops', 'Look it up');
    for (let i = 0; i < 200 && ai.lookups.length === before; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect((await ok(call('POST', `/ai/chats/${chat}/stop`, 'ops'))).stopped).toBe(true);
    const res = await pending;
    expect(res.body.message).toMatchObject({ stopped: true });
    const [lookup] = await t.deps.db
      .select()
      .from(aiWebLookups)
      .where(eq(aiWebLookups.chatId, chat));
    expect(lookup).toMatchObject({ status: 'stopped' });
  });
});

describe('after a look on the web', () => {
  it('only prepares cards, for the rest of the reply and of the chat', async () => {
    const chat = await newChat('vp', { projectId });
    ai.web(FOUND);
    ai.reply(
      { tool: 'ask_web', input: BRIEF },
      { tool: 'create_my_task', input: { title: 'Read the made-up standard' } },
      {
        tool: 'propose',
        input: {
          title: 'Remind me',
          actions: [
            { endpoint: 'tasks.create', body: { title: 'Read the made-up standards page' } },
          ],
        },
      },
      { say: 'I prepared a card.' },
    );
    await ok(send(chat, 'vp', 'Look it up and remind me to read it'));
    const [, task, card] = ai.results.slice(-3);
    expect(task).toMatch(
      /This chat has used the web, so the assistant can only prepare action cards/,
    );
    expect(resultOf(card!).proposalId).toEqual(expect.any(String));
    const after = await ok(call('GET', `/ai/chats/${chat}`, 'vp'));
    expect(after.proposals).toMatchObject([{ fromWeb: true, preparedByAi: true }]);

    ai.queue(
      { tool: 'create_my_task', input: { title: 'Another reminder' } },
      { say: 'A card, then.' },
    );
    await ok(send(chat, 'vp', 'Remind me again'));
    expect(ai.results.at(-1)).toMatch(/This chat has used the web/);
    expect(ai.turns.at(-1)!.system).toContain('THIS CHAT HAS USED THE WEB');
  });

  it('starts a blank form, and puts facts from the web into it only through a card the person checks', async () => {
    const chat = await newChat('lead', { projectId });
    ai.web(FOUND);
    const instruction = (results: string[]) =>
      (resultOf(results[3]!).parts as string[])
        .find((line) => line.includes('Describe the clinical'))!
        .split(' | ')[0]!;
    const documentId = (results: string[]) => resultOf(results[2]!).documentId as string;
    const fill = (results: string[], text: string) => ({
      title: 'Fill in the purpose',
      actions: [
        {
          endpoint: 'documents.fillForm',
          params: { id: documentId(results) },
          body: { versionNo: 1, fills: [{ part: instruction(results), text }] },
        },
      ],
    });
    ai.reply(
      { tool: 'ask_web', input: BRIEF },
      {
        tool: 'start_form',
        input: { projectId, stepKey: '1', documentType: 'PID', title: 'Named from outside' },
      },
      { tool: 'start_form', input: { projectId, stepKey: '1', documentType: 'PID' } },
      { tool: 'read_form', input: (results: string[]) => ({ documentId: documentId(results) }) },
      {
        tool: 'fill_form',
        input: (results: string[]) => ({
          documentId: documentId(results),
          versionNo: 1,
          fills: [{ part: instruction(results), text: 'Straight in.' }],
        }),
      },
      {
        tool: 'propose',
        input: (results: string[]) =>
          fill(results, 'The plate must pass a fatigue test to 5,000,000 cycles at 250 N.'),
      },
      {
        tool: 'propose',
        input: (results: string[]) => fill(results, 'It must also carry 999 N.'),
      },
      { say: 'Check each fact from the web against its page before you confirm.' },
    );
    await ok(send(chat, 'lead', 'Look up the fatigue test and put it in the PID'));
    const results = ai.results.slice(-7);
    // A title could come from the outside text: only a blank copy of the approved form is started.
    expect(results[1]).toMatch(/This chat has used the web/);
    expect(resultOf(results[2]!)).toMatchObject({ versionNo: 1 });
    // Nothing is saved directly.
    expect(results[4]).toMatch(/This chat has used the web/);
    // The card shows exactly what goes in, and refuses a figure from nowhere.
    expect(resultOf(results[5]!).proposalId).toEqual(expect.any(String));
    expect(results[6]).toMatch(/states 999, which no source gave/);

    const [card] = (await ok(call('GET', `/ai/chats/${chat}`, 'lead'))).proposals;
    expect(card).toMatchObject({ fromWeb: true, status: 'pending' });
    expect(card.preview.actions[0]).toMatchObject({
      endpoint: 'documents.fillForm',
      summary: expect.stringMatching(/^Fill in 1 part of .+, saved as a new draft version/),
      detail: {
        kind: 'fill',
        versionNo: 1,
        fills: [
          {
            was: '[Describe the clinical need here.]',
            mode: 'replace',
            text: 'The plate must pass a fatigue test to 5,000,000 cycles at 250 N.',
          },
        ],
      },
    });
    const docId = card.preview.actions[0].detail.documentId;
    expect((await ok(call('GET', `/documents/${docId}`, 'lead'))).versions).toHaveLength(1);

    // The person confirms: a new draft, written by the assistant, that says it holds web facts.
    const confirmed = await t.app.inject({
      method: 'POST',
      url: `/api/v1/proposals/${card.id}/confirm`,
      headers: { cookie: w.who.lead!.cookie, 'if-match': String(card.version) },
    });
    expect(confirmed.statusCode).toBe(200);
    const doc = await ok(call('GET', `/documents/${docId}`, 'lead'));
    expect(doc.versions).toHaveLength(2);
    expect(doc.versions[0]).toMatchObject({ versionNo: 2, viaAi: true });
    expect(doc.versions[0].note).toContain(WEB_VERSION_NOTE);
  });
});

describe('the report, as COAL hands it on', () => {
  const pages = [
    { url: 'https://a.example.org/x', title: 'A', date: null, read: true },
    { url: 'https://b.example.org/y/', title: 'B', date: '2025', read: false },
  ];

  it('reads a report with no headings, or with Markdown, and matches addresses loosely', () => {
    expect(shapeReport('It is so [https://a.example.org/x].', pages).answer).toBe('It is so [W1].');
    const shaped = shapeReport(
      '## ANSWER:\nYes (https://b.example.org/y).\n**FINDINGS**\n1. One https://a.example.org/x#part\n2. Two <https://b.example.org/y/>',
      pages,
    );
    expect(shaped.answer).toBe('Yes [W1].');
    expect(shaped.findings).toEqual(['One [W2]', 'Two [W1]']);
    expect(shaped.pages.map((p) => [p.tag, p.site])).toEqual([
      ['W1', 'b.example.org'],
      ['W2', 'a.example.org'],
    ]);
  });

  it('drops an answer with no page, keeps a long finding’s tag, and lists read pages it did not cite', () => {
    const shaped = shapeReport(
      `ANSWER\nNo page here.\nFINDINGS\n- ${'word '.repeat(200)}[https://a.example.org/x]`,
      pages,
    );
    expect(shaped.answer).toMatch(/no answer with a page/);
    expect(shaped.findings[0]).toMatch(/… \[W1\]$/);
    expect(shaped.findings[0]!.length).toBeLessThan(420);
    expect(shapeReport('ANSWER\nNothing.', pages).pages).toEqual([
      {
        tag: '',
        url: 'https://a.example.org/x',
        title: 'A',
        site: 'a.example.org',
        date: null,
        read: true,
      },
    ]);
  });
});
