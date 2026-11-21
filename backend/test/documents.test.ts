import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ORG_ID } from '../src/core/config';
import { OutboxDispatcher } from '../src/modules/events/dispatcher';
import { SUBSCRIPTIONS } from '../src/modules/events/subscriptions';
import { systemContext } from '../src/core/http/context';
import { decisions } from '../src/modules/process/tables';
import { documentVersions, signatures } from '../src/modules/documents/tables';
import { SAMPLE_TEMPLATES, sampleDocx } from '../src/modules/templates/samples';
import { loadSampleTemplates } from '../src/modules/templates/service';
import { templates } from '../src/modules/templates/tables';
import { createTestApp, type TestApp } from './helpers';
import { createWorld, type World } from './world';

let t: TestApp;
let w: World;

beforeAll(async () => {
  t = await createTestApp();
  w = await createWorld(t);
  await loadSampleTemplates(t.deps, systemContext(DEFAULT_ORG_ID));
});
afterAll(async () => {
  await t?.close();
});

const call = (...args: Parameters<World['call']>) => w.call(...args);
const ok = (res: Promise<{ status: number; body: any }>) => w.ok(res);

const PDF = new TextEncoder().encode('%PDF-1.4 made-up drawing');

const FIELDS = { target_markets: 'India and the UAE', launch_year: '2028' };
const SECTIONS = { purpose: 'A made-up clinical need for a spine plate.', risks: 'None known.' };

const makeDoc = (id: string, as: string, body: Record<string, unknown>) =>
  call('POST', `/projects/${id}/documents`, as, body);
const makePid = (id: string, as = 'head') =>
  ok(makeDoc(id, as, { stepKey: '1', documentType: 'PID' }));
const save = (docId: string, as: string, body: Record<string, unknown>) =>
  call('POST', `/documents/${docId}/versions`, as, body);
const submit = (docId: string, n: number, as: string, preview = false) =>
  call('POST', `/documents/${docId}/versions/${n}/submit${preview ? '?preview=true' : ''}`, as);
const open = (docId: string, as: string, version?: number) =>
  call('GET', `/documents/${docId}${version ? `?version=${version}` : ''}`, as);
const rowOf = (doc: any, meaning: string) =>
  doc.current.requests.find((r: any) => r.meaning === meaning);
const sign = (doc: any, meaning: string, as: string, preview = false) =>
  call(
    'POST',
    `/signature-requests/${rowOf(doc, meaning).id}/sign${preview ? '?preview=true' : ''}`,
    as,
  );

/** Fills a PID in and submits it for signing: ready for the reviewer. */
async function submittedPid(id: string, as = 'head') {
  const doc = await makePid(id, as);
  await ok(save(doc.id, as, { fields: FIELDS, sections: SECTIONS }));
  const sent = await ok(submit(doc.id, 2, as));
  return sent.document;
}

const projectCode = async (id: string) => (await ok(call('GET', `/projects/${id}`, 'vp'))).code;

describe('making a document', () => {
  it('fills a template from the project’s records, numbers it, and makes the PDF', async () => {
    const id = await w.go('Plate A');
    const code = await projectCode(id);
    const doc = await makePid(id);

    expect(doc).toMatchObject({
      number: `${code}-PID-01`,
      title: 'Project Initiation Document',
      status: 'draft',
      stepKey: '1',
      type: { code: 'PID', kind: 'template', sensitivity: 'normal' },
      template: { version: 1 },
      latestVersionNo: 1,
      restricted: false,
      createdBy: { name: 'Hari Example' },
      can: { edit: true, submit: true },
    });
    expect(doc.current).toMatchObject({
      versionNo: 1,
      status: 'draft',
      hasPdf: true,
      carried: false,
    });
    expect(doc.current.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.current.content.fields).toMatchObject({
      project_code: code,
      project_name: 'Plate A',
      product_line: 'Spine',
      document_number: `${code}-PID-01`,
      prepared_by: 'Hari Example',
      target_markets: '',
    });
    expect(doc.current.content.fields.members.map((m: any) => m.name)).toContain('Dev Example');
    expect(doc.signatureRows).toEqual([
      {
        meaning: 'prepared',
        roles: [
          { key: 'rd_head', name: 'R&D Head' },
          { key: 'rd_lead', name: 'R&D Lead' },
        ],
      },
      { meaning: 'reviewed', roles: [{ key: 'dard', name: 'DARD' }] },
      { meaning: 'approved', roles: [{ key: 'vp', name: 'VP' }] },
    ]);
    expect(doc.spec.document_type).toBe('PID');

    const second = await makePid(id, 'lead');
    expect(second.number).toBe(`${code}-PID-02`);
  });

  it('lets only the doers of a step make documents there', async () => {
    const id = await w.go('Plate B');
    const asDesigner = await makeDoc(id, 'designer', { stepKey: '1', documentType: 'PID' });
    expect(asDesigner.status).toBe(403);
    expect(asDesigner.body.whoCan).toEqual(['R&D Head', 'R&D Lead']);
    const otherLine = await makeDoc(id, 'leadOther', { stepKey: '1', documentType: 'PID' });
    expect(otherLine.status).toBe(403);
    const wrongStep = await makeDoc(id, 'head', { stepKey: '2', documentType: 'PID' });
    expect(wrongStep.status).toBe(400);
    expect(wrongStep.body.errors[0].message).toContain('step 1');
    const locked = await makeDoc(id, 'head', { stepKey: '3', documentType: 'APPROVAL_FORM' });
    expect(locked.status).toBe(409);
    expect(locked.body.code).toBe('DOCUMENT_LOCKED');
  });

  it('says so when a type has no template yet, and takes an upload instead', async () => {
    const id = await w.go('Plate C');
    await t.deps.db
      .update(templates)
      .set({ status: 'retired' })
      .where(sql`true`);
    const none = await makeDoc(id, 'lead', { stepKey: '2a', documentType: 'REG_PLAN' });
    expect(none.status).toBe(409);
    expect(none.body.code).toBe('NO_TEMPLATE');

    const fileId = await w.upload('lead', 'Regulatory plan.pdf', PDF);
    const uploaded = await ok(
      makeDoc(id, 'lead', { stepKey: '2a', documentType: 'REG_PLAN', fileId }),
    );
    expect(uploaded).toMatchObject({ template: null, spec: null, type: { code: 'REG_PLAN' } });
    expect(uploaded.current.file.name).toBe('Regulatory plan.pdf');
    await t.deps.db
      .update(templates)
      .set({ status: 'active' })
      .where(sql`${templates.version} = 1`);
  });

  it('takes an uploaded document of its own kind, with the same versions and signatures', async () => {
    const id = await w.go('Plate D');
    const noFile = await makeDoc(id, 'ops', {
      stepKey: '2',
      documentType: 'DOC',
      title: 'Survey data',
    });
    expect(noFile.status).toBe(400);

    const fileId = await w.upload('ops', 'survey.pdf', PDF);
    const doc = await ok(
      makeDoc(id, 'ops', { stepKey: '2', documentType: 'DOC', title: 'Survey data', fileId }),
    );
    expect(doc.number).toMatch(/-DOC-01$/);
    expect(doc.current.contentSha256).toBe(createHash('sha256').update(PDF).digest('hex'));
    expect(doc.current.pdfSha256).toBe(doc.current.contentSha256);

    // Someone else's upload can't be used.
    const theirs = await w.upload('designer', 'theirs.pdf', PDF);
    expect(
      (await makeDoc(id, 'ops', { stepKey: '2', documentType: 'DOC', fileId: theirs })).status,
    ).toBe(403);

    const newer = new TextEncoder().encode('%PDF-1.4 made-up survey, revised');
    const second = await ok(
      save(doc.id, 'ops', {
        fileId: await w.upload('ops', 'survey 2.pdf', newer),
        note: 'More answers',
      }),
    );
    expect(second.versions.map((v: any) => v.versionNo)).toEqual([2, 1]);
    expect((await save(doc.id, 'ops', {})).status).toBe(400);

    // It goes through the signature rows: prepared by Om, approved by the step's signer, the VP.
    const sent = await ok(submit(doc.id, 2, 'ops'));
    expect(sent.document.status).toBe('in_review');
    const approved = await ok(sign(sent.document, 'approved', 'vp'));
    expect(approved.document).toMatchObject({ status: 'approved', approvedRev: 'A' });
    const compare = await call('GET', `/documents/${doc.id}/compare?from=1&to=2`, 'ops');
    expect(compare.status).toBe(400);
  });
});

