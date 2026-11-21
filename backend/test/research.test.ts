import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { aiRequests, aiToolCalls } from '../src/modules/ai/tables';
import type { WebSearch } from '../src/modules/ai/provider';
import { runResearch } from '../src/modules/research/assistant';
import { clearOutsideCache, plainOf } from '../src/modules/research/connectors/client';
import { openFdaSearch, yearOf } from '../src/modules/research/connectors/index';
import { sweepResearch } from '../src/modules/research/jobs';
import { researchRuns } from '../src/modules/research/tables';
import { ScriptedAi } from './fakes';
import { createTestApp, type TestApp } from './helpers';
import { createWorld, type World } from './world';

/**
 * Research in public sources (docs/workstation-and-ai.md#researching-what-already-exists). The
 * sources answer from made-up fixtures through a stand-in, which records every address COAL
 * calls, so the tests can check exactly what left COAL.
 */
const sent: URL[] = [];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const fetchOutside: typeof fetch = async (input) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  sent.push(url);
  if (url.hostname === 'eutils.ncbi.nlm.nih.gov') {
    if (url.pathname.endsWith('/esearch.fcgi')) {
      return json({ esearchresult: { idlist: ['90000001', '90000002'] } });
    }
    if (url.pathname.endsWith('/esummary.fcgi')) {
      return json({
        result: {
          uids: ['90000001', '90000002'],
          '90000001': {
            uid: '90000001',
            title: 'Fusion with a made-up expandable lumbar cage in 40 patients',
            authors: [{ name: 'Example A' }, { name: 'Sample B' }],
            source: 'J Madeup Spine',
            pubdate: '2024 Mar',
          },
          '90000002': {
            uid: '90000002',
            title: 'Subsidence after expandable cages: a made-up review',
            authors: [{ name: 'Example C' }],
            source: 'Madeup Spine J',
            pubdate: '2023',
          },
        },
      });
    }
    if (url.pathname.endsWith('/efetch.fcgi')) {
      return new Response(
        '<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID Version="1">90000001</PMID><Article><Abstract><AbstractText Label="RESULTS">Fusion was seen in 38 of 40 patients at 12 months.</AbstractText></Abstract></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>',
      );
    }
  }
  if (url.hostname === 'api.fda.gov' && url.pathname === '/device/510k.json') {
    return json({
      results: [
        {
          k_number: 'K990001',
          device_name: 'Example Expandable Cage System',
          applicant: 'Acme Example Spine Inc.',
          decision_date: '2025-02-03',
          product_code: 'MAX',
          decision_description: 'Substantially Equivalent',
        },
      ],
    });
  }
  return new Response('not here', { status: 404 });
};

let t: TestApp;
let w: World;
const ai = new ScriptedAi();
let projectId: string;
let sources: any[];
const idOf = (name: string) => sources.find((s) => s.name === name)!.id as string;

const call = (...args: Parameters<World['call']>) => w.call(...args);
const ok = (res: Promise<{ status: number; body: any }>) => w.ok(res);

