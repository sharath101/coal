import JSZip from 'jszip';
import { type DraftBlock, type DraftContent, GAP_PATTERN } from './content';

/**
 * Lays drafted content out as a Word file on a base .docx (a template or the letterhead):
 * everything in the base is kept (styles, numbering, headers and footers with their images,
 * settings, page setup) and only the body's content is replaced. Without a base, a plain A4
 * document is made.
 *
 * Headings and tables use direct formatting, since templates often lack Heading or table
 * styles; fonts and line spacing come from the base's own defaults.
 *
 * A header or footer run whose text contains `{{title}}` or `{{documentNumber}}` gets the
 * draft's title or document number (the letterhead uses these in its document-control block).
 */

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL_NUMBERING = `${R_NS}/numbering`;
const CT_NUMBERING = 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** A4 with 2.5 cm margins, for documents without a base or a base without a section. */
const DEFAULT_SECT_PR =
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
  '<w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="709" w:footer="709" w:gutter="0"/>' +
  '<w:cols w:space="708"/></w:sectPr>';

export const HEADER_FIELDS = { title: '{{title}}', documentNumber: '{{documentNumber}}' } as const;

// ─── Text ────────────────────────────────────────────────────────────────────────────────────

/** Drops characters XML 1.0 can't hold (control characters, lone surrogates). */
function xmlSafe(text: string): string {
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (
      c === 0x9 ||
      c === 0xa ||
      c === 0xd ||
      (c >= 0x20 && c <= 0xd7ff) ||
      (c >= 0xe000 && c <= 0xfffd) ||
      c >= 0x10000
    )
      out += ch;
  }
  return out;
}

function escapeXml(text: string): string {
  return xmlSafe(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

interface RunStyle {
  bold?: boolean;
  italic?: boolean;
  /** Half-points (22 = 11 pt). */
  size?: number;
  highlight?: boolean;
}

/** Run properties in schema order (b, i, sz, highlight). */
function runProps(style: RunStyle): string {
  let props = '';
  if (style.bold) props += '<w:b/><w:bCs/>';
  if (style.italic) props += '<w:i/><w:iCs/>';
  if (style.size) props += `<w:sz w:val="${style.size}"/><w:szCs w:val="${style.size}"/>`;
  if (style.highlight) props += '<w:highlight w:val="yellow"/>';
  return props;
}

/** Text as run content: line breaks become <w:br/>, tabs <w:tab/>. */
function runContent(text: string): string {
  return xmlSafe(text)
    .split(/\r\n|\r|\n/)
    .map((line) =>
      line
        .split('\t')
        .map((piece) => (piece ? `<w:t xml:space="preserve">${escapeXml(piece)}</w:t>` : ''))
        .join('<w:tab/>'),
    )
    .join('<w:br/>');
}

function run(text: string, rPrInner: string): string {
  if (!text) return '';
  return `<w:r>${rPrInner ? `<w:rPr>${rPrInner}</w:rPr>` : ''}${runContent(text)}</w:r>`;
}

/** Splits text into plain parts and `[[to fill: …]]` gaps. */
function splitGaps(text: string): { text: string; gap: boolean }[] {
  const parts: { text: string; gap: boolean }[] = [];
  let last = 0;
  for (const match of text.matchAll(new RegExp(GAP_PATTERN.source, 'g'))) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), gap: false });
    parts.push({ text: match[0], gap: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), gap: false });
  return parts;
}

/** Runs for text, with each gap highlighted yellow. */
function runs(text: string, style: RunStyle = {}): string {
  return splitGaps(text)
    .map((part) => run(part.text, runProps({ ...style, highlight: part.gap })))
    .join('');
}

// ─── Paragraphs and tables ─────────────────────────────────────────────────────────────────

interface ParagraphStyle {
  align?: 'left' | 'center' | 'right';
  before?: number;
  after?: number;
  keepNext?: boolean;
  /** 0-based outline level, so headings show in Word's navigation pane. */
  outline?: number;
  numId?: number;
  /** Paragraph mark size in half-points (for spacer paragraphs). */
  markSize?: number;
}

