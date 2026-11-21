import { AppError } from '../../../core/http/errors';

/**
 * How research reaches the public sources (docs/workstation-and-ai.md#researching-what-already-exists).
 * Only these hosts can be called: a source's settings choose what to search, never where to send
 * it. Each host is called one request at a time with a gap between, as the sources ask, and recent
 * answers are kept for a while so the same search isn't sent twice.
 */
const HOSTS: Record<string, { gapMs: number }> = {
  'eutils.ncbi.nlm.nih.gov': { gapMs: 350 },
  'www.ebi.ac.uk': { gapMs: 200 },
  'clinicaltrials.gov': { gapMs: 200 },
  'api.fda.gov': { gapMs: 250 },
  'api.crossref.org': { gapMs: 200 },
};

const CACHE_MS = 10 * 60 * 1000;
const CACHE_SIZE = 300;
const TIMEOUT_MS = 20_000;

const cache = new Map<string, { at: number; status: number; body: string }>();
const queues = new Map<string, Promise<unknown>>();
const lastCall = new Map<string, number>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Forgets the kept answers, between tests. */
export function clearOutsideCache(): void {
  cache.clear();
  lastCall.clear();
}

export class OutsideClient {
  constructor(
    private readonly fetchImpl: typeof fetch,
    /** NCBI's key, when there is one, lets PubMed be asked more often. */
    readonly options: { ncbiApiKey?: string; openFdaApiKey?: string; contactEmail?: string } = {},
  ) {}

  /** A GET to an allowed host. A 404 is an empty answer (openFDA says "nothing found" that way). */
  async get(url: URL, signal: AbortSignal): Promise<{ status: number; body: string }> {
    const host = HOSTS[url.hostname];
    if (url.protocol !== 'https:' || !host) {
      throw new Error(`Research may not call ${url.hostname}.`);
    }
    const key = url.toString();
    const kept = cache.get(key);
    if (kept && Date.now() - kept.at < CACHE_MS) return kept;

    const turn = (queues.get(url.hostname) ?? Promise.resolve()).then(async () => {
      const wait = (lastCall.get(url.hostname) ?? 0) + host.gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastCall.set(url.hostname, Date.now());
      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      const response = await this.fetchImpl(key, {
        headers: {
          accept: 'application/json, text/xml;q=0.9, */*;q=0.5',
          'user-agent': `COAL research${this.options.contactEmail ? ` (mailto:${this.options.contactEmail})` : ''}`,
        },
        signal: AbortSignal.any([signal, timeout]),
      });
      return { status: response.status, body: await response.text() };
    });
    queues.set(
      url.hostname,
      turn.catch(() => undefined),
    );
    const answer = await turn;
    if (answer.status >= 500 || answer.status === 429) {
      throw new AppError(
        502,
        'SOURCE_UNAVAILABLE',
        `${url.hostname} did not answer (${answer.status}). Try again later.`,
      );
    }
    if (answer.status >= 400 && answer.status !== 404) {
      throw new AppError(
        502,
        'SOURCE_UNAVAILABLE',
        `${url.hostname} refused the search (${answer.status}).`,
      );
    }
    if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: Date.now(), ...answer });
    return answer;
  }

  async json(url: URL, signal: AbortSignal): Promise<unknown> {
    const { status, body } = await this.get(url, signal);
    if (status === 404 || !body) return null;
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new AppError(
        502,
        'SOURCE_UNAVAILABLE',
        `${url.hostname} sent an answer COAL can't read.`,
      );
    }
  }

  async text(url: URL, signal: AbortSignal): Promise<string> {
    const { status, body } = await this.get(url, signal);
    return status === 404 ? '' : body;
  }
}

// Reading what the sources send: never trusted to be the shape the docs promise.

export const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const asText = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

/** Plain words from a fragment of HTML or XML. */
export function plainOf(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export const cut = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