async function confirm(proposalId: string, as: string, version: number) {
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/v1/proposals/${proposalId}/confirm`,
    headers: { cookie: w.who[as]!.cookie, 'if-match': String(version) },
  });
  return { status: res.statusCode, body: res.json() };
}

/** A research card, confirmed: what the person does after the assistant prepares one. */
async function startResearch(as: string, body: Record<string, unknown>) {
  const card = await ok(
    call('POST', '/proposals', as, {
      title: 'Research what exists',
      actions: [{ endpoint: 'research.start', body }],
    }),
  );
  const done = await confirm(card.id, as, card.version);
  expect(done.status).toBe(200);
  const runs = await ok(call('GET', `/research?proposal=${card.id}`, as));
  return { card, run: runs.items[0] };
}

const cageResearch = (extra: Record<string, unknown> = {}) => ({
  question: 'Which expandable lumbar cages exist, and how do they do?',
  terms: ['expandable cage', 'lumbar fusion', 'MAX'],
  sourceIds: [idOf('PubMed'), idOf('FDA 510(k) clearances'), idOf('Google Scholar')],
  ...extra,
});

beforeAll(async () => {
  t = await createTestApp({ RESEARCH_MAX_SEARCHES: '4' }, { ai, fetchOutside });
  w = await createWorld(t);
  projectId = await w.go('Quokka cervical plate');
  sources = (await ok(call('GET', '/research-sources', 'ops'))).items;
}, 60_000);
afterAll(async () => {
  await t?.close();
});
beforeEach(() => {
  clearOutsideCache();
  sent.length = 0;
});
afterEach(() => {
  expect(ai.pending).toBe(0);
});

describe('the source library', () => {
  it('starts with the public databases, and says which COAL can search here', () => {
    const byName = new Map(sources.map((s) => [s.name, s]));
    expect(byName.get('PubMed')).toMatchObject({ kind: 'pubmed', searchable: true, enabled: true });
    expect(byName.get('FDA 510(k) clearances')?.settings).toEqual({
      kind: 'openfda',
      datasets: ['510k', 'classification'],
    });
    // No API, or automated searching not allowed: the person opens these.
    expect(byName.get('Google Scholar')).toMatchObject({ kind: 'link', searchable: false });
    expect(byName.get('CTRI (India)')).toMatchObject({ kind: 'link', searchable: false });
  });

  it('is kept by the VP, the R&D Head and the R&D Leads', async () => {
    const journal = await call('POST', '/research-sources', 'lead', {
      name: 'Made-up Journal of Spine Technique',
      note: 'For endoscopic and robotic techniques.',
      settings: { kind: 'journal', issn: '2508-2043' },
    });
    expect(journal.status).toBe(201);
    expect(journal.body).toMatchObject({ searchable: true, addedBy: { name: 'Leela Example' } });

    const refused = await call('POST', '/research-sources', 'ops', {
      name: 'Another journal',
      settings: { kind: 'pubmed' },
    });
    expect(refused.status).toBe(403);
    expect(refused.body.whoCan).toEqual(['VP', 'R&D Head', 'R&D Lead']);

    const taken = await call('POST', '/research-sources', 'head', {
      name: 'made-up journal of spine technique',
      settings: { kind: 'pubmed' },
    });
    expect(taken.status).toBe(400);

    const off = await ok(
      call('PATCH', `/research-sources/${journal.body.id}`, 'head', { enabled: false }),
    );
    expect(off.enabled).toBe(false);
  });

  it('checks each kind of source: a website without an address, a link to http, an ISSN', async () => {
    for (const settings of [
      { kind: 'website', domains: ['https://example.com/news'] },
      { kind: 'link', url: 'http://example.com/?q={q}' },
      { kind: 'journal', issn: '2508' },
      { kind: 'openfda', datasets: [] },
    ]) {
      const res = await call('POST', '/research-sources', 'vp', { name: 'Bad one', settings });
      expect(res.status, JSON.stringify(settings)).toBe(400);
    }
  });
});

describe('starting research', () => {
  it('goes on a card that shows exactly the words that will leave COAL', async () => {
    const card = await ok(
      call('POST', '/proposals', 'ops', {
        title: 'Research what exists',
        actions: [{ endpoint: 'research.start', body: cageResearch({ projectId, stepKey: '2' }) }],
      }),
    );
    const action = card.preview.actions[0];
    expect(action.summary).toBe('Search 2 sources for: expandable cage; lumbar fusion; MAX');
    expect(action.detail).toEqual({
      kind: 'research',
      question: 'Which expandable lumbar cages exist, and how do they do?',
      terms: ['expandable cage', 'lumbar fusion', 'MAX'],
      since: null,
      searched: [
        { name: 'FDA 510(k) clearances', kind: 'openfda' },
        { name: 'PubMed', kind: 'pubmed' },
      ],
      linksOnly: ['Google Scholar'],
      keepIn: expect.stringMatching(/^SPN-\d{2}-\d{3} · Quokka cervical plate, step 2$/),
    });
    // Nothing was searched for the preview.
    expect(sent).toEqual([]);
    await ok(call('POST', `/proposals/${card.id}/reject`, 'ops'));
  });

  it('refuses terms that name a project, a person or the company', async () => {
    const project = await ok(call('GET', `/projects/${projectId}`, 'ops'));
    for (const term of [project.code, 'quokka cervical plate', 'Vera Example cage', 'Jayon cage']) {
      const res = await call('POST', '/proposals', 'ops', {
        title: 'Research',
        actions: [{ endpoint: 'research.start', body: cageResearch({ terms: [term] }) }],
      });
      expect(res.status, term).toBe(400);
    }
  });

  it('is for the people of steps C, 1 and 2, and the AI can only put it on a card', async () => {
    expect((await call('POST', '/research', 'designer', cageResearch())).status).toBe(403);
    const chat = (await ok(call('POST', '/ai/chats', 'ops', { context: {} }))).id;
    ai.reply({ say: 'I would prepare a card.' });
    await ok(call('POST', `/ai/chats/${chat}/messages`, 'ops', { text: 'Find cages' }));
    // research.start is confirm-tier: the tools never call it directly.
    const tools = ai.turns.at(-2)!.tools.map((tool) => tool.name);
    expect(tools).toContain('list_research_sources');
    expect(tools).not.toContain('research_start');
  });
});

describe('a research run', () => {
  it('searches only with the approved words, writes a brief from the results, and tells the person', async () => {
    const { run } = await startResearch('ops', cageResearch({ projectId, stepKey: '2' }));
    expect(run).toMatchObject({
      status: 'queued',
      terms: ['expandable cage', 'lumbar fusion', 'MAX'],
    });

    ai.queue(
      {
        tool: 'search_source',
        input: { source: idOf('PubMed'), query: '"expandable cage" AND lumbar' },
      },
      {
        tool: 'search_source',
        input: { source: idOf('FDA 510(k) clearances'), query: 'expandable cage' },
      },
      // A word nobody approved: refused, and nothing is sent.
      { tool: 'search_source', input: { source: idOf('PubMed'), query: 'quokka cage' } },
      {
        tool: 'search_source',
        input: { source: idOf('Google Scholar'), query: 'expandable cage' },
      },
      { tool: 'read_result', input: { ref: 'R1' } },
      {
        say: 'Existing products\nAn expandable cage was cleared in 2025 [R3].\n\nEvidence\nFusion in 38 of 40 patients [R1]. Two studies [R1, R2]. Something else [R9]. Also [R2; R8].',
      },
    );
    expect(await runResearch(t.deps, run.id)).toBe('done');

    const done = await ok(call('GET', `/research/${run.id}`, 'ops'));
    expect(done.status).toBe('done');
    expect(done.brief).toContain('[R3]');
    expect(done.brief).toContain('[R1]');
    // A tag that points to no result is removed, and several in one bracket become one each.
    expect(done.brief).not.toContain('[R9]');
    expect(done.brief).toContain('Two studies [R1][R2].');
    expect(done.brief).toContain('Also [R2].');
    expect(done.results.map((r: any) => [r.ref, r.kind, r.externalId])).toEqual([
      ['R1', 'article', 'PMID 90000001'],
      ['R2', 'article', 'PMID 90000002'],
      ['R3', 'clearance', 'K990001'],
    ]);
    expect(done.results[0]).toMatchObject({
      url: 'https://pubmed.ncbi.nlm.nih.gov/90000001/',
      snippet: expect.stringContaining('38 of 40 patients'),
      detail: 'Example A, Sample B · J Madeup Spine',
      year: '2024',
    });
    expect(done.results[2].url).toBe(
      'https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm?ID=K990001',
    );
    // What left COAL, as it was sent: the two searches that were allowed.
    expect(done.searches.map((s: any) => [s.source, s.query])).toEqual([
      ['PubMed', '"expandable cage" AND lumbar'],
      ['FDA 510(k) clearances', 'expandable cage'],
    ]);
    expect(sent.map((u) => u.toString()).join(' ')).not.toMatch(/quokka/i);
    expect(sent.every((u) => ['eutils.ncbi.nlm.nih.gov', 'api.fda.gov'].includes(u.hostname))).toBe(
      true,
    );
    // The search a person opens themselves, ready.
    expect(done.links).toEqual([
      {
        sourceId: idOf('Google Scholar'),
        name: 'Google Scholar',
        url: 'https://scholar.google.com/scholar?q=expandable%20cage%20lumbar%20fusion%20MAX',
      },
    ]);

    // The research assistant saw the question and the library, and none of COAL's records.
    const turn = ai.turns.at(-1)!;
    expect(turn.tools.map((tool) => tool.name)).toEqual(['search_source', 'read_result']);
    expect(turn.prompt).toContain('expandable cage');
    expect(turn.prompt).not.toContain(projectId);
    expect(ai.results.at(-3)).toMatch(/^Refused, nothing was sent: .*quokka/);
    expect(ai.results.at(-2)).toMatch(/There is no source/);

    const [request] = await t.deps.db
      .select()
      .from(aiRequests)
      .where(
        eq(
          aiRequests.id,
          (await t.deps.db.select().from(researchRuns).where(eq(researchRuns.id, run.id)))[0]!
            .requestId!,
        ),
      );
    expect(request).toMatchObject({ purpose: 'research', outcome: 'completed', chatId: null });
    const calls = await t.deps.db
      .select()
      .from(aiToolCalls)
      .where(eq(aiToolCalls.requestId, request!.id));
    expect(calls.map((c) => [c.tool, c.allowed])).toEqual([
      ['search_source', true],
      ['search_source', true],
      ['search_source', false],
      ['search_source', false],
      ['read_result', true],
    ]);

    const bell = await ok(call('GET', '/notifications', 'ops'));
    expect(bell.items[0]).toMatchObject({
      title: 'Research ready: Which expandable lumbar cages exist, and how do they do?',
      link: `/research/${run.id}`,
    });
  });

  it('is private to the person who ran it, and the assistant never reads it', async () => {
    const { run } = await startResearch('ops', cageResearch());
    ai.queue({ say: 'Nothing to report.' });
    await runResearch(t.deps, run.id);
    expect((await call('GET', `/research/${run.id}`, 'head')).status).toBe(403);
    expect((await call('GET', `/research/${run.id}`, 'ops')).status).toBe(200);
    expect((await ok(call('GET', '/research', 'head'))).items).toEqual([]);
  });

  it('searches a website through the provider, keeping only pages on that website', async () => {
    const site = await ok(
      call('POST', '/research-sources', 'head', {
        name: 'Made-up device news',
        note: 'Trade news about new devices.',
        settings: { kind: 'website', domains: ['news.example.com'] },
      }),
    );
    // Without a provider that searches the web, a website is a link the person opens.
    expect(site.searchable).toBe(false);
    const asked: WebSearch[] = [];
    Object.assign(ai, {
      searchWeb: async (search: WebSearch) => {
        asked.push(search);
        return {
          pages: [
            {
              url: 'https://news.example.com/made-up-cage',
              title: 'Made-up maker launches a cage',
              summary: 'A made-up expandable cage was launched.',
            },
            { url: 'https://elsewhere.example.org/x', title: 'Off the list', summary: 'No.' },
          ],
          queries: ['expandable cage launch'],
          usage: { calls: 2, inputTokens: 500, outputTokens: 100 },
        };
      },
    });
    try {
      const { run } = await startResearch('ops', cageResearch({ sourceIds: [site.id] }));
      ai.queue(
        { tool: 'search_source', input: { source: site.id, query: 'expandable cage' } },
        { say: 'Existing products\nA cage was launched [R1].' },
      );
      await runResearch(t.deps, run.id);
      const done = await ok(call('GET', `/research/${run.id}`, 'ops'));
      expect(asked[0]).toMatchObject({ query: 'expandable cage', domains: ['news.example.com'] });
      expect(done.results.map((r: any) => r.url)).toEqual([
        'https://news.example.com/made-up-cage',
      ]);
      // The query the provider sent is what is logged as having left COAL.
      expect(done.searches.map((s: any) => s.query)).toEqual(['expandable cage launch']);
    } finally {
      delete (ai as { searchWeb?: unknown }).searchWeb;
    }
  });

  it('can be stopped: at once while queued, and at its next search while running', async () => {
    const queued = (await startResearch('ops', cageResearch())).run;
    const stopped = await ok(call('POST', `/research/${queued.id}/stop`, 'ops'));
    expect(stopped.status).toBe('stopped');
    expect(await runResearch(t.deps, queued.id)).toBe('skipped');

    const { run } = await startResearch('ops', cageResearch());
    let release = () => {};
    ai.queue({ hold: new Promise<void>((resolve) => (release = resolve)) }, { say: 'Too late.' });
    const running = runResearch(t.deps, run.id);
    await expect
      .poll(async () => (await ok(call('GET', `/research/${run.id}`, 'ops'))).status)
      .toBe('running');
    await ok(call('POST', `/research/${run.id}/stop`, 'ops'));
    expect(await running).toBe('stopped');
    release();
    expect((await ok(call('GET', `/research/${run.id}`, 'ops'))).status).toBe('stopped');
  });

  it('is sent again if it waited too long, and ended if a worker left it running', async () => {
    const { run } = await startResearch('ops', cageResearch());
    const later = { ...t.deps, now: () => new Date(Date.now() + 2 * 60_000) };
    const resent: string[] = [];
    expect(await sweepResearch(later, async (id) => void resent.push(id))).toMatchObject({
      resent: expect.any(Number),
    });
    expect(resent).toContain(run.id);

    await t.deps.db
      .update(researchRuns)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(researchRuns.id, run.id));
    const muchLater = {
      ...t.deps,
      now: () => new Date(Date.now() + t.deps.config.research.timeoutMs + 10 * 60_000),
    };
    await sweepResearch(muchLater, async () => undefined);
    const [row] = await t.deps.db
      .select()
      .from(researchRuns)
      .where(and(eq(researchRuns.id, run.id)));
    expect(row).toMatchObject({ status: 'failed', error: expect.stringMatching(/unexpectedly/) });
  });
});

describe('keeping results', () => {
  it('keeps chosen results as sources of the whole project, which everyone on it and the assistant can read', async () => {
    const { run } = await startResearch('ops', cageResearch({ projectId }));
    ai.queue(
      { tool: 'search_source', input: { source: idOf('PubMed'), query: 'expandable cage' } },
      { say: 'Evidence\nFusion was seen [R1].' },
    );
    await runResearch(t.deps, run.id);
    const found = await ok(call('GET', `/research/${run.id}`, 'ops'));
    const [first, second] = found.results;

    // Only the person who ran it.
    const body = { projectId, results: [{ resultId: first.id }] };
    expect((await call('POST', `/research/${run.id}/keep`, 'head', body)).status).toBe(403);

    const kept = await ok(call('POST', `/research/${run.id}/keep`, 'ops', body));
    expect(kept.items[0]).toMatchObject({
      kind: 'link',
      title: first.title,
      url: first.url,
      researchResultId: first.id,
      note: expect.stringContaining('38 of 40 patients'),
      target: { stepKey: null, documentId: null, taskId: null },
    });
    expect((await ok(call('GET', `/research/${run.id}`, 'ops'))).results[0].keptAt).not.toBeNull();
    // A result is kept once.
    expect((await call('POST', `/research/${run.id}/keep`, 'ops', body)).status).toBe(400);

    // Everyone working on the project reads it, with no step to look at.
    for (const who of ['designer', 'lead', 'head']) {
      const items = (await ok(call('GET', `/projects/${projectId}/sources`, who))).items;
      expect(items.map((x: any) => x.title)).toContain(first.title);
    }
    // The Board sees project content only at its checkpoints, so it reads none of this.
    expect((await ok(call('GET', `/projects/${projectId}/sources`, 'md'))).items).toEqual([]);

    // One result can also go on a single step.
    const onStep = await ok(
      call('POST', `/research/${run.id}/keep`, 'ops', {
        projectId,
        stepKey: '2',
        results: [{ resultId: second.id }],
      }),
    );
    expect(onStep.items[0].target).toMatchObject({ stepKey: '2' });

    // At any point, the assistant reads what was kept on the project, without naming a step.
    const chat = (await ok(call('POST', '/ai/chats', 'ops', { context: { projectId } }))).id;
    ai.reply({ tool: 'list_sources', input: { projectId } }, { say: 'Two kept sources [S1].' });
    const reply = await ok(call('POST', `/ai/chats/${chat}/messages`, 'ops', { text: 'Sources?' }));
    const listed = JSON.parse(ai.results.at(-1)!).result;
    expect(listed.find((x: any) => x.title === first.title)).toMatchObject({
      wholeProject: true,
      fromResearch: true,
    });
    expect(listed.find((x: any) => x.title === second.title)).toMatchObject({
      wholeProject: false,
      step: '2',
    });
    const text = reply.message.parts.find((p: any) => p.type === 'text');
    expect(text.citations[0]).toMatchObject({ type: 'source' });
  });
});

describe('keeping results elsewhere', () => {
  it('is only into a project the person may add sources to', async () => {
    // The Trauma Lead may research, but is not on this Spine project.
    const { run } = await startResearch('leadOther', cageResearch());
    ai.queue(
      { tool: 'search_source', input: { source: idOf('PubMed'), query: 'expandable cage' } },
      { say: 'Evidence\nFusion was seen [R1].' },
    );
    await runResearch(t.deps, run.id);
    const [first] = (await ok(call('GET', `/research/${run.id}`, 'leadOther'))).results;
    const res = await call('POST', `/research/${run.id}/keep`, 'leadOther', {
      projectId,
      results: [{ resultId: first.id }],
    });
    expect(res.status).toBe(403);
    expect(
      (await ok(call('GET', `/research/${run.id}`, 'leadOther'))).results[0].keptAt,
    ).toBeNull();
  });
});

describe('reading what sources send', () => {
  it('turns markup and entities into plain words', () => {
    expect(plainOf('<p>A &amp; B&#xa0;C &#233; &nbsp;D</p>')).toBe('A & B C é D');
  });

  it('finds the year in each source’s way of writing a date', () => {
    expect(yearOf('2024 Mar')).toBe('2024');
    expect(yearOf('2025-02-03')).toBe('2025');
    expect(yearOf('20261029')).toBe('2026');
    expect(yearOf('')).toBeNull();
  });
});

describe('openFDA searches', () => {
  it('need every word, and read three capital letters as a product code', () => {
    expect(openFdaSearch('510k', 'expandable AND cage MAX', 2020)).toBe(
      '(device_name:expandable) AND (device_name:cage) AND product_code:MAX AND decision_date:[2020-01-01 TO 3000-01-01]',
    );
    expect(openFdaSearch('event', 'cage', 2020)).toBe(
      '(device.generic_name:cage device.brand_name:cage mdr_text.text:cage) AND date_received:[20200101 TO 30000101]',
    );
  });
});
