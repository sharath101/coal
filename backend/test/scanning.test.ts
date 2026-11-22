import { createServer, type Server } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ORG_ID } from '../src/core/config';
import { systemContext } from '../src/core/http/context';
import { ClamdScanner } from '../src/modules/files/scanner';
import { scanPending } from '../src/modules/files/service';
import { buildDocx, blocksFromSpec } from '../src/modules/templates/docx-builder';
import { SAMPLE_TEMPLATES } from '../src/modules/templates/samples';
import { FakeScanner } from './fakes';
import { createTestApp, type TestApp } from './helpers';
import { createWorld, type World } from './world';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** A clamd that records what it was sent, and answers the way clamd does. */
function fakeClamd(answer: string) {
  const received: Buffer[] = [];
  const server: Server = createServer((socket) => {
    const chunks: Buffer[] = [];
    socket.on('data', (data) => {
      chunks.push(data);
      const all = Buffer.concat(chunks);
      // The stream ends with a zero-length chunk.
      if (all.subarray(all.length - 4).equals(Buffer.alloc(4))) {
        received.push(all);
        socket.end(`${answer}\0`);
      }
    });
  });
  return new Promise<{ port: number; received: Buffer[]; close: () => Promise<void> }>(
    (resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as { port: number };
        resolve({ port, received, close: () => new Promise((done) => server.close(() => done())) });
      });
    },
  );
}

describe('the clamd client', () => {
  it('sends the bytes in the INSTREAM format and reads a clean answer', async () => {
    const clamd = await fakeClamd('stream: OK');
    try {
      const scanner = new ClamdScanner({ host: '127.0.0.1', port: clamd.port });
      const bytes = Buffer.from('made-up report');
      await expect(scanner.scan(bytes)).resolves.toEqual({ clean: true });
      const sent = clamd.received[0]!;
      expect(sent.subarray(0, 10).toString()).toBe('zINSTREAM\0');
      expect(sent.readUInt32BE(10)).toBe(bytes.length);
      expect(sent.subarray(14, 14 + bytes.length).toString()).toBe('made-up report');
      expect(sent.subarray(14 + bytes.length).equals(Buffer.alloc(4))).toBe(true);
    } finally {
      await clamd.close();
    }
  });

  it('reads what it found, and splits long files into chunks', async () => {
    const clamd = await fakeClamd('stream: Eicar-Signature FOUND');
    try {
      const scanner = new ClamdScanner({ host: '127.0.0.1', port: clamd.port });
      const big = Buffer.alloc(200_000, 1);
      await expect(scanner.scan(big)).resolves.toEqual({ clean: false, threat: 'Eicar-Signature' });
      // 200,000 bytes is four chunks of up to 64 KiB, each with its 4-byte length, plus the end marker.
      expect(clamd.received[0]!.length).toBe(10 + 200_000 + 4 * 4 + 4);
    } finally {
      await clamd.close();
    }
  });

  it('fails, rather than calling a file clean, when the answer is an error or there is no scanner', async () => {
    const clamd = await fakeClamd('INSTREAM size limit exceeded. ERROR');
    try {
      const scanner = new ClamdScanner({ host: '127.0.0.1', port: clamd.port });
      await expect(scanner.scan(Buffer.from('x'))).rejects.toThrow(/answered/);
    } finally {
      await clamd.close();
    }
    const nobody = new ClamdScanner({ host: '127.0.0.1', port: 1 });
    await expect(nobody.scan(Buffer.from('x'))).rejects.toThrow();
  });
});

describe('scanning uploads', () => {
  let t: TestApp;
  let w: World;
  const scanner = new FakeScanner();

  beforeAll(async () => {
    t = await createTestApp({}, { scanner });
    w = await createWorld(t);
  });
  afterAll(async () => {
    await t?.close();
  });

  const statusOf = async (fileId: string) => {
    const res = await w.call('POST', `/files/${fileId}/complete`, 'designer');
    return res.body.scanStatus as string;
  };

  it('marks a clean upload clean, and opens it', async () => {
    const id = await w.upload(
      'designer',
      'report.pdf',
      new TextEncoder().encode('%PDF-1.4 made-up report'),
    );
    expect(await statusOf(id)).toBe('clean');
    expect((await w.call('GET', `/files/${id}/link`, 'designer')).status).toBe(200);
  });

  it('refuses to open an infected upload, or to attach one', async () => {
    const id = await w.upload('designer', 'bad.pdf', new TextEncoder().encode(EICAR));
    expect(await statusOf(id)).toBe('infected');
    const link = await w.call('GET', `/files/${id}/link`, 'designer');
    expect(link.status).toBe(403);
    expect(link.body.detail).toContain('virus');

    const project = await w.go('Scan plate');
    const attach = await w.call('POST', `/projects/${project}/attachments`, 'designer', {
      stepKey: '1',
      fileId: id,
    });
    expect(attach.status).toBe(400);
    expect(attach.body.errors[0].message).toContain('virus');
  });

  it('refuses a template with a virus', async () => {
    const fileId = await w.upload('vp', 'form.docx', new TextEncoder().encode(EICAR));
    const res = await w.call('POST', '/templates', 'vp', {
      documentType: 'PID',
      docxFileId: fileId,
    });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].message).toContain('virus');
  });

  it('scans a template file on its way in, even if it was uploaded before a scanner was set up', async () => {
    const spec = SAMPLE_TEMPLATES.find((s) => s.spec.document_type === 'PID')!.spec;
    const fileId = await w.upload('vp', 'form.docx', buildDocx(blocksFromSpec(spec), 'x'));
    const before = scanner.calls;
    const res = await w.call('POST', '/templates', 'vp', {
      documentType: 'PID',
      docxFileId: fileId,
    });
    expect(res.status).toBe(201);
    // The file was scanned when it was uploaded, and the bytes COAL checks are scanned again.
    expect(scanner.calls).toBeGreaterThan(before);
  });

  it('holds back a file the scanner could not check, and scans it when the scanner is back', async () => {
    scanner.down = true;
    const id = await w.upload('designer', 'later.pdf', new TextEncoder().encode('%PDF-1.4 later'));
    scanner.down = false;
    // The upload finished, but nothing has said it is safe.
    const waiting = await w.call('GET', `/files/${id}/link`, 'designer');
    expect(waiting.status).toBe(409);
    expect(waiting.body.code).toBe('FILE_NOT_SCANNED');

    expect(await scanPending(t.deps, systemContext(DEFAULT_ORG_ID))).toBe(1);
    expect((await w.call('GET', `/files/${id}/link`, 'designer')).status).toBe(200);
    // Nothing is left to scan.
    expect(await scanPending(t.deps, systemContext(DEFAULT_ORG_ID))).toBe(0);
  });

  it('records each scan in the audit trail', async () => {
    const { auditEvents } = await import('../src/modules/audit/tables');
    const rows = await t.deps.db.select().from(auditEvents);
    const scans = rows.filter((r) => r.action === 'file.scanned');
    expect(scans.length).toBeGreaterThanOrEqual(3);
    expect(scans.some((r) => (r.after as { scanStatus: string }).scanStatus === 'infected')).toBe(
      true,
    );
  });
});