/** Paragraph properties in schema order (keepNext, numPr, spacing, jc, outlineLvl, rPr). */
function paragraph(content: string, style: ParagraphStyle = {}): string {
  let props = '';
  if (style.keepNext) props += '<w:keepNext/>';
  if (style.numId !== undefined)
    props += `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${style.numId}"/></w:numPr>`;
  if (style.before !== undefined || style.after !== undefined)
    props += `<w:spacing w:before="${style.before ?? 0}" w:after="${style.after ?? 0}"/>`;
  if (style.align) props += `<w:jc w:val="${style.align}"/>`;
  if (style.outline !== undefined) props += `<w:outlineLvl w:val="${style.outline}"/>`;
  if (style.markSize) props += `<w:rPr><w:sz w:val="${style.markSize}"/></w:rPr>`;
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${content}</w:p>`;
}

/**
 * Text as paragraphs, one per line (a line break in a justified paragraph stretches the line),
 * with `gap` twips after each blank-line-separated group.
 */
function textParagraphs(text: string, run: RunStyle, style: ParagraphStyle, gap: number): string {
  return text
    .split(/\n[ \t]*\n/)
    .flatMap((group) => {
      const lines = group.split(/\r\n|\r|\n/);
      return lines.map((line, i) =>
        paragraph(runs(line.trim(), run), {
          ...style,
          before: 0,
          after: i === lines.length - 1 ? gap : 0,
        }),
      );
    })
    .join('');
}

/** A small empty paragraph: keeps consecutive tables apart and adds a little space. */
const SPACER = paragraph('', { before: 0, after: 0, markSize: 12 });

interface Cell {
  text: string;
  bold?: boolean;
  shade?: string;
}

interface Row {
  cells: Cell[];
  header?: boolean;
  /** Minimum height in twips (room to sign). */
  minHeight?: number;
}

const BORDER = 'w:val="single" w:sz="4" w:space="0" w:color="000000"';

function cellXml(cell: Cell, width: number): string {
  const shade = cell.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${cell.shade}"/>` : '';
  const paragraphs = textParagraphs(cell.text, { bold: cell.bold }, { align: 'left' }, 0);
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade}</w:tcPr>${paragraphs}</w:tc>`;
}

/** A bordered table across the text width. `widths` are twips and sum to the table width. */
function table(widths: number[], rows: Row[]): string {
  const total = widths.reduce((a, b) => a + b, 0);
  const tblPr =
    `<w:tblPr><w:tblW w:w="${total}" w:type="dxa"/>` +
    `<w:tblBorders><w:top ${BORDER}/><w:left ${BORDER}/><w:bottom ${BORDER}/><w:right ${BORDER}/>` +
    `<w:insideH ${BORDER}/><w:insideV ${BORDER}/></w:tblBorders>` +
    '<w:tblLayout w:type="fixed"/>' +
    '<w:tblCellMar><w:top w:w="28" w:type="dxa"/><w:left w:w="85" w:type="dxa"/>' +
    '<w:bottom w:w="28" w:type="dxa"/><w:right w:w="85" w:type="dxa"/></w:tblCellMar>' +
    '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>' +
    '</w:tblPr>';
  const grid = `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
  const body = rows
    .map((row) => {
      let trPr = '<w:cantSplit/>';
      if (row.minHeight) trPr += `<w:trHeight w:val="${row.minHeight}" w:hRule="atLeast"/>`;
      if (row.header) trPr += '<w:tblHeader/>';
      const cells = widths.map((w, i) => cellXml(row.cells[i] ?? { text: '' }, w)).join('');
      return `<w:tr><w:trPr>${trPr}</w:trPr>${cells}</w:tr>`;
    })
    .join('');
  return `<w:tbl>${tblPr}${grid}${body}</w:tbl>${SPACER}`;
}

/** Splits `total` twips by share, rounding so the parts add up exactly. */
function splitWidth(total: number, shares: number[]): number[] {
  const sum = shares.reduce((a, b) => a + b, 0) || 1;
  const widths = shares.map((s) => Math.floor((total * s) / sum));
  const rest = total - widths.reduce((a, b) => a + b, 0);
  widths[widths.length - 1] = (widths[widths.length - 1] ?? 0) + rest;
  return widths;
}

/** Column shares from the longest text in each column, so short columns stay narrow. */
function columnShares(columns: string[][]): number[] {
  return columns.map((texts) => {
    const longest = Math.min(40, Math.max(...texts.map((t) => t.length)));
    const longestWord = Math.max(...texts.flatMap((t) => t.split(/\s+/).map((w) => w.length)));
    return Math.max(6, longest, Math.min(longestWord + 2, 24));
  });
}

