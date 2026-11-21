import { RESEARCH_LIMITS, dateOfInstant, queryProblems } from '@coal/shared';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { change } from '../../core/db/change';
import { newId } from '../../core/db/columns';
import type { AppDeps } from '../../core/deps';
import { systemContext } from '../../core/http/context';
import { AppError } from '../../core/http/errors';
import { costOf, WEB_SEARCH_USD } from '../ai/pricing';
import {
  RESEARCH_PROMPT_VERSION,
  RESEARCH_ASSISTANT,
  researchPrompt,
} from '../ai/prompts/research';
import type { AiTool } from '../ai/provider';
import { logRequest, spentToday, type ToolCallLog } from '../ai/service';
import { notify } from '../notifications/service';
import { OutsideClient, cut } from './connectors/client';
import { readFound, searchSource, type Found } from './connectors/index';
import { sourcePlan, sourceRows, type RunRow } from './service';
import { researchResults, researchRuns } from './tables';

const SearchInput = z.object({
  source: z.string().min(1).max(100),
  query: z.string().min(2).max(300),
  since: z.number().int().min(1950).max(2100).optional(),
});
const ReadInput = z.object({ ref: z.string().regex(/^R\d+$/) });

const schemaOf = (schema: z.ZodObject): Record<string, unknown> => {
  const { $schema: _schema, ...rest } = z.toJSONSchema(schema, { io: 'input' }) as Record<
    string,
    unknown
  >;
  return rest;
};

/** How often a running run looks for the person's stop. */
const STOP_POLL_MS = 2000;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

const onDomain = (url: string, domains: string[]) => {
  const host = hostOf(url);
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
};

/**
 * Runs one research run in the background (docs/workstation-and-ai.md#researching-what-already-exists).
 * The research assistant has two tools, both on the library's sources only: it sees no record
 * of the company, can save nothing but results, and every query it sends must use only the
 * words the person approved. Safe to call twice: only a queued run is taken.
 */
