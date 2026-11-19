import PizZip from 'pizzip';
import { AppError } from '../src/core/http/errors';
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