describe('versions', () => {
  it('saves each draft as a new version and never overwrites one', async () => {
    const id = await w.go('Plate E');
    const doc = await makePid(id);
    const v2 = await ok(
      save(doc.id, 'head', { fields: FIELDS, sections: SECTIONS, note: 'First pass' }),
    );
    expect(v2.latestVersionNo).toBe(2);
    expect(v2.current).toMatchObject({ versionNo: 2, note: 'First pass', status: 'draft' });
    expect(v2.current.content.fields.target_markets).toBe(FIELDS.target_markets);
    expect(v2.current.content.sections.purpose).toBe(SECTIONS.purpose);

    // Saving what is already saved makes no new version.
    const same = await ok(save(doc.id, 'head', { fields: FIELDS, sections: SECTIONS }));
    expect(same.versions).toHaveLength(2);

    // What is not mentioned stays; what is sent changes.
    const v3 = await ok(save(doc.id, 'head', { sections: { purpose: 'A sharper need.' } }));
    expect(v3.current.content.fields.target_markets).toBe(FIELDS.target_markets);
    expect(v3.current.content.sections).toMatchObject({
      purpose: 'A sharper need.',
      risks: 'None known.',
    });

    // Version 1 is as it was.
    const first = await ok(open(doc.id, 'head', 1));
    expect(first.current.content.fields.target_markets).toBe('');
    expect(first.versions.map((v: any) => v.versionNo)).toEqual([3, 2, 1]);
  });

  it('fills record fields itself: a person cannot type over them, or invent others', async () => {
    const id = await w.go('Plate F');
    const code = await projectCode(id);
    const doc = await makePid(id);
    const typed = await ok(
      save(doc.id, 'head', { fields: { project_code: 'HACKED', target_markets: 'India' } }),
    );
    expect(typed.current.content.fields.project_code).toBe(code);
    expect(typed.current.content.fields.target_markets).toBe('India');

    const unknown = await save(doc.id, 'head', { fields: { colour: 'red' } });
    expect(unknown.status).toBe(400);
    const badSection = await save(doc.id, 'head', { sections: { nothing: 'x' } });
    expect(badSection.status).toBe(400);
  });

  it('makes a PDF of each version, from the filled Word file', async () => {
    const id = await w.go('Plate G');
    const doc = await makePid(id);
    const v2 = await ok(save(doc.id, 'head', { fields: FIELDS, sections: SECTIONS }));
    const links = await ok(call('GET', `/documents/${doc.id}/versions/2/links`, 'head'));
    const pdf = Buffer.from(await (await fetch(links.pdf.url)).arrayBuffer());
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.toString()).toContain('India and the UAE');
    expect(createHash('sha256').update(pdf).digest('hex')).toBe(v2.current.pdfSha256);
    expect(links.file).toBeNull();
  });

  it('saves nothing when the PDF cannot be made', async () => {
    const id = await w.go('Plate H');
    const doc = await makePid(id);
    t.pdf.fail = true;
    try {
      const res = await save(doc.id, 'head', { fields: FIELDS });
      expect(res.status).toBe(502);
      expect(res.body.code).toBe('PDF_UNAVAILABLE');
    } finally {
      t.pdf.fail = false;
    }
    expect((await ok(open(doc.id, 'head'))).versions).toHaveLength(1);
  });

  it('compares two versions: fields side by side, written sections as a text difference', async () => {
    const id = await w.go('Plate I');
    const doc = await makePid(id);
    await ok(
      save(doc.id, 'head', {
        fields: FIELDS,
        sections: { purpose: 'The knee implant is sterile.' },
      }),
    );
    await ok(
      save(doc.id, 'head', { sections: { purpose: 'The hip implant is sterile and sealed.' } }),
    );
    const diff = await ok(call('GET', `/documents/${doc.id}/compare?from=2&to=3`, 'head'));
    expect(diff.fields.find((f: any) => f.key === 'target_markets')).toMatchObject({
      changed: false,
    });
    const purpose = diff.sections.find((s: any) => s.id === 'purpose');
    expect(purpose.changed).toBe(true);
    expect(purpose.parts).toEqual([
      { type: 'same', text: 'The ' },
      { type: 'removed', text: 'knee' },
      { type: 'added', text: 'hip' },
      { type: 'same', text: ' implant is ' },
      { type: 'removed', text: 'sterile.' },
      { type: 'added', text: 'sterile and sealed.' },
    ]);
    const missing = await call('GET', `/documents/${doc.id}/compare?from=1&to=9`, 'head');
    expect(missing.status).toBe(404);
  });
});

