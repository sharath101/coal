import { COMPANY_NAMES, PROJECT_CODE, containsPhrase, researchWords } from './research';

/**
 * The rules on what leaves COAL when the assistant looks something up on the web
 * (docs/workstation-and-ai.md#looking-things-up-on-the-web). The assistant writes a brief for a
 * separate web assistant that knows nothing about the company. The brief is the only thing that
 * leaves, and COAL checks it first. They are pure, so the server and the tests run the same code.
 */

export const WEB_LIMITS = {
  /** Characters in the question. */
  question: 300,
  /** Facts to look for in one brief, and characters in each. */
  lookFor: 6,
  lookForChars: 160,
  /** Websites a brief may keep the search to. */
  sites: 5,
  /** Words in a row that may not be copied from COAL's records. */
  copiedWords: 8,
} as const;

/** The kinds of source a brief may ask the web assistant to prefer. */
export const WEB_SOURCE_KINDS = ['standards', 'regulators', 'papers', 'makers', 'news'] as const;
export type WebSourceKind = (typeof WEB_SOURCE_KINDS)[number];

/** Said on a draft version saved from a card that was prepared in a chat that used the web. */
export const WEB_VERSION_NOTE = 'Includes facts from the public web: check them before you submit.';

/**
 * References to standards and regulations, and public identifiers: their numbers name a document
 * anyone can read, not a figure of the company's.
 */
const STANDARD =
  /\b(?:\d{1,3}\s+CFR\s+(?:Part\s+)?\d+(?:\.\d+)*|(?:ISO|IEC|ASTM|EN|BS|DIN|ANSI|AAMI|ASME|IEEE|UL|USP|JIS|IMDRF|MEDDEV|ICH)(?:[\s/]+(?:ISO|IEC|EN|TR|TS|PAS))*\s*[A-Z]?\d+(?:[-.:/]\d+)*)/g;
const PUBLIC_ID = /\b(?:K\d{6}|P\d{6}|DEN\d{6}|NCT\d{8})\b/g;
/** Ids and times in COAL's records: their digits are not figures anyone wrote. */
const RECORD_NOISE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?\b/gi;
/** Units a figure may be written with, glued to it: 4.5mm, 500N, 12M. */
const UNIT =
  /^(?:mm|cm|m|km|µm|um|nm|in|ft|n|kn|mpa|gpa|kpa|pa|psi|kg|g|mg|lb|lbs|ml|cc|s|ms|min|h|hr|hrs|d|days?|wk|wks|mo|yr|yrs|hz|khz|mhz|mv|w|kw|°|°c|k|mn|bn|cr|lakhs?|crores?|x)$/i;
