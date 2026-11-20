import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/core/config';
import { AnthropicProvider } from '../src/modules/ai/anthropic';
import { createProvider } from '../src/modules/ai/gateway';
import { CopilotProvider } from '../src/modules/ai/copilot';
import { costOf } from '../src/modules/ai/pricing';
import { transcriptPrompt, type AiTool, type ModelTurn } from '../src/modules/ai/provider';

const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});

type Part = Record<string, unknown>;
const streamOf = (parts: Part[]) => ({
  stream: new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'stream-start', warnings: [] });
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  }),
});
const finish = (reason: 'stop' | 'tool-calls', input: number, output: number): Part => ({
  type: 'finish',
  finishReason: { unified: reason, raw: reason },
  usage: usage(input, output),
});
const text = (id: string, words: string[]): Part[] => [
  { type: 'text-start', id },
  ...words.map((delta) => ({ type: 'text-delta', id, delta })),
  { type: 'text-end', id },
];

const lookup = (seen: unknown[]): AiTool => ({
  name: 'lookup',
  description: 'Look something up',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
  run: async (input) => {
    seen.push(input);
    return 'the answer is 42';
  },
});

const turnOf = (over: Partial<ModelTurn>): ModelTurn => ({
  model: 'claude-test',
  system: 'Be brief.',
  history: [
    { role: 'user', text: 'Earlier question' },
    { role: 'assistant', text: 'Earlier answer' },
  ],
  prompt: 'What is the answer?',
  tools: [],
  maxSteps: 4,
  signal: new AbortController().signal,
  timeoutMs: 10_000,
  onText: () => undefined,
  ...over,
});

describe('the Anthropic provider', () => {
  it('runs the tool loop through the AI SDK, streams the words and adds up the usage', async () => {
    const seen: unknown[] = [];
    const calls: Part[][] = [
      [
        ...text('a', ['Let me ', 'check. ']),
        { type: 'tool-call', toolCallId: 'c1', toolName: 'lookup', input: '{"q":"answer"}' },
        finish('tool-calls', 100, 20),
      ],
      [...text('b', ['It is ', '42.']), finish('stop', 150, 10)],
    ];
    const model = new MockLanguageModelV4({
      doStream: async () => streamOf(calls.shift()!),
    });
    const provider = new AnthropicProvider({ model: () => model });
    const words: string[] = [];
    const outcome = await provider.run(
      turnOf({ tools: [lookup(seen)], onText: (d) => words.push(d) }),
    );

    expect(words.join('')).toBe('Let me check. It is 42.');
    expect(seen).toEqual([{ q: 'answer' }]);
    expect(outcome).toEqual({
      model: 'claude-test',
      usage: { calls: 2, inputTokens: 250, outputTokens: 30 },
    });

    // The model was shown the instructions, the earlier conversation and the tool.
    const first = model.doStreamCalls[0]!;
    expect(JSON.stringify(first.prompt)).toContain('Be brief.');
    expect(JSON.stringify(first.prompt)).toContain('Earlier answer');
    expect(JSON.stringify(first.prompt)).toContain('What is the answer?');
    expect(first.tools).toMatchObject([{ type: 'function', name: 'lookup' }]);
    // The second call saw the tool's answer.
    expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).toContain('the answer is 42');
  });

  it('stops at the step limit', async () => {
    const seen: unknown[] = [];
    const model = new MockLanguageModelV4({
      doStream: async () =>
        streamOf([
          {
            type: 'tool-call',
            toolCallId: `c${seen.length}`,
            toolName: 'lookup',
            input: '{"q":"again"}',
          },
          finish('tool-calls', 10, 5),
        ]),
    });
    const outcome = await new AnthropicProvider({ model: () => model }).run(
      turnOf({ tools: [lookup(seen)], maxSteps: 3 }),
    );
    expect(model.doStreamCalls.length).toBe(3);
    expect(outcome.usage.calls).toBe(3);
  });

  it('gives back a refusal from the model as an error, but a stop as a quiet end', async () => {
    const failing = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error('403 Access restricted by network policy');
      },
    });
    await expect(new AnthropicProvider({ model: () => failing }).run(turnOf({}))).rejects.toThrow(
      /network policy/,
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      new AnthropicProvider({ model: () => failing }).run(turnOf({ signal: controller.signal })),
    ).resolves.toMatchObject({ usage: { calls: 0 } });
  });

  it('names the key and the workspace it bills to on every call', async () => {
    const seen: { url: string; headers: Headers }[] = [];
    const provider = new AnthropicProvider({
      apiKey: 'sk-test',
      workspaceId: 'wrkspc_test',
      fetch: async (input, init) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        seen.push({ url, headers: new Headers(init?.headers) });
        return new Response(
          JSON.stringify({ type: 'error', error: { type: 'permission_error', message: 'no' } }),
          {
            status: 403,
            headers: { 'content-type': 'application/json' },
          },
        );
      },
    });
    await expect(provider.run(turnOf({ model: 'claude-sonnet-5-5' }))).rejects.toThrow();
    expect(seen[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(seen[0]!.headers.get('x-api-key')).toBe('sk-test');
    expect(seen[0]!.headers.get('anthropic-workspace-id')).toBe('wrkspc_test');
  });
});

