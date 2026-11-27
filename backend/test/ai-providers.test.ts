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
  it('searches the web on the given websites, keeping only the pages the search returned', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [
          {
            type: 'tool-call',
            toolCallId: 'w1',
            toolName: 'web_search',
            input: '{"query":"expandable cage launch"}',
            providerExecuted: true,
          },
          {
            type: 'tool-result',
            toolCallId: 'w1',
            toolName: 'web_search',
            result: [
              {
                type: 'web_search_result',
                url: 'https://news.example.com/a',
                title: 'A made-up launch',
                pageAge: null,
                encryptedContent: 'x',
              },
            ],
          },
          {
            type: 'text',
            text: 'https://news.example.com/a | A made-up cage was launched.\nhttps://invented.example.org/b | Not from the search.',
          },
        ],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: usage(300, 40),
        warnings: [],
      }),
    });
    const outcome = await new AnthropicProvider({ model: () => model }).searchWeb({
      model: 'claude-test',
      query: 'expandable cage',
      domains: ['news.example.com'],
      maxSearches: 2,
      signal: new AbortController().signal,
      timeoutMs: 10_000,
    });
    expect(outcome).toEqual({
      pages: [
        {
          url: 'https://news.example.com/a',
          title: 'A made-up launch',
          summary: 'A made-up cage was launched.',
        },
      ],
      queries: ['expandable cage launch'],
      usage: { calls: 1, inputTokens: 300, outputTokens: 40 },
    });
    // The search was limited to the source's websites.
    expect(model.doGenerateCalls[0]!.tools).toMatchObject([
      { type: 'provider', args: { allowedDomains: ['news.example.com'], maxUses: 2 } },
    ]);
  });

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

  it('runs the web assistant with only its web search and reader, keeps only the pages they returned, and goes on after a pause', async () => {
    const page = 'https://standards.example.org/plates';
    const calls: Part[][] = [
      [
        {
          type: 'tool-call',
          toolCallId: 's1',
          toolName: 'web_search',
          input: '{"query":"cervical plate fatigue test standard"}',
          providerExecuted: true,
        },
        {
          type: 'tool-result',
          toolCallId: 's1',
          toolName: 'web_search',
          result: [
            {
              type: 'web_search_result',
              url: page,
              title: 'A made-up standards page',
              pageAge: 'March 2024',
              encryptedContent: 'x',
            },
          ],
        },
        {
          type: 'finish',
          finishReason: { unified: 'stop', raw: 'pause_turn' },
          usage: usage(300, 20),
        },
      ],
      [
        {
          type: 'tool-call',
          toolCallId: 'f1',
          toolName: 'web_fetch',
          input: JSON.stringify({ url: page }),
          providerExecuted: true,
        },
        {
          type: 'tool-result',
          toolCallId: 'f1',
          toolName: 'web_fetch',
          result: {
            type: 'web_fetch_result',
            url: page,
            retrievedAt: null,
            content: {
              type: 'document',
              title: 'Plates, made up',
              source: { type: 'text', mediaType: 'text/plain', data: 'Made-up text.' },
            },
          },
        },
        ...text('t', [
          `ANSWER\nA fatigue test is needed [${page}].\n`,
          'FINDINGS\n- An invented one [https://invented.example.com/x]',
        ]),
        finish('stop', 900, 80),
      ],
    ];
    const model = new MockLanguageModelV4({ doStream: async () => streamOf(calls.shift()!) });
    const progress: unknown[] = [];
    const outcome = await new AnthropicProvider({ model: () => model }).lookUpWeb({
      model: 'claude-test',
      system: 'Search the web.',
      prompt: 'THE QUESTION\nWhat must a cervical plate pass?',
      sites: ['standards.example.org'],
      maxSearches: 5,
      maxPages: 5,
      signal: new AbortController().signal,
      timeoutMs: 10_000,
      onProgress: (step) => progress.push(step),
    });

    expect(outcome.searches).toEqual(['cervical plate fatigue test standard']);
    // Only what the tools returned: the address the model made up is not a page.
    expect(outcome.pages).toEqual([
      { url: page, title: 'Plates, made up', date: 'March 2024', read: true },
    ]);
    expect(outcome.text).toContain('A fatigue test is needed');
    expect(outcome.usage).toEqual({ calls: 2, inputTokens: 1200, outputTokens: 100 });
    expect(progress).toEqual([
      { kind: 'search', query: 'cervical plate fatigue test standard' },
      { kind: 'read', url: page },
    ]);
    // The provider's own web tools and nothing else, kept to the websites asked for.
    expect(model.doStreamCalls[0]!.tools).toMatchObject([
      {
        type: 'provider',
        id: 'anthropic.web_search_20260318',
        args: { allowedDomains: ['standards.example.org'], maxUses: 5 },
      },
      {
        type: 'provider',
        id: 'anthropic.web_fetch_20260318',
        args: { allowedDomains: ['standards.example.org'], maxUses: 5 },
      },
    ]);
    expect(model.doStreamCalls[0]!.tools).toHaveLength(2);
    // The paused turn went on from where it stopped, with the searches it had left.
    expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).toContain(
      'cervical plate fatigue test standard',
    );
    expect(model.doStreamCalls[1]!.tools).toMatchObject([
      { args: { maxUses: 4 } },
      { args: { maxUses: 5 } },
    ]);
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
      template: 'claude-sonnet-5-5',
      research: 'claude-sonnet-5-5',
      web: 'claude-sonnet-5-5',
    });
    // Turning a sample into a template, and research, stay on the strong model when the everyday one is made cheaper.
    expect(config({ AI_PROVIDER: 'copilot', AI_MODEL_CHAT: 'claude-haiku-5.5' }).ai.models).toEqual(
      {
        chat: 'claude-haiku-5.5',
        title: 'claude-haiku-5.5',
        draft_write: 'claude-sonnet-5.5',
        template: 'claude-sonnet-5.5',
        research: 'claude-sonnet-5.5',
        web: 'claude-sonnet-5.5',
      },
    );
    // The web assistant follows the research model, unless it has its own.
    expect(config({ AI_MODEL_RESEARCH: 'claude-opus-5-5' }).ai.models.web).toBe('claude-opus-5-5');
    expect(
      config({ AI_MODEL_RESEARCH: 'claude-opus-5-5', AI_MODEL_WEB: 'claude-haiku-5-5' }).ai.models
        .web,
    ).toBe('claude-haiku-5-5');
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
