import {
  dateOfInstant,
  siteOf,
  webBriefProblems,
  type WebBrief,
  type WebLookup,
  type WebPage,
} from '@coal/shared';
import { and, eq } from 'drizzle-orm';
import { change } from '../../core/db/change';
import type { Executor } from '../../core/db/client';
import { newId } from '../../core/db/columns';
import type { AppDeps } from '../../core/deps';
import type { Actor, RequestContext } from '../../core/http/context';
import { AppError, notFound } from '../../core/http/errors';
import { assertCanAccess } from '../permissions';
import { privatePhrases } from '../research/service';
import { costOf, WEB_SEARCH_USD } from './pricing';
import { WEB_ASSISTANT, WEB_PROMPT_VERSION, webPrompt } from './prompts/web';
import type { WebLookupOutcome } from './provider';
import {
  assertWithinBudget,
  logRequest,
  requireChat,
  webAvailable,
  type ToolCallLog,
} from './service';
import { aiChats, aiWebLookups } from './tables';

/**
 * Looking things up on the web (docs/workstation-and-ai.md#looking-things-up-on-the-web). The
 * assistant that sees the company's records never reaches the internet: it writes a brief, COAL
 * checks it, and a separate web assistant, which sees only that brief, searches and reads public
 * pages. What comes back is shaped by COAL and is outside material.
 */

type LookupRow = typeof aiWebLookups.$inferSelect;
type Report = LookupRow['report'];

const NO_ANSWER = 'The web assistant gave no answer with a page to back it.';
const LIMITS = { answer: 1200, finding: 400, findings: 12, note: 300, notes: 6, title: 200 };
const SECTIONS: Record<string, keyof Report> = {
  ANSWER: 'answer',
  FINDINGS: 'findings',
  'NOT FOUND': 'notFound',
  CAUTIONS: 'cautions',
};
/** An address in a report: in brackets, in parentheses, in angle brackets, or bare. */
const ADDRESS =
  /\[\s*(https?:\/\/[^\]\s]+)\s*\]|\(\s*(https?:\/\/[^)\s]+)\s*\)|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s\])>]+)/g;

const cutTo = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/** An address as written, to match against a page: no punctuation after it, no fragment, no final slash. */
const keyOf = (url: string) =>
  url
    .replace(/[)\].,;:'"]+$/, '')
    .replace(/#.*$/, '')
    .replace(/\/$/, '')
    .toLowerCase();

const tidy = (line: string) =>
  line
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();

/** Whole sentences, with their tags, up to the limit. */
function cutSentences(text: string, max: number): string {
  if (text.length <= max) return text;
  let kept = '';
  for (const sentence of text.split(/(?<=[.!?\]])\s+/)) {
    if (kept.length + sentence.length + 1 > max) break;
    kept = kept ? `${kept} ${sentence}` : sentence;
  }
  return kept || cutTo(text, max);
}

/**
 * The web assistant's report, as COAL hands it on: each statement keeps a tag (W1, W2…) for a page
 * the search or the reader really returned, an address it wrote that no tool returned is removed, a
 * finding with no page is dropped, and no address is left in the words. Pure, so it can be tested.
 */
