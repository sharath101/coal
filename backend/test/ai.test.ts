import { ENDPOINTS, dateOfInstant } from '@coal/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ORG_ID } from '../src/core/config';
import { systemContext } from '../src/core/http/context';
import { aiChats, aiMessages, aiRequests, aiToolCalls } from '../src/modules/ai/tables';
import { aiToolDefs, proposableCatalogue } from '../src/modules/ai/tools';
import { withCitations } from '../src/modules/ai/turn';
import { auditEvents } from '../src/modules/audit/tables';
import { loadSampleTemplates } from '../src/modules/templates/service';
import { createTestApp, type TestApp } from './helpers';
import { ScriptedAi } from './fakes';
import { createWorld, type World } from './world';

let t: TestApp;
let w: World;
const ai = new ScriptedAi();
const clock = { now: new Date() };
let annexId: string;
let projectId: string;

beforeAll(async () => {
  t = await createTestApp(
    { AI_MAX_TOOL_CALLS: '3', AI_DAILY_BUDGET_USD: '1', TEMPLATE_FILLING: 'true' },
    { ai, now: () => clock.now },
  );
  w = await createWorld(t);
  await loadSampleTemplates(t.deps, systemContext(DEFAULT_ORG_ID));
  projectId = await w.go('Quokka spine plate');
  await w.advance(projectId, '4');
  const annex = await w.ok(
    w.call('POST', `/projects/${projectId}/documents`, 'lead', {
      stepKey: '5',
      documentType: 'BUDGET_ANNEX',
      title: 'Secret wombat costs',
    }),
  );
  annexId = annex.id;
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
const fresh = (name: string) => `${name} ${Math.random().toString(36).slice(2, 7)}`;
const id = (as: string) => w.who[as]!.user.id;
const newChat = async (as: string, context: Record<string, unknown> = {}) =>
  (await ok(call('POST', '/ai/chats', as, { context }))).id as string;
const send = (chatId: string, as: string, text: string) =>
  call('POST', `/ai/chats/${chatId}/messages`, as, { text });
const textOf = (message: any) => message.parts.find((p: any) => p.type === 'text')?.text as string;

/** Sends a message as an event stream, and returns the events. */
async function stream(chatId: string, as: string, text: string) {
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/v1/ai/chats/${chatId}/messages`,
    headers: { cookie: w.who[as]!.cookie, accept: 'text/event-stream' },
    payload: { text },
  });
  const events = res.body
    .split('\n\n')
    .filter((b) => b.startsWith('event:'))
    .map((b) => JSON.parse(b.split('\n')[1]!.slice('data: '.length)));
  return { res, events };
}

const until = async (done: () => boolean) => {
  for (let i = 0; i < 200 && !done(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(done()).toBe(true);
};

const requestsOf = async (chatId: string) =>
  (await t.deps.db.select().from(aiRequests).where(eq(aiRequests.chatId, chatId))).sort((a, b) =>
    a.purpose.localeCompare(b.purpose),
  );

describe('the AI is not set up', () => {
  it('says so, rather than failing', async () => {
    const bare = await createTestApp();
    try {
      const w2 = await createWorld(bare);
      const chat = await w2.ok(w2.call('POST', '/ai/chats', 'pme', { context: {} }));
      const res = await w2.call('POST', `/ai/chats/${chat.id}/messages`, 'pme', { text: 'Hello' });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('AI_UNAVAILABLE');
    } finally {
      await bare.close();
    }
  });
});

describe('chats', () => {
  it('are private to the person who started them', async () => {
    const mine = await newChat('pme');
    const other = await newChat('designer');
    expect((await call('GET', `/ai/chats/${mine}`, 'pme')).status).toBe(200);
    for (const as of ['designer', 'vp', 'head']) {
      const res = await call('GET', `/ai/chats/${mine}`, as);
      expect(res.status).toBe(403);
      expect(res.body.whoCan).toEqual(['The person who started the chat']);
      expect((await send(mine, as, 'Hello')).status).toBe(403);
      expect((await call('POST', `/ai/chats/${mine}/stop`, as)).status).toBe(403);
    }
    const listed = (await ok(call('GET', '/ai/chats', 'pme'))).items.map((c: any) => c.id);
    expect(listed).toContain(mine);
    expect(listed).not.toContain(other);
  });

  it('can be about a project, and are found by it', async () => {
    const chat = await newChat('lead', { projectId, stepKey: '5' });
    const found = await ok(call('GET', `/ai/chats?filter[project]=${projectId}`, 'lead'));
    expect(found.items.map((c: any) => c.id)).toContain(chat);
    expect(found.items[0].context).toEqual({ projectId, stepKey: '5' });
    expect(
      (await ok(call('GET', `/ai/chats?filter[project]=${projectId}`, 'designer'))).items,
    ).toEqual([]);
  });

  it('check what they are about', async () => {
    expect((await call('POST', '/ai/chats', 'pme', { context: { stepKey: '5' } })).status).toBe(
      400,
    );
    const nothing = '01a1f3ee-dd8c-721a-85c0-6460296a0905';
    expect(
      (await call('POST', '/ai/chats', 'pme', { context: { projectId: nothing } })).status,
    ).toBe(404);
    // The budget annex is for few: pinning a chat to it needs the right to open it.
    const denied = await call('POST', '/ai/chats', 'designer', {
      context: { documentId: annexId },
    });
    expect(denied.status).toBe(403);
    expect(
      (await call('POST', '/ai/chats', 'lead', { context: { documentId: annexId } })).status,
    ).toBe(201);
  });
});

describe('citations', () => {
  const record = (ref: string, label: string) => ({
    ref,
    type: 'task',
    id: label,
    label,
    link: '/tasks',
    passage: null,
  });
  const records = new Map([
    ['S1', record('S1', 'first')],
    ['S2', record('S2', 'second')],
    ['S3', record('S3', 'third')],
  ]);

  it('are numbered in the order the reply uses them, and made-up tags are dropped', () => {
    const { text, citations } = withCitations('A [S3] B [S1] C [S3][S9].', records);
    expect(text).toBe('A [S1] B [S2] C [S1].');
    expect(citations.map((c) => [c.ref, c.label])).toEqual([
      ['S1', 'third'],
      ['S2', 'first'],
    ]);
  });

  it('are left out when the reply cites nothing', () => {
    expect(withCitations('Plain words.', records)).toEqual({ text: 'Plain words.', citations: [] });
  });
});

describe('a reply', () => {
  it('comes from what the tools read, with citations, and everything is logged', async () => {
    const title = fresh('Polish the echidna fixture');
    await ok(call('POST', '/tasks', 'pme', { title }));
    const chat = await newChat('pme');
    ai.reply(
      { tool: 'my_tasks' },
      { say: `You have one open task: ${title} [S1]. It is not late [S9].` },
    );
    const res = await send(chat, 'pme', 'What is waiting on me?');
    expect(res.status).toBe(201);

    const { userMessage, message } = res.body;
    expect(userMessage).toMatchObject({
      sender: 'user',
      parts: [{ type: 'text', text: 'What is waiting on me?' }],
    });
    expect(message.parts[0]).toEqual({
      type: 'activity',
      items: [{ tool: 'my_tasks', label: 'Looked at your tasks', ok: true }],
    });
    expect(message.parts[1]).toMatchObject({
      type: 'text',
      citations: [{ ref: 'S1', type: 'task', label: title, link: '/tasks' }],
    });
    // A tag the AI made up is dropped; the real one stays.
    expect(textOf(message)).toContain('[S1]');
    expect(textOf(message)).not.toContain('S9');

    // The model saw the records with their tags.
    expect(JSON.parse(ai.results.at(-1)!)).toMatchObject({
      result: [{ title, kind: 'own', status: 'open' }],
      sources: [{ ref: 'S1', is: `task: ${title}` }],
    });

    // The logs: one request for the reply, one for the title, and the tool call.
    const [reply, name] = await requestsOf(chat);
    expect(reply).toMatchObject({
      provider: 'scripted',
      purpose: 'chat',
      outcome: 'completed',
      userId: id('pme'),
      toolCalls: 1,
      modelCalls: 2,
      inputTokens: 1000,
      outputTokens: 200,
      costUsd: '0.006000',
    });
    expect(reply!.promptVersion).toMatch(/^v1-[0-9a-f]{8}$/);
    expect(name).toMatchObject({ purpose: 'title', toolCalls: 0 });
    const [toolCall] = await t.deps.db
      .select()
      .from(aiToolCalls)
      .where(eq(aiToolCalls.requestId, reply!.id));
    expect(toolCall).toMatchObject({
      tool: 'my_tasks',
      endpoint: 'tasks.list',
      tier: 'read',
      allowed: true,
      denialReason: null,
      input: {},
    });
    expect(toolCall!.recordsReturned).toEqual([
      { type: 'task', id: message.parts[1].citations[0].id },
    ]);

    const detail = await ok(call('GET', `/ai/chats/${chat}`, 'pme'));
    expect(detail.title).toBe('A made-up chat title');
    expect(detail.messages.map((m: any) => m.sender)).toEqual(['user', 'assistant']);
  });

  it('is written from instructions that name the person, their role and the day', async () => {
    const chat = await newChat('lead', { projectId, stepKey: '5' });
    ai.reply({ say: 'Hello.' });
    await ok(send(chat, 'lead', 'Hi'));
    const turn = ai.turns.at(-2)!;
    expect(turn.model).toBe('claude-sonnet-5-5');
    expect(turn.maxSteps).toBe(4);
    expect(turn.system).toContain('Name: Leela Example. Role: R&D Lead. Product line: Spine.');
    expect(turn.system).toContain(`Today is ${dateOfInstant(clock.now)} (Indian time).`);
    expect(turn.system).toMatch(/In the R&D route, R&D Lead does: .*\n.*signs off: /);
    expect(turn.system).toMatch(/Project SPN-\d\d-\d+ · Quokka spine plate \(id /);
    expect(turn.system).toContain('Step 5 of that project');
    expect(turn.system).toContain('Every fact you state');
    expect(turn.tools.map((x) => x.name)).toEqual(aiToolDefs().map((x) => x.name));
    // The title is asked of the cheaper model, with no tools.
    const naming = ai.turns.at(-1)!;
    expect(naming.model).toBe('claude-haiku-5-5');
    expect(naming.tools).toEqual([]);
  });

  it('cites a widget by its key, and the chat can still be read', async () => {
    const chat = await newChat('head');
    ai.reply(
      { tool: 'get_widget', input: { key: 'my-tasks' } },
      { say: 'Your tasks are on the Dashboard [S1].' },
    );
    const res = await send(chat, 'head', 'What does my-tasks show?');
    expect(res.body.message.parts[1].citations).toMatchObject([
      { ref: 'S1', type: 'widget', id: 'my-tasks', link: '/dashboard' },
    ]);
    const detail = await call('GET', `/ai/chats/${chat}`, 'head');
    expect(detail.status).toBe(200);
    expect(detail.body.messages[1].parts[1].citations[0].id).toBe('my-tasks');
  });

  it('shows the model the earlier messages, without their source tags', async () => {
    const title = fresh('Check the jig');
    await ok(call('POST', '/tasks', 'ops', { title }));
    const chat = await newChat('ops');
    ai.reply({ tool: 'my_tasks' }, { say: () => `You have ${title} [S1].` });
    await ok(send(chat, 'ops', 'What is open?'));
    ai.queue({ say: 'Yes.' });
    await ok(send(chat, 'ops', 'Is it late?'));
    expect(ai.turns.at(-1)!.history).toEqual([
      { role: 'user', text: 'What is open?' },
      { role: 'assistant', text: `You have ${title}.` },
    ]);
  });

  it('streams as events when asked, and the same reply is kept', async () => {
    const title = fresh('Stream me');
    await ok(call('POST', '/tasks', 'dard', { title }));
    const chat = await newChat('dard');
    ai.reply({ say: 'One moment.' }, { tool: 'my_tasks' }, { say: 'You have a task [S1].' });
    const { res, events } = await stream(chat, 'dard', 'What is open?');
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(events.map((e) => e.type)).toEqual([
      'start',
      'text',
      'activity',
      'activity',
      'text',
      'done',
      'title',
    ]);
    expect(events[2]).toMatchObject({
      tool: 'my_tasks',
      state: 'start',
      label: 'Looked at your tasks',
    });
    expect(events[3]).toMatchObject({ state: 'done' });
    // Words after a lookup start a new paragraph.
    expect(events[4].delta).toBe('\n\nYou have a task [S1].');
    expect(textOf(events[5].message)).toBe('One moment.\n\nYou have a task [S1].');
    expect(events[6]).toEqual({ type: 'title', title: 'A made-up chat title' });
    const detail = await ok(call('GET', `/ai/chats/${chat}`, 'dard'));
    expect(textOf(detail.messages[1])).toBe('One moment.\n\nYou have a task [S1].');
  });

  it('can fail, and then keeps the question and logs the failure', async () => {
    const chat = await newChat('pme');
    ai.queue({ fail: 'upstream exploded' });
    const res = await send(chat, 'pme', 'Hello?');
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('AI_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toContain('exploded');
    const detail = await ok(call('GET', `/ai/chats/${chat}`, 'pme'));
    expect(detail.messages.map((m: any) => m.sender)).toEqual(['user']);
    expect(await requestsOf(chat)).toMatchObject([{ outcome: 'error', errorCode: 'AI_FAILED' }]);

    ai.queue({ fail: 'again' });
    const { events } = await stream(chat, 'pme', 'Hello?');
    expect(events.map((e) => e.type)).toEqual(['start', 'error']);
  });

  it('can be stopped, keeping what was written', async () => {
    const chat = await newChat('aems');
    ai.queue({ say: 'Looking into it.' }, { hold: new Promise(() => undefined) });
    const before = ai.turns.length;
    const pending = send(chat, 'aems', 'Take your time');
    await until(() => ai.turns.length > before);
    // One reply at a time.
    const busy = await send(chat, 'aems', 'And this?');
    expect(busy.status).toBe(409);
    expect(busy.body.code).toBe('CHAT_BUSY');
    expect((await ok(call('POST', `/ai/chats/${chat}/stop`, 'aems'))).stopped).toBe(true);

    const res = await pending;
    expect(res.status).toBe(201);
    expect(res.body.message).toMatchObject({ stopped: true });
    expect(textOf(res.body.message)).toBe('Looking into it.');
    expect(await requestsOf(chat)).toMatchObject([{ outcome: 'stopped' }]);
    expect((await ok(call('POST', `/ai/chats/${chat}/stop`, 'aems'))).stopped).toBe(false);
    // The person can go on.
    ai.queue({ say: 'Back.' });
    expect((await send(chat, 'aems', 'Again')).status).toBe(201);
  });

  it('stops using tools after the limit, and tells the model', async () => {
    const chat = await newChat('qc');
    ai.reply(
      { tool: 'my_tasks' },
      { tool: 'my_tasks' },
      { tool: 'my_tasks' },
      { tool: 'my_tasks' },
      { say: 'Done.' },
    );
    await ok(send(chat, 'qc', 'Look a lot'));
    expect(ai.results.at(-1)).toMatch(/^You have used all the lookups/);
    const [reply] = await requestsOf(chat);
    expect(reply).toMatchObject({ toolCalls: 3 });
  });

  it('is refused once the person has used the day’s budget, and starts again the next day', async () => {
    const chat = await newChat('qa');
    ai.usage = { inputTokens: 400_000, outputTokens: 0 };
    ai.reply({ say: 'A big one.' });
    expect((await send(chat, 'qa', 'First')).status).toBe(201);
    ai.usage = { inputTokens: 1000, outputTokens: 200 };

    const before = ai.turns.length;
    const refused = await send(chat, 'qa', 'Second');
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe('AI_BUDGET_REACHED');
    // Also when the reply would have streamed, and nothing reached the model.
    const streamed = await t.app.inject({
      method: 'POST',
      url: `/api/v1/ai/chats/${chat}/messages`,
      headers: { cookie: w.who.qa!.cookie, accept: 'text/event-stream' },
      payload: { text: 'Third' },
    });
    expect(streamed.statusCode).toBe(429);
    expect(streamed.headers['content-type']).toContain('application/problem+json');
    expect(ai.turns.length).toBe(before);
    // Others have their own budget.
    ai.reply({ say: 'Fine.' });
    expect((await send(await newChat('pme'), 'pme', 'Hello')).status).toBe(201);

    const saved = clock.now;
    clock.now = new Date(saved.getTime() + 24 * 3_600_000);
    try {
      ai.queue({ say: 'A new day.' });
      expect((await send(chat, 'qa', 'Fourth')).status).toBe(201);
    } finally {
      clock.now = saved;
    }
  });
});

describe('what the AI may do', () => {
  it('uses only tools that wrap endpoints it may use', () => {
    const defs = aiToolDefs();
    expect(new Set(defs.map((d) => d.name)).size).toBe(defs.length);
    for (const def of defs) {
      expect(ENDPOINTS, def.name).toContain(def.endpoint);
      expect(['read', 'auto'], `${def.name} → ${def.endpoint.id}`).toContain(def.endpoint.aiTier);
    }
    // Everything that signs, decides, sends back or deletes is out of reach.
    const reach = new Set(defs.map((d) => d.endpoint.id));
    for (const closed of ENDPOINTS.filter((e) => ['never', 'confirm', 'none'].includes(e.aiTier))) {
      expect(reach.has(closed.id), closed.id).toBe(false);
    }
  });

  it('can put only auto and confirm actions on a card', () => {
    const catalogue = proposableCatalogue();
    for (const wanted of ['tasks.create', 'steps.submit', 'deviations.record', 'tasks.reassign']) {
      expect(catalogue).toContain(`- ${wanted}:`);
    }
    for (const never of ENDPOINTS.filter((e) => e.aiTier === 'never' || e.aiTier === 'none')) {
      expect(catalogue, never.id).not.toContain(`- ${never.id}:`);
    }
  });

  it('refuses a tool the person could not use, and tells the model who can', async () => {
    const chat = await newChat('designer');
    ai.reply(
      { tool: 'read_document', input: { documentId: annexId } },
      { tool: 'list_documents', input: { projectId } },
      { say: 'I am not allowed to read that one.' },
    );
    await ok(send(chat, 'designer', 'What does the budget annex say?'));
    const [refusal, listing] = ai.results.slice(-2);
    expect(refusal).toMatch(/^Not allowed \(NOT_ALLOWED\)/);
    expect(refusal).toContain(
      'Who can: Board, VP, R&D Head, The R&D Lead of this product line, R&D Ops on the project.',
    );
    // Nothing about the annex reaches the model: not its title, not that it exists.
    expect(`${refusal}${listing}`).not.toContain('wombat');
    expect(JSON.parse(listing!).result.map((d: any) => d.number)).not.toContain(
      expect.stringContaining('BUD'),
    );

    const [request] = await requestsOf(chat);
    const calls = await t.deps.db
      .select()
      .from(aiToolCalls)
      .where(eq(aiToolCalls.requestId, request!.id));
    const denied = calls.find((c) => c.tool === 'read_document')!;
    expect(denied).toMatchObject({ allowed: false, recordsReturned: [] });
    expect(denied.denialReason).toMatch(/^Only these people can do this: Board, VP/);
  });

  it('reads the same things for the Lead, who may open it', async () => {
    const chat = await newChat('lead');
    ai.reply({ tool: 'read_document', input: { documentId: annexId } }, { say: 'Read it.' });
    await ok(send(chat, 'lead', 'Open the annex'));
    expect(JSON.parse(ai.results.at(-1)!)).toMatchObject({
      result: { title: 'Secret wombat costs', restricted: false },
      sources: [{ ref: 'S1', is: expect.stringContaining('Secret wombat costs') }],
    });
  });

  it('makes only the person’s own tasks directly, marked as the AI’s work', async () => {
    const chat = await newChat('pme');
    const title = fresh('Order the dowel pins');
    ai.reply(
      {
        tool: 'create_my_task',
        input: { title, dueOn: dateOfInstant(new Date(clock.now.getTime() + 5 * 86_400_000)) },
      },
      { say: 'Added it [S1].' },
    );
    const res = await send(chat, 'pme', 'Remind me to order the dowel pins');
    expect(res.body.message.parts[1].citations).toMatchObject([{ type: 'task', label: title }]);
    const mine = (await ok(call('GET', '/tasks?limit=100', 'pme'))).items.find(
      (x: any) => x.title === title,
    );
    expect(mine).toMatchObject({ kind: 'own', viaAi: true, assignedBy: null });
    const [entry] = await t.deps.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'task.created'), eq(auditEvents.recordId, mine.id)));
    expect(entry).toMatchObject({ actorType: 'user_via_ai', actorId: id('pme') });
  });

  it('prepares an action card for anything that affects someone else, which only the person confirms', async () => {
    const chat = await newChat('head');
    const title = fresh('Rerun the FEA on the cage');
    ai.reply(
      {
        tool: 'propose',
        input: {
          title: 'Ask Dev to rerun the FEA',
          actions: [{ endpoint: 'tasks.create', body: { title, assigneeId: id('designer') } }],
        },
      },
      { say: 'I have prepared a card for you to check.' },
    );
    const res = await send(chat, 'head', 'Ask Dev to rerun the FEA');
    const card = res.body.message.parts.find((p: any) => p.type === 'card');
    expect(card).toBeTruthy();
    expect(JSON.parse(ai.results.at(-1)!).result).toMatchObject({
      status: 'pending',
      shownToThePerson: [{ summary: expect.stringContaining(`Assign to Dev Example: ${title}`) }],
    });

    // Nothing has happened yet.
    const tasksOfDesigner = async () =>
      (await ok(call('GET', '/tasks?limit=100', 'designer'))).items as any[];
    expect((await tasksOfDesigner()).map((x) => x.title)).not.toContain(title);

    // The chat shows the card as it stands, and says the AI prepared it here.
    const detail = await ok(call('GET', `/ai/chats/${chat}`, 'head'));
    expect(detail.proposals).toMatchObject([
      { id: card.proposalId, status: 'pending', chatId: chat, preparedByAi: true },
    ]);

    // Only the person confirms it, from their own session.
    const confirmed = await t.app.inject({
      method: 'POST',
      url: `/api/v1/proposals/${card.proposalId}/confirm`,
      headers: { cookie: w.who.head!.cookie, 'if-match': '1' },
    });
    expect(confirmed.statusCode).toBe(200);
    expect((await tasksOfDesigner()).find((x) => x.title === title)).toMatchObject({
      kind: 'work',
      assignedBy: { id: id('head') },
      viaAi: true,
    });
    const [created] = await t.deps.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.action, 'proposal.created'), eq(auditEvents.recordId, card.proposalId)),
      );
    expect(created).toMatchObject({ actorType: 'user_via_ai', after: { chatId: chat } });
  });

  it('shows the model the cards still waiting, and changes one when asked', async () => {
    const chat = await newChat('head');
    const title = fresh('Check the pin gauge');
    const action = (assigneeId: string) => [
      { endpoint: 'tasks.create', body: { title, assigneeId } },
    ];
    ai.reply(
      {
        tool: 'propose',
        input: { title: 'Ask Dev to check the gauge', actions: action(id('designer')) },
      },
      { say: 'The card is ready.' },
    );
    const first = await send(chat, 'head', 'Ask Dev to check the pin gauge');
    const cardId = first.body.message.parts.find((p: any) => p.type === 'card').proposalId;

    ai.queue(
      { tool: 'revise_card', input: { proposalId: cardId, actions: action(id('aems')) } },
      { say: 'I changed the card.' },
    );
    const second = await send(chat, 'head', 'Make it Asha instead');
    // The model was told which card is waiting, and what it would do.
    expect(ai.turns.at(-1)!.system).toContain(
      `Card ${cardId} (version 1): Ask Dev to check the gauge. It would: Assign to Dev Example: ${title}.`,
    );
    expect(second.body.message.parts.filter((p: any) => p.type === 'card')).toEqual([
      { type: 'card', proposalId: cardId },
    ]);
    const detail = await ok(call('GET', `/ai/chats/${chat}`, 'head'));
    expect(detail.proposals).toMatchObject([{ id: cardId, version: 2, status: 'pending' }]);
    expect(detail.proposals[0].preview.actions[0].summary).toBe(`Assign to Asha Example: ${title}`);

    const confirmed = await t.app.inject({
      method: 'POST',
      url: `/api/v1/proposals/${cardId}/confirm`,
      headers: { cookie: w.who.head!.cookie, 'if-match': '2' },
    });
    expect(confirmed.statusCode).toBe(200);
    const has = async (as: string) =>
      ((await ok(call('GET', '/tasks?limit=100', as))).items as any[]).some(
        (x) => x.title === title,
      );
    expect(await has('aems')).toBe(true);
    expect(await has('designer')).toBe(false);

    // A card that was answered is no longer shown to the model as waiting.
    ai.queue({ say: 'Anything else?' });
    await ok(send(chat, 'head', 'Thanks'));
    expect(ai.turns.at(-1)!.system).not.toContain('ACTION CARDS WAITING');
  });

  it('cannot put a signing or deciding action on a card', async () => {
    const chat = await newChat('vp');
    ai.reply(
      {
        tool: 'propose',
        input: {
          title: 'Approve step 1',
          actions: [{ endpoint: 'steps.approve', params: { id: projectId, key: '1' } }],
        },
      },
      { say: 'I cannot do that.' },
    );
    const res = await send(chat, 'vp', 'Approve step 1');
    expect(ai.results.at(-1)).toMatch(/can't be put on an action card/);
    expect(res.body.message.parts.some((p: any) => p.type === 'card')).toBe(false);
    expect((await ok(call('GET', `/ai/chats/${chat}`, 'vp'))).proposals).toEqual([]);
  });

  it('is refused by the server if it calls an endpoint it may not, whatever the tool', async () => {
    // The tiers are enforced where the endpoint runs, so even a tool wrongly built on a closed
    // endpoint could not act: a "via AI" call to a `confirm` or `never` endpoint is refused.
    const { guard } = await import('../src/core/http/endpoint');
    const ctx = {
      orgId: DEFAULT_ORG_ID,
      requestId: 'r',
      actor: {
        userId: id('vp'),
        name: 'V',
        roleKey: 'vp',
        positionKey: 'vp',
        productLineId: null,
        switcherId: null,
      },
      sessionId: 's',
      viaAi: true,
    };
    for (const closed of [
      'steps.approve',
      'steps.sendBack',
      'proposals.confirm',
      'signatures.sign',
      'tasks.reassign',
    ]) {
      const endpoint = ENDPOINTS.find((e) => e.id === closed)!;
      expect(() => guard(endpoint, ctx), closed).toThrow(
        expect.objectContaining({ code: 'AI_NOT_ALLOWED' }),
      );
    }
  });
});

describe('feedback', () => {
  it('rates a reply, and the rating can change', async () => {
    const chat = await newChat('pme');
    ai.reply({ say: 'Hello.' });
    const { userMessage, message } = (await send(chat, 'pme', 'Hi')).body;
    const rate = (as: string, messageId: string, rating: string) =>
      call('POST', '/ai/feedback', as, { messageId, rating, comment: 'It helped' });
    expect((await ok(rate('pme', message.id, 'up'))).feedback).toBe('up');
    expect((await ok(rate('pme', message.id, 'down'))).feedback).toBe('down');
    const detail = await ok(call('GET', `/ai/chats/${chat}`, 'pme'));
    expect(detail.messages.map((m: any) => m.feedback)).toEqual([null, 'down']);
    // Only your own chat, and only a reply.
    expect((await rate('designer', message.id, 'up')).status).toBe(403);
    expect((await rate('pme', userMessage.id, 'up')).status).toBe(400);
  });
});

describe('the logs', () => {
  it('can be added to but never changed', async () => {
    const [row] = await t.deps.db.select().from(aiRequests).limit(1);
    await expect(
      t.deps.db.update(aiRequests).set({ costUsd: '0' }).where(eq(aiRequests.id, row!.id)),
    ).rejects.toThrow();
    await expect(t.deps.db.delete(aiToolCalls)).rejects.toThrow();
    // Chats and their messages are ordinary records.
    expect((await t.deps.db.select().from(aiChats).limit(1)).length).toBe(1);
    expect((await t.deps.db.select().from(aiMessages).limit(1)).length).toBe(1);
  });
});
