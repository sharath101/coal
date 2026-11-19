import {
  diffText,
  fieldLabel,
  formatDocumentNumber,
  isWorking,
  missingRequired,
  readable,
  specTitle,
  stepActions,
  type CompareResponse,
  type DocumentContent,
  type DocumentDetail,
  type DocumentSummary,
  type FieldValue,
  type SigningPreview,
  type SigningResult,
  type StepDefinition,
  type TemplateSpec,
  type WaitingSignature,
} from '@coal/shared';
import type { Executor, Tx } from '../../core/db/client';
import { change, previewable } from '../../core/db/change';
import type { AppDeps } from '../../core/deps';
import type { Actor, RequestContext } from '../../core/http/context';
import { AppError, notFound, validationFailed } from '../../core/http/errors';
import { assertCanAccess, canAccess } from '../permissions';
import {
  assertUsableEvidence,
  findFiles,
  linkTo,
  storeGeneratedFile,
  type FileRow,
} from '../files/service';
import {
  activeTemplate,
  findTemplate,
  findTypeByCode,
  findTypesById,
  type TemplateRow,
  type TypeRow,
} from '../templates/service';
import { findActiveUsersByRole } from '../users/service';
import { assertMay, loadEnv, viewerOf } from '../rnd/env';
import { activeMembers, findProjectByRun } from '../rnd/projects';
import type { Env } from '../rnd/actions';
import { accessOf, documentResource, visibleVersions, type Access } from './access';
import {
  buildContent,
  hashContent,
  renderPdf,
  searchTextOf,
  sha256,
  type FieldContext,
} from './content';
import { memberIdsOf, type ProjectFacts } from './facts';
import {
  approveVersion,
  openRows,
  planRows,
  returnVersion,
  roleNameOf,
  signRow,
  type Signer,
} from './signing';
import {
  countDocumentsOfType,
  documentsById,
  documentsOfRun,
  findDocument,
  findRequest,
  findVersion,
  latestVersionOf,
  pendingRequests,
  requestsOfVersions,
  signaturesOf,
  versionsById,
  versionsHoldingFile,
  versionsOf,
  type DocumentRow,
  type RequestRow,
  type VersionRow,
} from './store';
import { documents, documentVersions } from './tables';
import { documentVisibility, presentDocument, presentDocuments, type Viewer } from './views';
import { insertVersion } from './versions';
import { eq } from 'drizzle-orm';

const signerOf = (actor: Actor): Signer => ({
  userId: actor.userId,
  name: actor.name,
  roleKey: actor.roleKey,
});

interface Opened {
  doc: DocumentRow;
  env: Env;
  viewer: Viewer;
  step: StepDefinition;
  type: TypeRow;
}

/** Loads a document with its project. `forUpdate` locks the project's run for a change. */
async function openDocument(
  ex: Executor,
  ctx: RequestContext,
  actor: Actor,
  id: string,
  options: { forUpdate?: boolean } = {},
): Promise<Opened> {
  const first = await findDocument(ex, ctx.orgId, id);
  if (!first) throw notFound('document');
  const project = await findProjectByRun(ex, ctx.orgId, first.runId);
  if (!project) throw notFound('document');
  const env = await loadEnv(ex, ctx.orgId, actor, project.id, options);
  const doc = options.forUpdate
    ? ((await findDocument(ex, ctx.orgId, id, { forUpdate: true })) as DocumentRow)
    : first;
  const step = env.loaded.route.steps.find((s) => s.key === doc.stepKey) as StepDefinition;
  const type = (await findTypesById(ex, ctx.orgId, [doc.documentTypeId])).get(
    doc.documentTypeId,
  ) as TypeRow;
  return { doc, env, viewer: await viewerOf(ex, env), step, type };
}

/** May the person open this document at all? Returns what of it they get. */
async function readAccess(ex: Executor, o: Opened): Promise<Access> {
  const versions = (await versionsOf(ex, [o.doc.id])).get(o.doc.id) ?? [];
  const requests = [
    ...(
      await requestsOfVersions(
        ex,
        versions.map((v) => v.id),
      )
    ).values(),
  ].flat();
  const resource = documentResource(o.viewer.facts, o.step, o.type, requests);
  assertCanAccess('documents.read', o.viewer.actor, resource);
  return accessOf(o.viewer.actor, resource);
}

