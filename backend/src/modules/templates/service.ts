import {
  DEFAULT_NUMBERING,
  FIELD_SOURCES,
  SIGNATURE_ROW_SETS,
  type CreateDocumentTypeBody,
  type TemplateSpec,
  checkPlaceholders,
  fieldLabel,
  readable,
  specPlaceholders,
  type DocumentContent,
  type DocumentTypeView,
  type FieldValue,
  type TemplateDetail,
  type TemplateSummary,
} from '@coal/shared';
import { and, asc, desc, eq, inArray, max, sql } from 'drizzle-orm';
import { change } from '../../core/db/change';
import type { Executor } from '../../core/db/client';
import type { AppDeps } from '../../core/deps';
import type { Actor, RequestContext } from '../../core/http/context';
import { AppError, notFound, validationFailed } from '../../core/http/errors';
import {
  assertUsableEvidence,
  findFiles,
  readFileBytes,
  scanStored,
  storeGeneratedFile,
} from '../files/service';
import { listRoles } from '../org/service';
import { listLatestVersions } from '../process/service';
import { findUsersByIds } from '../users/service';
import { DOCUMENT_TYPES } from './catalogue';
import { DocxError, fillDocx, openZip, readTags } from './docx';
import { SAMPLE_TEMPLATES, sampleDocx } from './samples';
import { documentTypes, templates } from './tables';

export type TypeRow = typeof documentTypes.$inferSelect;
export type TemplateRow = typeof templates.$inferSelect;

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * The specification of a template that is filled in COAL. A plain Word form has none, and no
 * document made from it asks for one, so this is reached only through a template with a specification.
 */
export function specOf(row: TemplateRow): TemplateSpec {
  if (!row.spec) {
    throw new AppError(
      500,
      'INTERNAL',
      'This template is a plain Word form: it has no specification.',
    );
  }
  return row.spec;
}

/**
 * The blank form people fill in: the Word file with any placeholders emptied, so a prepared form
 * (the sample templates, a file with `{tags}`) reads as a clean form. A file whose braces can't be
 * read is Jayon's form as it is, and is served as it is.
 */
export function blankForm(docx: Buffer): Buffer {
  try {
    return fillDocx(docx, {});
  } catch (error) {
    if (error instanceof DocxError) return docx;
    throw error;
  }
}

/** Word files are forms, not archives. */
export const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;

/** Loads the catalogue of document types. Safe to run on every deploy. */
export async function loadDocumentTypes(ex: Executor, orgId: string): Promise<void> {
  await ex
    .insert(documentTypes)
    .values(
      DOCUMENT_TYPES.map((t) => ({
        orgId,
        code: t.code,
        name: t.name,
        departmentCode: t.department,
        kind: t.kind,
        sensitivity: t.sensitivity ?? 'normal',
        stepKeys: t.steps,
        numberingPattern: t.numbering,
        signaturePlan: t.plan,
      })),
    )
    .onConflictDoUpdate({
      target: [documentTypes.orgId, documentTypes.code],
      set: {
        name: sql`excluded.name`,
        departmentCode: sql`excluded.department_code`,
        kind: sql`excluded.kind`,
        sensitivity: sql`excluded.sensitivity`,
        stepKeys: sql`excluded.step_keys`,
        numberingPattern: sql`excluded.numbering_pattern`,
        signaturePlan: sql`excluded.signature_plan`,
        updatedAt: sql`now()`,
      },
    });
}

export async function findTypeByCode(
  ex: Executor,
  orgId: string,
  code: string,
  options: { forUpdate?: boolean } = {},
): Promise<TypeRow | null> {
  const query = ex
    .select()
    .from(documentTypes)
    .where(and(eq(documentTypes.orgId, orgId), eq(documentTypes.code, code)));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  return row ?? null;
}

export async function findTypesById(
  ex: Executor,
  orgId: string,
  ids: string[],
): Promise<Map<string, TypeRow>> {
  if (ids.length === 0) return new Map();
  const rows = await ex
    .select()
    .from(documentTypes)
    .where(and(eq(documentTypes.orgId, orgId), inArray(documentTypes.id, [...new Set(ids)])));
  return new Map(rows.map((r) => [r.id, r]));
}

