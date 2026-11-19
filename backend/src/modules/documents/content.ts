import { createHash } from 'node:crypto';
import {
  canonicalJson,
  type DocumentContent,
  type FieldSource,
  type FieldValue,
  type TemplateSpec,
} from '@coal/shared';
import type { Executor } from '../../core/db/client';
import type { AppDeps } from '../../core/deps';
import { AppError, validationFailed } from '../../core/http/errors';
import { findFiles, readFileBytes } from '../files/service';
import { ROLES } from '../org/catalogue';
import { DocxError, fillDocx } from '../templates/docx';
import { renderData, type TemplateRow } from '../templates/service';
import type { ProjectFacts } from './facts';

export const sha256 = (data: string | Buffer): string =>
  createHash('sha256').update(data).digest('hex');

export const hashContent = (content: DocumentContent): string => sha256(canonicalJson(content));

/** Today in Indian time, as printed on documents. */
export function todayInIndia(now = new Date()): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(now);
}

const ROLE_NAMES = new Map(ROLES.map((r) => [r.key, r.name]));

/** What a document's fields are filled from, apart from the person's own answers. */
export interface FieldContext {
  facts: ProjectFacts;
  step: { key: string; name: string };
  number: string;
  title: string;
  authorName: string;
  now?: Date;
}

function recordValue(source: FieldSource, c: FieldContext): FieldValue {
  switch (source) {
    case 'project.code':
      return c.facts.code;
    case 'project.name':
      return c.facts.name;
    case 'project.description':
      return c.facts.description;
    case 'project.product_line':
      return c.facts.productLineName;
    case 'project.stage':
      return c.facts.stage;
    case 'project.team':
      return c.facts.team.map((m) => ({
        name: m.name,
        role: ROLE_NAMES.get(m.roleKey) ?? m.roleKey,
      }));
    case 'step.key':
      return c.step.key;
    case 'step.name':
      return c.step.name;
    case 'document.number':
      return c.number;
    case 'document.title':
      return c.title;
    case 'author.name':
      return c.authorName;
    case 'today':
      return todayInIndia(c.now);
    case 'person':
      return '';
  }
}

/** What the person typed, to be merged into the document. Left out means unchanged. */
export interface TypedContent {
  fields: Record<string, string>;
  sections: Record<string, string>;
}

/**
 * Builds a version's content: fields from COAL's records are filled afresh (never typed, never
 * written by the AI), the person's fields and written sections come from what was typed, and
 * whatever wasn't mentioned keeps the previous version's text.
 */
export function buildContent(
  spec: TemplateSpec,
  c: FieldContext,
  typed: TypedContent,
  previous: DocumentContent | null,
): DocumentContent {
  const fields: Record<string, FieldValue> = {};
  const sections: Record<string, string> = {};
  const known = new Set<string>();
  const writtenIds = new Set<string>();

  for (const section of spec.sections) {
    if (section.kind === 'written') {
      writtenIds.add(section.id);
      sections[section.id] = typed.sections[section.id] ?? previous?.sections[section.id] ?? '';
      continue;
    }
    for (const [name, field] of Object.entries(section.fields)) {
      known.add(name);
      if (field.from === 'person') {
        const earlier = previous?.fields[name];
        fields[name] = typed.fields[name] ?? (typeof earlier === 'string' ? earlier : '');
      } else {
        fields[name] = recordValue(field.from, c);
      }
    }
  }
  for (const name of Object.keys(typed.fields)) {
    if (!known.has(name))
      throw validationFailed(`"${name}" is not a field of this document.`, `fields.${name}`);
  }
  for (const id of Object.keys(typed.sections)) {
    if (!writtenIds.has(id))
      throw validationFailed(
        `"${id}" is not a written section of this document.`,
        `sections.${id}`,
      );
  }
  return { fields, sections };
}

/** Everything searchable in a document, for full-text search later. */
export function searchTextOf(title: string, content: DocumentContent | null): string {
  if (!content) return title;
  const text = (value: FieldValue) =>
    typeof value === 'string' ? value : value.map((row) => Object.values(row).join(' ')).join(' ');
  return [title, ...Object.values(content.fields).map(text), ...Object.values(content.sections)]
    .filter((s) => s.trim())
    .join('\n');
}

/** Fills a template's Word file with the content and turns it into a PDF. */
export async function renderPdf(
  deps: AppDeps,
  ex: Executor,
  orgId: string,
  template: TemplateRow,
  content: DocumentContent,
  fileName: string,
): Promise<Buffer> {
  // On the caller's own connection: inside a transaction, a second one could starve the pool.
  const [docxFile] = await findFiles(ex, orgId, [template.docxFileId]);
  if (!docxFile) throw new AppError(500, 'INTERNAL', 'The template file is missing.');
  const docx = await readFileBytes(deps, docxFile);
  let filled: Buffer;
  try {
    filled = fillDocx(docx, renderData(content));
  } catch (error) {
    if (error instanceof DocxError)
      throw new AppError(500, 'INTERNAL', 'The template could not be filled.');
    throw error;
  }
  return deps.pdf.fromDocx(filled, fileName);
}