/** The content, files and versions of a document are for people with full access; others get its outcome only. */
async function fullAccess(ex: Executor, o: Opened): Promise<Access> {
  const access = await readAccess(ex, o);
  if (access.level !== 'full') {
    throw new AppError(
      403,
      'NOT_ALLOWED',
      'Only these people can open this: Board, VP, R&D Head.',
      {
        whoCan: ['Board', 'VP', 'R&D Head'],
      },
    );
  }
  return access;
}

const documentsWorking = (o: Opened) => isWorking(o.env.loaded.state);

/** A step takes document work while it is open and the project is working. */
function assertStepOpen(o: Opened): void {
  if (!documentsWorking(o)) {
    throw new AppError(
      409,
      'PROJECT_NOT_ACTIVE',
      "The project is on hold or finished, so documents can't change now.",
    );
  }
  if (!stepActions(o.env.loaded.route, o.env.loaded.state, o.step.key).submit) {
    throw new AppError(
      409,
      'DOCUMENT_LOCKED',
      `Step ${o.step.key} isn't open for work, so its documents can't change. If it needs rework, it is sent back.`,
    );
  }
}

// Listing

export async function listProjectDocuments(
  ex: Executor,
  ctx: RequestContext,
  actor: Actor,
  projectId: string,
  stepKey: string | undefined,
): Promise<DocumentSummary[]> {
  const env = await loadEnv(ex, ctx.orgId, actor, projectId);
  const rows = await documentsOfRun(ex, ctx.orgId, env.loaded.run.id, stepKey);
  return presentDocuments(ex, await viewerOf(ex, env), rows);
}

export async function getDocument(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  id: string,
  versionNo: number | undefined,
): Promise<DocumentDetail> {
  const o = await openDocument(deps.db, ctx, actor, id);
  await readAccess(deps.db, o);
  return presentDocument(deps.db, o.viewer, o.doc, versionNo);
}

// Creating and saving

async function makePdf(
  deps: AppDeps,
  tx: Tx,
  orgId: string,
  template: TemplateRow,
  content: DocumentContent,
  name: string,
  userId: string,
): Promise<{ fileId: string; sha256: string }> {
  const bytes = await renderPdf(deps, tx, orgId, template, content, name);
  const file = await storeGeneratedFile(deps, tx, orgId, {
    name: `${name}.pdf`,
    bytes,
    contentType: 'application/pdf',
    userId,
  });
  return { fileId: file.id, sha256: file.sha256 as string };
}

export interface NewDocument {
  stepKey: string;
  documentType: string;
  title?: string | undefined;
  fileId?: string | undefined;
}

const fieldContext = (
  o: Opened,
  doc: Pick<DocumentRow, 'number' | 'title'>,
  actor: Actor,
): FieldContext => ({
  facts: o.viewer.facts,
  step: { key: o.step.key, name: o.step.name },
  number: doc.number,
  title: doc.title,
  authorName: actor.name,
});

/** The document's number: its type's pattern, counting the project's documents of that type. */
async function nextNumber(tx: Tx, orgId: string, type: TypeRow, o: Opened): Promise<string> {
  const count = await countDocumentsOfType(tx, orgId, o.env.loaded.run.id, type.id);
  return formatDocumentNumber(type.numberingPattern, {
    projectCode: o.viewer.facts.code,
    type: type.code,
    nn: count + 1,
  });
}

const pdfOfUpload = (file: FileRow) =>
  file.mimeType === 'application/pdf' && file.sha256
    ? { fileId: file.id, sha256: file.sha256 }
    : null;