export async function findTemplate(
  ex: Executor,
  orgId: string,
  id: string,
): Promise<TemplateRow | null> {
  const [row] = await ex
    .select()
    .from(templates)
    .where(and(eq(templates.orgId, orgId), eq(templates.id, id)));
  return row ?? null;
}

export async function findTemplatesById(
  ex: Executor,
  orgId: string,
  ids: string[],
): Promise<Map<string, TemplateRow>> {
  if (ids.length === 0) return new Map();
  const rows = await ex
    .select()
    .from(templates)
    .where(and(eq(templates.orgId, orgId), inArray(templates.id, [...new Set(ids)])));
  return new Map(rows.map((r) => [r.id, r]));
}

/** The version people use to make new documents of a type. */
export async function activeTemplate(
  ex: Executor,
  orgId: string,
  typeId: string,
): Promise<TemplateRow | null> {
  const [row] = await ex
    .select()
    .from(templates)
    .where(
      and(
        eq(templates.orgId, orgId),
        eq(templates.documentTypeId, typeId),
        eq(templates.status, 'active'),
      ),
    );
  return row ?? null;
}

const presentType = (t: TypeRow, template: TemplateRow | undefined): DocumentTypeView => ({
  code: t.code,
  name: t.name,
  kind: t.kind,
  sensitivity: t.sensitivity,
  stepKeys: t.stepKeys,
  signatureRows: t.signaturePlan.rows,
  activeTemplate: template
    ? { id: template.id, version: template.version, name: template.name, hasSpec: !!template.spec }
    : null,
});

export async function listDocumentTypes(ex: Executor, orgId: string): Promise<DocumentTypeView[]> {
  const types = await ex
    .select()
    .from(documentTypes)
    .where(eq(documentTypes.orgId, orgId))
    .orderBy(asc(documentTypes.name));
  const active = await ex
    .select()
    .from(templates)
    .where(and(eq(templates.orgId, orgId), eq(templates.status, 'active')));
  const byType = new Map(active.map((t) => [t.documentTypeId, t]));
  return types.map((t) => presentType(t, byType.get(t.id)));
}

/** Who a template COAL loaded itself is shown as added by. */
const COAL_PERSON = {
  id: '00000000-0000-7000-8000-000000000000',
  name: 'COAL (loaded by command)',
};

const MANAGERS = ['vp', 'rd_head'];
export const canManageTemplates = (actor: Actor) => MANAGERS.includes(actor.roleKey);

export async function listTemplates(
  ex: Executor,
  orgId: string,
  actor: Actor,
  query: { documentType?: string | undefined; status?: TemplateRow['status'] | undefined },
): Promise<TemplateSummary[]> {
  const conditions = [eq(templates.orgId, orgId)];
  // Drafts and retired versions are for the people who manage the library.
  if (!canManageTemplates(actor)) conditions.push(eq(templates.status, 'active'));
  else if (query.status) conditions.push(eq(templates.status, query.status));
  if (query.documentType) {
    const type = await findTypeByCode(ex, orgId, query.documentType);
    if (!type) return [];
    conditions.push(eq(templates.documentTypeId, type.id));
  }
  const rows = await ex
    .select()
    .from(templates)
    .where(and(...conditions))
    .orderBy(asc(templates.name), desc(templates.version));
  return presentTemplates(ex, orgId, rows);
}

export async function presentTemplates(
  ex: Executor,
  orgId: string,
  rows: TemplateRow[],
): Promise<TemplateSummary[]> {
  const types = await findTypesById(
    ex,
    orgId,
    rows.map((r) => r.documentTypeId),
  );
  const people = await findUsersByIds(
    ex,
    orgId,
    rows.flatMap((r) => [r.addedBy, r.activatedBy].filter((id): id is string => !!id)),
  );
  const nameOf = new Map(people.map((u) => [u.id, u.name]));
  const person = (id: string | null) => (id ? { id, name: nameOf.get(id) ?? 'Unknown' } : null);
  return rows.map((row) => {
    const type = types.get(row.documentTypeId) as TypeRow;
    return {
      id: row.id,
      documentType: { code: type.code, name: type.name },
      name: row.name,
      version: row.version,
      status: row.status,
      steps: row.spec?.steps ?? type.stepKeys,
      // A template COAL loaded itself has no person behind it.
      addedBy: person(row.addedBy) ?? COAL_PERSON,
      addedAt: row.createdAt.toISOString(),
      activatedBy: person(row.activatedBy),
      activatedAt: row.activatedAt?.toISOString() ?? null,
      hasSample: !!row.samplePdfFileId,
    };
  });
}

