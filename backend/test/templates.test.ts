import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemContext } from '../src/core/http/context';
import { importTemplateFolder } from '../src/modules/templates/import';
import { DEFAULT_ORG_ID } from '../src/core/config';
import { buildDocx, blocksFromSpec } from '../src/modules/templates/docx-builder';
import { SAMPLE_TEMPLATES, sampleDocx } from '../src/modules/templates/samples';
import { loadSampleTemplates } from '../src/modules/templates/service';
import { createTestApp, type TestApp } from './helpers';
import { createWorld, type World } from './world';

let t: TestApp;
let w: World;

const sample = (code: string) => SAMPLE_TEMPLATES.find((s) => s.spec.document_type === code)!;

beforeAll(async () => {
  t = await createTestApp({ TEMPLATE_FILLING: 'true' });
  w = await createWorld(t);
  await loadSampleTemplates(t.deps, systemContext(DEFAULT_ORG_ID));
});
afterAll(async () => {
  await t?.close();
});

const { call } = { call: (...args: Parameters<World['call']>) => w.call(...args) };
const ok = (res: Promise<{ status: number; body: any }>) => w.ok(res);

/** Uploads a Word file as the person, then adds it as a template version. */
async function addTemplate(
  as: string,
  docx: Buffer,
  extra: Record<string, unknown> = {},
  name = 'form.docx',
) {
  const fileId = await w.upload(as, name, docx);
  return call('POST', '/templates', as, { documentType: 'PID', docxFileId: fileId, ...extra });
}

const errors = (res: { body: any }) =>
  (res.body.errors as { message: string }[]).map((e) => e.message);