describe('signing a document', () => {
  it('will not submit while required parts are empty', async () => {
    const id = await w.go('Plate J');
    const doc = await makePid(id);
    const res = await submit(doc.id, 1, 'head');
    expect(res.status).toBe(400);
    expect(res.body.errors[0].message).toContain('Purpose and clinical need');
    expect(res.body.errors[0].message).toContain('Target markets');
  });

  it('previews the rows without saving anything, then signs them in order', async () => {
    const id = await w.go('Plate K');
    const doc = await makePid(id);
    await ok(save(doc.id, 'head', { fields: FIELDS, sections: SECTIONS }));

    const preview = await ok(submit(doc.id, 2, 'head', true));
    expect(preview).toMatchObject({ saved: false, document: null });
    expect(preview.preview.rows).toEqual([
      { meaning: 'prepared', who: 'Hari Example (you)', byYou: true },
      { meaning: 'reviewed', who: 'DARD', byYou: false },
      { meaning: 'approved', who: 'VP', byYou: false },
    ]);
    expect((await ok(open(doc.id, 'head'))).status).toBe('draft');

    const sent = (await ok(submit(doc.id, 2, 'head'))).document;
    expect(sent.status).toBe('in_review');
    expect(sent.current.requests.map((r: any) => [r.meaning, r.status])).toEqual([
      ['prepared', 'signed'],
      ['reviewed', 'pending'],
      ['approved', 'waiting'],
    ]);
    expect(sent.current.signatures).toMatchObject([
      { meaning: 'prepared', by: { name: 'Hari Example', role: 'R&D Head' } },
    ]);

    // While it is with the signers, it can't be edited.
    const edit = await save(doc.id, 'head', { sections: { purpose: 'Changed my mind.' } });
    expect(edit.status).toBe(409);
    expect(edit.body.code).toBe('DOCUMENT_LOCKED');
    expect((await submit(doc.id, 2, 'head')).status).toBe(409);

    // What waits for whom.
    const waiting = async (as: string) => (await ok(call('GET', '/signature-requests', as))).items;
    expect(await waiting('dard')).toMatchObject([
      { meaning: 'reviewed', number: sent.number, versionNo: 2, stepKey: '1' },
    ]);
    expect(await waiting('vp')).toEqual([]);
    expect(await waiting('designer')).toEqual([]);

    // Only the reviewer reviews, and the approver waits for the reviewer.
    const asDesigner = await sign(sent, 'reviewed', 'designer');
    expect(asDesigner.status).toBe(403);
    expect(asDesigner.body.whoCan).toEqual(['DARD']);
    expect((await sign(sent, 'approved', 'vp')).status).toBe(409);

    const reviewed = (await ok(sign(sent, 'reviewed', 'dard'))).document;
    expect(reviewed.status).toBe('in_review');
    expect(reviewed.current.requests.map((r: any) => r.status)).toEqual([
      'signed',
      'signed',
      'pending',
    ]);
    expect(await waiting('vp')).toMatchObject([{ meaning: 'approved' }]);
    expect(reviewed.current.requests.find((r: any) => r.meaning === 'approved').can.sign).toBe(
      false,
    );
    expect(
      (await ok(open(doc.id, 'vp'))).current.requests.find((r: any) => r.meaning === 'approved').can
        .sign,
    ).toBe(true);

    const previewSign = await ok(sign(reviewed, 'approved', 'vp', true));
    expect(previewSign).toMatchObject({ saved: false, document: null });
    expect(previewSign.preview.warnings[0]).toContain('last signature');
    expect((await ok(open(doc.id, 'vp'))).status).toBe('in_review');

    const approved = (await ok(sign(reviewed, 'approved', 'vp'))).document;
    expect(approved).toMatchObject({ status: 'approved', approvedRev: 'A' });
    expect(approved.current).toMatchObject({ status: 'approved', revLabel: 'A' });
    expect(approved.current.signatures.map((s: any) => [s.meaning, s.by.name])).toEqual([
      ['prepared', 'Hari Example'],
      ['reviewed', 'Dina Example'],
      ['approved', 'Vera Example'],
    ]);
    expect((await sign(approved, 'approved', 'vp')).status).toBe(409);
    expect((await sign(approved, 'approved', 'vp')).body.code).toBe('ALREADY_DONE');

    // Each signature is tied to the version's content and PDF hashes.
    const rows = await t.deps.db
      .select()
      .from(signatures)
      .where(eq(signatures.subjectId, approved.current.id));
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.contentSha256).toBe(approved.current.contentSha256);
      expect(row.pdfSha256).toBe(approved.current.pdfSha256);
      expect(row.method).toBe('click');
    }
  });

  it('warns in the preview when nobody who could sign a row is on the project', async () => {
    const id = await w.go('Plate K2', w.ids('designer', 'pme', 'ops', 'qc'));
    const doc = await makePid(id);
    await ok(save(doc.id, 'head', { fields: FIELDS, sections: SECTIONS }));
    const preview = await ok(submit(doc.id, 2, 'head', true));
    expect(preview.preview.warnings).toEqual([
      expect.stringContaining('Nobody holding the DARD role is on this project'),
    ]);
    // Adding the DARD to the team clears it.
    await ok(
      call('PUT', `/projects/${id}/team`, 'head', {
        userIds: w.ids('designer', 'pme', 'ops', 'qc', 'dard', 'head', 'lead'),
      }),
    );
    expect((await ok(submit(doc.id, 2, 'head', true))).preview.warnings).toEqual([]);
  });

  it('returns a document to its authors with a comment, and signing starts over on the next version', async () => {
    const id = await w.go('Plate L');
    const sent = await submittedPid(id);
    const reviewer = rowOf(sent, 'reviewed');
    const short = await call('POST', `/signature-requests/${reviewer.id}/return`, 'dard', {
      comment: 'x',
    });
    expect(short.status).toBe(400);
    const returned = (
      await ok(
        call('POST', `/signature-requests/${reviewer.id}/return`, 'dard', {
          comment: 'Please add the markets in Asia.',
        }),
      )
    ).document;
    expect(returned.status).toBe('returned');
    expect(returned.current.requests.map((r: any) => r.status)).toEqual([
      'signed',
      'returned',
      'cancelled',
    ]);
    expect(rowOf(returned, 'reviewed')).toMatchObject({
      returnComment: 'Please add the markets in Asia.',
      returnedBy: { name: 'Dina Example' },
    });

    // The authors revise as a new version, and submit again.
    const revised = await ok(
      save(sent.id, 'head', { fields: { target_markets: 'India, the UAE and Asia' } }),
    );
    expect(revised.status).toBe('draft');
    expect(revised.versions.map((v: any) => [v.versionNo, v.status])).toEqual([
      [3, 'draft'],
      [2, 'returned'],
      [1, 'draft'],
    ]);
    const again = (await ok(submit(sent.id, 3, 'head'))).document;
    expect(again.current.requests.map((r: any) => r.status)).toEqual([
      'signed',
      'pending',
      'waiting',
    ]);
  });

  it('keeps the same person from preparing and approving the same version', async () => {
    // A template that names the Head as the approver, so a Head who prepares it can't also approve it.
    const base = structuredClone(
      SAMPLE_TEMPLATES.find((s) => s.spec.document_type === 'PID')!.spec,
    );
    const spec = {
      ...base,
      signature_rows: ['prepared', 'approved'] as const,
      reviewed_by: [],
      approved_by: ['rd_head'],
    };
    const original = (await ok(call('GET', '/templates/active?documentType=PID', 'vp'))).id;
    const fileId = await w.upload(
      'vp',
      'pid.docx',
      sampleDocx({ spec: spec as never, intro: 'Head approves' }),
    );
    const added = await ok(
      call('POST', '/templates', 'vp', { documentType: 'PID', docxFileId: fileId, spec }),
    );
    await ok(call('POST', `/templates/${added.id}/activate`, 'vp'));
    try {
      const id = await w.go('Plate M');
      const doc = await makePid(id);
      await ok(save(doc.id, 'head', { fields: FIELDS, sections: SECTIONS }));
      const sent = (await ok(submit(doc.id, 2, 'head'))).document;
      expect(sent.current.requests.map((r: any) => [r.meaning, r.status])).toEqual([
        ['prepared', 'signed'],
        ['approved', 'pending'],
      ]);
      const asPreparer = await sign(sent, 'approved', 'head');
      expect(asPreparer.status).toBe(403);
      expect(asPreparer.body.code).toBe('SEPARATION_OF_DUTIES');
      expect((await ok(open(doc.id, 'head'))).current.requests[1].can.sign).toBe(false);
      expect(await ok(call('GET', '/signature-requests', 'head'))).toEqual({ items: [] });

      const approved = (await ok(sign(sent, 'approved', 'head2'))).document;
      expect(approved).toMatchObject({ status: 'approved', approvedRev: 'A' });
    } finally {
      await ok(call('POST', `/templates/${original}/activate`, 'vp'));
    }
  });

  it('gives a second approval a new revision letter, and supersedes the first', async () => {
    const id = await w.go('Plate N');
    const draft = await ok(makeDoc(id, 'lead', { stepKey: '2a', documentType: 'REG_PLAN' }));
    expect(draft.signatureRows.map((r: any) => r.meaning)).toEqual(['prepared']);
    await ok(save(draft.id, 'lead', { sections: { bodies: 'A made-up notified body.' } }));
    // Step 2a has no sign-off, so the author's signature is the last: it is approved on submitting.
    const first = (await ok(submit(draft.id, 2, 'lead'))).document;
    expect(first).toMatchObject({ status: 'approved', approvedRev: 'A' });

    // Changing an approved document is a new revision that goes through signing again.
    const next = await ok(save(draft.id, 'lead', { sections: { bodies: 'Two made-up bodies.' } }));
    expect(next).toMatchObject({ status: 'draft', approvedRev: 'A' });
    const second = (await ok(submit(draft.id, 3, 'lead'))).document;
    expect(second).toMatchObject({ status: 'approved', approvedRev: 'B' });
    expect(second.versions.map((v: any) => [v.versionNo, v.status, v.revLabel])).toEqual([
      [3, 'approved', 'B'],
      [2, 'superseded', 'A'],
      [1, 'draft', null],
    ]);
  });

  it('asks the reviewer to sign, by a work message, when a version is submitted', async () => {
    const id = await w.go('Plate notify');
    const sent = await submittedPid(id);
    await new OutboxDispatcher(t.deps.db, SUBSCRIPTIONS).drain();
    const dard = (await ok(call('GET', '/notifications?limit=100', 'dard'))).items.filter(
      (n: any) => n.projectId === id,
    );
    const message = dard.find((n: any) => n.title === `Sign ${sent.number}`);
    expect(message.body).toMatch(
      /^Your signature is needed on SPN-\d\d-\d+: step 1, Project inception\./,
    );
    expect(message.link).toBe(`/projects/${id}/documents/${sent.id}`);
    // The step's own sign-off is asked through its task, not through a second message.
    const vp = (await ok(call('GET', '/notifications?limit=100', 'vp'))).items.filter(
      (n: any) => n.projectId === id && n.title.startsWith('Sign '),
    );
    expect(vp).toHaveLength(0);
  });

  it('refuses everything while the project is on hold', async () => {
    const id = await w.go('Plate O');
    const sent = await submittedPid(id);
    await ok(call('POST', `/projects/${id}/hold`, 'vp', { reason: 'Waiting for funds' }));
    const res = await sign(sent, 'reviewed', 'dard');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROJECT_NOT_ACTIVE');
    expect((await save(sent.id, 'head', { fields: { launch_year: '2030' } })).status).toBe(409);
  });
});