export async function presentTemplate(
  ex: Executor,
  orgId: string,
  actor: Actor,
  row: TemplateRow,
): Promise<TemplateDetail> {
  const [summary] = await presentTemplates(ex, orgId, [row]);
  return {
    ...(summary as TemplateSummary),
    spec: row.spec,
    notes: row.notes,
    can: { activate: canManageTemplates(actor) && row.status !== 'active' },
  };
}

/** Made-up values for every placeholder, to prove the template fills and renders. */
export function sampleContent(spec: TemplateSpec): DocumentContent {
  const fields: Record<string, FieldValue> = {};
  const sections: Record<string, string> = {};
  for (const section of spec.sections) {
    if (section.kind === 'written') {
      sections[section.id] =
        `Sample paragraph one for ${readable(section.id)}.\nSample paragraph two, to check line breaks.`;
      continue;
    }
    for (const [name, field] of Object.entries(section.fields)) {
      fields[name] =
        FIELD_SOURCES[field.from] === 'table'
          ? [
              { name: 'Asha Example', role: 'R&D Lead' },
              { name: 'Om Example', role: 'R&D Ops' },
            ]
          : `Sample ${fieldLabel(name, field).toLowerCase()}`;
    }
  }
  return { fields, sections };
}

/** The data docxtemplater fills the Word file from: fields and written sections by name. */
export const renderData = (content: DocumentContent): Record<string, unknown> => ({
  ...content.fields,
  ...content.sections,
});

const checkFailed = (problems: string[]) =>
  new AppError(400, 'VALIDATION_FAILED', 'The template did not pass its checks.', {
    errors: problems.map((message) => ({ path: 'docxFileId', message })),
  });

/**
 * Every check a template must pass: the specification against the document type and the roles, the
 * placeholders against the specification (both ways), and a fill with made-up data. Returns the
 * filled sample Word file; a failure lists every problem. `type` is null when the document type is
 * still to be made, so only what does not need it is checked.
 */
export async function checkTemplateFile(
  deps: AppDeps,
  orgId: string,
  input: { code: string; type: TypeRow | null; spec: TemplateSpec; docx: Buffer },
): Promise<Buffer> {
  const { code, type, spec } = input;
  const problems: string[] = [];
  if (spec.document_type !== code) {
    problems.push(`The specification is for ${spec.document_type}, not ${code}.`);
  }
  const wrongSteps = spec.steps.filter(
    (s) => type && type.stepKeys.length > 0 && !type.stepKeys.includes(s),
  );
  if (type && wrongSteps.length > 0) {
    problems.push(
      `${type.name} documents belong to step ${type.stepKeys.join(', ')}, not ${wrongSteps.join(', ')}.`,
    );
  }
  const roleKeys = new Set((await listRoles(deps.db, orgId)).map((r) => r.key));
  for (const role of [...spec.reviewed_by, ...spec.approved_by]) {
    if (!roleKeys.has(role)) problems.push(`"${role}" is not a role in COAL.`);
  }

  let sampleDocxBytes: Buffer | null = null;
  let tags: ReturnType<typeof readTags> | null = null;
  try {
    tags = readTags(input.docx);
  } catch (error) {
    if (!(error instanceof DocxError)) throw error;
    problems.push(...error.problems);
  }
  if (tags) {
    problems.push(...checkPlaceholders(spec, tags).problems);
    if (problems.length === 0) {
      try {
        sampleDocxBytes = fillDocx(input.docx, renderData(sampleContent(spec)));
      } catch (error) {
        if (!(error instanceof DocxError)) throw error;
        problems.push(...error.problems);
      }
    }
  }
  if (problems.length > 0 || !sampleDocxBytes) throw checkFailed(problems);
  return sampleDocxBytes;
}