export async function createDocument(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  projectId: string,
  input: NewDocument,
): Promise<DocumentDetail> {
  return change(deps.db, ctx, async (tx, log) => {
    const env = await loadEnv(tx, ctx.orgId, actor, projectId, { forUpdate: true });
    const step = env.loaded.route.steps.find((s) => s.key === input.stepKey);
    if (!step) throw validationFailed('There is no such step.', 'stepKey');
    const type = await findTypeByCode(tx, ctx.orgId, input.documentType);
    if (!type) throw validationFailed('There is no such document type.', 'documentType');
    if (type.kind === 'record') {
      throw validationFailed(`${type.name} is made by COAL, not added by hand.`, 'documentType');
    }
    if (type.stepKeys.length > 0 && !type.stepKeys.includes(step.key)) {
      throw validationFailed(
        `${type.name} documents belong to step ${type.stepKeys.join(' or ')}.`,
        'documentType',
      );
    }
    const doers = [...step.doers];
    assertMay(env, 'documents.create', doers);

    const placeholder = {
      doc: { id: '', stepKey: step.key } as DocumentRow,
      env,
      viewer: await viewerOf(tx, env),
      step,
      type,
    } satisfies Opened;
    assertStepOpen(placeholder);

    const number = await nextNumber(tx, ctx.orgId, type, placeholder);
    const title = input.title ?? type.name;
    const runStepId = env.loaded.stepIds.get(step.key) as string;
    const iteration = env.loaded.state.steps[step.key]?.iteration ?? 1;

    let template: TemplateRow | null = null;
    let content: DocumentContent | null = null;
    let pdf: { fileId: string; sha256: string } | null = null;
    let fileId: string | null = null;
    let contentSha256: string;
    let plan = type.signaturePlan;

    if (input.fileId) {
      const file = await assertUsableEvidence(tx, ctx.orgId, actor, input.fileId, 'fileId');
      fileId = file.id;
      pdf = pdfOfUpload(file);
      contentSha256 = file.sha256 ?? sha256(file.id);
    } else {
      if (type.kind !== 'template') {
        throw validationFailed(`${type.name} is an uploaded document: choose its file.`, 'fileId');
      }
      template = await activeTemplate(tx, ctx.orgId, type.id);
      if (!template) {
        throw new AppError(
          409,
          'NO_TEMPLATE',
          `There is no template for ${type.name} yet. Upload the document instead, or ask the VP or the R&D Head to add the template.`,
        );
      }
      if (!template.spec.steps.includes(step.key)) {
        throw validationFailed(
          `The ${type.name} template is for step ${template.spec.steps.join(', ')}.`,
          'stepKey',
        );
      }
      plan = {
        rows: template.spec.signature_rows,
        reviewedBy: template.spec.reviewed_by,
        approvedBy: template.spec.approved_by,
      };
      content = buildContent(
        template.spec,
        fieldContext(placeholder, { number, title }, actor),
        { fields: {}, sections: {} },
        null,
      );
      contentSha256 = hashContent(content);
      pdf = await makePdf(deps, tx, ctx.orgId, template, content, `${number}-v1`, actor.userId);
    }

    const [created] = await tx
      .insert(documents)
      .values({
        orgId: ctx.orgId,
        runId: env.loaded.run.id,
        stepKey: step.key,
        documentTypeId: type.id,
        templateId: template?.id ?? null,
        number,
        title,
        signaturePlan: plan,
        createdBy: actor.userId,
      })
      .returning();
    const doc = created as DocumentRow;
    const version = await insertVersion(tx, ctx.orgId, {
      documentId: doc.id,
      runStepId,
      iteration,
      content,
      contentSha256,
      fileId,
      pdf,
      searchText: searchTextOf(title, content),
      note: '',
      createdBy: actor.userId,
      viaAi: ctx.viaAi,
    });
    log.audit({
      action: 'document.created',
      recordType: 'document',
      recordId: doc.id,
      after: {
        number,
        title,
        type: type.code,
        stepKey: step.key,
        template: template?.version ?? null,
      },
    });
    log.audit({
      action: 'document.version_saved',
      recordType: 'document_version',
      recordId: version.id,
      after: { number, versionNo: 1, contentSha256, pdfSha256: pdf?.sha256 ?? null },
    });
    log.event({
      type: 'document.created',
      projectId,
      stepKey: step.key,
      payload: { documentId: doc.id, number, title },
    });
    const viewer = await viewerOf(tx, env);
    return presentDocument(tx, viewer, doc);
  });
}