// ─── Blocks ────────────────────────────────────────────────────────────────────────────────

const HEADING: Record<'1' | '2' | '3', { size: number; before: number; after: number }> = {
  '1': { size: 28, before: 240, after: 120 },
  '2': { size: 24, before: 200, after: 100 },
  '3': { size: 22, before: 160, after: 80 },
};

interface Layout {
  /** Text width in twips. */
  width: number;
  /** Gives a numbering id for a new list. */
  listNumId: (ordered: boolean) => number;
}

function blockXml(block: DraftBlock, layout: Layout): string {
  switch (block.type) {
    case 'heading': {
      const h = HEADING[block.level];
      return paragraph(runs(block.text, { bold: true, size: h.size }), {
        before: h.before,
        after: h.after,
        keepNext: true,
        outline: Number(block.level) - 1,
      });
    }
    case 'paragraph':
      return textParagraphs(block.text, {}, {}, 120);
    case 'fields': {
      if (block.items.length === 0) return '';
      const widths = splitWidth(layout.width, [35, 65]);
      return table(
        widths,
        block.items.map((item) => ({
          cells: [{ text: item.label, bold: true, shade: 'F2F2F2' }, { text: item.value }],
        })),
      );
    }
    case 'table': {
      const count = Math.max(block.header.length, ...block.rows.map((r) => r.length));
      if (count === 0) return '';
      const columns = Array.from({ length: count }, (_, i) => [
        block.header[i] ?? '',
        ...block.rows.map((r) => r[i] ?? ''),
      ]);
      const widths = splitWidth(layout.width, columnShares(columns));
      const rows: Row[] = [];
      if (block.header.length > 0)
        rows.push({
          header: true,
          cells: block.header.map((text) => ({ text, bold: true, shade: 'D9D9D9' })),
        });
      for (const r of block.rows) rows.push({ cells: r.map((text) => ({ text })) });
      return table(widths, rows);
    }
    case 'list': {
      if (block.items.length === 0) return '';
      const numId = layout.listNumId(block.ordered);
      const items = block.items.map((item) => paragraph(runs(item), { numId, after: 60 }));
      return `${items.join('')}${paragraph('', { before: 0, after: 60, markSize: 12 })}`;
    }
    case 'signatures': {
      if (block.rows.length === 0) return '';
      const widths = splitWidth(layout.width, [26, 30, 26, 18]);
      const header: Row = {
        header: true,
        cells: ['Role', 'Name', 'Signature', 'Date'].map((text) => ({
          text,
          bold: true,
          shade: 'D9D9D9',
        })),
      };
      const rows: Row[] = block.rows.map((r) => ({
        minHeight: 680,
        cells: [{ text: r.role, bold: true }, { text: r.name }, { text: '' }, { text: '' }],
      }));
      return table(widths, [header, ...rows]);
    }
  }
}

function titleXml(content: DraftContent): string {
  let xml = '';
  const title = content.title.trim();
  const number = content.documentNumber.trim();
  if (title)
    xml += paragraph(runs(title, { bold: true, size: 32 }), {
      align: 'center',
      before: 0,
      after: number ? 60 : 240,
      keepNext: true,
    });
  if (number)
    xml += paragraph(runs(`Document No.: ${number}`, { size: 20 }), {
      align: 'center',
      before: 0,
      after: 240,
    });
  return xml;
}

// ─── Package parts ─────────────────────────────────────────────────────────────────────────

async function readPart(zip: JSZip, name: string): Promise<string | null> {
  const file = zip.file(name);
  return file ? file.async('string') : null;
}

/** The main document part, from the package relationships (almost always word/document.xml). */
async function mainPartName(zip: JSZip): Promise<string> {
  const rels = await readPart(zip, '_rels/.rels');
  const target = rels
    ?.match(/<Relationship\b[^>]*>/g)
    ?.find((r) => /Type="[^"]*\/officeDocument"/.test(r))
    ?.match(/Target="([^"]+)"/)?.[1];
  return target ? target.replace(/^\//, '') : 'word/document.xml';
}

function relsPartFor(part: string): string {
  const slash = part.lastIndexOf('/');
  return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
}