/** The database's own refusal, which drizzle wraps in a "Failed query" error. */
const refused = async (change: PromiseLike<unknown>, pattern: RegExp) => {
  const error = await Promise.resolve(change).then(
    () => null,
    (e: Error & { cause?: Error }) => e,
  );
  expect(error).not.toBeNull();
  expect(`${error!.message} ${error!.cause?.message ?? ''}`).toMatch(pattern);
};

describe('what a version is made of cannot change', () => {
  it('refuses, in the database, changes to a saved version, a signature, or a revision letter', async () => {
    const id = await w.go('Plate P');
    const sent = await submittedPid(id);
    const versionId = sent.current.id;
    await refused(
      t.deps.db
        .update(documentVersions)
        .set({ contentSha256: 'x' })
        .where(eq(documentVersions.id, versionId)),
      /cannot be changed/,
    );
    await refused(
      t.deps.db
        .update(documentVersions)
        .set({ content: { fields: {}, sections: {} } })
        .where(eq(documentVersions.id, versionId)),
      /cannot be changed/,
    );
    await refused(
      t.deps.db.delete(documentVersions).where(eq(documentVersions.id, versionId)),
      /cannot be deleted/,
    );
    await refused(t.deps.db.update(signatures).set({ printedName: 'Someone else' }), /insert-only/);
    await refused(t.deps.db.delete(signatures), /insert-only/);

    const approved = (await ok(sign(sent, 'reviewed', 'dard'))).document;
    const done = (await ok(sign(approved, 'approved', 'vp'))).document;
    await refused(
      t.deps.db
        .update(documentVersions)
        .set({ status: 'draft' })
        .where(eq(documentVersions.id, done.current.id)),
      /cannot go back/,
    );
    await refused(
      t.deps.db
        .update(documentVersions)
        .set({ revLabel: 'Z' })
        .where(eq(documentVersions.id, done.current.id)),
      /revision letter/,
    );
  });
});