export interface AddTemplateInput {
  documentType: string;
  /** The uploaded file's name, which names a plain form. */
  docxFileName?: string | undefined;
  /** The Word file's bytes, already read from storage, or made by COAL. */
  docx: Buffer;
  /** The stored Word file. */
  docxFileId: string;
  spec?: TemplateSpec | undefined;
  notes: string;
}

/**
 * Saves a Word file as a draft version of a document type's template
 * (docs/documents-and-signing.md#adding-a-template). Nothing is saved unless every check passes.
 *
 * Filling templates in COAL is parked (`TEMPLATE_FILLING`): a template is then Jayon's Word form
 * as it is, with no specification, so the only checks are on the file. A specification from COAL
 * itself (the sample templates, the import command) is kept, and used once filling is switched on.
 */
export async function addTemplate(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor | null,
  input: AddTemplateInput,
): Promise<TemplateRow> {
  const { orgId } = ctx;
  const type = await findTypeByCode(deps.db, orgId, input.documentType);
  if (!type) throw validationFailed('There is no such document type.', 'documentType');
  if (type.kind !== 'template') {
    throw validationFailed(`${type.name} documents are not made from a template.`, 'documentType');
  }
  if (input.docx.length > MAX_TEMPLATE_BYTES) {
    throw checkFailed(['The Word file is larger than 10 MB.']);
  }
  const filling = deps.config.templateFilling;
  if (actor && input.spec && !filling) {
    throw validationFailed(
      'Filling templates in COAL is switched off for now. Upload the Word form as it is, without a specification.',
      'spec',
    );
  }

  if (deps.scanner) {
    const verdict = await deps.scanner.scan(input.docx).catch(() => null);
    if (!verdict) {
      throw new AppError(
        502,
        'PDF_UNAVAILABLE',
        'COAL could not scan the file for viruses just now. Try again in a moment.',
      );
    }
    if (!verdict.clean) throw checkFailed(['The virus scan found a problem with this file.']);
  }

  // The specification: the one given, or the previous version's. A plain form has none.
  let spec: TemplateSpec | null = null;
  let previewBytes: Buffer;
  let form: Buffer;
  if (filling || input.spec) {
    const [previous] = await deps.db
      .select()
      .from(templates)
      .where(and(eq(templates.orgId, orgId), eq(templates.documentTypeId, type.id)))
      .orderBy(desc(templates.version))
      .limit(1);
    spec = input.spec ?? previous?.spec ?? null;
    if (!spec) {
      throw validationFailed(
        `This is the first template for ${type.name}, so it needs a specification. COAL's team prepares it from the sample documents.`,
        'spec',
      );
    }
    previewBytes = await checkTemplateFile(deps, orgId, {
      code: type.code,
      type,
      spec,
      docx: input.docx,
    });
    form = blankForm(input.docx);
  } else {
    // Only the file is checked: it must open as a Word file. What is in it is Jayon's own.
    try {
      openZip(input.docx);
    } catch (error) {
      if (error instanceof DocxError) throw checkFailed(error.problems);
      throw error;
    }
    form = blankForm(input.docx);
    previewBytes = form;
  }

  const samplePdf = await deps.pdf.fromDocx(previewBytes, `${type.code}-sample.docx`);

  return change(deps.db, ctx, async (tx, log) => {
    // One at a time per type, so versions are numbered without gaps or repeats.
    await findTypeByCode(tx, orgId, type.code, { forUpdate: true });
    const [latest] = await tx
      .select({ version: max(templates.version) })
      .from(templates)
      .where(and(eq(templates.orgId, orgId), eq(templates.documentTypeId, type.id)));
    const version = (latest?.version ?? 0) + 1;
    const sample = await storeGeneratedFile(deps, tx, orgId, {
      name: `${type.code}-v${version}-sample.pdf`,
      bytes: samplePdf,
      contentType: 'application/pdf',
      userId: actor?.userId ?? null,
    });
    // A file with nothing to empty is its own blank form.
    const formFile = form.equals(input.docx)
      ? null
      : await storeGeneratedFile(deps, tx, orgId, {
          name: `${type.code}-v${version}-form.docx`,
          bytes: form,
          contentType: DOCX,
          userId: actor?.userId ?? null,
          derivedFrom: input.docxFileId,
        });
    const [row] = await tx
      .insert(templates)
      .values({
        orgId,
        documentTypeId: type.id,
        version,
        status: 'draft',
        name: spec?.template ?? templateNameOf(type, input.docxFileName),
        spec,
        placeholders: spec ? specPlaceholders(spec).map((p) => p.name) : [],
        docxFileId: input.docxFileId,
        formFileId: formFile?.id ?? input.docxFileId,
        samplePdfFileId: sample.id,
        notes: input.notes,
        addedBy: actor?.userId ?? null,
      })
      .returning();
    const added = row as TemplateRow;
    log.audit({
      action: 'template.added',
      recordType: 'template',
      recordId: added.id,
      after: {
        documentType: type.code,
        version,
        name: added.name,
        status: 'draft',
        plainForm: !spec,
      },
    });
    log.event({
      type: 'template.added',
      payload: { templateId: added.id, documentType: type.code, version },
    });
    return added;
  });
}