function resolveTarget(fromPart: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = fromPart.split('/').slice(0, -1);
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop();
    else if (piece !== '.') parts.push(piece);
  }
  return parts.join('/');
}

function blankDocx(): JSZip {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
      '</Types>',
  );
  zip.file(
    '_rels/.rels',
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="word/document.xml"/>` +
      '</Relationships>',
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${R_NS}/styles" Target="styles.xml"/>` +
      `<Relationship Id="rId2" Type="${R_NS}/settings" Target="settings.xml"/>` +
      '</Relationships>',
  );
  zip.file(
    'word/document.xml',
    `${XML_DECL}<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${DEFAULT_SECT_PR}</w:body></w:document>`,
  );
  zip.file(
    'word/styles.xml',
    `${XML_DECL}<w:styles xmlns:w="${W_NS}">` +
      '<w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>' +
      '<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-IN" w:eastAsia="en-US" w:bidi="ar-SA"/>' +
      '</w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
      '</w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>' +
      '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>' +
      '<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
      '<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style>' +
      '</w:styles>',
  );
  zip.file(
    'word/settings.xml',
    `${XML_DECL}<w:settings xmlns:w="${W_NS}"><w:defaultTabStop w:val="720"/>` +
      '<w:characterSpacingControl w:val="doNotCompress"/>' +
      '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>' +
      '</w:settings>',
  );
  return zip;
}

// ─── Sections ──────────────────────────────────────────────────────────────────────────────

const SECT_PR = /<w:sectPr(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/w:sectPr>)/g;

/**
 * The section properties for the new body. A multi-section template's first section is used
 * (its header and page setup are what page 1 shows; later sections may be landscape annexes).
 * A first-page flag without a first-page header or footer is dropped (with a page 0 start):
 * the template's cover page is gone, so page 1 should carry the normal header.
 */
function chooseSectPr(bodyInner: string): string {
  const all = bodyInner.replace(/<w:sectPrChange\b[\s\S]*?<\/w:sectPrChange>/g, '').match(SECT_PR);
  let sectPr = all?.[0] ?? DEFAULT_SECT_PR;
  if (sectPr.endsWith('/>')) return DEFAULT_SECT_PR;
  sectPr = sectPr.replace(/<w:type\b[^>]*\/>/g, '');
  const hasFirst = /<w:(?:header|footer)Reference\b[^>]*w:type="first"/.test(sectPr);
  if (!hasFirst && /<w:titlePg\b/.test(sectPr)) {
    sectPr = sectPr.replace(/<w:titlePg\b[^>]*\/>/g, '');
    // A cover page is often page 0, so the first real page reads 1.
    sectPr = sectPr.replace(/(<w:pgNumType\b[^>]*?)\s+w:start="0"/, '$1');
  }
  return sectPr;
}

/** Text width of a section in twips: page width less margins and gutter. */
function textWidth(sectPr: string): number {
  const attr = (el: string | undefined, name: string) =>
    Number(el ? (new RegExp(`w:${name}="(-?\\d+)"`).exec(el)?.[1] ?? 0) : 0);
  const pgSz = /<w:pgSz\b[^>]*>/.exec(sectPr)?.[0];
  const pgMar = /<w:pgMar\b[^>]*>/.exec(sectPr)?.[0];
  const page = attr(pgSz, 'w') || 11906;
  const width =
    page - (pgMar ? attr(pgMar, 'left') + attr(pgMar, 'right') + attr(pgMar, 'gutter') : 2836);
  return width >= 2000 ? width : 9070;
}

// ─── Numbering ─────────────────────────────────────────────────────────────────────────────

function abstractNumXml(id: number, ordered: boolean): string {
  const fmt = ordered
    ? '<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>'
    : '<w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>';
  return (
    `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="singleLevel"/>` +
    `<w:lvl w:ilvl="0"><w:start w:val="1"/>${fmt}<w:lvlJc w:val="left"/>` +
    '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>'
  );
}

/** Hands out list numbering ids above the base's own, then writes them into numbering.xml. */
class Numbering {
  private nums: { numId: number; ordered: boolean }[] = [];
  private bulletNumId: number | null = null;
  private nextNumId: number;
  private readonly bulletAbstractId: number;
  private readonly decimalAbstractId: number;

