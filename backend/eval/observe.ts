import { and, eq, gt, max, ne } from 'drizzle-orm';
import type { AppDeps } from '../src/core/deps';
import type {
  AiProvider,
  ModelTurn,
  TurnOutcome,
  WebLookupOutcome,
  WebLookupRun,
  WebSearch,
} from '../src/modules/ai/provider';
import { aiRequests, aiToolCalls } from '../src/modules/ai/tables';
import { auditEvents } from '../src/modules/audit/tables';
import { proposals } from '../src/modules/proposals/tables';
import type { Observation } from './checks';
import { fakeWeb, type WebReport } from './world';

/**
 * Wraps the model and writes down everything it is shown: its instructions and every tool result.
 * That is the strongest evidence for a leak check, because the server decides what the model can
 * see, whatever the model then chooses to say. It also plays the web assistant with made-up pages,
 * so the exam reaches no real website, and keeps every brief: what would have left COAL.
 */
export class RecordingProvider implements AiProvider {
  /** What the model was shown since the last `reset`. */
  private shown: string[] = [];
  private failed: string[] = [];
  /** The briefs the web assistant was sent since the last `reset`. */
  briefs: string[] = [];
  /** What the made-up web reports to the next lookups. */
  webReport: WebReport = 'standard';
  model = '';

  constructor(private readonly inner: AiProvider) {}

  get name() {
    return this.inner.name;
  }

  reset() {
    this.shown = [];
    this.failed = [];
    this.briefs = [];
    this.webReport = 'standard';
  }

  get seen(): string {
    return this.shown.join('\n');
  }

  /** Why the provider failed, if it did: COAL tells the person only that it could not answer. */
  get failures(): string {
    return this.failed.join('; ');
  }

  async run(turn: ModelTurn): Promise<TurnOutcome> {
    // The person's own words are not evidence of a leak: only what COAL puts in front of the model.
    this.shown.push(turn.system);
    const tools = turn.tools.map((tool) => ({
      ...tool,
      run: async (input: unknown) => {
        const result = await tool.run(input);
        this.shown.push(result);
        if (process.env.EVAL_TRACE) {
          console.log(
            `  tool ${tool.name} ${JSON.stringify(input).slice(0, 120)} → ${result.length} chars`,
          );
        }
        return result;
      },
    }));
    const started = Date.now();
    if (process.env.EVAL_TRACE)
      console.log(`  model turn starts (${turn.model}, ${turn.tools.length} tools)`);
    try {
      const outcome = await this.inner.run({ ...turn, tools });
      if (turn.tools.length > 0) this.model = outcome.model;
      if (process.env.EVAL_TRACE) console.log(`  model turn ends after ${Date.now() - started} ms`);
      return outcome;
    } catch (error) {
      this.failed.push(error instanceof Error ? error.message : String(error));
      if (process.env.EVAL_TRACE)
        console.log(`  model turn failed after ${Date.now() - started} ms`);
      throw error;
    }
  }

  searchWeb(search: WebSearch) {
    return this.inner.searchWeb
      ? this.inner.searchWeb(search)
      : Promise.reject(new Error('no web'));
  }

  async lookUpWeb(lookup: WebLookupRun): Promise<WebLookupOutcome> {
    this.briefs.push(lookup.prompt);
    const found = fakeWeb(this.webReport);
    for (const query of found.searches) lookup.onProgress?.({ kind: 'search', query });
    if (process.env.EVAL_TRACE) console.log(`  web brief: ${lookup.prompt.replace(/\s+/g, ' ')}`);
    return found;
  }

  close() {
    return this.inner.close?.() ?? Promise.resolve();
  }
}

/** The newest audit entry, so a case can tell what was recorded after it. */
export async function auditMark(db: AppDeps['db']): Promise<number> {
  const [row] = await db.select({ seq: max(auditEvents.seq) }).from(auditEvents);
  return row?.seq ?? 0;
}

/** What one conversation did, from COAL's own records. */
export async function observe(
  db: AppDeps['db'],
  input: {
    chatId: string;
    mark: number;
    replies: { text: string; citations: number }[];
    seen: string;
    briefs: string[];
    error: string | null;
  },
): Promise<Observation> {
  const [cards, calls, writes] = await Promise.all([
    db.select().from(proposals).where(eq(proposals.chatId, input.chatId)),
    db
      .select({
        tool: aiToolCalls.tool,
        allowed: aiToolCalls.allowed,
        input: aiToolCalls.input,
        denial: aiToolCalls.denialReason,
      })
      .from(aiToolCalls)
      .innerJoin(aiRequests, eq(aiRequests.id, aiToolCalls.requestId))
      // The assistant's own tools: the web assistant's searches are what `briefs` stands for.
      .where(and(eq(aiRequests.chatId, input.chatId), ne(aiToolCalls.tier, 'outside')))
      .orderBy(aiToolCalls.createdAt),
    db
      .select({
        action: auditEvents.action,
        recordType: auditEvents.recordType,
        actorType: auditEvents.actorType,
      })
      .from(auditEvents)
      .where(gt(auditEvents.seq, input.mark))
      .orderBy(auditEvents.seq),
  ]);
  return {
    reply: input.replies.map((r) => r.text).join('\n\n'),
    citations: input.replies.reduce((n, r) => n + r.citations, 0),
    cards: cards.flatMap((card) =>
      card.actions.map((a) => ({ endpoint: a.endpoint, body: a.body ?? null })),
    ),
    toolCalls: calls.map((c) => ({
      tool: c.tool,
      allowed: c.allowed,
      input: c.input,
      denial: c.denial,
    })),
    seen: input.seen,
    briefs: input.briefs,
    writes: writes.map((w) => ({
      action: w.action,
      recordType: w.recordType,
      viaAi: w.actorType === 'user_via_ai',
    })),
    error: input.error,
  };
}
