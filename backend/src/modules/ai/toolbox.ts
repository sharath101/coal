import type { ChatStreamEvent, Citation, DraftRef, IdeaRef } from '@coal/shared';
import type { AppDeps } from '../../core/deps';
import { callEndpoint } from '../../core/http/call';
import type { Actor, RequestContext } from '../../core/http/context';
import { implementationOf } from '../../core/http/endpoint';
import { AppError } from '../../core/http/errors';
import type { AiTool } from './provider';
import type { ToolCallLog } from './service';
import { aiToolDefs, inputSchemaOf, type AiToolDef, type ToolSource } from './tools';

/** The longest a tool's answer may be before it is cut, so one lookup can't fill the model's context. */
const MAX_RESULT_CHARS = 12_000;
const MAX_LOGGED_INPUT_CHARS = 1_000;

export interface ToolboxEnv {
  deps: AppDeps;
  /** The person's own request. The tools run as them, marked "via AI". */
  ctx: RequestContext;
  actor: Actor;
  chatId: string;
  requestId: string;
  maxToolCalls: number;
  /** A file from outside is in the chat, so nothing is saved without a card. */
  outsideText?: boolean;
  /** Everything the person has said in this chat, which a draft may rest on. */
  said: string;
  /** Today's date, a source for the dates a draft states. */
  today: string;
  signal: AbortSignal;
  emit: (event: ChatStreamEvent) => void;
}

/**
 * The tools for one reply, and a record of how they were used. Every tool runs through its
 * endpoint's own checks as the person asking, so the AI can't see or do more than they could
 * (docs/workstation-and-ai.md#what-the-ai-may-do). Refusals go back to the model as text, so it
 * can tell the person who can help instead of failing.
 */
export function buildToolbox(env: ToolboxEnv) {
  /** What the tools returned in this reply: a draft's numbers must come from here or from the person. */
  const read: string[] = [env.today];
  const ctx: RequestContext = {
    ...env.ctx,
    viaAi: true,
    aiChat: {
      chatId: env.chatId,
      requestId: env.requestId,
      ...(env.outsideText && { outsideText: true }),
      grounding: { said: env.said, read: () => read.join('\n') },
    },
  };
  /** The records read in this reply, by the tag the answer cites them with. */
  const citations = new Map<string, Citation>();
  const known = new Map<string, string>();
  const calls: ToolCallLog[] = [];
  const activity: { tool: string; label: string; ok: boolean }[] = [];
  const cards: string[] = [];
  const drafts = new Map<string, DraftRef>();
  const ideas: IdeaRef[] = [];
  let used = 0;

  function cite(source: ToolSource): string {
    const key = `${source.type}:${source.id}`;
    const existing = known.get(key);
    if (existing) return existing;
    const ref = `S${citations.size + 1}`;
    known.set(key, ref);
    citations.set(ref, {
      ref,
      type: source.type,
      id: source.id,
      label: source.label,
      link: source.link,
      passage: source.passage ?? null,
    });
    return ref;
  }

  async function run(def: AiToolDef, raw: unknown): Promise<string> {
    if (env.signal.aborted) return 'The person stopped this reply.';
    if (used >= env.maxToolCalls) {
      return 'You have used all the lookups you may use for this reply. Answer with what you already have, and say what is missing.';
    }
    used += 1;
    const callId = `t${used}`;
    const started = Date.now();
    const parsed = def.input.safeParse(raw ?? {});
    const label = parsed.success ? def.label(parsed.data as never) : def.name;
    env.emit({ type: 'activity', id: callId, tool: def.name, label, state: 'start' });

    const json = JSON.stringify(raw ?? {});
    const log: ToolCallLog = {
      tool: def.name,
      endpoint: def.endpoint.id,
      tier: def.endpoint.aiTier,
      allowed: true,
      denialReason: null,
      input:
        json.length <= MAX_LOGGED_INPUT_CHARS
          ? (raw ?? {})
          : { cut: json.slice(0, MAX_LOGGED_INPUT_CHARS) },
      recordsReturned: [],
      proposalId: null,
      durationMs: 0,
    };
    let text: string;
    let ok = true;
    try {
      if (!parsed.success) {
        ok = false;
        text = `The input was not valid: ${parsed.error.issues
          .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
          .join('; ')}. Fix it and try again.`;
      } else {
        const impl = implementationOf(def.endpoint.id);
        if (!impl) throw new Error(`No implementation for ${def.endpoint.id}`);
        const { output } = await callEndpoint(
          impl,
          env.deps,
          ctx,
          env.actor,
          def.call(parsed.data as never),
        );
        const shaped = def.shape(output as never, parsed.data as never);
        const refs = shaped.sources.map((s) => ({ ref: cite(s), is: `${s.type}: ${s.label}` }));
        log.recordsReturned = shaped.sources.map((s) => ({
          type: s.type,
          id: s.id,
          ...(s.version !== undefined && { version: s.version }),
        }));
        if (shaped.proposalId) {
          log.proposalId = shaped.proposalId;
          cards.push(shaped.proposalId);
          env.emit({ type: 'card', proposalId: shaped.proposalId });
        }
        if (shaped.draft) {
          drafts.set(shaped.draft.documentId, shaped.draft);
          env.emit({ type: 'draft', ...shaped.draft });
        }
        if (shaped.idea) {
          ideas.push(shaped.idea);
          env.emit({ type: 'idea', ...shaped.idea });
        }
        text = JSON.stringify({ result: shaped.data, sources: refs });
        read.push(text);
        const limit = def.maxChars ?? MAX_RESULT_CHARS;
        if (text.length > limit) {
          text = `${text.slice(0, limit)}\n…[cut: too long. Ask for something narrower.]`;
        }
      }
    } catch (error) {
      ok = false;
      if (error instanceof AppError) {
        const refused = error.status === 403;
        log.allowed = !refused;
        log.denialReason = refused ? error.message : null;
        const who = error.extra.whoCan?.length ? ` Who can: ${error.extra.whoCan.join(', ')}.` : '';
        const problems = error.extra.errors?.length
          ? ` Problems: ${error.extra.errors.map((e) => `${e.path || 'input'}: ${e.message}`).join('; ')}.`
          : '';
        text = `${refused ? 'Not allowed' : 'Failed'} (${error.code}): ${error.message}${who}${problems}`;
      } else {
        text = 'The lookup failed unexpectedly. Tell the person you could not check this.';
      }
    }
    log.durationMs = Date.now() - started;
    calls.push(log);
    activity.push({ tool: def.name, label, ok });
    env.emit({ type: 'activity', id: callId, tool: def.name, label, state: ok ? 'done' : 'error' });
    return text;
  }

  const tools: AiTool[] = aiToolDefs().map((def) => ({
    name: def.name,
    description: def.description,
    inputSchema: inputSchemaOf(def),
    run: (raw) => run(def, raw),
  }));

  return { tools, citations, calls, activity, cards, drafts, ideas };
}
