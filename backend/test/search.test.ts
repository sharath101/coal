import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ORG_ID } from '../src/core/config';
import { systemContext } from '../src/core/http/context';
import { loadSampleTemplates } from '../src/modules/templates/service';
import { createTestApp, type TestApp } from './helpers';
import { createWorld, type World } from './world';

let t: TestApp;
let w: World;
let project: string;
let code: string;

beforeAll(async () => {
  t = await createTestApp({ TEMPLATE_FILLING: 'true' });
  w = await createWorld(t);
  await loadSampleTemplates(t.deps, systemContext(DEFAULT_ORG_ID));
  project = await w.go('Quokka spine plate');
  code = (await w.ok(w.call('GET', `/projects/${project}`, 'vp'))).code;
  await w.advance(project, '4');
  // A budget annex, which the team mustn't find, and an Action Plan draft, which it may.
  const budget = await w.ok(
    w.call('POST', `/projects/${project}/documents`, 'lead', {
      stepKey: '5',
      documentType: 'BUDGET_ANNEX',
      title: 'Wombat costs',
    }),
  );
  await w.ok(
    w.call('POST', `/documents/${budget.id}/versions`, 'lead', {
      fields: { material_cost: 'Titanium numbat allowance', total_budget: '2' },
    }),
  );
  await w.ok(
    w.call('POST', `/projects/${project}/documents`, 'head', {
      stepKey: '5',
      documentType: 'ACTION_PLAN',
      title: 'Platypus plan',
    }),
  );
}, 60_000);
afterAll(async () => {
  await t?.close();
});

const find = async (as: string, q: string, types?: string) =>
  (
    await w.ok(
      w.call('GET', `/search?q=${encodeURIComponent(q)}${types ? `&types=${types}` : ''}`, as),
    )
  ).items as { type: string; title: string; subtitle: string; snippet: string | null }[];
const titles = async (as: string, q: string, types?: string) =>
  (await find(as, q, types)).map((h) => `${h.type}: ${h.title}`);

describe('search', () => {
  it('finds projects by code or words, for everyone: status is open', async () => {
    for (const as of ['designer', 'outsider', 'md']) {
      expect(await titles(as, 'quokka', 'project')).toEqual([
        `project: ${code} · Quokka spine plate`,
      ]);
    }
    expect(await titles('designer', code.slice(0, 6), 'project')).toContain(
      `project: ${code} · Quokka spine plate`,
    );
  });

  it('finds a document only for the people who may open it', async () => {
    // The budget annex: the Lead, the Head, the VP and R&D Ops on the project.
    for (const as of ['lead', 'head', 'vp', 'ops']) {
      expect((await titles(as, 'numbat', 'document')).join()).toMatch(/Wombat costs/);
    }
    const [hit] = await find('lead', 'numbat', 'document');
    expect(hit?.snippet).toContain('Titanium numbat allowance');
    expect(hit?.subtitle).toBe(`${code} · step 5 · version 2 (draft)`);
    for (const as of ['designer', 'pme', 'md', 'leadOther', 'outsider']) {
      expect(await titles(as, 'numbat')).toEqual([]);
      expect(await titles(as, 'wombat')).toEqual([]);
    }
  });

  it('keeps drafts to the people who work on the project', async () => {
    expect((await titles('designer', 'platypus', 'document')).join()).toMatch(/Platypus plan/);
    // The Board reads only submitted checkpoint papers; another line's Lead nothing.
    for (const as of ['md', 'leadOther', 'outsider']) {
      expect(await titles(as, 'platypus')).toEqual([]);
    }
  });

  it('finds only my tasks, my queue and what I gave', async () => {
    await w.ok(w.call('POST', '/tasks', 'pme', { title: 'Polish the echidna fixture' }));
    expect(await titles('pme', 'echidna')).toEqual(['task: Polish the echidna fixture']);
    expect(await titles('designer', 'echidna')).toEqual([]);
  });

  it('finds people by name, with their role', async () => {
    const [dina] = await find('designer', 'dina', 'person');
    expect(dina).toMatchObject({ type: 'person', title: 'Dina Example', subtitle: 'DARD' });
  });

  it('refuses a query too short to mean anything', async () => {
    expect((await w.call('GET', '/search?q=a', 'designer')).status).toBe(400);
    expect((await w.call('GET', '/search?q=plate&types=secrets', 'designer')).status).toBe(400);
  });
});