describe('the template library', () => {
  it('starts with COAL’s made-up samples, active, for every document type that uses a template', async () => {
    const { items } = await ok(call('GET', '/document-types', 'designer'));
    const withTemplates = items.filter((i: any) => i.kind === 'template');
    expect(withTemplates.map((i: any) => i.code).sort()).toEqual(
      [
        'ACTION_PLAN',
        'APPROVAL_FORM',
        'BUDGET_ANNEX',
        'MRS',
        'PID',
        'PROJECT_PLANNING',
        'REG_PLAN',
      ].sort(),
    );
    for (const type of withTemplates) expect(type.activeTemplate).toMatchObject({ version: 1 });
    expect(items.find((i: any) => i.code === 'BUDGET_ANNEX').sensitivity).toBe('budget');
    expect(items.find((i: any) => i.code === 'DOC').activeTemplate).toBeNull();
  });

  it('loading the samples again adds nothing', async () => {
    expect(await loadSampleTemplates(t.deps, systemContext(DEFAULT_ORG_ID))).toEqual([]);
  });

  it('shows everyone the active templates, and the drafts only to the VP and the Head', async () => {
    const added = await ok(addTemplate('vp', sampleDocx(sample('PID'))));
    expect(added).toMatchObject({ version: 2, status: 'draft', documentType: { code: 'PID' } });

    const seen = async (as: string) =>
      (await ok(call('GET', '/templates?documentType=PID', as))).items.map((i: any) => [
        i.version,
        i.status,
      ]);
    expect(await seen('designer')).toEqual([[1, 'active']]);
    expect(await seen('qa')).toEqual([[1, 'active']]);
    expect(await seen('vp')).toEqual([
      [2, 'draft'],
      [1, 'active'],
    ]);
    expect(await seen('head')).toEqual(await seen('vp'));

    const asDesigner = await call('GET', `/templates/${added.id}`, 'designer');
    expect(asDesigner.status).toBe(403);
    expect(asDesigner.body.whoCan).toEqual(['VP', 'R&D Head']);
  });

  it('checks a new version: it reuses the earlier specification, and a sample PDF is made', async () => {
    const list = await ok(call('GET', '/templates?documentType=PID&status=draft', 'vp'));
    const draft = await ok(call('GET', `/templates/${list.items[0].id}`, 'vp'));
    expect(draft.spec.document_type).toBe('PID');
    expect(draft.spec.reviewed_by).toEqual(['dard']);
    expect(draft.hasSample).toBe(true);

    const links = await ok(call('GET', `/templates/${draft.id}/links`, 'vp'));
    expect(links.sample.url).toMatch(/^http/);
    expect(links.docx.url).toMatch(/^http/);
    // The sample PDF of an active template is for everyone; the Word file isn't.
    const active = await ok(call('GET', '/templates/active?documentType=PID', 'designer'));
    const asDesigner = await ok(call('GET', `/templates/${active.id}/links`, 'designer'));
    expect(asDesigner.sample.url).toMatch(/^http/);
    expect(asDesigner.docx).toBeNull();
  });

  it('activates a version: the previous one is retired, and kept', async () => {
    const [draft] = (await ok(call('GET', '/templates?documentType=PID&status=draft', 'vp'))).items;
    const asDesigner = await call('POST', `/templates/${draft.id}/activate`, 'designer');
    expect(asDesigner.status).toBe(403);

    const activated = await ok(call('POST', `/templates/${draft.id}/activate`, 'head'));
    expect(activated).toMatchObject({
      version: 2,
      status: 'active',
      activatedBy: { name: 'Hari Example' },
    });
    expect(activated.can.activate).toBe(false);

    const all = (await ok(call('GET', '/templates?documentType=PID', 'vp'))).items;
    expect(all.map((i: any) => [i.version, i.status])).toEqual([
      [2, 'active'],
      [1, 'retired'],
    ]);
    const current = await ok(call('GET', '/templates/active?documentType=PID', 'designer'));
    expect(current.version).toBe(2);

    const again = await call('POST', `/templates/${draft.id}/activate`, 'vp');
    expect(again.status).toBe(409);
    // A retired version can be made active again.
    const [retired] = all.filter((i: any) => i.status === 'retired');
    const rolledBack = await ok(call('POST', `/templates/${retired.id}/activate`, 'vp'));
    expect(rolledBack).toMatchObject({ version: 1, status: 'active' });
    expect((await ok(call('GET', '/templates/active?documentType=PID', 'vp'))).version).toBe(1);
    await ok(call('POST', `/templates/${draft.id}/activate`, 'vp'));
  });

  it('is for the VP and the Head: nobody else uploads', async () => {
    const res = await addTemplate('designer', sampleDocx(sample('PID')));
    expect(res.status).toBe(403);
    expect(res.body.whoCan).toEqual(['VP', 'R&D Head']);
  });

  it('refuses a Word file that uses a placeholder the specification does not define', async () => {
    const docx = buildDocx(
      [...blocksFromSpec(sample('PID').spec), { type: 'text', text: '{stray}' }],
      'x',
    );
    const res = await addTemplate('vp', docx);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(errors(res)).toEqual([expect.stringContaining('{stray}')]);
  });

  it('refuses a Word file that lacks a placeholder the specification defines', async () => {
    const spec = structuredClone(sample('PID').spec);
    spec.sections = spec.sections.filter((s) => s.id !== 'risks');
    const res = await addTemplate('vp', buildDocx(blocksFromSpec(spec), 'x'));
    expect(res.status).toBe(400);
    expect(errors(res)).toEqual([expect.stringContaining('"risks"')]);
  });

  it('refuses a table written as a single value, and says how to write it', async () => {
    const blocks = blocksFromSpec(sample('PID').spec).map((b) =>
      b.type === 'loop' ? ({ type: 'text', text: '{members}' } as const) : b,
    );
    const res = await addTemplate('vp', buildDocx(blocks, 'x'));
    expect(res.status).toBe(400);
    expect(errors(res)[0]).toContain('{#members}');
  });

  it('refuses a Word file with a broken placeholder', async () => {
    const blocks = [
      ...blocksFromSpec(sample('PID').spec),
      { type: 'text', text: 'Broken {purpose' } as const,
    ];
    const res = await addTemplate('vp', buildDocx(blocks, 'x'));
    expect(res.status).toBe(400);
    expect(errors(res)[0]).toMatch(/unclosed/);
  });

  it('refuses a file that is not a Word document', async () => {
    const fileId = await w.upload('vp', 'notes.docx', new TextEncoder().encode('just some text'));
    const res = await call('POST', '/templates', 'vp', { documentType: 'PID', docxFileId: fileId });
    expect(res.status).toBe(400);
    expect(errors(res)).toEqual([expect.stringContaining('not a Word')]);

    const pdf = await w.upload('vp', 'form.pdf', new TextEncoder().encode('%PDF-1.4'));
    const wrongType = await call('POST', '/templates', 'vp', {
      documentType: 'PID',
      docxFileId: pdf,
    });
    expect(wrongType.status).toBe(400);
    expect(wrongType.body.errors[0].message).toContain('Word');
  });

  it('refuses a specification for another document type, or for steps the type does not belong to', async () => {
    const other = structuredClone(sample('MRS').spec);
    const res = await addTemplate('vp', buildDocx(blocksFromSpec(other), 'x'), { spec: other });
    expect(res.status).toBe(400);
    expect(errors(res)[0]).toContain('MRS');

    const wrongStep = { ...structuredClone(sample('PID').spec), steps: ['5'] };
    const second = await addTemplate('vp', sampleDocx(sample('PID')), { spec: wrongStep });
    expect(second.status).toBe(400);
    expect(errors(second)[0]).toContain('step 1');

    const badRole = { ...structuredClone(sample('PID').spec), reviewed_by: ['wizard'] };
    const third = await addTemplate('vp', sampleDocx(sample('PID')), { spec: badRole });
    expect(third.status).toBe(400);
    expect(errors(third)[0]).toContain('wizard');
  });

  it('refuses templates for documents that are not made from one', async () => {
    const fileId = await w.upload('vp', 'form.docx', sampleDocx(sample('PID')));
    const res = await call('POST', '/templates', 'vp', { documentType: 'DOC', docxFileId: fileId });
    expect(res.status).toBe(400);
  });

  it('does not take someone else’s upload', async () => {
    const fileId = await w.upload('head', 'form.docx', sampleDocx(sample('PID')));
    const res = await call('POST', '/templates', 'vp', { documentType: 'PID', docxFileId: fileId });
    expect(res.status).toBe(403);
  });

  it('saves nothing when the PDF cannot be made', async () => {
    const before = (await ok(call('GET', '/templates?documentType=PID', 'vp'))).items.length;
    t.pdf.fail = true;
    try {
      const res = await addTemplate('vp', sampleDocx(sample('PID')));
      expect(res.status).toBe(502);
      expect(res.body.code).toBe('PDF_UNAVAILABLE');
    } finally {
      t.pdf.fail = false;
    }
    expect((await ok(call('GET', '/templates?documentType=PID', 'vp'))).items.length).toBe(before);
  });

  it('records who added and who activated each version in the audit trail', async () => {
    const { auditEvents } = await import('../src/modules/audit/tables');
    const rows = await t.deps.db.select().from(auditEvents);
    const actions = rows.filter((r) => r.recordType === 'template').map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining(['template.added', 'template.activated', 'template.retired']),
    );
  });
});

