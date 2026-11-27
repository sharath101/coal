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

/** A picture the person attached to the chat. The model looks at it with the person's message. */
export interface ModelImage {
  name: string;
  mediaType: string;
  data: Buffer;
}

export interface ModelTurn {
  model: string;
  system: string;
  /** Earlier messages of the chat, oldest first. */
  history: { role: 'user' | 'assistant'; text: string }[];
  /** The person's new message. */
  prompt: string;
  /**
   * Pictures attached to the chat, oldest first: the ones with this message, and recent ones from
   * earlier. Each is named in the message text that came with it (`[Attached file: …]`).
   */
  images?: ModelImage[];
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
  /**
   * Searches the web on the given websites only, for the research assistant
   * (docs/workstation-and-ai.md#researching-what-already-exists). Only some providers can: without
   * it, a website in the source library is a link the person opens.
   */
  searchWeb?(search: WebSearch): Promise<WebSearchOutcome>;
  /**
   * Runs the web assistant on one brief: a turn with the provider's own web search and web reader,
   * and no other tools (docs/workstation-and-ai.md#looking-things-up-on-the-web). Only some
   * providers can: without it, the assistant can't look things up on the web.
   */
  lookUpWeb?(lookup: WebLookupRun): Promise<WebLookupOutcome>;
  close?(): Promise<void>;
}

export interface WebLookupRun {
  model: string;
  system: string;
  /** The brief, written out: everything the web assistant knows. */
  prompt: string;
  /** Keep the search and the reading to these websites; empty for the whole web. */
  sites: string[];
  maxSearches: number;
  maxPages: number;
  signal: AbortSignal;
  timeoutMs: number;
  /** Told as each search is sent and each page is opened, so the person sees it working. */
  onProgress?(step: { kind: 'search'; query: string } | { kind: 'read'; url: string }): void;
}

export interface WebLookupOutcome {
  /** The web assistant's report, as it wrote it. */
  text: string;
  /** The searches sent, as they were sent. */
  searches: string[];
  /**
   * The pages the search returned or the reader opened: the only addresses a report may cite.
   * `date` is how old the page is, as the search gave it.
   */
  pages: { url: string; title: string; date: string | null; read: boolean }[];
  usage: TurnOutcome['usage'];
}

export interface WebSearch {
  model: string;
  /** Made only of the words the person approved. */
  query: string;
  domains: string[];
  maxSearches: number;
  signal: AbortSignal;
  timeoutMs: number;
}

export interface WebSearchOutcome {
  /** Pages the search returned, each with a line on what it says. Only addresses the search gave. */
  pages: { url: string; title: string; summary: string }[];
  /** The queries the provider sent, as it sent them. */
  queries: string[];
  usage: TurnOutcome['usage'];
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