describe('the Copilot stand-in', () => {
  it('shows the model the earlier conversation as one prompt', () => {
    expect(transcriptPrompt({ history: [], prompt: 'Hello' })).toBe('Hello');
    expect(
      transcriptPrompt({
        history: [
          { role: 'user', text: 'Question' },
          { role: 'assistant', text: 'Answer' },
        ],
        prompt: 'Next',
      }),
    ).toBe(
      "The conversation so far:\n\nThe person: Question\nYou: Answer\n\nThe person's new message (answer this one):\nNext",
    );
  });

  it('needs its token, and says so without calling anything', async () => {
    await expect(new CopilotProvider('').run(turnOf({}))).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });
});

describe('settings', () => {
  const config = (env: Record<string, string>) => loadConfig({ NODE_ENV: 'test', ...env });

  it('choose the provider, and have none unless one is set up', () => {
    expect(createProvider(config({}))).toBeNull();
    expect(config({}).ai.provider).toBe('none');
    expect(config({ ANTHROPIC_API_KEY: 'k' }).ai.provider).toBe('anthropic');
    expect(createProvider(config({ ANTHROPIC_API_KEY: 'k' }))?.name).toBe('anthropic');
    expect(
      createProvider(config({ AI_PROVIDER: 'copilot', COPILOT_GITHUB_TOKEN: 't' }))?.name,
    ).toBe('copilot');
    // Chosen but not set up.
    expect(createProvider(config({ AI_PROVIDER: 'copilot' }))).toBeNull();
    expect(createProvider(config({ AI_PROVIDER: 'anthropic' }))).toBeNull();
  });

  it('give each provider its own model names, and let one purpose be overridden', () => {
    expect(config({ AI_PROVIDER: 'anthropic' }).ai.models).toEqual({
      chat: 'claude-sonnet-5-5',
      title: 'claude-haiku-5-5',
      draft_write: 'claude-sonnet-5-5',
    });
    expect(config({ AI_PROVIDER: 'copilot', AI_MODEL_CHAT: 'claude-haiku-5.5' }).ai.models).toEqual(
      { chat: 'claude-haiku-5.5', title: 'claude-haiku-5.5', draft_write: 'claude-sonnet-5.5' },
    );
  });

  it('refuse the Copilot stand-in in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        S3_SECRET_ACCESS_KEY: 'real',
        CLAMAV_HOST: 'clamav',
        AI_PROVIDER: 'copilot',
      }),
    ).toThrow(/local development only/);
  });
});

describe('cost', () => {
  it('is worked out from the tokens, by the model family', () => {
    expect(costOf('claude-sonnet-5.5', 1_000_000, 1_000_000)).toBe(18);
    expect(costOf('claude-haiku-5-5', 1_000_000, 1_000_000)).toBe(6);
    expect(costOf('claude-opus-5.5', 1_000_000, 0)).toBe(5);
    expect(costOf('something-new', 1000, 200)).toBe(0.006);
  });
});
