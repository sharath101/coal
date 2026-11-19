import type { AiIntent, AiPurpose } from '@coal/shared';

/**
 * The model table: which Claude model each kind of AI work uses (docs/workstation-and-ai.md#ai-providers).
 * Cheap and fast where the work is simple, the strongest where quality matters most.
 * A row can be overridden with `AI_MODEL_<KEY>=<model id>` without a code change.
 */

export const MODELS = {
  'claude-haiku-5-5': { name: 'Haiku 5.5', input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-sonnet-5-5': { name: 'Sonnet 5.5', input: 2, output: 10, cacheRead: 0.1 },
  'claude-opus-5-5': { name: 'Opus 5.5', input: 4, output: 20, cacheRead: 0.2 },
} as const satisfies Record<
  string,
  { name: string; input: number; output: number; cacheRead: number }
>;

export type ModelId = keyof typeof MODELS;
type Effort = AiPurpose['effort'];

interface PurposeRow {
  label: string;
  model: ModelId;
  effort: Effort;
  maxTokens: number;
  why: string;
}

export const PURPOSES = {
  route: {
    label: 'Read each message and pick the model',
    model: 'claude-haiku-5-5',
    effort: 'low',
    maxTokens: 2000,
    why: 'Runs on every message, so it must be the cheapest and fastest. Sorting a message into one of seven kinds is easy.',
  },
  chat: {
    label: 'Small talk, help, how COAL works',
    model: 'claude-haiku-5-5',
    effort: 'low',
    maxTokens: 4000,
    why: 'Short answers with no records to weigh.',
  },
  lookup: {
    label: 'Look things up: my tasks, a project’s status, who is on a team',
    model: 'claude-haiku-5-5',
    effort: 'medium',
    maxTokens: 8000,
    why: 'One or two tool calls and a short answer. The facts come from COAL’s records, not the model.',
  },
  analysis: {
    label:
      'Questions that need reasoning across records ("which Spine projects are late, and why?")',
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    maxTokens: 16000,
    why: 'Several lookups and a judgment. Sonnet is accurate here at half the price of Opus.',
  },
  idea: {
    label: 'Turn the VP’s idea into a project (concept, then the Go preview)',
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    maxTokens: 16000,
    why: 'Pulling the product, line, need and markets out of free text, and asking for what’s missing.',
  },
  assign: {
    label: 'Assign work and make requests (action cards)',
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    maxTokens: 16000,
    why: 'Resolving people, projects and steps must be right; a person still confirms every card.',
  },
  draft: {
    label: 'Gather what a document needs, then hand it to the writer',
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    maxTokens: 16000,
    why: 'Finds the project, the step and the template. The writing itself goes to Opus.',
  },
  draft_write: {
    label: 'Write the document from Jayon’s template or letterhead',
    model: 'claude-opus-5-5',
    effort: 'high',
    maxTokens: 32000,
    why: 'Regulated documents that people sign. Following a form exactly and never inventing a number is worth the most capable model.',
  },
  template_pick: {
    label: 'Pick the right template when a step has several',
    model: 'claude-haiku-5-5',
    effort: 'low',
    maxTokens: 1000,
    why: 'Choosing one file name from a short list.',
  },
  explain: {
    label: 'Explain or check a document before someone signs it',
    model: 'claude-opus-5-5',
    effort: 'high',
    maxTokens: 32000,
    why: 'A missed gap here gets signed. Correctness matters more than cost.',
  },
  deep: {
    label: 'Hard questions the router marks as complex',
    model: 'claude-opus-5-5',
    effort: 'high',
    maxTokens: 32000,
    why: 'Escalation for multi-step judgment that Sonnet might get wrong.',
  },
} as const satisfies Record<string, PurposeRow>;

export type PurposeKey = keyof typeof PURPOSES;

/** The purpose, and so the model, for each kind of message. `complex` escalates one level. */
export function purposeFor(intent: AiIntent, complex: boolean): PurposeKey {
  switch (intent) {
    case 'chat':
      return 'chat';
    case 'lookup':
      return complex ? 'analysis' : 'lookup';
    case 'analysis':
      return complex ? 'deep' : 'analysis';
    case 'idea':
      return 'idea';
    case 'assign':
      return 'assign';
    case 'draft':
      return 'draft';
    case 'explain':
      return 'explain';
  }
}

export interface ResolvedPurpose extends PurposeRow {
  key: PurposeKey;
}

export function resolvePurpose(
  key: PurposeKey,
  overrides: Record<string, string>,
): ResolvedPurpose {
  const row = PURPOSES[key];
  const override = overrides[key];
  const model = override && override in MODELS ? (override as ModelId) : row.model;
  return { key, ...row, model };
}

export const modelName = (model: string): string =>
  (MODELS as Record<string, { name: string }>)[model]?.name ?? model;

export function listPurposes(overrides: Record<string, string>): AiPurpose[] {
  return (Object.keys(PURPOSES) as PurposeKey[]).map((key) => {
    const p = resolvePurpose(key, overrides);
    const price = MODELS[p.model];
    return {
      key,
      label: p.label,
      model: p.model,
      modelName: price.name,
      effort: p.effort,
      why: p.why,
      inputPerMTok: price.input,
      outputPerMTok: price.output,
    };
  });
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** US dollars for one call. Cache writes cost 1.25 times input; cache reads the model's read rate. */
export function costUsd(model: string, usage: TokenUsage): number {
  const price = (MODELS as Record<string, (typeof MODELS)[ModelId]>)[model];
  if (!price) return 0;
  const read = usage.cache_read_input_tokens ?? 0;
  const write = usage.cache_creation_input_tokens ?? 0;
  const dollars =
    (usage.input_tokens * price.input +
      write * price.input * 1.25 +
      read * price.cacheRead +
      usage.output_tokens * price.output) /
    1_000_000;
  return Math.round(dollars * 1_000_000) / 1_000_000;
}
