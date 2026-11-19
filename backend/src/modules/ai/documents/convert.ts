import path from 'node:path';

const DEFAULT_GOTENBERG_URL = 'http://localhost:3100';
const CONVERT_TIMEOUT_MS = 120_000;

function gotenbergUrl(): string {
  return (process.env.GOTENBERG_URL || DEFAULT_GOTENBERG_URL).replace(/\/+$/, '');
}

/**
 * LibreOffice picks the importer from the extension, so keep it; the rest is made ASCII-safe,
 * since names like "Run card – v2 & notes.docx" don't survive every multipart parser.
 */
function safeFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const stem = path.basename(filename, path.extname(filename)).replace(/[^A-Za-z0-9._-]+/g, '_');
  return `${stem || 'document'}${ext}`;
}

/**
 * Converts an office file (.docx, .xlsx, .doc, .odt, images…) to PDF with Gotenberg's
 * LibreOffice route. `filename` only needs the right extension.
 */
export async function toPdf(file: Buffer, filename: string): Promise<Buffer> {
  const base = gotenbergUrl();
  const name = safeFilename(filename);
  const form = new FormData();
  form.append('files', new Blob([new Uint8Array(file)]), name);
  // One page per sheet: a spreadsheet split over dozens of pages is unreadable as a preview.
  if (/\.(xlsx|xls|ods|csv)$/.test(name)) form.append('singlePageSheets', 'true');

  let response: Response;
  try {
    response = await fetch(`${base}/forms/libreoffice/convert`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(CONVERT_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not reach Gotenberg at ${base} to convert "${filename}" to PDF (${reason}). ` +
        'Start it with `pnpm db:up`, or set GOTENBERG_URL.',
      { cause: error },
    );
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300).trim();
    throw new Error(
      `Gotenberg could not convert "${filename}" to PDF: HTTP ${response.status}` +
        (detail ? ` (${detail})` : ''),
    );
  }
  return Buffer.from(await response.arrayBuffer());
}