/** A plain form has no specification to name it, so it is named for its file, or its kind of document. */
const templateNameOf = (type: TypeRow, fileName: string | undefined) => {
  const base = fileName?.replace(/\.docx$/i, '').trim();
  if (!base) return type.name;
  return base.toLowerCase().includes(type.name.toLowerCase()) ? base : `${type.name} (${base})`;
};

/** The API's way in: the Word file was uploaded first, and is read back from storage. */
export async function addTemplateFromUpload(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  input: {
    documentType: string;
    docxFileId: string;
    spec?: TemplateSpec | undefined;
    notes: string;
  },
): Promise<TemplateRow> {
  const file = await assertUsableEvidence(
    deps.db,
    ctx.orgId,
    actor,
    input.docxFileId,
    'docxFileId',
  );
  if (!file.name.toLowerCase().endsWith('.docx')) {
    throw validationFailed('Templates are Word (.docx) files.', 'docxFileId');
  }
  if (file.size > MAX_TEMPLATE_BYTES) throw checkFailed(['The Word file is larger than 10 MB.']);
  // The file was scanned when it was uploaded, where a scanner exists; make sure of it now.
  const scanned = await scanStored(deps, ctx, file);
  if (scanned.scanStatus === 'infected')
    throw checkFailed(['The virus scan found a problem with this file.']);
  const docx = await readFileBytes(deps, file);
  return addTemplate(deps, ctx, actor, {
    ...input,
    docxFileName: file.name,
    docx,
    notes: input.notes,
  });
}

/** Makes a draft or retired version active, retiring the one that was. */
export async function activateTemplate(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  id: string,
): Promise<TemplateRow> {
  return change(deps.db, ctx, async (tx, log) => {
    const found = await findTemplate(tx, ctx.orgId, id);
    if (!found) throw notFound('template');
    // Lock the type, so two activations of one type can't cross.
    const [type] = await tx
      .select()
      .from(documentTypes)
      .where(eq(documentTypes.id, found.documentTypeId))
      .for('update');
    const current = (await findTemplate(tx, ctx.orgId, id)) as TemplateRow;
    if (current.status === 'active') {
      throw new AppError(409, 'VERSION_CONFLICT', 'This version is already the active one.');
    }
    const now = new Date();
    const [retired] = await tx
      .update(templates)
      .set({ status: 'retired', retiredAt: now })
      .where(
        and(
          eq(templates.orgId, ctx.orgId),
          eq(templates.documentTypeId, current.documentTypeId),
          eq(templates.status, 'active'),
        ),
      )
      .returning();
    const [row] = await tx
      .update(templates)
      .set({ status: 'active', activatedBy: actor.userId, activatedAt: now, retiredAt: null })
      .where(eq(templates.id, id))
      .returning();
    const activated = row as TemplateRow;
    if (retired) {
      log.audit({
        action: 'template.retired',
        recordType: 'template',
        recordId: retired.id,
        before: { status: 'active' },
        after: { status: 'retired', version: retired.version },
      });
    }
    log.audit({
      action: 'template.activated',
      recordType: 'template',
      recordId: id,
      before: { status: current.status },
      after: { status: 'active', version: activated.version, documentType: type?.code },
    });
    log.event({
      type: 'template.activated',
      payload: {
        templateId: id,
        documentType: type?.code,
        version: activated.version,
        retiredVersion: retired?.version ?? null,
      },
    });
    return activated;
  });
}

