import { z } from 'zod';
import { StepKey } from '../process/definition';

/**
 * A template's specification (docs/documents-and-signing.md#the-template-library): which
 * sections are filled by code and which are written, where each field comes from, and the
 * signature rows. The Word file holds the layout; this holds the meaning.
 */

/** Where a field's value comes from, and whether it is one value or a table. */
export const FIELD_SOURCES = {
  'project.code': 'text',
  'project.name': 'text',
  'project.description': 'text',
  'project.product_line': 'text',
  'project.stage': 'text',
  'project.team': 'table',
  'step.key': 'text',
  'step.name': 'text',
  'document.number': 'text',
  'document.title': 'text',
  'author.name': 'text',
  today: 'text',
  /** Typed by the person in a form, or asked for in the chat. Never guessed. */
  person: 'text',
} as const;
export type FieldSource = keyof typeof FIELD_SOURCES;
export const FIELD_SOURCE_KEYS = Object.keys(FIELD_SOURCES) as [FieldSource, ...FieldSource[]];

/** The columns of a table field: the loop `{#members}{name}{role}{/members}` in the Word file. */
export const TABLE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  'project.team': ['name', 'role'],
};

export const SpecIdentifier = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]{0,39}$/,
    'Use lower-case letters, digits and underscores, starting with a letter.',
  );

export const SpecField = z
  .object({
    from: z.enum(FIELD_SOURCE_KEYS),
    label: z.string().trim().min(1).max(80).optional(),
    /** For `person` fields: a larger box in the form. */
    multiline: z.boolean().default(false),
    /** Must be filled in before the document is submitted for signing. */
    required: z.boolean().default(false),
  })
  .strict();
export type SpecField = z.infer<typeof SpecField>;

const FieldsSection = z
  .object({
    id: SpecIdentifier,
    title: z.string().trim().min(1).max(120).optional(),
    kind: z.literal('fields'),
    fields: z.record(SpecIdentifier, SpecField),
  })
  .strict();

const WrittenSection = z
  .object({
    id: SpecIdentifier,
    title: z.string().trim().min(1).max(120).optional(),
    kind: z.literal('written'),
    /** What to write. Shown to the author, and given to the AI. */
    instructions: z.string().trim().min(1).max(2000),
    /** Where the writer should look: `concept`, `step:2.documents`, or the id of another section. */
    sources: z.array(z.string().max(80)).max(20).default([]),
    required: z.boolean().default(false),
  })
  .strict();

export const SpecSection = z.discriminatedUnion('kind', [FieldsSection, WrittenSection]);
export type SpecSection = z.infer<typeof SpecSection>;

export const SIGNATURE_MEANINGS = ['prepared', 'reviewed', 'approved'] as const;
export type SignatureMeaning = (typeof SIGNATURE_MEANINGS)[number];

/** The rows a document is signed in, and who signs the Reviewed and Approved rows (by role). */
export interface SignaturePlan {
  rows: SignatureMeaning[];
  /** Role keys for the Reviewed row. */
  reviewedBy: string[];
  /** Role keys for the Approved row. Empty: the step's signer. */
  approvedBy: string[];
}

/** The rows a template may name, in signing order. */
export const SIGNATURE_ROW_SETS: readonly (readonly SignatureMeaning[])[] = [
  ['prepared'],
  ['prepared', 'approved'],
  ['prepared', 'reviewed', 'approved'],
];