export async function saveVersion(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  id: string,
  input: {
    fields: Record<string, string>;
    sections: Record<string, string>;
    fileId?: string | undefined;
    note: string;
  },
): Promise<DocumentDetail> {
  return change(deps.db, ctx, async (tx, log) => {
    const o = await openDocument(tx, ctx, actor, id, { forUpdate: true });
    assertMay(o.env, 'documents.write', [...o.step.doers]);
    await fullAccess(tx, o);
    if (o.type.kind === 'record') {
      throw new AppError(409, 'DOCUMENT_LOCKED', 'COAL makes this record; it cannot be edited.');
    }
    assertStepOpen(o);
    const latest = (await latestVersionOf(tx, o.doc.id)) as VersionRow;
    if (latest.status === 'in_review') {
      throw new AppError(
        409,
        'DOCUMENT_LOCKED',
        'This version is with its signers. Wait for them, or ask a signer to return it.',
      );
    }
    const runStepId = o.env.loaded.stepIds.get(o.step.key) as string;
    const iteration = o.env.loaded.state.steps[o.step.key]?.iteration ?? 1;
    const versionNo = latest.versionNo + 1;

    let content: DocumentContent | null = null;
    let contentSha256: string;
    let pdf: { fileId: string; sha256: string } | null = null;
    let fileId: string | null = null;

    if (o.doc.templateId) {
      if (input.fileId) {
        throw validationFailed(
          'This document is filled in from its template, not uploaded.',
          'fileId',
        );
      }
      const template = (await findTemplate(tx, ctx.orgId, o.doc.templateId)) as TemplateRow;
      content = buildContent(
        template.spec,
        fieldContext(o, o.doc, actor),
        { fields: input.fields, sections: input.sections },
        latest.content,
      );
      contentSha256 = hashContent(content);
      // Saving what is already saved makes no new version.
      if (latest.status === 'draft' && latest.contentSha256 === contentSha256) {
        return presentDocument(tx, o.viewer, o.doc);
      }
      pdf = await makePdf(
        deps,
        tx,
        ctx.orgId,
        template,
        content,
        `${o.doc.number}-v${versionNo}`,
        actor.userId,
      );
    } else {
      if (!input.fileId) throw validationFailed('Choose the new file.', 'fileId');
      const file = await assertUsableEvidence(tx, ctx.orgId, actor, input.fileId, 'fileId');
      fileId = file.id;
      pdf = pdfOfUpload(file);
      contentSha256 = file.sha256 ?? sha256(file.id);
    }

    const version = await insertVersion(tx, ctx.orgId, {
      documentId: o.doc.id,
      runStepId,
      iteration,
      content,
      contentSha256,
      fileId,
      pdf,
      searchText: searchTextOf(o.doc.title, content),
      note: input.note,
      createdBy: actor.userId,
      viaAi: ctx.viaAi,
    });
    log.audit({
      action: 'document.version_saved',
      recordType: 'document_version',
      recordId: version.id,
      after: { number: o.doc.number, versionNo, contentSha256, pdfSha256: pdf?.sha256 ?? null },
    });
    log.event({
      type: 'document.version_saved',
      projectId: o.viewer.facts.projectId,
      stepKey: o.step.key,
      payload: { documentId: o.doc.id, number: o.doc.number, versionNo },
    });
    return presentDocument(
      tx,
      o.viewer,
      (await findDocument(tx, ctx.orgId, o.doc.id)) as DocumentRow,
    );
  });
}

export async function versionLinks(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  id: string,
  versionNo: number,
) {
  const o = await openDocument(deps.db, ctx, actor, id);
  const access = await fullAccess(deps.db, o);
  const version = await findVersion(deps.db, o.doc.id, versionNo);
  if (!version || visibleVersions(access, [version]).length === 0) throw notFound('version');
  const files = await findFiles(
    deps.db,
    ctx.orgId,
    [version.pdfFileId, version.fileId].filter((f): f is string => !!f),
  );
  const link = async (fileId: string | null) => {
    const file = files.find((f) => f.id === fileId);
    return file ? linkTo(deps, file) : null;
  };
  return {
    pdf: await link(version.pdfFileId),
    // An uploaded PDF is its own PDF; show it once.
    file:
      version.fileId && version.fileId !== version.pdfFileId ? await link(version.fileId) : null,
  };
}

// Comparing

const asText = (value: FieldValue | undefined): string =>
  value === undefined
    ? ''
    : typeof value === 'string'
      ? value
      : value.map((row) => Object.values(row).join(' · ')).join('\n');