/** A code such as ABC-12-X9: capitals and digits joined by hyphens. */
const CODE = /\b[A-Z0-9]+(?:-[A-Z0-9]+)+\b/g;
const PUBLIC_HOST = /^(?=.{4,100}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const LOCAL_HOST =
  /\.(?:local|localhost|internal|intranet|lan|corp|home|test|example|invalid|localdomain)$/;

const normalNumber = (n: string) =>
  n
    .replaceAll(',', '')
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');

/** Every number in a text, written one way, leaving out the digits of ids and times. */
const numbersIn = (text: string): Set<string> =>
  new Set((text.replace(RECORD_NOISE, ' ').match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(normalNumber));

/** Codes such as ABC-12-X9 in a text, in capitals. */
const codesIn = (text: string): Set<string> =>
  new Set(
    (text.replace(RECORD_NOISE, ' ').match(CODE) ?? [])
      .filter((c) => /\d/.test(c) && /[A-Z]/i.test(c))
      .map((c) => c.toUpperCase()),
  );

/**
 * The figures in a text: numbers of three digits or more, or with a decimal point, alone or with a
 * unit (4.5 mm, 4.5mm, 1,200 N). A year, a standard's number (ISO 13485, ASTM F2077), a public
 * identifier (K123456) and a designation (316L, Ti-6Al-4V) are not figures.
 */
export function figuresOf(text: string): string[] {
  const cleaned = text.replace(STANDARD, ' ').replace(PUBLIC_ID, ' ');
  const found = new Set<string>();
  for (const token of cleaned.match(/[\p{L}\p{N}.,°µ]+/gu) ?? []) {
    const match = /^(\d[\d,]*(?:\.\d+)?)([\p{L}°µ]*)$/u.exec(token.replace(/[.,]+$/, ''));
    if (!match) continue;
    const [, digits = '', unit = ''] = match;
    if (unit && !UNIT.test(unit)) continue;
    const n = normalNumber(digits);
    if (n.length < 3 && !n.includes('.')) continue;
    if (/^(?:19|20)\d{2}$/.test(n)) continue;
    found.add(n);
  }
  return [...found];
}

/**
 * The first run of `words` words in a row that the text copies from `source` and that is not also in
 * `allowed`, or null.
 */
export function copiedPassage(
  text: string,
  source: string,
  allowed: string,
  words: number = WEB_LIMITS.copiedWords,
): string | null {
  const own = researchWords(text);
  if (own.length < words) return null;
  const runs = (all: string[]) => {
    const set = new Set<string>();
    for (let i = 0; i + words <= all.length; i++) set.add(all.slice(i, i + words).join(' '));
    return set;
  };
  const fromSource = runs(researchWords(source));
  const fromAllowed = runs(researchWords(allowed));
  for (let i = 0; i + words <= own.length; i++) {
    const run = own.slice(i, i + words).join(' ');
    if (fromSource.has(run) && !fromAllowed.has(run)) return run;
  }
  return null;
}

export interface WebBriefText {
  question: string;
  lookFor: string[];
  sites: string[];
}

export interface BriefContext {
  /** Every project's code and name, and every person's name: these never leave COAL. */
  private: string[];
  /**
   * What COAL's records said in this chat, as the assistant has it: what its tools returned, and
   * what it answered earlier.
   */
  coal: string;
  /** What may be repeated: what the person said in this chat, and what the web returned in it. */
  allowed: string;
}

const namesPrivate = (text: string, context: BriefContext) =>
  context.private.find((p) => researchWords(p).length > 0 && containsPhrase(text, p));

/**
 * What is wrong with a brief for the web assistant, in words the assistant can act on. Empty when
 * it may be sent. A brief may not hold an address, a project's code or name, a person's name or the
 * company's name; nor a figure, a code or eight words in a row from COAL's records, unless the
 * person said them or the web already returned them.
 */
export function webBriefProblems(brief: WebBriefText, context: BriefContext): string[] {
  const problems: string[] = [];
  const text = [brief.question, ...brief.lookFor].join('\n');

  if (/https?:|www\.|\S@\S/i.test(text)) {
    problems.push(
      'It holds a web or email address. Ask in words, and put a website the person named in sites.',
    );
  }
  const code = PROJECT_CODE.exec(text);
  if (code) problems.push(`It holds ${code[0]}, a project code. Project codes never leave COAL.`);
  if (COMPANY_NAMES.some((name) => containsPhrase(text, name))) {
    problems.push(
      'It names the company. Ask in general words: the web assistant must not know who is asking.',
    );
  }
  const named = namesPrivate(text, context);
  if (named) {
    problems.push(
      `It holds “${named}”, the name of a project or a person in COAL. Describe the kind of device or the topic in general words instead (for example in the plural).`,
    );
  }

  const coalNumbers = numbersIn(context.coal);
  const allowedNumbers = numbersIn(context.allowed);
  const figures = figuresOf(text).filter((f) => coalNumbers.has(f) && !allowedNumbers.has(f));
  if (figures.length > 0) {
    problems.push(
      `It holds ${figures.join(', ')}, from COAL's records. The company's figures never leave COAL: ask about the general range instead.`,
    );
  }
  const coalCodes = codesIn(context.coal);
  const allowedCodes = codesIn(context.allowed);
  const codes = [...codesIn(text)].filter((c) => coalCodes.has(c) && !allowedCodes.has(c));
  if (codes.length > 0) {
    problems.push(
      `It holds ${codes.join(', ')}, a code from COAL's records. The company's codes never leave COAL.`,
    );
  }
  const copied = copiedPassage(text, context.coal, context.allowed);
  if (copied) {
    problems.push(
      `It copies words from COAL's records (“${copied}”). Ask in your own general words.`,
    );
  }

  for (const site of brief.sites) {
    if (!PUBLIC_HOST.test(site) || LOCAL_HOST.test(site)) {
      problems.push(`“${site}” is not the name of a public website, such as fda.gov.`);
    } else if (
      COMPANY_NAMES.some((name) => containsPhrase(site, name)) ||
      namesPrivate(site, context)
    ) {
      problems.push(`“${site}” points at the company, or at one of its projects or people.`);
    }
  }
  return [...new Set(problems)];
}

/** The website of an address, without "www.": what a person reads to judge a page. */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}