export function shapeReport(
  text: string,
  found: WebLookupOutcome['pages'],
): Report & { pages: WebPage[] } {
  const sections: Record<keyof Report, string[]> = {
    answer: [],
    findings: [],
    notFound: [],
    cautions: [],
  };
  let current: keyof Report = 'answer';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const heading = /^[#*\s]*(ANSWER|FINDINGS|NOT FOUND|CAUTIONS)[*\s]*:?\s*(.*)$/i.exec(line);
    if (heading) {
      current = SECTIONS[(heading[1] as string).toUpperCase()] as keyof Report;
      if (heading[2]) sections[current].push(heading[2]);
      continue;
    }
    sections[current].push(line);
  }

  const byKey = new Map(found.map((p) => [keyOf(p.url), p]));
  const cited: WebLookupOutcome['pages'] = [];
  const tags = new Map<string, string>();
  const tagOf = (address: string): string | null => {
    const page = byKey.get(keyOf(address));
    if (!page) return null;
    let tag = tags.get(page.url);
    if (!tag) {
      tag = `W${cited.length + 1}`;
      cited.push(page);
      tags.set(page.url, tag);
    }
    return tag;
  };
  const retag = (line: string) => {
    let backed = false;
    const out = line.replace(ADDRESS, (_all, a?: string, b?: string, c?: string, d?: string) => {
      const tag = tagOf((a ?? b ?? c ?? d) as string);
      if (!tag) return '';
      backed = true;
      return `[${tag}]`;
    });
    return { text: tidy(out), backed };
  };
  const bare = (line: string) => tidy(line.replace(ADDRESS, ''));
  // A finding is one fact: its tags go after its words, which are cut if they run long.
  const finding = (line: string) => {
    const refs = [...new Set(line.match(/\[W\d+\]/g) ?? [])].join('');
    return `${cutTo(line.replace(/\s*\[W\d+\]/g, '').trim(), LIMITS.finding)} ${refs}`;
  };

  const answerLines = sections.answer.map(retag);
  const answer = answerLines.some((l) => l.backed)
    ? cutSentences(answerLines.map((l) => l.text).join(' '), LIMITS.answer)
    : NO_ANSWER;
  const findings = sections.findings
    .map(retag)
    .filter((l) => l.backed && l.text.replace(/\[W\d+\]/g, '').trim().length > 0)
    .map((l) => finding(l.text))
    .slice(0, LIMITS.findings);
  const notes = (lines: string[]) =>
    lines
      .map(bare)
      .filter(Boolean)
      .map((l) => cutTo(l, LIMITS.note))
      .slice(0, LIMITS.notes);

  const page = (p: WebLookupOutcome['pages'][number], tag: string): WebPage => ({
    tag,
    url: p.url,
    title: cutTo(p.title.replace(/\s+/g, ' ').trim() || p.url, LIMITS.title),
    site: siteOf(p.url),
    date: p.date,
    read: p.read,
  });
  return {
    answer,
    findings,
    notFound: notes(sections.notFound),
    cautions: notes(sections.cautions),
    // The pages its statements rest on, then the pages it read but did not cite (shown, not citable).
    pages: [
      ...cited.map((p) => page(p, tags.get(p.url) as string)),
      ...found.filter((p) => p.read && !tags.has(p.url)).map((p) => page(p, '')),
    ],
  };
}

export const presentLookup = (row: LookupRow, lookupsLeft: number): WebLookup => ({
  id: row.id,
  chatId: row.chatId,
  round: row.round,
  brief: { ...row.brief, followUp: row.followUpOf },
  searches: row.searches,
  pages: row.pages,
  ...row.report,
  status: row.status,
  error: row.error,
  lookupsLeft,
  createdAt: row.createdAt.toISOString(),
});

async function countInReply(ex: Executor, requestId: string): Promise<number> {
  const rows = await ex
    .select({ id: aiWebLookups.id })
    .from(aiWebLookups)
    .where(eq(aiWebLookups.requestId, requestId));
  return rows.length;
}

/**
 * Asks the web assistant one question, for the assistant inside one of the person's chats. Only
 * the brief leaves COAL, and only once it has passed its checks.
 */
