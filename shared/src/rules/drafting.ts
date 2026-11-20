import { specTitle, type TemplateSpec } from './templates';

/**
 * The checks on what the assistant writes into a document (docs/workstation-and-ai.md#drafting-a-document):
 * a number must come from a source, and a field the person types must be what the person said.
 * They are pure, so the server and the tests run the same code.
 */

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

/** The numbers in a text, written the same way: no thousands commas. */
export const numbersOf = (text: string): string[] =>
  (text.match(NUMBER) ?? []).map((n) => n.replaceAll(',', '').replace(/\.0+$/, ''));

/**
 * The numbers a written text states that no source gave. A single digit passes: it is usually a
 * count of something in words ("3 phases"), and a made-up dimension or strength is never one.
 */
export function ungroundedNumbers(text: string, sources: string): string[] {
  const known = new Set(numbersOf(sources));
  const missing = numbersOf(text).filter((n) => (n.length > 1 || n.includes('.')) && !known.has(n));
  return [...new Set(missing)];
}

const wordsOf = (text: string): string[] =>
  (text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter((w) => !/^\d+$/.test(w));

/**
 * Whether a value is the person's own: most of its words (four letters or more) appear in what
 * they said. A value with no such words, such as "UK", passes.
 */
export function isWhatWasSaid(value: string, said: string, share = 0.6): boolean {
  const words = wordsOf(value);
  if (words.length === 0) return true;
  const spoken = new Set(wordsOf(said));
  return words.filter((w) => spoken.has(w)).length / words.length >= share;
}

export interface DraftInput {
  fields: Record<string, string>;
  sections: Record<string, string>;
}

/** What the assistant may be shown as the basis for a draft. */
export interface Grounding {
  /** Everything the person said in this chat. */
  said: string;
  /** Everything the tools returned in this reply, and today's date. */
  read: string;
}

/**
 * What is wrong with a draft the assistant wants to save, in words it can act on. A gap (an empty
 * field or section) is not a problem: a draft may have gaps, and says so.
 */
export function draftProblems(spec: TemplateSpec, input: DraftInput, ground: Grounding): string[] {
  const problems: string[] = [];
  const sources = `${ground.said}\n${ground.read}`;
  const fields = new Map(
    spec.sections.flatMap((s) => (s.kind === 'fields' ? Object.entries(s.fields) : [])),
  );
  const sections = new Map(
    spec.sections.flatMap((s) => (s.kind === 'written' ? [[s.id, s] as const] : [])),
  );

  for (const [id, text] of Object.entries(input.sections)) {
    const section = sections.get(id);
    if (!section) continue;
    const numbers = ungroundedNumbers(text, sources);
    if (numbers.length > 0) {
      problems.push(
        `"${specTitle(section)}" states ${numbers.join(', ')}, which no source gave. Take it out, or ask the person for it.`,
      );
    }
  }
  for (const [name, value] of Object.entries(input.fields)) {
    const field = fields.get(name);
    if (!field) continue;
    if (field.from !== 'person') {
      problems.push(`{${name}} is filled from COAL's records, so it cannot be set here.`);
      continue;
    }
    if (!isWhatWasSaid(value, ground.said)) {
      problems.push(
        `"${name}" must be what the person told you, in their words. Ask them for it instead of writing it yourself.`,
      );
      continue;
    }
    const numbers = ungroundedNumbers(value, sources);
    if (numbers.length > 0) {
      problems.push(`"${name}" states ${numbers.join(', ')}, which the person did not give.`);
    }
  }
  return problems;
}
