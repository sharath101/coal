import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { TemplateSpec } from '@coal/shared';
import { parse } from 'yaml';
import type { AppDeps } from '../../core/deps';
import type { RequestContext } from '../../core/http/context';
import { storeGeneratedFile } from '../files/service';
import { addTemplate } from './service';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface ImportResult {
  name: string;
  ok: boolean;
  /** One line for the person, then any problems that need fixing. */
  lines: string[];
}

/**
 * Imports the forms in a folder: each is `NAME.docx` with `NAME.spec.yaml` beside it. Every one is
 * checked like an upload and saved as a draft; the VP or the Head makes it active.
 */
export async function importTemplateFolder(
  deps: AppDeps,
  ctx: RequestContext,
  folder: string,
): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  if (!existsSync(folder)) return results;
  const specs = readdirSync(folder)
    .filter((f) => f.endsWith('.spec.yaml'))
    .sort();

  for (const specFile of specs) {
    const name = basename(specFile, '.spec.yaml');
    const docxPath = join(folder, `${name}.docx`);
    if (!existsSync(docxPath)) {
      results.push({
        name,
        ok: false,
        lines: [`${name}.docx is missing next to its specification.`],
      });
      continue;
    }
    let raw: unknown;
    try {
      raw = parse(readFileSync(join(folder, specFile), 'utf8'));
    } catch (error) {
      results.push({
        name,
        ok: false,
        lines: [`The specification is not valid YAML: ${(error as Error).message}`],
      });
      continue;
    }
    const parsed = TemplateSpec.safeParse(raw);
    if (!parsed.success) {
      results.push({
        name,
        ok: false,
        lines: [
          'The specification is not valid:',
          ...parsed.error.issues.map((i) => `  ${i.path.join('.') || '(top)'}: ${i.message}`),
        ],
      });
      continue;
    }
    const docx = readFileSync(docxPath);
    try {
      const file = await storeGeneratedFile(deps, deps.db, ctx.orgId, {
        name: `${name}.docx`,
        bytes: docx,
        contentType: DOCX,
        userId: null,
      });
      const template = await addTemplate(deps, ctx, null, {
        documentType: parsed.data.document_type,
        docx,
        docxFileId: file.id,
        spec: parsed.data,
        notes: `Imported from ${name}.docx`,
      });
      results.push({
        name,
        ok: true,
        lines: [
          `${parsed.data.document_type} version ${template.version} saved as a draft. Make it active on the Templates page.`,
        ],
      });
    } catch (error) {
      const problems =
        (error as { extra?: { errors?: { message: string }[] } }).extra?.errors ?? [];
      results.push({
        name,
        ok: false,
        lines: [(error as Error).message, ...problems.map((p) => `  ${p.message}`)],
      });
    }
  }
  return results;
}