describe('step sign-off records', () => {
  it('is made when a step is submitted, listing its outputs and hashes, and signed with the step', async () => {
    const id = await w.go('Plate Q');
    const code = await projectCode(id);
    const draft = await makePid(id);
    await ok(save(draft.id, 'head', { fields: FIELDS, sections: SECTIONS }));

    const preview = await ok(call('POST', `/projects/${id}/steps/1/submit?preview=true`, 'head'));
    expect(preview.preview.warnings).toEqual([
      expect.stringContaining(`${code}-PID-01 is not approved yet`),
    ]);

    await ok(call('POST', `/projects/${id}/steps/1/submit`, 'head'));
    const list = (await ok(call('GET', `/projects/${id}/documents?step=1`, 'head'))).items;
    const record = list.find((d: any) => d.type.code === 'STEP_SIGNOFF');
    expect(record).toMatchObject({
      number: `${code}-SO-01`,
      status: 'in_review',
      title: 'Step 1 sign-off: Project inception',
    });

    const detail = await ok(open(record.id, 'head'));
    expect(detail.current.content.fields).toMatchObject({
      project: `${code} · Plate Q`,
      step: '1 · Project inception',
      iteration: '1',
      prepared_by: 'Hari Example',
    });
    const [output] = detail.current.content.fields.outputs;
    expect(output).toMatchObject({ number: `${code}-PID-01`, version: '2', status: 'draft' });
    expect(output.content_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(detail.current.requests.map((r: any) => [r.meaning, r.status, r.can.sign])).toEqual([
      ['prepared', 'signed', false],
      ['approved', 'pending', false],
    ]);
    expect(detail.current.hasPdf).toBe(true);

    // It is signed by signing off the step, never on its own.
    const direct = await sign(detail, 'approved', 'vp');
    expect(direct.status).toBe(409);
    expect(direct.body.code).toBe('DOCUMENT_LOCKED');
    expect(await ok(call('GET', '/signature-requests', 'vp'))).toEqual({ items: [] });

    await ok(call('POST', `/projects/${id}/steps/1/approve`, 'vp'));
    const signed = await ok(open(record.id, 'vp'));
    expect(signed).toMatchObject({ status: 'approved', approvedRev: 'A' });
    expect(signed.current.signatures.map((s: any) => [s.meaning, s.by.name])).toEqual([
      ['prepared', 'Hari Example'],
      ['approved', 'Vera Example'],
    ]);
    // Documents can't change once the step is signed off.
    expect((await save(draft.id, 'head', { fields: { launch_year: '2031' } })).status).toBe(409);
  });

  it('goes back to the authors when the signer returns the step, and a new one is made on resubmitting', async () => {
    const id = await w.go('Plate R');
    await w.attach(id, '1');
    await ok(call('POST', `/projects/${id}/steps/1/submit`, 'head'));
    await ok(
      call('POST', `/projects/${id}/steps/1/return`, 'vp', { comment: 'The team is missing.' }),
    );
    const recordOf = async () =>
      (await ok(call('GET', `/projects/${id}/documents?step=1`, 'head'))).items.find(
        (d: any) => d.type.code === 'STEP_SIGNOFF',
      );
    const record = await recordOf();
    expect(record).toMatchObject({ status: 'returned', latestVersionNo: 1 });

    await ok(call('POST', `/projects/${id}/steps/1/submit`, 'head'));
    const again = await recordOf();
    expect(again).toMatchObject({ id: record.id, status: 'in_review', latestVersionNo: 2 });
    await ok(call('POST', `/projects/${id}/steps/1/approve`, 'vp'));
    const done = await ok(open(record.id, 'vp'));
    expect(done.versions.map((v: any) => [v.versionNo, v.status])).toEqual([
      [2, 'approved'],
      [1, 'returned'],
    ]);
  });

  it('is signed by every Board member at a Board step, and approved when the last one signs', async () => {
    const id = await w.go('Plate S');
    await w.advance(id, '3');
    await ok(call('POST', `/projects/${id}/steps/4/submit`, 'vp'));
    const [record] = (await ok(call('GET', `/projects/${id}/documents?step=4`, 'vp'))).items;
    const requestsOf = async () =>
      (await ok(open(record.id, 'vp'))).current.requests.map((r: any) => [
        r.meaning,
        r.assignee?.name,
        r.status,
      ]);
    expect(await requestsOf()).toEqual([
      ['prepared', 'Vera Example', 'signed'],
      ['approved', 'Chet Example', 'pending'],
      ['approved', 'Mira Example', 'pending'],
    ]);
    await ok(call('POST', `/projects/${id}/steps/4/approve`, 'md'));
    expect((await ok(open(record.id, 'vp'))).status).toBe('in_review');
    expect(await requestsOf()).toEqual([
      ['prepared', 'Vera Example', 'signed'],
      ['approved', 'Chet Example', 'pending'],
      ['approved', 'Mira Example', 'signed'],
    ]);
    await ok(call('POST', `/projects/${id}/steps/4/approve`, 'ceo'));
    expect(await ok(open(record.id, 'vp'))).toMatchObject({ status: 'approved' });
  });
});

describe('a step needs its documents before it is submitted', () => {
  const stepView = async (id: string, key: string) => w.stepOf(id, key, 'head');
  const records = async (id: string, key: string) =>
    (await ok(call('GET', `/projects/${id}/documents?step=${key}`, 'head'))).items.filter(
      (d: any) => d.type.code === 'STEP_SIGNOFF',
    );

  it('refuses a step with no document, and makes no sign-off record', async () => {
    const id = await w.go('Plate DN1');
    expect((await stepView(id, '1')).documentNeeds).toEqual([
      'Project Initiation Document: not made or uploaded yet.',
    ]);
    for (const url of [
      `/projects/${id}/steps/1/submit`,
      `/projects/${id}/steps/1/submit?preview=true`,
    ]) {
      const refused = await call('POST', url, 'head');
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('DOCUMENTS_NEEDED');
      expect(refused.body.errors[0].message).toContain('Project Initiation Document');
    }
    expect((await stepView(id, '1')).status).toBe('ready');
    expect(await records(id, '1')).toEqual([]);
  });

  it('refuses a template that is still blank, and accepts it once it is filled in', async () => {
    const id = await w.go('Plate DN2');
    const code = await projectCode(id);
    const pid = await makePid(id);
    const blank = await call('POST', `/projects/${id}/steps/1/submit`, 'head');
    expect(blank.body.code).toBe('DOCUMENTS_NEEDED');
    expect(blank.body.errors[0].message).toContain(`${code}-PID-01`);
    expect((await stepView(id, '1')).documentNeeds).toHaveLength(1);

    await ok(save(pid.id, 'head', { fields: FIELDS, sections: SECTIONS }));
    expect((await stepView(id, '1')).documentNeeds).toEqual([]);
    // It needn't be signed yet: the preview only warns (S7).
    const preview = await ok(call('POST', `/projects/${id}/steps/1/submit?preview=true`, 'head'));
    expect(preview.saved).toBe(false);
    expect(preview.preview.warnings[0]).toContain('is not approved yet');
    expect(await records(id, '1')).toEqual([]);
    await ok(call('POST', `/projects/${id}/steps/1/submit`, 'head'));
    expect(await records(id, '1')).toHaveLength(1);
  });

  it('takes an upload for a document, and does not ask for the need-to-know budget annex', async () => {
    const id = await w.go('Plate DN3');
    await w.advance(id, '4');
    const step = await stepView(id, '5');
    expect(step.documentNeeds).toEqual(['Action Plan: not made or uploaded yet.']);
    await w.attach(id, '5');
    expect((await stepView(id, '5')).documentNeeds).toEqual([]);
    await ok(call('POST', `/projects/${id}/steps/5/submit`, 'lead'));
  });

  it('asks for nothing at a step whose documents have no type yet', async () => {
    const id = await w.go('Plate DN4');
    await w.advance(id, '5');
    expect((await stepView(id, '6')).documentNeeds).toEqual([]);
  });
});

describe('signed decisions', () => {
  it('signs Go, and every decision at a checkpoint, with a hash of what was decided', async () => {
    const id = await w.go('Plate T');
    await w.advance(id, '4');
    const rows = await t.deps.db
      .select()
      .from(signatures)
      .where(eq(signatures.subjectType, 'decision'));
    const projectDecisions = await t.deps.db.select().from(decisions);
    expect(rows.length).toBeGreaterThan(0);
    const go = projectDecisions.find((d) => d.decision === 'go' && d.runId);
    const goSignature = rows.find((r) => r.subjectId === go!.id)!;
    expect(goSignature).toMatchObject({
      meaning: 'decision',
      decision: 'go',
      printedName: 'Vera Example',
      roleName: 'VP',
    });
    expect(goSignature.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    const checkpoint = projectDecisions.find(
      (d) => d.decision === 'checkpoint' && d.stepKey === '4',
    );
    expect(rows.some((r) => r.subjectId === checkpoint!.id)).toBe(true);
    // Every decision recorded has a signature.
    const signed = new Set(rows.map((r) => r.subjectId));
    expect(projectDecisions.every((d) => signed.has(d.id))).toBe(true);
  });
});

describe('rework', () => {
  it('carries each document’s latest version into the new iteration as a new draft', async () => {
    const id = await w.go('Plate U');
    await w.advance(id, '6');
    const fileId = await w.upload('designer', 'plate drawing.pdf', PDF);
    const doc = await ok(
      makeDoc(id, 'designer', {
        stepKey: '7',
        documentType: 'DOC',
        title: 'Plate drawing',
        fileId,
      }),
    );
    const sent = (await ok(submit(doc.id, 1, 'designer'))).document;
    const approved = (await ok(sign(sent, 'approved', 'lead'))).document;
    expect(approved).toMatchObject({ status: 'approved', approvedRev: 'A' });

    await w.advance(id, '12', { from: '7' });
    await ok(call('POST', `/projects/${id}/steps/13/start`, 'ops'));
    await ok(
      call('POST', `/projects/${id}/steps/13/send-back`, 'head', {
        to: '7',
        reason: 'The lab test failed on the plate',
      }),
    );

    const carried = await ok(open(doc.id, 'designer'));
    expect(carried.status).toBe('draft');
    expect(carried.approvedRev).toBe('A');
    expect(
      carried.versions.map((v: any) => [v.versionNo, v.status, v.iteration, v.carried]),
    ).toEqual([
      [2, 'draft', 2, true],
      [1, 'approved', 1, false],
    ]);
    expect(carried.current.note).toContain('Carried forward');
    expect(carried.current.contentSha256).toBe(approved.current.contentSha256);
    expect(carried.can).toEqual({ edit: true, submit: true });

    // Revising goes through signing again, and the earlier approval is superseded when the new one is approved.
    const revised = new TextEncoder().encode('%PDF-1.4 made-up drawing, after the test');
    await ok(
      save(doc.id, 'designer', {
        fileId: await w.upload('designer', 'plate drawing b.pdf', revised),
      }),
    );
    const again = (await ok(submit(doc.id, 3, 'designer'))).document;
    const second = (await ok(sign(again, 'approved', 'lead'))).document;
    expect(second.versions.map((v: any) => [v.versionNo, v.status, v.revLabel])).toEqual([
      [3, 'approved', 'B'],
      [2, 'draft', null],
      [1, 'superseded', 'A'],
    ]);
  });

  it('returns a version that was still with its signers when the step is sent back', async () => {
    const id = await w.go('Plate V');
    await w.advance(id, '6');
    const fileId = await w.upload('designer', 'plate b.pdf', PDF);
    const doc = await ok(makeDoc(id, 'designer', { stepKey: '7', documentType: 'DOC', fileId }));
    await ok(submit(doc.id, 1, 'designer'));
    await w.advance(id, '12', { from: '7' });
    await ok(call('POST', `/projects/${id}/steps/13/start`, 'ops'));
    await ok(
      call('POST', `/projects/${id}/steps/13/send-back`, 'head', {
        to: '7',
        reason: 'The lab test failed',
      }),
    );
    const after = await ok(open(doc.id, 'designer'));
    expect(after.versions.map((v: any) => [v.versionNo, v.status])).toEqual([
      [2, 'draft'],
      [1, 'returned'],
    ]);
    expect(rowOf(await ok(open(doc.id, 'designer', 1)), 'approved').status).toBe('cancelled');
  });
});

describe('need-to-know', () => {
  it('keeps the budget annex from the team, and shows it to the Lead, the Head, the VP and R&D Ops on the project', async () => {
    const id = await w.go('Plate W');
    await w.advance(id, '4');
    const plan = await ok(makeDoc(id, 'head', { stepKey: '5', documentType: 'ACTION_PLAN' }));
    const budget = await ok(makeDoc(id, 'lead', { stepKey: '5', documentType: 'BUDGET_ANNEX' }));
    expect(budget.type.sensitivity).toBe('budget');

    const listed = async (as: string) =>
      (await ok(call('GET', `/projects/${id}/documents?step=5`, as))).items
        .map((d: any) => d.type.code)
        .sort();
    for (const as of ['lead', 'head', 'vp', 'ops'])
      expect(await listed(as)).toEqual(['ACTION_PLAN', 'BUDGET_ANNEX']);
    // The rest of the team sees the plan, not its budget.
    for (const as of ['designer', 'pme', 'dard']) expect(await listed(as)).toEqual(['ACTION_PLAN']);
    // Everyone else sees neither.
    for (const as of ['md', 'leadOther', 'qa', 'outsider']) expect(await listed(as)).toEqual([]);

    const asDesigner = await open(budget.id, 'designer');
    expect(asDesigner.status).toBe(403);
    expect(asDesigner.body.whoCan).toEqual([
      'Board',
      'VP',
      'R&D Head',
      'The R&D Lead of this product line',
      'R&D Ops on the project',
    ]);
    expect((await open(plan.id, 'designer')).status).toBe(200);
    expect((await open(plan.id, 'leadOther')).status).toBe(403);
    expect((await open(plan.id, 'outsider')).status).toBe(403);
    expect((await call('GET', `/documents/${budget.id}/versions/1/links`, 'designer')).status).toBe(
      403,
    );
    expect(
      (await call('GET', `/documents/${budget.id}/compare?from=1&to=1`, 'designer')).status,
    ).toBe(403);
  });

  it('gives the Board its papers once they are submitted, and the Lead only their outcome', async () => {
    const id = await w.go('Plate X');
    await w.advance(id, '3');
    const fileId = await w.upload('vp', 'board paper.pdf', PDF);
    const paper = await ok(
      makeDoc(id, 'vp', { stepKey: '4', documentType: 'DOC', title: 'Board paper', fileId }),
    );

    // A draft is for the people who work on it.
    expect((await ok(call('GET', `/projects/${id}/documents?step=4`, 'md'))).items).toEqual([]);
    expect((await open(paper.id, 'md')).status).toBe(404);
    const lead = (await ok(call('GET', `/projects/${id}/documents?step=4`, 'lead'))).items;
    expect(lead).toMatchObject([{ title: 'Board paper', restricted: true, status: 'draft' }]);

    await ok(submit(paper.id, 1, 'vp'));
    const board = (await ok(call('GET', `/projects/${id}/documents?step=4`, 'md'))).items;
    expect(board).toMatchObject([{ title: 'Board paper', restricted: false, status: 'in_review' }]);
    expect((await ok(open(paper.id, 'md'))).current.versionNo).toBe(1);

    const asLead = await ok(open(paper.id, 'lead'));
    expect(asLead).toMatchObject({ restricted: true, current: null, versions: [], spec: null });
    expect((await call('GET', `/documents/${paper.id}/versions/1/links`, 'lead')).status).toBe(403);
    // The team doesn't see Board papers at all.
    expect((await ok(call('GET', `/projects/${id}/documents?step=4`, 'designer'))).items).toEqual(
      [],
    );
  });

  it('keeps the budget annex, and its drafts, out of what the team can read in the feed and the sign-off record', async () => {
    const id = await w.go('Plate AG');
    await w.advance(id, '4');
    const budget = await ok(
      makeDoc(id, 'lead', { stepKey: '5', documentType: 'BUDGET_ANNEX', title: 'Secret costs' }),
    );
    await ok(save(budget.id, 'lead', { fields: { material_cost: '1', total_budget: '2' } }));
    const plan = await ok(makeDoc(id, 'head', { stepKey: '5', documentType: 'ACTION_PLAN' }));
    await ok(save(plan.id, 'head', { fields: { material: 'Titanium' } }));

    const feed = async (as: string) =>
      (await ok(call('GET', `/projects/${id}/activity?limit=100`, as))).items.filter((e: any) =>
        /^(document|signature)\./.test(e.type),
      );
    const withTitle = (items: any[]) =>
      items.filter(
        (e) => e.payload.title === 'Secret costs' || e.payload.number?.includes('-BUD-'),
      );
    // The Lead, the VP and R&D Ops may read the annex, so they see its events; the rest of the team doesn't.
    for (const as of ['lead', 'vp', 'ops'])
      expect(withTitle(await feed(as)).length).toBeGreaterThan(0);
    for (const as of ['designer', 'pme', 'dard', 'md', 'outsider']) {
      expect(withTitle(await feed(as))).toEqual([]);
    }
    // The action plan is still only a draft, so the Board sees nothing of it (only the sign-off
    // record of checkpoint step 4, which it signed), and outsiders see nothing at all.
    const aboutStep5 = (items: any[]) =>
      items.filter((e) => /-(ACT|BUD)-/.test(e.payload.number ?? ''));
    expect(aboutStep5(await feed('md'))).toEqual([]);
    expect(await feed('outsider')).toEqual([]);
    expect(aboutStep5(await feed('designer')).length).toBeGreaterThan(0);

    // Submitting the step lists the plan on the sign-off record, but not the annex.
    await ok(call('POST', `/projects/${id}/steps/5/submit`, 'head'));
    const [record] = (
      await ok(call('GET', `/projects/${id}/documents?step=5`, 'designer'))
    ).items.filter((d: any) => d.type.code === 'STEP_SIGNOFF');
    const detail = await ok(open(record.id, 'designer'));
    expect(detail.current.content.fields.outputs.map((o: any) => o.number)).toEqual([
      expect.stringContaining('-ACT-'),
    ]);
    expect(JSON.stringify(detail)).not.toContain('Secret costs');
  });

  it('shows the Board only the papers of checkpoints', async () => {
    const id = await w.go('Plate Y');
    const fileId = await w.upload('ops', 'raw data.pdf', PDF);
    const doc = await ok(makeDoc(id, 'ops', { stepKey: '2', documentType: 'DOC', fileId }));
    await ok(submit(doc.id, 1, 'ops'));
    expect((await ok(call('GET', `/projects/${id}/documents`, 'md'))).items).toEqual([]);
    expect((await open(doc.id, 'md')).status).toBe(403);
  });

  it('lets a signer from outside R&D read what they are asked to sign', async () => {
    const base = structuredClone(
      SAMPLE_TEMPLATES.find((s) => s.spec.document_type === 'MRS')!.spec,
    );
    const spec = { ...base, reviewed_by: ['company_qa'] };
    const fileId = await w.upload('vp', 'mrs.docx', sampleDocx({ spec, intro: 'QA reviews' }));
    const original = (await ok(call('GET', '/templates/active?documentType=MRS', 'vp'))).id;
    const added = await ok(
      call('POST', '/templates', 'vp', { documentType: 'MRS', docxFileId: fileId, spec }),
    );
    await ok(call('POST', `/templates/${added.id}/activate`, 'vp'));
    try {
      const id = await w.go('Plate Z');
      const doc = await ok(makeDoc(id, 'ops', { stepKey: '2', documentType: 'MRS' }));
      // Nothing is sent to QA while it is a draft.
      expect((await open(doc.id, 'qa')).status).toBe(403);
      await ok(
        save(doc.id, 'ops', {
          fields: { regions: 'India' },
          sections: { market_size: 'A made-up market.' },
        }),
      );
      await ok(submit(doc.id, 2, 'ops'));

      const asQa = await ok(open(doc.id, 'qa'));
      expect(asQa.current.requests.find((r: any) => r.meaning === 'reviewed').can.sign).toBe(true);
      expect((await ok(call('GET', '/signature-requests', 'qa'))).items).toMatchObject([
        { number: doc.number },
      ]);
      const links = await ok(call('GET', `/documents/${doc.id}/versions/2/links`, 'qa'));
      expect(links.pdf.url).toMatch(/^http/);
      // But not the project's other people, and not the project.
      expect((await open(doc.id, 'outsider')).status).toBe(403);
      expect((await call('GET', `/projects/${id}/documents`, 'qa')).body.items).toHaveLength(1);
    } finally {
      await ok(call('POST', `/templates/${original}/activate`, 'vp'));
    }
  });

  it('opens a document’s PDF for people who may see it, and for no one else', async () => {
    const id = await w.go('Plate AA');
    const doc = await makePid(id);
    const [file] = await t.deps.db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, doc.id));
    const pdfId = file!.pdfFileId!;
    for (const as of ['head', 'designer', 'vp'])
      expect((await call('GET', `/files/${pdfId}/link`, as)).status).toBe(200);
    for (const as of ['outsider', 'qa', 'leadOther', 'md'])
      expect((await call('GET', `/files/${pdfId}/link`, as)).status).toBe(403);
  });
});