export async function runResearch(
  deps: AppDeps,
  runId: string,
): Promise<RunRow['status'] | 'skipped'> {
  const [claimed] = await deps.db
    .update(researchRuns)
    .set({ status: 'running', startedAt: deps.now() })
    .where(and(eq(researchRuns.id, runId), eq(researchRuns.status, 'queued')))
    .returning();
  if (!claimed) return 'skipped';
  const run = claimed;
  const started = Date.now();
  const { ai, research } = deps.config;
  const provider = deps.ai;

  if (!provider)
    return finish(deps, run, { status: 'failed', error: 'The assistant is not set up here.' });
  const spent = await spentToday(deps.db, run.orgId, run.userId, deps.now());
  if (spent >= ai.dailyBudgetUsd) {
    return finish(deps, run, {
      status: 'failed',
      error: 'Today’s AI budget is used up. Run it again tomorrow.',
    });
  }

  const plan = sourcePlan(await sourceRows(deps.db, run.orgId, run.sourceIds), run.terms, provider);
  const searchable = plan.filter((p) => p.searched && p.row.enabled);
  const client = new OutsideClient(deps.fetchOutside, {
    ncbiApiKey: research.ncbiApiKey,
    openFdaApiKey: research.openFdaApiKey,
    contactEmail: research.contactEmail,
  });
  const model = ai.models.research;

  const controller = new AbortController();
  let stoppedByPerson = false;
  let timedOut = false;
  const poll = setInterval(() => {
    void deps.db
      .select({ stop: researchRuns.stopAsked })
      .from(researchRuns)
      .where(eq(researchRuns.id, run.id))
      .then(([row]) => {
        if (row?.stop) {
          stoppedByPerson = true;
          controller.abort();
        }
      })
      .catch(() => undefined);
  }, STOP_POLL_MS);
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, research.timeoutMs);

  // What was found, by ref, and by the source's own id so a result found twice keeps one ref.
  const byRef = new Map<string, { id: string; found: Found }>();
  const byItem = new Map<string, string>();
  const calls: ToolCallLog[] = [];
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0, webSearches: 0 };
  let searches = 0;
  let reads = 0;

  async function keep(sourceId: string, items: Found[]) {
    const kept: { ref: string; id: string; found: Found }[] = [];
    const rows = [];
    for (const found of items) {
      const key = `${sourceId}:${found.externalId}`;
      const existing = byItem.get(key);
      if (existing) {
        kept.push({ ref: existing, ...(byRef.get(existing) as { id: string; found: Found }) });
        continue;
      }
      const ref = `R${byRef.size + 1}`;
      const id = newId();
      byItem.set(key, ref);
      byRef.set(ref, { id, found });
      kept.push({ ref, id, found });
      rows.push({ id, orgId: run.orgId, runId: run.id, ref, sourceId, ...found });
    }
    if (rows.length > 0) await deps.db.insert(researchResults).values(rows).onConflictDoNothing();
    return kept;
  }

  async function logSearch(source: string, queries: string[], found: number) {
    const at = deps.now().toISOString();
    const entries = queries.map((query) => ({ source, query, found, at }));
    await deps.db
      .update(researchRuns)
      .set({ searches: sql`${researchRuns.searches} || ${JSON.stringify(entries)}::jsonb` })
      .where(eq(researchRuns.id, run.id));
  }

  const record = (log: Omit<ToolCallLog, 'proposalId'>) => calls.push({ ...log, proposalId: null });

  const searchTool: AiTool = {
    name: 'search_source',
    description:
      'Search one source of the library. The query may use only the words of the approved terms, with AND, OR, NOT, brackets and quotes. Returns results with tags such as R3 to cite.',
    inputSchema: schemaOf(SearchInput),
    async run(raw) {
      const t0 = Date.now();
      if (controller.signal.aborted) return 'The research was stopped.';
      const parsed = SearchInput.safeParse(raw ?? {});
      if (!parsed.success)
        return `The input was not valid: ${parsed.error.issues.map((i) => i.message).join('; ')}`;
      const input = parsed.data;
      const source = searchable.find(
        (p) => p.row.id === input.source || p.row.name.toLowerCase() === input.source.toLowerCase(),
      );
      const base = {
        tool: 'search_source',
        endpoint: `outside:${source?.row.kind ?? 'unknown'}`,
        tier: 'outside',
        input,
      };
      if (!source) {
        record({
          ...base,
          allowed: false,
          denialReason: 'not in this run',
          recordsReturned: [],
          durationMs: 0,
        });
        return `There is no source "${input.source}" in this run. Use one of: ${searchable.map((p) => `${p.row.name} (${p.row.id})`).join('; ')}.`;
      }
      if (searches >= research.maxSearches) {
        return 'You have used all the searches of this run. Write the brief with what you have.';
      }
      const problems = queryProblems(input.query, run.terms);
      if (problems.length > 0) {
        record({
          ...base,
          allowed: false,
          denialReason: problems[0] as string,
          recordsReturned: [],
          durationMs: 0,
        });
        return `Refused, nothing was sent: ${problems[0]}`;
      }
      searches += 1;
      try {
        let items: Found[];
        let sent = [input.query];
        const settings = source.row.settings;
        if (settings.kind === 'website' && provider?.searchWeb) {
          const outcome = await provider.searchWeb({
            model,
            query: input.query,
            domains: settings.domains,
            maxSearches: 2,
            signal: controller.signal,
            timeoutMs: 90_000,
          });
          usage.calls += outcome.usage.calls;
          usage.inputTokens += outcome.usage.inputTokens;
          usage.outputTokens += outcome.usage.outputTokens;
          usage.webSearches += outcome.queries.length;
          if (outcome.queries.length > 0) sent = outcome.queries;
          items = outcome.pages
            .filter((p) => onDomain(p.url, settings.domains))
            .slice(0, RESEARCH_LIMITS.perSearch)
            .map((p) => ({
              kind: 'web' as const,
              externalId: p.url,
              title: cut(p.title || p.url, 300),
              detail: hostOf(p.url),
              year: null,
              url: p.url,
              snippet: cut(p.summary, 600),
            }));
        } else {
          items = await searchSource(client, settings, {
            query: input.query,
            since: input.since ?? run.since,
            limit: RESEARCH_LIMITS.perSearch,
            signal: controller.signal,
          });
        }
        const kept = await keep(source.row.id, items);
        await logSearch(source.row.name, sent, items.length);
        record({
          ...base,
          allowed: true,
          denialReason: null,
          recordsReturned: kept.map((k) => ({ type: 'research_result', id: k.id })),
          durationMs: Date.now() - t0,
        });
        if (kept.length === 0)
          return 'Nothing found. Try other words from the approved terms, or another source.';
        return JSON.stringify({
          found: kept.length,
          results: kept.map((k) => ({
            ref: k.ref,
            what: k.found.kind,
            title: k.found.title,
            by: k.found.detail,
            year: k.found.year,
            text: cut(k.found.snippet, 400),
          })),
        });
      } catch (error) {
        record({
          ...base,
          allowed: true,
          denialReason: null,
          recordsReturned: [],
          durationMs: Date.now() - t0,
        });
        if (controller.signal.aborted) return 'The research was stopped.';
        return error instanceof AppError
          ? `The source did not answer: ${error.message} Try another source, and say so in the brief if it matters.`
          : 'The search failed. Try another source, and say so in the brief if it matters.';
      }
    },
  };

  const readTool: AiTool = {
    name: 'read_result',
    description:
      'Read one result in full, by its tag (R3): the abstract, the trial design, the report narrative. Use it before relying on a result for a number.',
    inputSchema: schemaOf(ReadInput),
    async run(raw) {
      if (controller.signal.aborted) return 'The research was stopped.';
      const parsed = ReadInput.safeParse(raw ?? {});
      const item = parsed.success ? byRef.get(parsed.data.ref) : undefined;
      if (!parsed.success || !item) return 'There is no result with that tag in this run.';
      if (reads >= RESEARCH_LIMITS.reads) {
        return 'You have read as many results in full as this run allows. Write the brief.';
      }
      reads += 1;
      const t0 = Date.now();
      try {
        const text = await readFound(client, item.found, controller.signal);
        record({
          tool: 'read_result',
          endpoint: 'outside:read',
          tier: 'outside',
          input: parsed.data,
          allowed: true,
          denialReason: null,
          recordsReturned: [{ type: 'research_result', id: item.id }],
          durationMs: Date.now() - t0,
        });
        return JSON.stringify({ ref: parsed.data.ref, title: item.found.title, text });
      } catch {
        return `Could not read it in full. What the search gave: ${item.found.snippet}`;
      }
    },
  };

  let written = '';
  let failure: string | null = null;
  try {
    if (searchable.length > 0) {
      const outcome = await provider.run({
        model,
        system: RESEARCH_ASSISTANT,
        history: [],
        prompt: researchPrompt({
          question: run.question,
          terms: run.terms,
          since: run.since,
          today: dateOfInstant(deps.now()),
          maxSearches: research.maxSearches,
          sources: searchable.map((p) => ({
            id: p.row.id,
            name: p.row.name,
            settings: p.row.settings,
            note: p.row.note,
          })),
          linksOnly: plan.filter((p) => !p.searched).map((p) => p.row.name),
        }),
        tools: [searchTool, readTool],
        maxSteps: research.maxSearches + RESEARCH_LIMITS.reads + 2,
        signal: controller.signal,
        timeoutMs: research.timeoutMs,
        onText: (delta) => {
          written += delta;
        },
      });
      usage.calls += outcome.usage.calls;
      usage.inputTokens += outcome.usage.inputTokens;
      usage.outputTokens += outcome.usage.outputTokens;
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : 'The model call failed.';
  } finally {
    clearInterval(poll);
    clearTimeout(timer);
  }

  // `[R2, R5]` is two tags; a tag the model made up points to nothing, so it goes.
  const brief = written
    .replace(/\[(R\d+(?:\s*[,;]\s*R\d+)+)\]/g, (_all, list: string) =>
      list
        .split(/\s*[,;]\s*/)
        .map((ref) => `[${ref}]`)
        .join(''),
    )
    .replace(/\[R(\d+)\]/g, (tag, n: string) => (byRef.has(`R${n}`) ? tag : ''))
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  const status = stoppedByPerson ? 'stopped' : timedOut || failure ? 'failed' : 'done';
  const error = stoppedByPerson
    ? null
    : timedOut
      ? 'It took too long. What was found so far is kept.'
      : failure
        ? 'The research assistant could not finish. What was found so far is kept.'
        : null;
  const requestId = newId();
  return finish(deps, run, {
    status,
    error,
    brief: brief || null,
    results: byRef.size,
    log: {
      request: {
        id: requestId,
        orgId: run.orgId,
        chatId: run.chatId,
        userId: run.userId,
        provider: provider.name,
        model,
        purpose: 'research',
        promptVersion: RESEARCH_PROMPT_VERSION,
        modelCalls: usage.calls,
        toolCalls: calls.length,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd:
          costOf(model, usage.inputTokens, usage.outputTokens) + usage.webSearches * WEB_SEARCH_USD,
        outcome: stoppedByPerson ? 'stopped' : status === 'failed' ? 'error' : 'completed',
        errorCode: status === 'failed' && !stoppedByPerson ? 'AI_FAILED' : null,
        durationMs: Date.now() - started,
      },
      calls,
    },
  });
}

