import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { toPdf } from './convert';

const saved = process.env.GOTENBERG_URL;
afterEach(() => {
  if (saved === undefined) delete process.env.GOTENBERG_URL;
  else process.env.GOTENBERG_URL = saved;
});

/** A stand-in Gotenberg that records the request and answers with `status` and `body`. */
async function fakeGotenberg(status: number, body: string) {
  const seen: { url?: string; type?: string; body?: string } = {};
  const server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      Object.assign(seen, {
        url: req.url,
        type: req.headers['content-type'],
        body: Buffer.concat(chunks).toString('latin1'),
      });
      res.writeHead(status).end(body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  process.env.GOTENBERG_URL = `http://127.0.0.1:${port}/`;
  return { seen, close: () => new Promise((resolve) => server.close(resolve)) };
}

describe('toPdf', () => {
  it("posts the file to Gotenberg's LibreOffice route and returns the PDF", async () => {
    const gotenberg = await fakeGotenberg(200, '%PDF-1.7 example');
    try {
      const pdf = await toPdf(Buffer.from('docx bytes'), 'Plan – v2 & notes.docx');
      expect(pdf.toString()).toBe('%PDF-1.7 example');
      expect(gotenberg.seen.url).toBe('/forms/libreoffice/convert');
      expect(gotenberg.seen.type).toMatch(/^multipart\/form-data/);
      expect(gotenberg.seen.body).toContain('name="files"; filename="Plan_v2_notes.docx"');
      expect(gotenberg.seen.body).toContain('docx bytes');
      expect(gotenberg.seen.body).not.toContain('singlePageSheets');
    } finally {
      await gotenberg.close();
    }
  });

  it('asks for one page per sheet for spreadsheets', async () => {
    const gotenberg = await fakeGotenberg(200, '%PDF-');
    try {
      await toPdf(Buffer.from('xlsx bytes'), 'Sheet.XLSX');
      expect(gotenberg.seen.body).toMatch(/name="singlePageSheets"\r\n\r\ntrue/);
    } finally {
      await gotenberg.close();
    }
  });

  it('says what went wrong when Gotenberg refuses', async () => {
    const gotenberg = await fakeGotenberg(503, 'LibreOffice is restarting');
    try {
      await expect(toPdf(Buffer.from('x'), 'a.docx')).rejects.toThrow(
        /could not convert "a\.docx" to PDF: HTTP 503 \(LibreOffice is restarting\)/,
      );
    } finally {
      await gotenberg.close();
    }
  });

  it('says how to start Gotenberg when it is not running', async () => {
    process.env.GOTENBERG_URL = 'http://127.0.0.1:9';
    await expect(toPdf(Buffer.from('x'), 'a.docx')).rejects.toThrow(
      /Could not reach Gotenberg at http:\/\/127\.0\.0\.1:9 .*pnpm db:up/,
    );
  });
});