describe('the import command', () => {
  const folder = mkdtempSync(join(tmpdir(), 'coal-import-'));
  const ctx = () => systemContext(DEFAULT_ORG_ID, 'import');
  const spec = sample('MRS').spec;

  it('saves a form and its specification as a draft, for the VP or the Head to activate', async () => {
    writeFileSync(join(folder, 'MRS.docx'), sampleDocx(sample('MRS')));
    writeFileSync(join(folder, 'MRS.spec.yaml'), stringify(spec));
    const results = await importTemplateFolder(t.deps, ctx(), folder);
    expect(results).toEqual([
      { name: 'MRS', ok: true, lines: [expect.stringContaining('MRS version 2 saved as a draft')] },
    ]);
    const drafts = (await ok(call('GET', '/templates?documentType=MRS&status=draft', 'vp'))).items;
    expect(drafts).toMatchObject([
      { version: 2, status: 'draft', addedBy: { name: 'COAL (loaded by command)' } },
    ]);
    const active = await ok(call('GET', '/templates/active?documentType=MRS', 'designer'));
    expect(active.version).toBe(1);
  });

  it('says what is wrong with each form that fails, and carries on with the rest', async () => {
    writeFileSync(join(folder, 'NODOCX.spec.yaml'), stringify(spec));
    writeFileSync(join(folder, 'BAD.docx'), sampleDocx(sample('MRS')));
    writeFileSync(
      join(folder, 'BAD.spec.yaml'),
      stringify({ ...spec, document_type: 'mrs lowercase' }),
    );
    writeFileSync(join(folder, 'STRAY.docx'), sampleDocx(sample('PID')));
    writeFileSync(join(folder, 'STRAY.spec.yaml'), stringify(spec));
    const results = await importTemplateFolder(t.deps, ctx(), folder);
    const byName = Object.fromEntries(results.map((r) => [r.name, r]));
    expect(byName.NODOCX).toMatchObject({
      ok: false,
      lines: [expect.stringContaining('NODOCX.docx is missing')],
    });
    expect(byName.BAD).toMatchObject({ ok: false });
    expect(byName.BAD!.lines.join('\n')).toContain('document_type');
    // A Word file that doesn't match the specification beside it is refused, naming the placeholders.
    expect(byName.STRAY!.ok).toBe(false);
    expect(byName.STRAY!.lines.join('\n')).toContain('The specification defines');
  });

  it('does nothing for a folder that is not there', async () => {
    expect(await importTemplateFolder(t.deps, ctx(), join(folder, 'missing'))).toEqual([]);
  });
});
