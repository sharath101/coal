import PizZip from 'pizzip';
import { AppError } from '../src/core/http/errors';
import type { AiProvider, ModelTurn, TurnOutcome } from '../src/modules/ai/provider';
import type { PdfRenderer } from '../src/modules/documents/pdf';
import type { ScanResult, VirusScanner } from '../src/modules/files/scanner';

/** Stands in for Gotenberg: a "PDF" that carries the filled Word file's text, so content changes change its bytes. */
export class FakePdfRenderer implements PdfRenderer {
  calls = 0;
  fail = false;

  async fromDocx(docx: Buffer): Promise<Buffer> {
    this.calls += 1;
    if (this.fail) throw new AppError(502, 'PDF_UNAVAILABLE', 'The PDF service is down.');
    const xml = new PizZip(docx).file('word/document.xml')?.asText() ?? '';
    const text = xml
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return Buffer.from(`%PDF-1.4\n% fake pdf\n${text}\n%%EOF`);
  }
}

/** Stands in for ClamAV: finds the standard test string. */
export class FakeScanner implements VirusScanner {
  calls = 0;
  down = false;

  async scan(bytes: Buffer | AsyncIterable<unknown>): Promise<ScanResult> {
    this.calls += 1;
    if (this.down) throw new Error('scanner down');
    const parts: Buffer[] = [];
    if (Buffer.isBuffer(bytes)) parts.push(bytes);
    else for await (const chunk of bytes) parts.push(chunk as Buffer);
    return Buffer.concat(parts).toString('latin1').includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')
      ? { clean: false, threat: 'Eicar-Test-Signature' }
      : { clean: true };
  }
}

/** One thing the scripted model does in a turn. */
export type ScriptStep =
  | { say: string | ((results: string[]) => string) }
  | { tool: string; input?: unknown }
  | { fail: string }
  /** Waits until the person stops the reply, or the test lets it go. */
  | { hold: Promise<void> };

/**
 * Stands in for the model (docs/workstation-and-ai.md#testing-the-ai): each turn plays a script of
 * words and tool calls, running the real tools like a model would, so tests need no key. Turns
 * are played in the order they are queued.
 */
export class ScriptedAi implements AiProvider {
  readonly name = 'scripted' as const;
  readonly turns: ModelTurn[] = [];
  /** What each tool answered, in order, for the tests to read. */
  readonly results: string[] = [];
  private readonly scripts: ScriptStep[][] = [];
  usage = { inputTokens: 1000, outputTokens: 200 };

  queue(...steps: ScriptStep[]): this {
    this.scripts.push(steps);
    return this;
  }

  /** A reply to the next message, then the title the chat gets. */
  reply(...steps: ScriptStep[]): this {
    return this.queue(...steps).queue({ say: 'A made-up chat title' });
  }

  get pending(): number {
    return this.scripts.length;
  }

  async run(turn: ModelTurn): Promise<TurnOutcome> {
    this.turns.push(turn);
    const steps = this.scripts.shift() ?? [{ say: 'Nothing was scripted for this turn.' }];
    const results: string[] = [];
    let calls = 1;
    for (const step of steps) {
      if ('fail' in step) throw new Error(step.fail);
      if ('hold' in step) {
        await Promise.race([
          step.hold,
          new Promise<void>((resolve) => turn.signal.addEventListener('abort', () => resolve())),
        ]);
        if (turn.signal.aborted) break;
      } else if ('say' in step) {
        turn.onText(typeof step.say === 'function' ? step.say(results) : step.say);
      } else {
        const tool = turn.tools.find((t) => t.name === step.tool);
        if (!tool) throw new Error(`The model asked for a tool that was not offered: ${step.tool}`);
        calls += 1;
        const text = await tool.run(step.input ?? {});
        results.push(text);
        this.results.push(text);
      }
    }
    return { model: turn.model, usage: { calls, ...this.usage } };
  }
}