export async function lookUpWeb(
  deps: AppDeps,
  ctx: RequestContext,
  actor: Actor,
  chatId: string,
  brief: WebBrief,
): Promise<WebLookup> {
  const chat = await requireChat(deps.db, ctx.orgId, chatId);
  assertCanAccess('ai.web', actor, chat);
  const reply = ctx.aiChat;
  // The brief is checked against what the assistant read in its reply, so it can only come from there.
  if (!ctx.viaAi || !reply || reply.chatId !== chat.id) {
    throw new AppError(
      403,
      'NOT_ALLOWED',
      'Only the assistant looks things up on the web, from inside its own reply in this chat.',
    );
  }
  const provider = deps.ai;
  if (!provider?.lookUpWeb || !webAvailable(deps)) {
    throw new AppError(
      503,
      'AI_UNAVAILABLE',
      'Looking things up on the web is not available here.',
    );
  }
  if (!chat.webOn) {
    throw new AppError(
      409,
      'WEB_OFF',
      'Web lookups are switched off in this chat. The person can switch Web on under the message box.',
    );
  }
  const { web } = deps.config.ai;
  // Counted in the reply as it runs, so lookups asked for together can't pass the limit.
  const counts = reply.counts ?? { webLookups: await countInReply(deps.db, reply.requestId) };
  if (counts.webLookups >= web.lookupsPerReply) {
    throw new AppError(
      409,
      'WEB_LIMIT',
      `This reply has made its ${web.lookupsPerReply} web lookups. Answer with what you have, and say what is still missing.`,
    );
  }
  let earlier: LookupRow | null = null;
  if (brief.followUp) {
    const [row] = await deps.db
      .select()
      .from(aiWebLookups)
      .where(and(eq(aiWebLookups.orgId, ctx.orgId), eq(aiWebLookups.id, brief.followUp)));
    if (!row || row.chatId !== chat.id) throw notFound('web lookup');
    earlier = row;
  }

  const grounding = reply.grounding;
  const problems = webBriefProblems(brief, {
    private: await privatePhrases(deps.db, ctx.orgId),
    coal: [grounding?.read() ?? '', grounding?.answered ?? ''].join('\n'),
    allowed: [grounding?.said ?? '', grounding?.web?.() ?? ''].join('\n'),
  });
  if (problems.length > 0) {
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      'Nothing was sent: the brief did not pass its checks.',
      {
        errors: problems.map((message) => ({ path: 'brief', message })),
      },
    );
  }
  await assertWithinBudget(
    deps.db,
    ctx.orgId,
    actor.userId,
    deps.now(),
    deps.config.ai.dailyBudgetUsd,
  );

  counts.webLookups += 1;
  const round = counts.webLookups;
  const model = deps.config.ai.models.web;
  const started = Date.now();
  const { followUp: _followUp, ...sent } = brief;
  const prompt = webPrompt({
    brief: sent,
    today: dateOfInstant(deps.now()),
    earlier: earlier && {
      searches: earlier.searches,
      ...earlier.report,
      pages: earlier.pages.filter((p) => p.tag),
    },
  });
  const signal = reply.signal ?? new AbortController().signal;
  let outcome: WebLookupOutcome = {
    text: '',
    searches: [],
    pages: [],
    usage: { calls: 0, inputTokens: 0, outputTokens: 0 },
  };
  let failed = false;
  try {
    outcome = await provider.lookUpWeb({
      model,
      system: WEB_ASSISTANT,
      prompt,
      sites: brief.sites,
      maxSearches: web.maxSearches,
      maxPages: web.maxPages,
      signal,
      timeoutMs: web.timeoutMs,
      onProgress: (step) =>
        reply.progress?.(
          step.kind === 'search'
            ? `Searching the web: ${cutTo(step.query, 80)}`
            : `Reading a page on ${siteOf(step.url) || 'the web'}`,
        ),
    });
  } catch {
    failed = true;
  }
  const stopped = signal.aborted;
  const status = stopped ? 'stopped' : failed ? 'failed' : 'done';
  const shaped = shapeReport(outcome.text, outcome.pages);
  const searches = outcome.searches.slice(0, 20).map((q) => cutTo(q, 200));

  const calls: ToolCallLog[] = [
    ...searches.map((query) => ({ tool: 'web_search', input: { query } })),
    ...outcome.pages
      .filter((p) => p.read)
      .map((p) => ({ tool: 'web_fetch', input: { url: p.url } })),
  ].map((call) => ({
    ...call,
    endpoint: 'outside:web',
    tier: 'outside',
    allowed: true,
    denialReason: null,
    recordsReturned: [],
    proposalId: null,
    durationMs: 0,
  }));
  const webRequestId = newId();
  const row = await change(deps.db, ctx, async (tx, log) => {
    await logRequest(
      tx,
      {
        id: webRequestId,
        orgId: ctx.orgId,
        chatId: chat.id,
        userId: actor.userId,
        provider: provider.name,
        model,
        purpose: 'web',
        promptVersion: WEB_PROMPT_VERSION,
        modelCalls: outcome.usage.calls,
        toolCalls: calls.length,
        inputTokens: outcome.usage.inputTokens,
        outputTokens: outcome.usage.outputTokens,
        costUsd:
          costOf(model, outcome.usage.inputTokens, outcome.usage.outputTokens) +
          outcome.searches.length * WEB_SEARCH_USD,
        outcome: stopped ? 'stopped' : failed ? 'error' : 'completed',
        errorCode: failed && !stopped ? 'AI_FAILED' : null,
        durationMs: Date.now() - started,
      },
      calls,
    );
    const [inserted] = await tx
      .insert(aiWebLookups)
      .values({
        orgId: ctx.orgId,
        chatId: chat.id,
        userId: actor.userId,
        requestId: reply.requestId,
        webRequestId,
        round,
        followUpOf: earlier?.id ?? null,
        brief: sent,
        searches,
        pages: shaped.pages,
        report: {
          answer: shaped.answer,
          findings: shaped.findings,
          notFound: shaped.notFound,
          cautions: shaped.cautions,
        },
        status,
        error:
          failed && !stopped ? 'The web assistant could not finish. Try again in a moment.' : null,
      })
      .returning();
    // The brief has left COAL: from now on the chat only prepares cards.
    await tx.update(aiChats).set({ usedWeb: true }).where(eq(aiChats.id, chat.id));
    log.audit({
      action: 'ai.web_lookup',
      recordType: 'ai_web_lookup',
      recordId: (inserted as LookupRow).id,
      after: {
        chatId: chat.id,
        round,
        status,
        searches: searches.length,
        pages: shaped.pages.length,
      },
    });
    return inserted as LookupRow;
  });
  return presentLookup(row, Math.max(0, web.lookupsPerReply - counts.webLookups));
}
