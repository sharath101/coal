import {
  TemplateSpec,
  type PrepareTemplateBody,
  type PreparedTemplate,
  type SampleOutline,
} from '@coal/shared';
import type { AppDeps } from '../../core/deps';
import type { Actor, RequestContext } from '../../core/http/context';
import { AppError, validationFailed } from '../../core/http/errors';
import {
  assertUsableEvidence,
  readFileBytes,
  scanStored,
  storeGeneratedFile,
  type FileRow,
} from '../files/service';
import { DocxError } from './docx';
import { applyPlan, indexDocx, outlineOf } from './sample-docx';
import { MAX_SAMPLE_BYTES, pdfToDocx } from './sample-pdf';
import { checkTemplateFile, findTypeByCode } from './service';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** A sample that cannot be used, with every reason, written for the person who attached it. */
const unusable = (problems: string[]) =>
  new AppError(400, 'VALIDATION_FAILED', 'The sample could not be used.', {
    errors: problems.map((message) => ({ path: 'fileId', message })),
  });

interface LoadedSample {
  file: FileRow;
  /** The Word file the template is made from: the sample itself, or a plain one built from a PDF. */
  docx: Buffer;
  layout: 'kept' | 'rebuilt';
  pages: number | null;
  notes: string[];
}

/**
 * Opens a sample the person uploaded: a Word file as it is, or a PDF with text as a plain Word
 * form. The same bytes always give the same parts, so the AI's numbers still match when it builds.
 */
export async function loadSample(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  fileId: string,
): Promise<LoadedSample> {
  const file = await assertUsableEvidence(deps.db, ctx.orgId, actor, fileId, 'fileId');
  const scanned = await scanStored(deps, ctx, file);
  if (scanned.scanStatus === 'infected')
    throw unusable(['The virus scan found a problem with this file.']);
  const name = file.name.toLowerCase();
  const isPdf = name.endsWith('.pdf');
  if (!isPdf && !name.endsWith('.docx')) {
    throw unusable(['A sample must be a Word (.docx) file or a PDF.']);
  }
  if (file.size > MAX_SAMPLE_BYTES) throw unusable(['The file is larger than 10 MB.']);
  const bytes = await readFileBytes(deps, file);
  try {
    if (isPdf) {
      const read = await pdfToDocx(bytes);
      return { file, docx: read.docx, layout: 'rebuilt', pages: read.pages, notes: read.notes };
    }
    indexDocx(bytes);
    return { file, docx: bytes, layout: 'kept', pages: null, notes: [] };
  } catch (error) {
    if (error instanceof DocxError) throw unusable(error.problems);
    throw unusable([(error as Error).message || 'The file could not be read.']);
  }
}

/** The sample as a numbered outline, for the AI to decide what each part is. */
export async function readSampleOutline(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  fileId: string,
): Promise<SampleOutline> {
  const sample = await loadSample(deps, ctx, actor, fileId);
  const { parts, notes } = outlineOf(indexDocx(sample.docx));
  return {
    file: { id: sample.file.id, name: sample.file.name, mimeType: sample.file.mimeType },
    layout: sample.layout,
    pages: sample.pages,
    parts,
    notes: [...sample.notes, ...notes],
  };
}

/** The specification the plan describes: what each section is, without where it sits in the sample. */
function specOf(plan: PrepareTemplateBody): unknown {
  return {
    template: plan.template,
    document_type: plan.documentType,
    steps: plan.steps,
    sections: plan.sections.map((s) =>
      s.kind === 'fields'
        ? {
            id: s.id,
            ...(s.title && { title: s.title }),
            kind: 'fields',
            fields: Object.fromEntries(
              Object.entries(s.fields).map(([name, f]) => [
                name,
                {
                  from: f.from,
                  ...(f.label && { label: f.label }),
                  multiline: f.multiline,
                  required: f.required,
                },
              ]),
            ),
          }
        : {
            id: s.id,
            ...(s.title && { title: s.title }),
            kind: 'written',
            instructions: s.instructions,
            sources: s.sources,
            required: s.required,
          },
    ),
    signature_rows: plan.signatureRows,
    reviewed_by: plan.reviewedBy,
    approved_by: plan.approvedBy,
  };
}

/**
 * Turns a sample into a template without adding one to the library: the placeholders go into the
 * person's Word file (or into a plain form built from a PDF), the result is checked like an upload,
 * and a sample PDF is made from made-up data. Nothing the person has not seen is saved as a template.
 */
export async function prepareTemplate(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  plan: PrepareTemplateBody,
): Promise<PreparedTemplate> {
  const sample = await loadSample(deps, ctx, actor, plan.fileId);

  const parsed = TemplateSpec.safeParse(specOf(plan));
  if (!parsed.success) {
    throw new AppError(400, 'VALIDATION_FAILED', 'The template did not pass its checks.', {
      errors: parsed.error.issues.map((i) => ({
        path: i.path.join('.') || 'spec',
        message: i.message,
      })),
    });
  }
  const spec = parsed.data;

  const type = await findTypeByCode(deps.db, ctx.orgId, plan.documentType);
  if (type && type.kind !== 'template') {
    throw validationFailed(`${type.name} documents are not made from a template.`, 'documentType');
  }

  const built = applyPlan(sample.docx, plan);
  if (built.problems.length > 0) {
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      'The sample could not be turned into a template.',
      {
        errors: built.problems.map((message) => ({ path: 'sections', message })),
      },
    );
  }
  const filled = await checkTemplateFile(deps, ctx.orgId, {
    code: plan.documentType,
    type,
    spec,
    docx: built.docx,
  });
  const pdf = await deps.pdf.fromDocx(filled, `${plan.documentType}-sample.docx`);

  return deps.db.transaction(async (tx) => {
    const docx = await storeGeneratedFile(deps, tx, ctx.orgId, {
      name: `${plan.documentType}-template.docx`,
      bytes: built.docx,
      contentType: DOCX,
      userId: actor.userId,
      derivedFrom: sample.file.id,
    });
    const sampleFile = await storeGeneratedFile(deps, tx, ctx.orgId, {
      name: `${plan.documentType}-sample.pdf`,
      bytes: pdf,
      contentType: 'application/pdf',
      userId: actor.userId,
      derivedFrom: docx.id,
    });
    return { docxFileId: docx.id, sampleFileId: sampleFile.id, layout: sample.layout, spec };
  });
}
