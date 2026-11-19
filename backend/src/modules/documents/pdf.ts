import type { AppConfig } from '../../core/config';
import { AppError } from '../../core/http/errors';

/** Turns a Word file into a PDF. Gotenberg (LibreOffice) in production, a stand-in in tests. */
export interface PdfRenderer {
  fromDocx(docx: Buffer, fileName: string): Promise<Buffer>;
}

const unavailable = (detail?: string) =>
  new AppError(
    502,
    'PDF_UNAVAILABLE',
    `COAL could not make the PDF just now${detail ? ` (${detail})` : ''}. Try again in a moment.`,
  );

export class GotenbergRenderer implements PdfRenderer {
  constructor(private readonly config: AppConfig['pdf']) {}

  async fromDocx(docx: Buffer, fileName: string): Promise<Buffer> {
    const form = new FormData();
    form.append(
      'files',
      new Blob([new Uint8Array(docx)], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      fileName.toLowerCase().endsWith('.docx') ? fileName : `${fileName}.docx`,
    );
    let response: Response;
    try {
      response = await fetch(`${this.config.url}/forms/libreoffice/convert`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw unavailable(error instanceof Error ? error.name : undefined);
    }
    if (!response.ok) throw unavailable(`status ${response.status}`);
    const pdf = Buffer.from(await response.arrayBuffer());
    if (pdf.subarray(0, 4).toString('latin1') !== '%PDF') throw unavailable('not a PDF');
    return pdf;
  }
}