describe('attachments and sources', () => {
  it('attaches files and pictures to a step, and opens them for the people who may see the step', async () => {
    const id = await w.go('Plate AB');
    const picture = await w.upload('designer', 'photo.png', new Uint8Array([137, 80, 78, 71]));
    const attached = await ok(
      call('POST', `/projects/${id}/attachments`, 'designer', {
        stepKey: '1',
        fileId: picture,
        caption: 'The test rig',
      }),
    );
    expect(attached).toMatchObject({
      caption: 'The test rig',
      target: { stepKey: '1' },
      addedBy: { name: 'Dev Example' },
      file: { name: 'photo.png' },
    });

    const seen = async (as: string) =>
      (await ok(call('GET', `/projects/${id}/attachments?step=1`, as))).items.length;
    expect(await seen('head')).toBe(1);
    expect(await seen('pme')).toBe(1);
    expect(await seen('outsider')).toBe(0);
    expect(await seen('md')).toBe(0);
    expect(await seen('leadOther')).toBe(0);

    expect((await call('GET', `/files/${picture}/link`, 'head')).status).toBe(200);
    expect((await call('GET', `/files/${picture}/link`, 'outsider')).status).toBe(403);
    expect((await call('GET', `/files/${picture}/link`, 'md')).status).toBe(403);
  });

  it('lets the Board see attachments only at its checkpoints', async () => {
    const id = await w.go('Plate AC');
    await w.advance(id, '3');
    const file = await w.upload('vp', 'proposal.pdf', PDF);
    await ok(call('POST', `/projects/${id}/attachments`, 'vp', { stepKey: '4', fileId: file }));
    expect((await ok(call('GET', `/projects/${id}/attachments?step=4`, 'md'))).items).toHaveLength(
      1,
    );
    expect((await call('GET', `/files/${file}/link`, 'md')).status).toBe(200);
  });

  it('only lets the people on a project add to it, and only their own uploads', async () => {
    const id = await w.go('Plate AD');
    const file = await w.upload('designer', 'x.png', new Uint8Array([1, 2, 3]));
    const outsider = await call('POST', `/projects/${id}/attachments`, 'outsider', {
      stepKey: '1',
      fileId: await w.upload('outsider', 'y.png', new Uint8Array([1])),
    });
    expect(outsider.status).toBe(403);
    const theirs = await call('POST', `/projects/${id}/attachments`, 'pme', {
      stepKey: '1',
      fileId: file,
    });
    expect(theirs.status).toBe(403);
    const none = await call('POST', `/projects/${id}/attachments`, 'designer', { fileId: file });
    expect(none.status).toBe(400);
    const both = await call('POST', `/projects/${id}/attachments`, 'designer', {
      stepKey: '1',
      documentId: '00000000-0000-7000-8000-000000000009',
      fileId: file,
    });
    expect(both.status).toBe(400);
  });

  it('attaches to a document only if the person may read it', async () => {
    const id = await w.go('Plate AE');
    await w.advance(id, '4');
    const budget = await ok(makeDoc(id, 'lead', { stepKey: '5', documentType: 'BUDGET_ANNEX' }));
    const file = await w.upload('designer', 'q.png', new Uint8Array([1, 2]));
    const refused = await call('POST', `/projects/${id}/attachments`, 'designer', {
      documentId: budget.id,
      fileId: file,
    });
    expect(refused.status).toBe(400);
    const own = await w.upload('lead', 'quote.pdf', PDF);
    const allowed = await ok(
      call('POST', `/projects/${id}/attachments`, 'lead', {
        documentId: budget.id,
        fileId: own,
        caption: 'Supplier quote',
      }),
    );
    expect(allowed.target).toMatchObject({ documentId: budget.id, stepKey: '5' });
    // It is as private as the document.
    expect(
      (await ok(call('GET', `/projects/${id}/attachments?document=${budget.id}`, 'lead'))).items,
    ).toHaveLength(1);
    expect(
      (await ok(call('GET', `/projects/${id}/attachments?document=${budget.id}`, 'designer')))
        .items,
    ).toEqual([]);
    expect((await call('GET', `/files/${own}/link`, 'designer')).status).toBe(403);
    expect((await call('GET', `/files/${own}/link`, 'ops')).status).toBe(200);
  });

  it('keeps sources: a link, a file or a citation, each with a note', async () => {
    const id = await w.go('Plate AF');
    const link = await ok(
      call('POST', `/projects/${id}/sources`, 'ops', {
        stepKey: '2',
        kind: 'link',
        title: 'Market report',
        url: 'https://example.com/report',
        note: 'Page 4',
      }),
    );
    expect(link).toMatchObject({
      kind: 'link',
      url: 'https://example.com/report',
      note: 'Page 4',
      file: null,
    });
    const citation = await ok(
      call('POST', `/projects/${id}/sources`, 'ops', {
        stepKey: '2',
        kind: 'citation',
        title: 'Made-up Journal 12(3)',
      }),
    );
    expect(citation.url).toBeNull();
    const file = await w.upload('ops', 'paper.pdf', PDF);
    const filed = await ok(
      call('POST', `/projects/${id}/sources`, 'ops', {
        stepKey: '2',
        kind: 'file',
        title: 'A paper',
        fileId: file,
      }),
    );
    expect(filed.file.name).toBe('paper.pdf');

    expect((await ok(call('GET', `/projects/${id}/sources?step=2`, 'head'))).items).toHaveLength(3);
    expect((await ok(call('GET', `/projects/${id}/sources?step=2`, 'outsider'))).items).toEqual([]);
    expect((await call('GET', `/files/${file}/link`, 'head')).status).toBe(200);

    const script = await call('POST', `/projects/${id}/sources`, 'ops', {
      stepKey: '2',
      kind: 'link',
      title: 'Bad',
      url: 'javascript:alert(1)',
    });
    expect(script.status).toBe(400);
    const noUrl = await call('POST', `/projects/${id}/sources`, 'ops', {
      stepKey: '2',
      kind: 'link',
      title: 'No address',
    });
    expect(noUrl.status).toBe(400);
    const noFile = await call('POST', `/projects/${id}/sources`, 'ops', {
      stepKey: '2',
      kind: 'file',
      title: 'No file',
    });
    expect(noFile.status).toBe(400);
  });

  it('keeps a source for the whole project, which the team reads and others do not', async () => {
    const id = await w.go('Plate AG');
    const whole = await call('POST', `/projects/${id}/sources`, 'designer', {
      kind: 'link',
      title: 'A made-up standard overview',
      url: 'https://example.com/standard',
      note: 'Background for everyone working on this.',
    });
    expect(whole.status).toBe(201);
    expect(whole.body.target).toEqual({ stepKey: null, documentId: null, taskId: null });
    // Not the whole project and a step at once.
    const both = await call('POST', `/projects/${id}/sources`, 'designer', {
      stepKey: '2',
      documentId: '01a1fe83-f5e3-7650-9df4-3075e75ec08f',
      kind: 'link',
      title: 'Too many places',
      url: 'https://example.com/x',
    });
    expect(both.status).toBe(400);

    const titles = async (who: string) =>
      (await ok(call('GET', `/projects/${id}/sources`, who))).items.map((x: any) => x.title);
    expect(await titles('ops')).toContain('A made-up standard overview');
    expect(await titles('head')).toContain('A made-up standard overview');
    expect(await titles('outsider')).toEqual([]);
    // The VP and the Head work on every project, so they may add one without being on the team.
    const byVp = await call('POST', `/projects/${id}/sources`, 'vp', {
      kind: 'link',
      title: 'Added by the VP',
      url: 'https://example.com/vp',
    });
    expect(byVp.status).toBe(201);
    // Someone who is not on the team may not add one.
    const outside = await call('POST', `/projects/${id}/sources`, 'outsider', {
      kind: 'link',
      title: 'Not mine to add',
      url: 'https://example.com/y',
    });
    expect(outside.status).toBe(403);
  });
});
