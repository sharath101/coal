/**
 * What the gateway needs from a model provider (docs/workstation-and-ai.md#ai-providers).
 * A provider runs one turn: it shows the model the instructions, the conversation and the tools,
 * runs the tool loop, and streams the words back. Everything else (which tools exist, what they
 * may do, what is logged, what it costs) is COAL's own code, the same for every provider.
 */
export interface AiTool {
  name: string;
  description: string;
  /** JSON Schema of the input. */
  inputSchema: Record<string, unknown>;
  /** Runs the tool. Returns text for the model, and never throws: a refusal is text too. */
  run(input: unknown): Promise<string>;
}

export interface ModelTurn {
  model: string;
  system: string;
  /** Earlier messages of the chat, oldest first. */
  history: { role: 'user' | 'assistant'; text: string }[];
  /** The person's new message. */
  prompt: string;
  tools: AiTool[];
  /** The most model calls (one more than the tools it may use) before it must answer. */
  maxSteps: number;
  signal: AbortSignal;
  timeoutMs: number;
  onText(delta: string): void;
}

export interface TurnOutcome {
  /** The model that answered, as the provider names it. */
  model: string;
  usage: { calls: number; inputTokens: number; outputTokens: number };
}

export interface AiProvider {
  readonly name: 'anthropic' | 'copilot' | 'scripted';
  run(turn: ModelTurn): Promise<TurnOutcome>;
  close?(): Promise<void>;
}

/** The provider can't be reached or refused the call. The text is safe to show. */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'unavailable' | 'failed' = 'failed',
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

/** The earlier conversation, as plain text, for a provider that takes one prompt. */
export function transcriptPrompt(turn: Pick<ModelTurn, 'history' | 'prompt'>): string {
  if (turn.history.length === 0) return turn.prompt;
  const lines = turn.history.map(
    (m) => `${m.role === 'user' ? 'The person' : 'You'}: ${m.text.replace(/\n{3,}/g, '\n\n')}`,
  );
  return [
    'The conversation so far:',
    '',
    ...lines,
    '',
    "The person's new message (answer this one):",
    turn.prompt,
  ].join('\n');
}