  constructor(existing: string | null) {
    const ids = (pattern: RegExp) =>
      [...(existing ?? '').matchAll(pattern)].map((m) => Number(m[1]));
    const maxAbstract = Math.max(0, ...ids(/w:abstractNumId="(\d+)"/g));
    const maxNum = Math.max(0, ...ids(/<w:num\b[^>]*w:numId="(\d+)"/g));
    this.bulletAbstractId = maxAbstract + 1;
    this.decimalAbstractId = maxAbstract + 2;
    this.nextNumId = maxNum + 1;
  }

  /** Bullet lists share one id; each numbered list gets its own, so it starts at 1. */
  numId(ordered: boolean): number {
    if (!ordered && this.bulletNumId !== null) return this.bulletNumId;
    const numId = this.nextNumId++;
    this.nums.push({ numId, ordered });
    if (!ordered) this.bulletNumId = numId;
    return numId;
  }

  get used(): boolean {
    return this.nums.length > 0;
  }

  /** The numbering part with the new definitions added (or a new part). */
  write(existing: string | null): string {
    const abstracts =
      abstractNumXml(this.bulletAbstractId, false) + abstractNumXml(this.decimalAbstractId, true);
    const nums = this.nums
      .map(({ numId, ordered }) => {
        const abstractId = ordered ? this.decimalAbstractId : this.bulletAbstractId;
        const restart = ordered
          ? '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>'
          : '';
        return `<w:num w:numId="${numId}"><w:abstractNumId w:val="${abstractId}"/>${restart}</w:num>`;
      })
      .join('');
    if (!existing)
      return `${XML_DECL}<w:numbering xmlns:w="${W_NS}">${abstracts}${nums}</w:numbering>`;
    let xml = existing.replace(/<w:numbering\b([^>]*)\/>/, '<w:numbering$1></w:numbering>');
    // Schema order: numPicBullet*, abstractNum*, num*, numIdMacAtCleanup?
    const firstNum = /<w:num[\s>]|<w:numIdMacAtCleanup\b|<\/w:numbering>/.exec(xml);
    if (!firstNum) throw new Error('The template has a malformed numbering part.');
    xml = xml.slice(0, firstNum.index) + abstracts + xml.slice(firstNum.index);
    const end = /<w:numIdMacAtCleanup\b|<\/w:numbering>/.exec(xml);
    if (!end) throw new Error('The template has a malformed numbering part.');
    return xml.slice(0, end.index) + nums + xml.slice(end.index);
  }
}

/** The relationship target of the main part's numbering, if it has one. */
async function existingNumberingPart(zip: JSZip, mainPart: string): Promise<string | null> {
  const rels = await readPart(zip, relsPartFor(mainPart));
  const target = rels
    ?.match(/<Relationship\b[^>]*>/g)
    ?.find((r) => r.includes(`Type="${REL_NUMBERING}"`))
    ?.match(/Target="([^"]+)"/)?.[1];
  return target ? resolveTarget(mainPart, target) : null;
}

/** Adds a numbering relationship to the main part, for a base that has none. */
async function addNumberingRelationship(zip: JSZip, mainPart: string): Promise<string> {
  const relsName = relsPartFor(mainPart);
  const rel = `<Relationship Id="rIdCoalNumbering" Type="${REL_NUMBERING}" Target="numbering.xml"/>`;
  const rels = await readPart(zip, relsName);
  zip.file(
    relsName,
    rels?.includes('</Relationships>')
      ? rels.replace('</Relationships>', `${rel}</Relationships>`)
      : `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel}</Relationships>`,
  );
  return resolveTarget(mainPart, 'numbering.xml');
}

/** Makes sure the package declares the numbering part's content type. */
async function declareNumberingType(zip: JSZip, part: string): Promise<void> {
  const types = (await readPart(zip, '[Content_Types].xml')) ?? '';
  if (types.includes(`PartName="/${part}"`)) return;
  zip.file(
    '[Content_Types].xml',
    types.replace(
      '</Types>',
      `<Override PartName="/${part}" ContentType="${CT_NUMBERING}"/></Types>`,
    ),
  );
}

// ─── Headers, footers and notes ────────────────────────────────────────────────────────────

