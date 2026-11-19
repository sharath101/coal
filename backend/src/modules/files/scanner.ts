import { createConnection } from 'node:net';
import type { Readable } from 'node:stream';
import type { AppConfig } from '../../core/config';

export type ScanResult = { clean: true } | { clean: false; threat: string };

/** Checks bytes for viruses. ClamAV in production; unset locally (docs/documents-and-signing.md). */
export interface VirusScanner {
  scan(bytes: Readable | Buffer): Promise<ScanResult>;
}

const CHUNK = 64 * 1024;

/** Talks to a clamd daemon with its INSTREAM command. */
export class ClamdScanner implements VirusScanner {
  constructor(private readonly config: NonNullable<AppConfig['scan']>) {}

  async scan(bytes: Readable | Buffer): Promise<ScanResult> {
    const socket = createConnection({ host: this.config.host, port: this.config.port });
    socket.setTimeout(120_000);
    const reply = new Promise<string>((resolve, reject) => {
      const parts: Buffer[] = [];
      socket.on('data', (chunk) => parts.push(chunk));
      socket.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
      socket.on('timeout', () => reject(new Error('The virus scanner timed out.')));
      socket.on('error', reject);
    });
    // The reply may fail before the stream is sent; keep it from being an unhandled rejection.
    reply.catch(() => undefined);

    const write = (data: Buffer) =>
      new Promise<void>((resolve, reject) => {
        socket.write(data, (error) => (error ? reject(error) : resolve()));
      });
    const frame = (data: Buffer) => {
      const header = Buffer.alloc(4);
      header.writeUInt32BE(data.length);
      return Buffer.concat([header, data]);
    };

    try {
      await write(Buffer.from('zINSTREAM\0'));
      const source = Buffer.isBuffer(bytes) ? [bytes] : bytes;
      for await (const piece of source) {
        const buffer = piece as Buffer;
        for (let at = 0; at < buffer.length; at += CHUNK) {
          await write(frame(buffer.subarray(at, at + CHUNK)));
        }
      }
      await write(Buffer.alloc(4));
      const text = (await reply).replace(/\0/g, '').trim();
      if (text.endsWith('OK')) return { clean: true };
      const found = /^stream: (.+) FOUND$/.exec(text);
      if (found) return { clean: false, threat: found[1] as string };
      throw new Error(`The virus scanner answered: ${text || 'nothing'}`);
    } finally {
      socket.destroy();
    }
  }
}
