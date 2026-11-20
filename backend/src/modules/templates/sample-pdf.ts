import { getDocumentProxy } from 'unpdf';
import { buildDocx, type Block } from './docx-builder';
import { DocxError } from './docx';

/**
 * Reads a PDF that has text and makes a plain Word form from it, so a sample that only exists as a
 * PDF can become a template (docs/workstation-and-ai.md#making-a-template-from-a-sample-document).
 * A PDF holds no layout to keep: headings, paragraphs and tables are worked out from where the text
 * sits, so they can be wrong, and the template says its layout was rebuilt.
 */

export const MAX_SAMPLE_PAGES = 30;
export const MAX_SAMPLE_BYTES = 10 * 1024 * 1024;
const READ_TIMEOUT_MS = 20_000;

interface Cell {
  x: number;
  end: number;
  text: string;
}

interface Line {
  y: number;
  size: number;
  bold: boolean;
  cells: Cell[];
}

interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
}

const text = (line: Line) => line.cells.map((c) => c.text).join(' ');

/** Items on about the same baseline make a line; big gaps inside a line separate its cells. */
function linesOf(items: TextItem[], bold: (font: string) => boolean): Line[] {
  const placed = items
    // pdf.js adds blank items for the gaps between words; the positions already say where the gaps are.
    .filter((i) => i.str.trim() !== '')
    .map((i) => ({
      str: i.str,
      x: i.transform[4] ?? 0,
      y: i.transform[5] ?? 0,
      width: i.width,
      size: Math.abs(i.transform[3] ?? i.height) || i.height || 10,
      bold: bold(i.fontName),
    }));
  placed.sort((a, b) => b.y - a.y || a.x - b.x);

  const rows: (typeof placed)[] = [];
  for (const item of placed) {
    const row = rows.at(-1);
    if (row && Math.abs((row[0] as { y: number }).y - item.y) <= item.size * 0.45) row.push(item);
    else rows.push([item]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    const cells: Cell[] = [];
    for (const item of row) {
      const last = cells.at(-1);
      const gap = last ? item.x - last.end : 0;
      if (last && gap <= item.size * 1.2) {
        const joined = gap > item.size * 0.12 && !/\s$/.test(last.text) && !/^\s/.test(item.str);
        last.text += (joined ? ' ' : '') + item.str;
        last.end = item.x + item.width;
      } else {
        cells.push({ x: item.x, end: item.x + item.width, text: item.str });
      }
    }
    return {
      y: (row[0] as { y: number }).y,
      size: Math.max(...row.map((i) => i.size)),
      bold: row.every((i) => i.bold),
      cells: cells
        .map((c) => ({ ...c, text: c.text.replace(/\s+/g, ' ').trim() }))
        .filter((c) => c.text),
    };
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 10;
}

/** Lines to blocks: tables where cells line up in columns, headings where the text is larger or bold. */
function blocksOf(pages: Line[][]): Block[] {
  const all = pages.flat().filter((l) => l.cells.length > 0);
  const body = median(all.map((l) => l.size));
  const blocks: Block[] = [];
  let paragraph: { text: string; y: number; size: number; page: number } | null = null;
  let rows: string[][] = [];
  const flushParagraph = () => {
    if (paragraph) blocks.push({ type: 'text', text: paragraph.text });
    paragraph = null;
  };
  const flushTable = () => {
    if (rows.length > 0) blocks.push({ type: 'table', rows });
    rows = [];
  };

  pages.forEach((lines, page) => {
    for (const line of lines.filter((l) => l.cells.length > 0)) {
      if (line.cells.length >= 2) {
        flushParagraph();
        rows.push(line.cells.map((c) => c.text));
        continue;
      }
      flushTable();
      const words = text(line);
      const heading =
        words.length <= 90 && (line.size >= body * 1.18 || (line.bold && !/[.;,]$/.test(words)));
      if (heading) {
        flushParagraph();
        blocks.push({ type: blocks.length === 0 ? 'title' : 'heading', text: words });
      } else if (
        paragraph &&
        paragraph.page === page &&
        paragraph.y - line.y <= Math.max(line.size, paragraph.size) * 1.6
      ) {
        paragraph.text += ` ${words}`;
        paragraph.y = line.y;
      } else {
        flushParagraph();
        paragraph = { text: words, y: line.y, size: line.size, page };
      }
    }
  });
  flushParagraph();
  flushTable();
  return blocks;
}

export interface ReadPdf {
  docx: Buffer;
  pages: number;
  notes: string[];
}

/** A PDF with text, as a plain Word file. Refuses scans, very long PDFs and files that will not open. */
export async function pdfToDocx(bytes: Buffer): Promise<ReadPdf> {
  if (bytes.length > MAX_SAMPLE_BYTES) {
    throw new DocxError(['This PDF is larger than 10 MB.']);
  }
  const read = async (): Promise<ReadPdf> => {
    let doc;
    try {
      doc = await getDocumentProxy(new Uint8Array(bytes));
    } catch {
      throw new DocxError(['This PDF cannot be opened. It may be damaged or protected.']);
    }
    if (doc.numPages > MAX_SAMPLE_PAGES) {
      throw new DocxError([
        `This PDF has ${doc.numPages} pages. A sample can have at most ${MAX_SAMPLE_PAGES}.`,
      ]);
    }
    const pages: Line[][] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const styles = content.styles as Record<string, { fontFamily?: string }>;
      const bold = (font: string) =>
        /bold|black|heavy|semibold/i.test(styles[font]?.fontFamily ?? font);
      pages.push(
        linesOf(
          content.items.filter((i) => 'str' in i),
          bold,
        ),
      );
    }
    const characters = pages.flat().reduce((sum, l) => sum + text(l).length, 0);
    if (characters < 40 * doc.numPages) {
      throw new DocxError([
        'This PDF has no text that can be read: it looks like a scan or a photo. Use a Word file, or a PDF saved from a Word file.',
      ]);
    }
    const blocks = blocksOf(pages);
    return {
      docx: buildDocx(blocks, ''),
      pages: doc.numPages,
      notes: [
        'This is a PDF, so the layout is rebuilt in a plain style. Headings, paragraphs and tables were worked out from where the text sits, so check them.',
      ],
    };
  };
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new DocxError(['Reading this PDF took too long.'])),
          READ_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