export function compareContent(
  spec: TemplateSpec,
  before: DocumentContent,
  after: DocumentContent,
): Pick<CompareResponse, 'fields' | 'sections'> {
  const fields: CompareResponse['fields'] = [];
  const sections: CompareResponse['sections'] = [];
  for (const section of spec.sections) {
    if (section.kind === 'written') {
      const parts = diffText(before.sections[section.id] ?? '', after.sections[section.id] ?? '');
      sections.push({
        id: section.id,
        title: specTitle(section),
        changed: parts.some((p) => p.type !== 'same'),
        parts,
      });
      continue;
    }
    for (const [name, field] of Object.entries(section.fields)) {
      const b = asText(before.fields[name]);
      const a = asText(after.fields[name]);
      fields.push({
        key: name,
        label: fieldLabel(name, field) || readable(name),
        before: b,
        after: a,
        changed: a !== b,
      });
    }
  }
  return { fields, sections };
}

export async function compareVersions(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  id: string,
  from: number,
  to: number,
): Promise<CompareResponse> {
  const o = await openDocument(deps.db, ctx, actor, id);
  const access = await fullAccess(deps.db, o);
  const a = await findVersion(deps.db, o.doc.id, from);
  const b = await findVersion(deps.db, o.doc.id, to);
  if (!a || !b || visibleVersions(access, [a, b]).length < 2) throw notFound('version');
  if (!a.content || !b.content || !o.doc.templateId) {
    throw validationFailed(
      'Only documents filled in from a template can be compared here.',
      'from',
    );
  }
  const template = (await findTemplate(deps.db, ctx.orgId, o.doc.templateId)) as TemplateRow;
  return {
    from: { versionNo: a.versionNo, revLabel: a.revLabel },
    to: { versionNo: b.versionNo, revLabel: b.revLabel },
    ...compareContent(template.spec, a.content, b.content),
  };
}

// Signing

const activeHolders = async (tx: Tx, orgId: string, roleKeys: string[]) =>
  (await Promise.all(roleKeys.map((role) => findActiveUsersByRole(tx, orgId, role)))).flat();

/**
 * The rows a submitted version will go through, for the preview and the warnings. A row warns when
 * nobody who could sign it is in reach: either nobody holds the role, or those who do aren't on
 * the project (a DARD or a designer must be on the team to sign for it).
 */
async function describeRows(
  tx: Tx,
  orgId: string,
  rows: ReturnType<typeof planRows>,
  actor: Actor,
  facts: ProjectFacts,
): Promise<SigningPreview> {
  const warnings: string[] = [];
  const out: SigningPreview['rows'] = [];
  for (const row of rows) {
    const byYou = row.meaning === 'prepared';
    let who = row.roleKeys.map(roleNameOf).join(' or ');
    if (byYou) who = `${actor.name} (you)`;
    else if (row.assigneeIds.length > 0) who = `${who}: all ${row.assigneeIds.length} must sign`;
    if (!byYou) {
      const holders = await activeHolders(tx, orgId, row.roleKeys);
      const reachable = holders.filter(
        (u) =>
          canAccess(
            'signatures.sign',
            { userId: u.id, name: u.name, roleKey: u.roleKey, productLineId: u.productLineId },
            {
              productLineId: facts.productLineId,
              memberIds: memberIdsOf(facts),
              roleKeys: row.roleKeys,
              assigneeId: null,
            },
          ).allowed,
      );
      if (holders.length === 0) {
        warnings.push(
          `Nobody holds the ${who} role yet, so ${row.meaning} can't be signed until someone does.`,
        );
      } else if (reachable.length === 0) {
        warnings.push(
          `Nobody holding the ${who} role is on this project, so ${row.meaning} can't be signed until someone is added to the team.`,
        );
      }
    }
    out.push({ meaning: row.meaning, who, byYou });
  }
  return { rows: out, warnings };
}