/** Saves how a run ended, logs what it cost, and tells the person. */
async function finish(
  deps: AppDeps,
  run: RunRow,
  end: {
    status: 'done' | 'failed' | 'stopped';
    error?: string | null;
    brief?: string | null;
    results?: number;
    log?: { request: Parameters<typeof logRequest>[1]; calls: ToolCallLog[] };
  },
): Promise<RunRow['status']> {
  await change(deps.db, systemContext(run.orgId, 'research'), async (tx, log) => {
    if (end.log) await logRequest(tx, end.log.request, end.log.calls);
    await tx
      .update(researchRuns)
      .set({
        status: end.status,
        error: end.error ?? null,
        brief: end.brief ?? null,
        requestId: end.log?.request.id ?? null,
        finishedAt: deps.now(),
      })
      .where(eq(researchRuns.id, run.id));
    log.audit({
      action: 'research.finished',
      recordType: 'research_run',
      recordId: run.id,
      after: { status: end.status, results: end.results ?? 0 },
    });
    const question = cut(run.question, 80);
    await notify(tx, run.orgId, [
      {
        userId: run.userId,
        kind: 'alert',
        eventType: 'research.finished',
        title:
          end.status === 'done'
            ? `Research ready: ${question}`
            : end.status === 'stopped'
              ? `Research stopped: ${question}`
              : `Research could not finish: ${question}`,
        body:
          end.error ??
          `${end.results ?? 0} results to look over. Keep the ones you want as sources of the project.`,
        link: `/research/${run.id}`,
        projectId: run.projectId,
        stepKey: run.stepKey,
        dedupeKey: `research:${run.id}`,
      },
    ]);
  });
  return end.status;
}
