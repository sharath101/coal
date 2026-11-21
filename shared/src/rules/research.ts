/**
 * The rules on what leaves COAL when it searches outside sources (docs/workstation-and-ai.md#researching-what-already-exists).
 * A person confirms the search terms on a card, and every query sent to a source may only use
 * those words, so a project's code, its name or a person's name never leaves COAL. They are
 * pure, so the server, the website and the tests run the same code.
 */

export const RESEARCH_LIMITS = {
  /** Terms on one card. */
  terms: 8,
  /** Words in one term: a device type, an approach or a material, not a description. */
  wordsPerTerm: 6,
  /** Searches the research assistant may make in one run. */
  searches: 20,
  /** Results kept from one search. */
  perSearch: 10,
  /** Results read in full (an abstract, a trial's summary) in one run. */
  reads: 15,
} as const;

/** Words a query may use besides the approved ones: how the sources combine words. */
const OPERATORS = new Set(['and', 'or', 'not']);

/** Project codes such as SPN-26-001, whatever the product line. */
const PROJECT_CODE = /\b[A-Z]{2,4}-\d{2}-\d{3}\b/i;

/** Names that point at the company itself. */
const COMPANY_NAMES = ['jayon', 'coal'];

const normalise = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** The words of a term or a query, as the query check counts them. */
export const researchWords = (text: string): string[] =>
  normalise(text)
    .split(' ')
    .filter((w) => w.length > 0);

const containsPhrase = (text: string, phrase: string) =>
  ` ${normalise(text)} `.includes(` ${normalise(phrase)} `);

export interface TermContext {
  /**
   * Phrases that must not leave COAL: every project's code and name, and every person's name.
   * Matched as whole words, ignoring case and punctuation.
   */
  private: string[];
}

/**
 * What is wrong with the search terms of a research card, in words a person (or the assistant)
 * can act on. Terms must be general: a device type, an anatomy, an approach, a material, an FDA
 * product code. Nothing that names the company, a project or a person.
 */
export function researchTermProblems(terms: string[], context: TermContext): string[] {
  const problems: string[] = [];
  if (terms.length === 0) problems.push('Give at least one search term.');
  if (terms.length > RESEARCH_LIMITS.terms) {
    problems.push(`Use at most ${RESEARCH_LIMITS.terms} search terms.`);
  }
  for (const term of terms) {
    const words = researchWords(term);
    if (words.length === 0) {
      problems.push(`“${term}” has no words to search for.`);
      continue;
    }
    if (words.length > RESEARCH_LIMITS.wordsPerTerm) {
      problems.push(
        `“${term}” is too long: a term is at most ${RESEARCH_LIMITS.wordsPerTerm} words, such as a device type or an approach.`,
      );
    }
    if (/https?:|www\.|@/i.test(term)) {
      problems.push(
        `“${term}” looks like an address. Use words, and choose websites in the library.`,
      );
    }
    if (PROJECT_CODE.test(term)) {
      problems.push(`“${term}” holds a project code. Project codes never leave COAL.`);
    }
    const company = COMPANY_NAMES.find((name) => containsPhrase(term, name));
    if (company) problems.push(`“${term}” names the company. Use general words only.`);
    const named = context.private.find(
      (p) => researchWords(p).length > 0 && containsPhrase(term, p),
    );
    if (named) {
      problems.push(
        `“${term}” holds “${named}”, the name of a project or a person. Use general words only.`,
      );
    }
  }
  return [...new Set(problems)];
}

/**
 * What is wrong with one query the research assistant wants to send: every word must come from
 * the approved terms (or be AND, OR or NOT). Empty when it may be sent.
 */
export function queryProblems(query: string, terms: string[]): string[] {
  const allowed = new Set(terms.flatMap(researchWords));
  const words = researchWords(query);
  if (words.length === 0) return ['The query has no words.'];
  const extra = [...new Set(words.filter((w) => !allowed.has(w) && !OPERATORS.has(w)))];
  return extra.length > 0
    ? [
        `These words were not approved by the person: ${extra.join(', ')}. Use only the words of the approved terms: ${terms.join('; ')}.`,
      ]
    : [];
}

/** The address of a search the person opens themselves: `{q}` in the source's address becomes the terms. */
export function searchLink(template: string, terms: string[]): string {
  if (!template.includes('{q}')) return template;
  return template.replaceAll('{q}', encodeURIComponent(terms.join(' ')));
}

/** A search the person opens themselves on a website, through a general search engine. */
export function siteSearchLink(domains: string[], terms: string[]): string {
  const sites = domains.map((d) => `site:${d}`).join(' OR ');
  return `https://www.google.com/search?q=${encodeURIComponent(`${sites} ${terms.join(' ')}`)}`;
}

/** Tags such as `[R3]` in a research brief that point to no result are removed. */
export function citedResultRefs(text: string): string[] {
  return [...new Set([...text.matchAll(/\[R(\d+)\]/g)].map((m) => `R${m[1]}`))];
}
