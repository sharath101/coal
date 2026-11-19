import {
  FIELD_SOURCES,
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
import { findUsersByIds } from '../users/service';
import { DOCUMENT_TYPES } from './catalogue';
import { DocxError, fillDocx, readTags } from './docx';
import { SAMPLE_TEMPLATES, sampleDocx } from './samples';
import { documentTypes, templates } from './tables';

export type TypeRow = typeof documentTypes.$inferSelect;
export type TemplateRow = typeof templates.$inferSelect;

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
  return types.map((t) => {
    const template = byType.get(t.id);
    return {
      code: t.code,
      name: t.name,
      kind: t.kind,
      sensitivity: t.sensitivity,
      stepKeys: t.stepKeys,
      signatureRows: t.signaturePlan.rows,
      activeTemplate: template
        ? { id: template.id, version: template.version, name: template.name }
        : null,
    };
  });
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
      steps: row.spec.steps,
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

export interface AddTemplateInput {
  documentType: string;
  /** The Word file's bytes, already read from storage, or made by COAL. */
  docx: Buffer;
  /** The stored Word file. */
  docxFileId: string;
  spec?: TemplateSpec | undefined;
  notes: string;
}

/**
 * Checks a Word file against its specification and saves it as a draft version
 * (docs/documents-and-signing.md#adding-a-template). Nothing is saved unless every check passes.
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

  const problems: string[] = [];
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

  // The specification: the one given, or the previous version's.
  const [previous] = await deps.db
    .select()
    .from(templates)
    .where(and(eq(templates.orgId, orgId), eq(templates.documentTypeId, type.id)))
    .orderBy(desc(templates.version))
    .limit(1);
  const spec = input.spec ?? previous?.spec;
  if (!spec) {
    throw validationFailed(
      `This is the first template for ${type.name}, so it needs a specification. COAL's team prepares it from the sample documents.`,
      'spec',
    );
  }
  if (spec.document_type !== type.code) {
    problems.push(`The specification is for ${spec.document_type}, not ${type.code}.`);
  }
  const wrongSteps = spec.steps.filter(
    (s) => type.stepKeys.length > 0 && !type.stepKeys.includes(s),
  );
  if (wrongSteps.length > 0) {
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
  if (problems.length > 0) throw checkFailed(problems);

  const samplePdf = await deps.pdf.fromDocx(sampleDocxBytes as Buffer, `${type.code}-sample.docx`);

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
    const [row] = await tx
      .insert(templates)
      .values({
        orgId,
        documentTypeId: type.id,
        version,
        status: 'draft',
        name: spec.template,
        spec,
        placeholders: specPlaceholders(spec).map((p) => p.name),
        docxFileId: input.docxFileId,
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
      after: { documentType: type.code, version, name: spec.template, status: 'draft' },
    });
    log.event({
      type: 'template.added',
      payload: { templateId: added.id, documentType: type.code, version },
    });
    return added;
  });
}

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
  return addTemplate(deps, ctx, actor, { ...input, docx, notes: input.notes });
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

/** Whether a person may open a template's Word file or sample: the VP and the Head always; the sample of an active one for all. */
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
        sql`${templates.docxFileId} = ${fileId} or ${templates.samplePdfFileId} = ${fileId}`,
      ),
    );
  return rows.some(
    (t) => canManageTemplates(actor) || (t.status === 'active' && t.samplePdfFileId === fileId),
  );
}

export async function templateFiles(ex: Executor, orgId: string, row: TemplateRow) {
  const ids = [row.docxFileId, row.samplePdfFileId].filter((id): id is string => !!id);
  const rows = await findFiles(ex, orgId, ids);
  return {
    docx: rows.find((f) => f.id === row.docxFileId) ?? null,
    sample: rows.find((f) => f.id === row.samplePdfFileId) ?? null,
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