/**
 * Whether a person may open a template's file: the VP and the Head always; the PDF and the blank
 * form of the approved version for everyone, because anyone making a document needs them.
 */
export async function templateFileAccess(
  ex: Executor,
  orgId: string,
  actor: Actor,
  fileId: string,
): Promise<boolean> {
  const rows = await ex
    .select()
    .from(templates)
    .where(
      and(
        eq(templates.orgId, orgId),
        sql`${templates.docxFileId} = ${fileId} or ${templates.samplePdfFileId} = ${fileId} or ${templates.formFileId} = ${fileId}`,
      ),
    );
  return rows.some(
    (t) =>
      canManageTemplates(actor) ||
      (t.status === 'active' && (t.samplePdfFileId === fileId || t.formFileId === fileId)),
  );
}

/**
 * The blank form of a template. Versions added since plain forms began have it; an older row gets
 * it the first time it is asked for, and keeps it.
 */
export async function ensureFormFile(deps: AppDeps, orgId: string, row: TemplateRow) {
  if (row.formFileId) return (await findFiles(deps.db, orgId, [row.formFileId]))[0] ?? null;
  const [original] = await findFiles(deps.db, orgId, [row.docxFileId]);
  if (!original) return null;
  const form = blankForm(await readFileBytes(deps, original));
  return deps.db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: templates.formFileId })
      .from(templates)
      .where(eq(templates.id, row.id))
      .for('update');
    if (current?.id) return (await findFiles(tx, orgId, [current.id]))[0] ?? null;
    const file = await storeGeneratedFile(deps, tx, orgId, {
      name: `${original.name.replace(/\.docx$/i, '')}-form.docx`,
      bytes: form,
      contentType: DOCX,
      userId: null,
      derivedFrom: row.docxFileId,
    });
    await tx.update(templates).set({ formFileId: file.id }).where(eq(templates.id, row.id));
    return file;
  });
}

/**
 * The hashes of every blank form of each document type, for telling a form nobody has filled in
 * from one that is: the Word file as it was uploaded, and its blank form.
 */
export async function blankFormHashes(
  ex: Executor,
  orgId: string,
  typeCodes: string[],
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (typeCodes.length === 0) return out;
  const rows = await ex
    .select({
      code: documentTypes.code,
      docxFileId: templates.docxFileId,
      formFileId: templates.formFileId,
    })
    .from(templates)
    .innerJoin(documentTypes, eq(templates.documentTypeId, documentTypes.id))
    .where(and(eq(templates.orgId, orgId), inArray(documentTypes.code, typeCodes)));
  const found = await findFiles(
    ex,
    orgId,
    rows.flatMap((r) => [r.docxFileId, r.formFileId].filter((id): id is string => !!id)),
  );
  const shaOf = new Map(found.map((f) => [f.id, f.sha256]));
  for (const row of rows) {
    const set = out.get(row.code) ?? new Set<string>();
    for (const id of [row.docxFileId, row.formFileId]) {
      const sha = id ? shaOf.get(id) : null;
      if (sha) set.add(sha);
    }
    out.set(row.code, set);
  }
  return out;
}

export async function templateFiles(deps: AppDeps, orgId: string, row: TemplateRow) {
  const ids = [row.docxFileId, row.samplePdfFileId].filter((id): id is string => !!id);
  const rows = await findFiles(deps.db, orgId, ids);
  return {
    docx: rows.find((f) => f.id === row.docxFileId) ?? null,
    sample: rows.find((f) => f.id === row.samplePdfFileId) ?? null,
    form: await ensureFormFile(deps, orgId, row),
  };
}

/**
 * Loads COAL's made-up sample templates for any type that has no template yet, and activates
 * them. Real templates from Jayon replace them as new versions. Returns what it added.
 */