export async function submitVersion(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  id: string,
  versionNo: number,
  preview: boolean,
): Promise<SigningResult> {
  return previewable(deps.db, ctx, preview, async (tx, log) => {
    const o = await openDocument(tx, ctx, actor, id, { forUpdate: true });
    assertMay(o.env, 'documents.submit', [...o.step.doers]);
    await fullAccess(tx, o);
    assertStepOpen(o);
    const version = await findVersion(tx, o.doc.id, versionNo, { forUpdate: true });
    if (!version) throw notFound('version');
    const latest = (await latestVersionOf(tx, o.doc.id)) as VersionRow;
    if (version.id !== latest.id || version.status !== 'draft') {
      throw new AppError(
        409,
        'DOCUMENT_LOCKED',
        'Only the latest draft can be submitted for signing.',
      );
    }
    if (o.doc.templateId && version.content) {
      const template = (await findTemplate(tx, ctx.orgId, o.doc.templateId)) as TemplateRow;
      const missing = missingRequired(template.spec, version.content);
      if (missing.length > 0) {
        throw validationFailed(`Fill in ${missing.join(', ')} before submitting.`, 'fields');
      }
    }

    const boardSigners =
      o.step.all_must_sign && o.step.signer
        ? (await findActiveUsersByRole(tx, ctx.orgId, o.step.signer)).map((u) => u.id)
        : [];
    const rows = planRows(
      o.doc.signaturePlan,
      { signer: o.step.signer, boardSigners },
      signerOf(actor),
    );
    const described = await describeRows(tx, ctx.orgId, rows, actor, o.viewer.facts);

    const requests = await openRows(tx, ctx.orgId, version.id, rows);
    const prepared = requests.find((r) => r.meaning === 'prepared') as RequestRow;
    const { complete } = await signRow(tx, ctx.orgId, version, prepared, signerOf(actor));
    log.audit({
      action: 'document.submitted',
      recordType: 'document_version',
      recordId: version.id,
      before: { status: 'draft' },
      after: { status: complete ? 'approved' : 'in_review', number: o.doc.number, versionNo },
    });
    log.audit({
      action: 'signature.signed',
      recordType: 'document_version',
      recordId: version.id,
      after: {
        meaning: 'prepared',
        by: actor.name,
        contentSha256: version.contentSha256,
        pdfSha256: version.pdfSha256,
      },
    });
    const projectId = o.viewer.facts.projectId;
    log.event({
      type: 'document.submitted',
      projectId,
      stepKey: o.step.key,
      payload: { documentId: o.doc.id, number: o.doc.number, versionNo },
    });
    log.event({
      type: 'signature.signed',
      projectId,
      stepKey: o.step.key,
      payload: { documentId: o.doc.id, meaning: 'prepared' },
    });
    if (complete) {
      await approveVersion(tx, log, o.doc, version, o.step.key, projectId);
    } else {
      await tx
        .update(documentVersions)
        .set({ status: 'in_review' })
        .where(eq(documentVersions.id, version.id));
      log.event({
        type: 'signature.requested',
        projectId,
        stepKey: o.step.key,
        payload: { documentId: o.doc.id, number: o.doc.number, versionNo },
      });
    }
    return {
      saved: !preview,
      preview: described,
      document: preview ? null : await presentDocument(tx, o.viewer, o.doc, versionNo),
    };
  });
}

/** Loads a signature request with everything needed to act on it, locking the project's run. */
async function openRequest(tx: Tx, ctx: RequestContext, actor: Actor, id: string) {
  const first = await findRequest(tx, ctx.orgId, id);
  if (!first) throw notFound('signature request');
  const [version] = [...(await versionsById(tx, [first.versionId])).values()];
  if (!version) throw notFound('signature request');
  const o = await openDocument(tx, ctx, actor, version.documentId, { forUpdate: true });
  const request = (await findRequest(tx, ctx.orgId, id, { forUpdate: true })) as RequestRow;
  const fresh = (await versionsById(tx, [version.id])).get(version.id) as VersionRow;
  const preparer = (await signaturesOf(tx, 'document_version', [version.id]))
    .get(version.id)
    ?.find((s) => s.meaning === 'prepared')?.userId;
  return { o, request, version: fresh, preparer };
}

/** A step sign-off record is signed by signing off the step, never on its own. */
function assertNotRecord(o: Opened): void {
  if (o.type.kind === 'record') {
    throw new AppError(
      409,
      'DOCUMENT_LOCKED',
      'This record is signed when the step is signed off. Use the step’s Approve button.',
    );
  }
}

