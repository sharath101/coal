import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { AiCall } from '@coal/shared';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { AppDeps } from '../../core/deps';
import type { RequestContext } from '../../core/http/context';
import { AppError } from '../../core/http/errors';
import { costUsd, modelName, type ResolvedPurpose, type TokenUsage } from './models';
import { aiCalls } from './tables';

/**
 * The one gateway every model call goes through (docs/architecture.md#ai-module): it picks the
 * client, applies the purpose's model and effort, and logs tokens and cost for every call.
 */

let client: Anthropic | null = null;
let clientKey = '';

const repoEnvFile = fileURLToPath(new URL('../../../../.env', import.meta.url));

/**
 * A setting from the configuration, or (in local work) read again from .env, so a key added
 * while COAL is running works on the next message without a restart.
 */
function setting(deps: AppDeps, configured: string, name: string): string {
  if (configured || deps.config.env !== 'development') return configured;
  if (!existsSync(repoEnvFile)) return '';
  return parseEnv(readFileSync(repoEnvFile, 'utf8'))[name]?.trim() ?? '';
}

export const apiKey = (deps: AppDeps) => setting(deps, deps.config.ai.apiKey, 'ANTHROPIC_API_KEY');

/** Needed with a key that isn't scoped to one workspace (`sk-ant-usr-…`): which workspace to use. */
const workspaceId = (deps: AppDeps) =>
  setting(deps, deps.config.ai.workspaceId, 'ANTHROPIC_WORKSPACE_ID');

export function aiClient(deps: AppDeps): Anthropic {
  const key = apiKey(deps);
  if (!key) {
    throw new AppError(503, 'AI_OFF', 'The assistant is off: set ANTHROPIC_API_KEY in coal/.env.');
  }
  const workspace = workspaceId(deps);
  if (!client || clientKey !== `${key}|${workspace}`) {
    client = new Anthropic({
      apiKey: key,
      maxRetries: 2,
      ...(workspace && { defaultHeaders: { 'anthropic-workspace-id': workspace } }),
    });
    clientKey = `${key}|${workspace}`;
  }
  return client;
}

/**
 * Request settings for a purpose.
 * - Opus and Sonnet get server-side fallbacks, so a safety decline is retried on a fallback
 *   model inside the same call instead of failing the turn.
 * - Saved thinking is tied to the tool list it was made with, and the tools grow with every new
 *   endpoint. `drop_block` lets an older chat carry on without that thinking instead of failing.
 */
export function modelParams(purpose: ResolvedPurpose) {
  const fallback = purpose.model !== 'claude-haiku-5-5';
  return {
    model: purpose.model,
    max_tokens: purpose.maxTokens,
    thinking: {
      type: 'adaptive' as const,
      block_binding: { prefix_mismatch_behavior: 'drop_block' as const },
    },
    output_config: { effort: purpose.effort },
    betas: [
      'thinking-binding-controls-2026-08-01',
      ...(fallback ? ['server-side-fallback-2026-07-01'] : []),
    ],
    ...(fallback && { fallbacks: 'default' as const }),
  };
}

export interface CallScope {
  deps: AppDeps;
  ctx: RequestContext;
  chatId: string | null;
}

export async function logCall(
  scope: CallScope,
  purpose: string,
  message: { model: string; usage: TokenUsage; stop_reason?: string | null },
  ms: number,
): Promise<AiCall> {
  const { deps, ctx, chatId } = scope;
  const cost = costUsd(message.model, message.usage);
  const usage = message.usage;
  await deps.db.insert(aiCalls).values({
    orgId: ctx.orgId,
    userId: ctx.actor!.userId,
    chatId,
    purpose,
    model: message.model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    costUsd: cost,
    ms,
    stopReason: message.stop_reason ?? null,
  });
  return {
    purpose,
    model: message.model,
    modelName: modelName(message.model),
    inputTokens:
      usage.input_tokens +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0),
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    costUsd: cost,
    ms,
  };
}

export async function spentToday(deps: AppDeps, ctx: RequestContext): Promise<number> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const [row] = await deps.db
    .select({ total: sql<number>`coalesce(sum(${aiCalls.costUsd}), 0)` })
    .from(aiCalls)
    .where(
      and(
        eq(aiCalls.orgId, ctx.orgId),
        eq(aiCalls.userId, ctx.actor!.userId),
        gte(aiCalls.createdAt, since),
      ),
    );
  return Number(row?.total ?? 0);
}

export async function assertBudget(deps: AppDeps, ctx: RequestContext): Promise<void> {
  const spent = await spentToday(deps, ctx);
  if (spent >= deps.config.ai.dailyBudgetUsd) {
    throw new AppError(
      429,
      'RATE_LIMITED',
      `You've used today's assistant budget ($${deps.config.ai.dailyBudgetUsd}). It resets at midnight UTC.`,
    );
  }
}

/**
 * One structured-output call: the model must answer in the schema's shape. It streams, because
 * the SDK refuses a large `max_tokens` without streaming (a long draft could outlast a plain
 * request), and the answer is checked against the schema here.
 */
export async function structured<S extends z.ZodType>(
  scope: CallScope,
  purpose: ResolvedPurpose,
  request: {
    system: string;
    messages: Anthropic.Beta.BetaMessageParam[];
    schema: S;
  },
): Promise<{ value: z.infer<S>; call: AiCall }> {
  const started = Date.now();
  const response = await aiClient(scope.deps)
    .beta.messages.stream({
      ...modelParams(purpose),
      system: request.system,
      messages: request.messages,
      output_config: { effort: purpose.effort, format: betaZodOutputFormat(request.schema) },
    })
    .finalMessage();
  const call = await logCall(scope, purpose.key, response, Date.now() - started);
  if (response.stop_reason === 'refusal') {
    throw new AppError(422, 'AI_DECLINED', 'The assistant declined this request.');
  }
  const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Handled below with the schema check.
  }
  const result = request.schema.safeParse(parsed);
  if (!result.success) {
    throw new AppError(
      502,
      'AI_FAILED',
      response.stop_reason === 'max_tokens'
        ? 'The answer was too long and got cut off. Try a narrower request.'
        : 'The assistant gave an answer in the wrong shape. Try again.',
    );
  }
  return { value: result.data, call };
}
