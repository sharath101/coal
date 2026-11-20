import { createAnthropic } from '@ai-sdk/anthropic';
import { isStepCount, jsonSchema, streamText, tool, type LanguageModel } from 'ai';
import { AiProviderError, type AiProvider, type ModelTurn, type TurnOutcome } from './provider';

/**
 * Anthropic (Claude) through the Vercel AI SDK (D17). The key isn't tied to one workspace, so
 * every call names the workspace it bills to. `model` is injectable so tests can use a mock.
 */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic' as const;
  private readonly make: (modelId: string) => LanguageModel;

  constructor(
    options:
      | { apiKey: string; workspaceId: string; fetch?: typeof globalThis.fetch }
      | { model: (modelId: string) => LanguageModel },
  ) {
    if ('model' in options) this.make = options.model;
    else {
      const anthropic = createAnthropic({
        apiKey: options.apiKey,
        headers: options.workspaceId ? { 'anthropic-workspace-id': options.workspaceId } : {},
        ...(options.fetch && { fetch: options.fetch }),
      });
      this.make = (modelId) => anthropic(modelId);
    }
  }

  async run(turn: ModelTurn): Promise<TurnOutcome> {
    const usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
    const result = streamText({
      model: this.make(turn.model),
      instructions: turn.system,
      messages: [
        ...turn.history.map((m) => ({ role: m.role, content: m.text })),
        { role: 'user' as const, content: turn.prompt },
      ],
      tools: Object.fromEntries(
        turn.tools.map((t) => [
          t.name,
          tool({
            description: t.description,
            inputSchema: jsonSchema(t.inputSchema),
            execute: (input: unknown) => t.run(input),
          }),
        ]),
      ),
      stopWhen: isStepCount(turn.maxSteps),
      abortSignal: turn.signal,
      timeout: turn.timeoutMs,
    });
    try {
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') turn.onText(part.text);
        else if (part.type === 'finish-step') {
          usage.calls += 1;
          usage.inputTokens += part.usage.inputTokens ?? 0;
          usage.outputTokens += part.usage.outputTokens ?? 0;
        } else if (part.type === 'error') throw part.error;
      }
    } catch (error) {
      if (turn.signal.aborted) return { model: turn.model, usage };
      throw new AiProviderError(error instanceof Error ? error.message : 'The model call failed.');
    }
    return { model: turn.model, usage };
  }
}