/** Adds a yellow highlight to existing run properties, in schema position. */
function withHighlight(rPrInner: string): string {
  const props = rPrInner.replace(/<w:highlight\b[^>]*\/>/g, '');
  const after =
    /<w:(?:u|effect|bdr|shd|fitText|vertAlign|rtl|cs|em|lang|eastAsianLayout|specVanish|oMath|rPrChange)[\s/>]/.exec(
      props,
    );
  const mark = '<w:highlight w:val="yellow"/>';
  return after ? props.slice(0, after.index) + mark + props.slice(after.index) : props + mark;
}

/** Innermost runs only (a run holding a text box holds runs of its own). */
const INNER_RUN = /<w:r(?:\s[^>]*)?>(?:(?!<w:r[\s>])(?!<\/w:r>)[\s\S])*<\/w:r>/g;

/** Fills `{{title}}` and `{{documentNumber}}` in a header or footer part, keeping run formatting. */
function fillHeaderFields(xml: string, content: DraftContent): string {
  const values: Record<string, string> = {
    [HEADER_FIELDS.title]: content.title.trim(),
    [HEADER_FIELDS.documentNumber]: content.documentNumber.trim(),
  };
  const tokens = Object.keys(values);
  if (!tokens.some((t) => xml.includes(t))) return xml;
  return xml.replace(INNER_RUN, (runXml) => {
    if (!tokens.some((t) => runXml.includes(t))) return runXml;
    const rPrInner = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(runXml)?.[1] ?? '';
    const text = [...runXml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
      .map((m) => unescapeXml(m[1] ?? ''))
      .join('');
    const filled = tokens.reduce((t, token) => t.split(token).join(values[token] ?? ''), text);
    return splitGaps(filled)
      .map((part) => run(part.text, part.gap ? withHighlight(rPrInner) : rPrInner))
      .join('');
  });
}

/** Footnotes and endnotes belonged to the old body; the separators stay. */
function dropNotes(xml: string, kind: 'footnote' | 'endnote'): string {
  const note = new RegExp(
    `<w:${kind}\\b(?![^>]*\\bw:type="(?:separator|continuationSeparator|continuationNotice)")[^>]*>[\\s\\S]*?</w:${kind}>`,
    'g',
  );
  return xml.replace(note, '');
}

// ─── Build ─────────────────────────────────────────────────────────────────────────────────

/**
 * The drafted content as a .docx: on `base` (a template or the letterhead) with only the
 * body's content replaced, or as a plain A4 document when `base` is null.
 */
export async function buildDocx(base: Buffer | null, content: DraftContent): Promise<Buffer> {
  const zip = base ? await JSZip.loadAsync(base) : blankDocx();
  const mainPart = await mainPartName(zip);
  const documentXml = await readPart(zip, mainPart);
  if (!documentXml) throw new Error('The Word template has no main document part.');

  const open = /<w:body(?:\s[^>]*)?>/.exec(documentXml);
  const close = documentXml.lastIndexOf('</w:body>');
  if (!open || close < open.index)
    throw new Error('The Word template has no document body to fill.');
  const bodyStart = open.index + open[0].length;
  const sectPr = chooseSectPr(documentXml.slice(bodyStart, close));

  const numberingName = await existingNumberingPart(zip, mainPart);
  const existingNumbering = numberingName ? await readPart(zip, numberingName) : null;
  const numbering = new Numbering(existingNumbering);
  const layout: Layout = { width: textWidth(sectPr), listNumId: (o) => numbering.numId(o) };

  let body = titleXml(content) + content.blocks.map((b) => blockXml(b, layout)).join('');
  // Word wants a paragraph as the body's last block before the section properties.
  if (!body.endsWith('</w:p>')) body += paragraph('');
  zip.file(mainPart, documentXml.slice(0, bodyStart) + body + sectPr + documentXml.slice(close));

  if (numbering.used) {
    const name = numberingName ?? (await addNumberingRelationship(zip, mainPart));
    zip.file(name, numbering.write(existingNumbering));
    await declareNumberingType(zip, name);
  }

  for (const name of Object.keys(zip.files)) {
    if (/^word\/(?:header|footer)\d*\.xml$/.test(name)) {
      const xml = await readPart(zip, name);
      if (xml) zip.file(name, fillHeaderFields(xml, content));
    }
  }
  for (const kind of ['footnote', 'endnote'] as const) {
    const name = `word/${kind}s.xml`;
    const xml = await readPart(zip, name);
    if (xml) zip.file(name, dropNotes(xml, kind));
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
