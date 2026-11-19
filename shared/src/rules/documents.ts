import { FIELD_SOURCES, fieldLabel, specTitle, type TemplateSpec } from './templates';

/** One field's value: text, or the rows of a table. */
export type FieldValue = string | Record<string, string>[];

/** What a template document holds. Hashed and signed as it is saved. */
export interface DocumentContent {
  fields: Record<string, FieldValue>;
  sections: Record<string, string>;
}

/** JSON with sorted keys, so the same content always gives the same hash. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Revision letters, given at approval: A, B, … Z, AA, AB. */
export function revisionLabel(index: number): string {
  let label = '';
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

/** `{project_code}-{type}-{nn}` and the like. ⚠ Until Jayon's own convention is known (S2). */
export function formatDocumentNumber(
  pattern: string,
  parts: { projectCode: string; type: string; nn: number },
): string {
  return pattern
    .replaceAll('{project_code}', parts.projectCode)
    .replaceAll('{type}', parts.type)
    .replaceAll('{nn}', String(parts.nn).padStart(2, '0'));
}

export const DEFAULT_NUMBERING = '{project_code}-{type}-{nn}';

/** Fields the person types: the ones that come from `person`. */
export function personFields(spec: TemplateSpec): string[] {
  const names: string[] = [];
  for (const section of spec.sections) {
    if (section.kind !== 'fields') continue;
    for (const [name, field] of Object.entries(section.fields)) {
      if (field.from === 'person') names.push(name);
    }
  }
  return names;
}

/** What is still empty that the specification marks as required. Checked when submitting. */
export function missingRequired(spec: TemplateSpec, content: DocumentContent): string[] {
  const missing: string[] = [];
  for (const section of spec.sections) {
    if (section.kind === 'written') {
      if (section.required && !(content.sections[section.id] ?? '').trim()) {
        missing.push(specTitle(section));
      }
    } else {
      for (const [name, field] of Object.entries(section.fields)) {
        if (!field.required || FIELD_SOURCES[field.from] === 'table') continue;
        const value = content.fields[name];
        if (typeof value !== 'string' || !value.trim()) missing.push(fieldLabel(name, field));
      }
    }
  }
  return missing;
}

export interface DiffPart {
  type: 'same' | 'added' | 'removed';
  text: string;
}

const MAX_CELLS = 4_000_000;

/**
 * Compares two texts word by word, for the version comparison. Falls back to whole lines when
 * the texts are too long to compare word by word.
 */
export function diffText(before: string, after: string): DiffPart[] {
  if (before === after) return before ? [{ type: 'same', text: before }] : [];
  let a = before.split(/(\s+)/).filter((t) => t !== '');
  let b = after.split(/(\s+)/).filter((t) => t !== '');
  if (a.length * b.length > MAX_CELLS) {
    a = before.split(/(\n)/).filter((t) => t !== '');
    b = after.split(/(\n)/).filter((t) => t !== '');
  }
  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j]
          ? (lcs[(i + 1) * width + j + 1] as number) + 1
          : Math.max(lcs[(i + 1) * width + j] as number, lcs[i * width + j + 1] as number);
    }
  }
  const parts: DiffPart[] = [];
  const push = (type: DiffPart['type'], text: string) => {
    const last = parts[parts.length - 1];
    if (last?.type === type) last.text += text;
    else parts.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('same', a[i] as string);
      i++;
      j++;
    } else if ((lcs[(i + 1) * width + j] as number) >= (lcs[i * width + j + 1] as number)) {
      push('removed', a[i++] as string);
    } else {
      push('added', b[j++] as string);
    }
  }
  while (i < a.length) push('removed', a[i++] as string);
  while (j < b.length) push('added', b[j++] as string);
  return parts;
}
