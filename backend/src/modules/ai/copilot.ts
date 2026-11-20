import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CopilotClient } from '@microsoft/copilot-sdk';
import {
  AiProviderError,
  transcriptPrompt,
  type AiProvider,
  type ModelTurn,
  type TurnOutcome,
} from './provider';

/**
 * The GitHub Copilot SDK as a temporary stand-in for Anthropic, on one development laptop (D19).
 * It is an agent runtime, so two things are enforced here: only COAL's own tools are offered
 * (`custom:*`: none of its built-in shell, file or web tools), and every permission request is
 * refused. A session lasts one turn; the conversation comes from COAL's own database.
 */
export class CopilotProvider implements AiProvider {
  readonly name = 'copilot' as const;
  private client: Promise<CopilotClient> | null = null;

  constructor(private readonly token: string) {}

  private connect(): Promise<CopilotClient> {
    this.client ??= (async () => {
      // Keep it apart from the Copilot of the editor, and send no telemetry.
      process.env.COPILOT_TELEMETRY_DISABLED = 'true';
      for (const name of ['COPILOT_AGENT_SESSION_ID', 'COPILOT_RUNTIME_PROCESS_FILE_LOGGING']) {
        delete process.env[name];
      }
      const sdk = await import('@microsoft/copilot-sdk').catch(() => {
        throw new AiProviderError('The Copilot SDK is not installed.', 'unavailable');
      });
      const baseDirectory = await mkdtemp(join(tmpdir(), 'coal-copilot-'));
      return new sdk.CopilotClient({
        mode: 'empty',
        runtime: sdk.RuntimeConnection.forDefault({ baseDirectory }),
        github: { token: this.token, useLoggedInUser: false },
      });
    })();
    this.client.catch(() => {
      this.client = null;
    });
    return this.client;
  }

  async run(turn: ModelTurn): Promise<TurnOutcome> {
    if (!this.token) throw new AiProviderError('COPILOT_GITHUB_TOKEN is not set.', 'unavailable');
    const sdk = await import('@microsoft/copilot-sdk');
    const client = await this.connect();
    const session = await client.createSession({
      model: turn.model,
      systemMessage: { mode: 'replace', content: turn.system },
      tools: {
        definitions: turn.tools.map((t) =>
          sdk.defineTool(t.name, {
            description: t.description,
            parameters: t.inputSchema,
            skipPermission: true,
            handler: (args: unknown) => t.run(args),
          }),
        ),
        availableTools: ['custom:*'],
      },
      permissions: { onRequest: () => ({ kind: 'reject' }) },
      events: { streaming: true },
    });

    const usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
    let model = turn.model;
    const stops = [
      session.on('assistant.message_delta', (e) => turn.onText(e.data.deltaContent)),
      session.on('assistant.usage', (e) => {
        usage.calls += 1;
        usage.inputTokens += e.data.inputTokens ?? 0;
        usage.outputTokens += e.data.outputTokens ?? 0;
        model = e.data.model || model;
      }),
    ];
    const abort = () => void session.abort().catch(() => undefined);
    turn.signal.addEventListener('abort', abort, { once: true });
    try {
      await session.sendAndWait(transcriptPrompt(turn), turn.timeoutMs);
    } catch (error) {
      if (turn.signal.aborted) return { model, usage };
      throw new AiProviderError(error instanceof Error ? error.message : 'The model call failed.');
    } finally {
      turn.signal.removeEventListener('abort', abort);
      for (const stop of stops) stop();
      await session.disconnect().catch(() => undefined);
    }
    return { model, usage };
  }

  async close(): Promise<void> {
    const client = await this.client?.catch(() => null);
    this.client = null;
    await client?.stop().catch(() => undefined);
  }
}