export const TemplateSpec = z
  .object({
    template: z.string().trim().min(3).max(120),
    document_type: z.string().regex(/^[A-Z][A-Z0-9_]{1,23}$/),
    steps: z.array(StepKey).min(1),
    sections: z.array(SpecSection).min(1).max(60),
    signature_rows: z.array(z.enum(SIGNATURE_MEANINGS)).default(['prepared', 'approved']),
    /** Role keys that may sign the Reviewed row. ⚠ Who reviews is still open (S1). */
    reviewed_by: z.array(z.string()).default([]),
    /** Role keys that may sign the Approved row. Empty: the step's signer. */
    approved_by: z.array(z.string()).default([]),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const rows = spec.signature_rows.join(',');
    if (!SIGNATURE_ROW_SETS.some((set) => set.join(',') === rows)) {
      ctx.addIssue({
        code: 'custom',
        path: ['signature_rows'],
        message: 'Use [prepared], [prepared, approved] or [prepared, reviewed, approved].',
      });
    }
    if (spec.signature_rows.includes('reviewed') && spec.reviewed_by.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['reviewed_by'],
        message: 'Name the roles that review, or take the Reviewed row out.',
      });
    }
    const seen = new Set<string>();
    const claim = (name: string, path: (string | number)[]) => {
      if (seen.has(name)) {
        ctx.addIssue({
          code: 'custom',
          path,
          message: `"${name}" is used twice. Every field and section needs its own name.`,
        });
      }
      seen.add(name);
    };
    spec.sections.forEach((section, index) => {
      if (section.kind === 'written') claim(section.id, ['sections', index, 'id']);
      else {
        for (const name of Object.keys(section.fields)) {
          claim(name, ['sections', index, 'fields', name]);
        }
      }
    });
  });
export type TemplateSpec = z.infer<typeof TemplateSpec>;

/** How a placeholder in the Word file is used. */
export type PlaceholderKind = 'text' | 'written' | 'table';

export interface Placeholder {
  name: string;
  kind: PlaceholderKind;
}

/** Every placeholder the specification defines: the Word file must use each one, and nothing else. */
export function specPlaceholders(spec: TemplateSpec): Placeholder[] {
  const out: Placeholder[] = [];
  for (const section of spec.sections) {
    if (section.kind === 'written') out.push({ name: section.id, kind: 'written' });
    else {
      for (const [name, field] of Object.entries(section.fields)) {
        out.push({ name, kind: FIELD_SOURCES[field.from] === 'table' ? 'table' : 'text' });
      }
    }
  }
  return out;
}

/** The tags found in a Word file: a name, with the names inside it if it is a loop. */
export type FoundTags = Record<string, Record<string, unknown>>;

export interface PlaceholderCheck {
  problems: string[];
}

/**
 * Checks the tags found in the Word file against the specification, both ways. A problem is
 * written for the person who prepared the template, so it says what to change.
 */
export function checkPlaceholders(spec: TemplateSpec, found: FoundTags): PlaceholderCheck {
  const problems: string[] = [];
  const defined = new Map<string, Placeholder>();
  for (const p of specPlaceholders(spec)) defined.set(p.name, p);
  const columnsOf = new Map<string, readonly string[]>();
  for (const section of spec.sections) {
    if (section.kind !== 'fields') continue;
    for (const [name, field] of Object.entries(section.fields)) {
      if (FIELD_SOURCES[field.from] === 'table')
        columnsOf.set(name, TABLE_COLUMNS[field.from] ?? []);
    }
  }

  for (const [name, inner] of Object.entries(found)) {
    const placeholder = defined.get(name);
    const isLoop = Object.keys(inner).length > 0;
    if (!placeholder) {
      problems.push(`The Word file uses {${name}}, which the specification doesn't define.`);
    } else if (placeholder.kind === 'table' && !isLoop) {
      problems.push(
        `{${name}} is a table. Write it as a loop: {#${name}}…{/${name}}, with ${
          columnsOf
            .get(name)
            ?.map((c) => `{${c}}`)
            .join(' and ') ?? 'its columns'
        } inside.`,
      );
    } else if (placeholder.kind !== 'table' && isLoop) {
      problems.push(`{${name}} is a single value, but the Word file uses it as a loop.`);
    } else if (placeholder.kind === 'table') {
      const allowed = columnsOf.get(name) ?? [];
      for (const column of Object.keys(inner)) {
        if (!allowed.includes(column)) {
          problems.push(
            `Inside {#${name}}, {${column}} isn't a column. The columns are ${allowed.map((c) => `{${c}}`).join(', ')}.`,
          );
        }
      }
    }
  }
  for (const [name] of defined) {
    if (!(name in found)) {
      problems.push(`The specification defines "${name}", but the Word file has no {${name}}.`);
    }
  }
  return { problems };
}

/** The headings the document form and the PDF use: a section's title, or its name made readable. */
export function readable(name: string): string {
  const spaced = name.replaceAll('_', ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const specTitle = (section: SpecSection): string => section.title ?? readable(section.id);
export const fieldLabel = (name: string, field: SpecField): string => field.label ?? readable(name);