function assertPending(request: RequestRow): void {
  if (request.status === 'signed') {
    throw new AppError(409, 'ALREADY_DONE', 'This row is already signed.');
  }
  if (request.status !== 'pending') {
    throw new AppError(409, 'DOCUMENT_LOCKED', "This row isn't waiting for a signature.");
  }
}

export async function signRequest(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  id: string,
  preview: boolean,
): Promise<SigningResult> {
  return previewable(deps.db, ctx, preview, async (tx, log) => {
    const { o, request, version, preparer } = await openRequest(tx, ctx, actor, id);
    assertCanAccess('signatures.sign', actor, {
      productLineId: o.viewer.facts.productLineId,
      memberIds: memberIdsOf(o.viewer.facts),
      roleKeys: request.roleKeys,
      assigneeId: request.assigneeId,
    });
    assertNotRecord(o);
    assertPending(request);
    if (!documentsWorking(o)) {
      throw new AppError(
        409,
        'PROJECT_NOT_ACTIVE',
        "The project is on hold or finished, so signing can't go on now.",
      );
    }
    if (request.meaning === 'approved' && preparer === actor.userId) {
      throw new AppError(
        403,
        'SEPARATION_OF_DUTIES',
        'You prepared this version, so someone else must approve it.',
      );
    }
    const { signedRow, complete } = await signRow(tx, ctx.orgId, version, request, signerOf(actor));
    const projectId = o.viewer.facts.projectId;
    log.audit({
      action: 'signature.signed',
      recordType: 'document_version',
      recordId: version.id,
      after: {
        meaning: request.meaning,
        by: actor.name,
        number: o.doc.number,
        versionNo: version.versionNo,
        contentSha256: version.contentSha256,
        pdfSha256: version.pdfSha256,
      },
    });
    log.event({
      type: 'signature.signed',
      projectId,
      stepKey: o.step.key,
      payload: { documentId: o.doc.id, number: o.doc.number, meaning: request.meaning },
    });
    const warnings: string[] = [];
    if (complete) {
      await approveVersion(tx, log, o.doc, version, o.step.key, projectId);
      warnings.push('This is the last signature, so the version becomes approved.');
    } else if (signedRow) {
      log.event({
        type: 'signature.requested',
        projectId,
        stepKey: o.step.key,
        payload: { documentId: o.doc.id, number: o.doc.number },
      });
    }
    return {
      saved: !preview,
      preview: {
        rows: [{ meaning: request.meaning, who: `${actor.name} (you)`, byYou: true }],
        warnings,
      },
      document: preview ? null : await presentDocument(tx, o.viewer, o.doc, version.versionNo),
    };
  });
}

export async function returnRequest(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  id: string,
  comment: string,
): Promise<SigningResult> {
  return change(deps.db, ctx, async (tx, log) => {
    const { o, request, version } = await openRequest(tx, ctx, actor, id);
    assertCanAccess('signatures.return', actor, {
      productLineId: o.viewer.facts.productLineId,
      memberIds: memberIdsOf(o.viewer.facts),
      roleKeys: request.roleKeys,
      assigneeId: request.assigneeId,
    });
    assertNotRecord(o);
    assertPending(request);
    if (!documentsWorking(o)) {
      throw new AppError(
        409,
        'PROJECT_NOT_ACTIVE',
        "The project is on hold or finished, so signing can't go on now.",
      );
    }
    await returnVersion(
      tx,
      log,
      o.doc,
      version,
      { request, by: signerOf(actor), comment },
      o.step.key,
      o.viewer.facts.projectId,
    );
    return {
      saved: true,
      preview: { rows: [], warnings: [] },
      document: await presentDocument(tx, o.viewer, o.doc, version.versionNo),
    };
  });
}

const isRecordDocument = async (deps: AppDeps, ctx: RequestContext, doc: DocumentRow) =>
  (await findTypesById(deps.db, ctx.orgId, [doc.documentTypeId])).get(doc.documentTypeId)?.kind ===
  'record';

/**
 * Who is asked to sign a document right now: the rows that are pending, with the person or the
 * roles. A step's sign-off record isn't listed: its signer is asked through the step's own task.
 */