export async function loadSampleTemplates(deps: AppDeps, ctx: RequestContext): Promise<string[]> {
  const added: string[] = [];
  for (const sample of SAMPLE_TEMPLATES) {
    const type = await findTypeByCode(deps.db, ctx.orgId, sample.spec.document_type);
    if (!type) continue;
    const [existing] = await deps.db
      .select({ id: templates.id })
      .from(templates)
      .where(and(eq(templates.orgId, ctx.orgId), eq(templates.documentTypeId, type.id)))
      .limit(1);
    if (existing) continue;
    const docx = sampleDocx(sample);
    const file = await storeGeneratedFile(deps, deps.db, ctx.orgId, {
      name: `${type.code}-sample.docx`,
      bytes: docx,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      userId: null,
    });
    const template = await addTemplate(deps, ctx, null, {
      documentType: type.code,
      docx,
      docxFileId: file.id,
      spec: sample.spec,
      notes: 'Made-up sample, until Jayon’s own form arrives.',
    });
    await activateSample(deps, ctx, template.id);
    added.push(type.code);
  }
  return added;
}

/** Activation by COAL itself, for the sample templates: there is no person to record. */
async function activateSample(deps: AppDeps, ctx: RequestContext, id: string): Promise<void> {
  await change(deps.db, ctx, async (tx, log) => {
    const [row] = await tx
      .update(templates)
      .set({ status: 'active', activatedAt: new Date() })
      .where(eq(templates.id, id))
      .returning();
    log.audit({
      action: 'template.activated',
      recordType: 'template',
      recordId: id,
      before: { status: 'draft' },
      after: { status: 'active', version: row?.version, sample: true },
    });
  });
}

/**
 * Adds a kind of document that is made from a template: the steps it belongs to, its numbering and
 * who signs. The first template of the type follows (docs/workstation-and-ai.md#making-a-template-from-a-sample-document).
 */
export async function createDocumentType(
  deps: AppDeps,
  ctx: RequestContext,
  input: CreateDocumentTypeBody,
): Promise<DocumentTypeView> {
  const { orgId } = ctx;
  const problems: { path: string; message: string }[] = [];
  const numbering = input.numbering ?? DEFAULT_NUMBERING;
  if (!numbering.includes('{project_code}') || !numbering.includes('{nn}')) {
    problems.push({
      path: 'numbering',
      message: 'The numbering needs {project_code} and {nn}, such as {project_code}-{type}-{nn}.',
    });
  }
  const rows = input.signatureRows.join(',');
  if (!SIGNATURE_ROW_SETS.some((set) => set.join(',') === rows)) {
    problems.push({
      path: 'signatureRows',
      message: 'Use [prepared], [prepared, approved] or [prepared, reviewed, approved].',
    });
  }
  if (input.signatureRows.includes('reviewed') && input.reviewedBy.length === 0) {
    problems.push({ path: 'reviewedBy', message: 'Name the roles that review.' });
  }
  const roleKeys = new Set((await listRoles(deps.db, orgId)).map((r) => r.key));
  for (const role of [...input.reviewedBy, ...input.approvedBy]) {
    if (!roleKeys.has(role))
      problems.push({ path: 'reviewedBy', message: `"${role}" is not a role in COAL.` });
  }
  const stepKeys = new Set(
    (await listLatestVersions(deps.db, orgId)).flatMap((v) => v.route.steps.map((s) => s.key)),
  );
  for (const step of input.steps) {
    if (!stepKeys.has(step))
      problems.push({ path: 'steps', message: `There is no step ${step} in the route.` });
  }
  if (await findTypeByCode(deps.db, orgId, input.code)) {
    problems.push({ path: 'code', message: `There is already a document type ${input.code}.` });
  }
  if (problems.length > 0) {
    throw new AppError(400, 'VALIDATION_FAILED', 'Some of the values sent are not valid.', {
      errors: problems,
    });
  }
  const row = await change(deps.db, ctx, async (tx, log) => {
    const [inserted] = await tx
      .insert(documentTypes)
      .values({
        orgId,
        code: input.code,
        name: input.name,
        departmentCode: 'RND',
        kind: 'template',
        stepKeys: input.steps,
        numberingPattern: numbering,
        signaturePlan: {
          rows: input.signatureRows,
          reviewedBy: input.reviewedBy,
          approvedBy: input.approvedBy,
        },
      })
      .returning();
    const added = inserted as TypeRow;
    log.audit({
      action: 'document_type.added',
      recordType: 'document_type',
      recordId: added.id,
      after: { code: added.code, name: added.name, steps: added.stepKeys, numbering },
    });
    log.event({ type: 'document_type.added', payload: { documentType: added.code } });
    return added;
  });
  return presentType(row, undefined);
}