export async function pendingSignersOf(
  ex: Executor,
  orgId: string,
  documentId: string,
): Promise<{ meaning: string; roleKeys: string[]; assigneeId: string | null; number: string }[]> {
  const doc = (await documentsById(ex, orgId, [documentId])).get(documentId);
  if (!doc) return [];
  const type = (await findTypesById(ex, orgId, [doc.documentTypeId])).get(doc.documentTypeId);
  if (type?.kind === 'record') return [];
  const versions = (await versionsOf(ex, [documentId])).get(documentId) ?? [];
  const requests = await requestsOfVersions(
    ex,
    versions.map((v) => v.id),
  );
  return [...requests.values()]
    .flat()
    .filter((r) => r.status === 'pending')
    .map((r) => ({
      meaning: r.meaning,
      roleKeys: r.roleKeys,
      assigneeId: r.assigneeId,
      number: doc.number,
    }));
}

/** What waits for my signature, across the projects I may sign for. */
export async function listWaiting(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
): Promise<WaitingSignature[]> {
  const pending = (await pendingRequests(deps.db, ctx.orgId)).filter(
    (r) => r.assigneeId === actor.userId || (!r.assigneeId && r.roleKeys.includes(actor.roleKey)),
  );
  if (pending.length === 0) return [];
  const versions = await versionsById(
    deps.db,
    pending.map((r) => r.versionId),
  );
  const docs = await documentsById(
    deps.db,
    ctx.orgId,
    [...versions.values()].map((v) => v.documentId),
  );
  const out: WaitingSignature[] = [];
  const projects = new Map<string, Awaited<ReturnType<typeof findProjectByRun>>>();
  const teams = new Map<string, string[]>();
  for (const request of pending) {
    const version = versions.get(request.versionId);
    const doc = version ? docs.get(version.documentId) : undefined;
    if (!version || !doc) continue;
    if (!projects.has(doc.runId)) {
      const project = await findProjectByRun(deps.db, ctx.orgId, doc.runId);
      projects.set(doc.runId, project);
      teams.set(
        doc.runId,
        project ? (await activeMembers(deps.db, ctx.orgId, project.id)).map((m) => m.user.id) : [],
      );
    }
    const project = projects.get(doc.runId);
    if (!project) continue;
    const preparer = (await signaturesOf(deps.db, 'document_version', [version.id]))
      .get(version.id)
      ?.find((s) => s.meaning === 'prepared')?.userId;
    if (request.meaning === 'approved' && preparer === actor.userId) continue;
    if (doc.stepKey && (await isRecordDocument(deps, ctx, doc))) continue;
    const allowed = canAccess('signatures.sign', actor, {
      productLineId: project.productLineId,
      memberIds: teams.get(doc.runId) ?? [],
      roleKeys: request.roleKeys,
      assigneeId: request.assigneeId,
    });
    if (!allowed.allowed) continue;
    out.push({
      id: request.id,
      meaning: request.meaning,
      documentId: doc.id,
      number: doc.number,
      title: doc.title,
      versionNo: version.versionNo,
      stepKey: doc.stepKey,
      project: { id: project.id, code: project.code, name: project.name },
      requestedAt: request.requestedAt.toISOString(),
    });
    if (out.length >= 100) break;
  }
  return out;
}

/** Whether a document version the person may read holds this file (its PDF or its upload). */
export async function fileViaDocuments(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  file: FileRow,
): Promise<boolean> {
  const versions = await versionsHoldingFile(deps.db, ctx.orgId, file.id);
  for (const version of versions) {
    try {
      const o = await openDocument(deps.db, ctx, actor, version.documentId);
      const versionsOfDoc = (await versionsOf(deps.db, [o.doc.id])).get(o.doc.id) ?? [];
      const requests = [
        ...(
          await requestsOfVersions(
            deps.db,
            versionsOfDoc.map((v) => v.id),
          )
        ).values(),
      ].flat();
      const access = accessOf(actor, documentResource(o.viewer.facts, o.step, o.type, requests));
      if (access.level === 'full' && visibleVersions(access, [version]).length > 0) return true;
    } catch {
      // A document that can't be opened by this person grants nothing.
    }
  }
  return false;
}

/** What the person may see of a run's documents, for the project's activity feed. */
export async function visibleDocuments(ex: Executor, v: Viewer) {
  return documentVisibility(ex, v, await documentsOfRun(ex, v.facts.orgId, v.facts.runId));
}
