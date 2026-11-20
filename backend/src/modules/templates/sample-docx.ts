import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
} from '@xmldom/xmldom';
import type PizZip from 'pizzip';
import type { Anchor, PrepareTemplateBody, SamplePart } from '@coal/shared';
import { openZip } from './docx';

/**
 * Reads a Word file as a numbered outline, and puts placeholders into it where the AI says the
 * sample's example text belongs to a field or a written section
 * (docs/workstation-and-ai.md#making-a-template-from-a-sample-document). The AI decides what each
 * part is; this code does the editing, in the person's own file, so the layout stays.
 */

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

/** How much of one part the AI is shown. */
const MAX_PART_CHARS = 400;
/** The most parts one outline lists, so a long manual cannot fill the model's context. */
export const MAX_PARTS = 600;

type El = XmlElement;
type Doc = XmlDocument;

interface Part {
  name: string;
  doc: Doc;
}

interface Para {
  id: string;
  part: Part;
  el: El;
  text: string;
  where: string;
}

export interface DocxIndex {
  zip: PizZip;
  parts: Part[];
  paras: Para[];
  byId: Map<string, Para>;
  /** Set when the file has more parts than the outline lists. */
  cut: boolean;
}

const local = (node: { localName?: string | null }) => node.localName ?? '';
const children = (el: El): El[] =>
  Array.from(el.childNodes as unknown as ArrayLike<El>).filter((n) => n.nodeType === 1);

function wElements(root: El | Doc, name: string): El[] {
  return Array.from<El>((root as Doc).getElementsByTagNameNS(W, name) as unknown as ArrayLike<El>);
}

function closest(el: El, name: string): El | null {
  for (let node = el.parentNode as El | null; node; node = node.parentNode as El | null) {
    if (node.nodeType === 1 && local(node) === name && node.namespaceURI === W) return node;
  }
  return null;
}

/** The runs that belong to this paragraph itself, not to a text box inside it. */
const ownRuns = (p: El): El[] => wElements(p, 'r').filter((r) => closest(r, 'p') === p);

function runText(r: El): string {
  let out = '';
  for (const child of children(r)) {
    const name = local(child);
    if (name === 't') out += child.textContent ?? '';
    else if (name === 'tab') out += '\t';
    else if (name === 'br' || name === 'cr') out += '\n';
    else if (name === 'noBreakHyphen') out += '-';
  }
  return out;
}

const paraText = (p: El): string => ownRuns(p).map(runText).join('');

function setRunText(doc: Doc, r: El, text: string): void {
  for (const child of children(r)) {
    if (['t', 'tab', 'br', 'cr', 'noBreakHyphen'].includes(local(child))) r.removeChild(child);
  }
  if (text === '') return;
  const t = doc.createElementNS(W, 'w:t');
  t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  t.appendChild(doc.createTextNode(text));
  r.appendChild(t);
}

function newRun(doc: Doc, text: string, like?: El): El {
  const r = doc.createElementNS(W, 'w:r');
  const props = like && children(like).find((c) => local(c) === 'rPr');
  if (props) r.appendChild(props.cloneNode(true));
  setRunText(doc, r, text);
  return r;
}

function parse(xml: string): Doc {
  return new DOMParser({
    onError: () => {
      throw new Error('The Word file has damaged content.');
    },
  }).parseFromString(xml, 'text/xml');
}

/** The parts of the file that hold text, in reading order: the body, then headers, then footers. */
function textParts(zip: PizZip): Part[] {
  const names = Object.keys(zip.files);
  const ordered = [
    ...names.filter((n) => n === 'word/document.xml'),
    ...names.filter((n) => /^word\/header\d*\.xml$/.test(n)).sort(),
    ...names.filter((n) => /^word\/footer\d*\.xml$/.test(n)).sort(),
  ];
  return ordered.map((name) => ({ name, doc: parse(zip.file(name)?.asText() ?? '') }));
}

function whereOf(p: El, part: Part, tables: El[]): string {
  if (part.name.includes('/header')) return 'header';
  if (part.name.includes('/footer')) return 'footer';
  const cell = closest(p, 'tc');
  if (!cell) return 'body';
  const row = closest(cell, 'tr');
  const table = row && closest(row, 'tbl');
  if (!row || !table) return 'body';
  const column =
    children(row)
      .filter((c) => local(c) === 'tc')
      .indexOf(cell) + 1;
  const rowNo =
    children(table)
      .filter((c) => local(c) === 'tr')
      .indexOf(row) + 1;
  return `table ${tables.indexOf(table) + 1}, row ${rowNo}, column ${column}`;
}

/** Numbers the parts worth showing: words, and the blank cells of tables, where a field may go. */
export function indexDocx(docx: Buffer): DocxIndex {
  const zip = openZip(docx);
  const parts = textParts(zip);
  const paras: Para[] = [];
  const byId = new Map<string, Para>();
  let cut = false;
  for (const part of parts) {
    const tables = wElements(part.doc, 'tbl');
    const seenBlankCell = new Set<El>();
    for (const el of wElements(part.doc, 'p')) {
      const text = paraText(el);
      const blank = text.trim() === '';
      if (blank) {
        const cell = closest(el, 'tc');
        // A blank line in the body is nothing; the first blank paragraph of a cell is a place for a value.
        if (!cell || seenBlankCell.has(cell) || closest(el, 'p')) continue;
        if (children(cell).some((c) => local(c) === 'p' && paraText(c).trim() !== '')) continue;
        seenBlankCell.add(cell);
      }
      if (paras.length >= MAX_PARTS) {
        cut = true;
        continue;
      }
      const para: Para = {
        id: `p${paras.length + 1}`,
        part,
        el,
        text,
        where: whereOf(el, part, tables),
      };
      paras.push(para);
      byId.set(para.id, para);
    }
  }
  return { zip, parts, paras, byId, cut };
}

function styleOf(p: El): string {
  const props = children(p).find((c) => local(c) === 'pPr');
  const style = props && children(props).find((c) => local(c) === 'pStyle');
  const value = style?.getAttributeNS(W, 'val') ?? style?.getAttribute('w:val') ?? '';
  return /heading|title/i.test(value) ? value.replace(/([a-z])(\d)/i, '$1 $2').toLowerCase() : '';
}

function isBold(p: El): boolean {
  const runs = ownRuns(p).filter((r) => runText(r).trim() !== '');
  return (
    runs.length > 0 &&
    runs.every((r) => {
      const props = children(r).find((c) => local(c) === 'rPr');
      const bold = props && children(props).find((c) => local(c) === 'b');
      return !!bold && (bold.getAttributeNS(W, 'val') ?? bold.getAttribute('w:val')) !== '0';
    })
  );
}

/** What the AI is shown: each part with its number, words and place. */
export function outlineOf(index: DocxIndex): { parts: SamplePart[]; notes: string[] } {
  const parts = index.paras.map((para): SamplePart => {
    const text = para.text.replace(/\u00a0/g, ' ');
    return {
      id: para.id,
      text:
        text.length > MAX_PART_CHARS
          ? `${text.slice(0, MAX_PART_CHARS)}… (${text.length - MAX_PART_CHARS} more characters)`
          : text,
      where: para.where,
      style: styleOf(para.el),
      bold: isBold(para.el),
    };
  });
  const notes = index.cut
    ? [`The file is long: the outline stops at ${MAX_PARTS} parts, so the rest cannot be used.`]
    : [];
  return { parts, notes };
}

// Editing

/** Replaces the characters from `start` to `end` of a paragraph, whatever runs they are split into. */
function replaceRange(part: Part, p: El, start: number, end: number, replacement: string): void {
  const runs = ownRuns(p);
  if (runs.length === 0) {
    p.appendChild(newRun(part.doc, replacement));
    return;
  }
  let position = 0;
  let placed = false;
  for (const run of runs) {
    const text = runText(run);
    const from = position;
    const to = position + text.length;
    position = to;
    const overlaps = start < to && end > from;
    const inserts = start === end && start >= from && start <= to;
    if (!placed && (overlaps || inserts)) {
      setRunText(
        part.doc,
        run,
        text.slice(0, Math.max(0, start - from)) +
          replacement +
          (end <= to ? text.slice(end - from) : ''),
      );
      placed = true;
    } else if (placed && overlaps) {
      setRunText(part.doc, run, end < to ? text.slice(end - from) : '');
    }
  }
  if (!placed) p.appendChild(newRun(part.doc, replacement, runs.at(-1)));
}

function putField(para: Para, name: string, anchor: Anchor, problems: string[]): void {
  const text = para.text;
  let start = 0;
  let end = text.length;
  if (anchor.text) {
    start = text.indexOf(anchor.text);
    if (start < 0) {
      problems.push(
        `${para.id} does not contain "${anchor.text}", so {${name}} could not go there.`,
      );
      return;
    }
    end = start + anchor.text.length;
  }
  const tag = `{${name}}`;
  if (anchor.mode === 'append') {
    const spaced = end > 0 && !/\s$/.test(text.slice(0, end)) ? ` ${tag}` : tag;
    replaceRange(para.part, para.el, end, end, spaced);
  } else {
    replaceRange(para.part, para.el, start, end, tag);
  }
  para.text = paraText(para.el);
}

function paragraph(index: DocxIndex, id: string, problems: string[]): Para | null {
  const para = index.byId.get(id);
  if (!para) problems.push(`There is no part ${id} in the sample.`);
  return para ?? null;
}

function putWritten(
  index: DocxIndex,
  section: Extract<PrepareTemplateBody['sections'][number], { kind: 'written' }>,
  problems: string[],
): void {
  const tag = `{${section.id}}`;
  if (section.replace) {
    const first = paragraph(index, section.replace.from, problems);
    const last = section.replace.to ? paragraph(index, section.replace.to, problems) : first;
    if (!first || !last) return;
    const parent = first.el.parentNode as El | null;
    if (!parent || last.el.parentNode !== parent) {
      problems.push(
        `${section.replace.from} and ${section.replace.to} are not in the same place (for example one is in a table), so they cannot become one section.`,
      );
      return;
    }
    const siblings = children(parent);
    const a = siblings.indexOf(first.el);
    const b = siblings.indexOf(last.el);
    if (a < 0 || b < a) {
      problems.push(`${section.replace.from} must come before ${section.replace.to}.`);
      return;
    }
    const covered = siblings.slice(a, b + 1);
    if (covered.some((n) => local(n) !== 'p')) {
      problems.push(
        `Between ${section.replace.from} and ${section.replace.to} there is a table or another block. Name a smaller range for "${section.id}".`,
      );
      return;
    }
    const firstRun = ownRuns(first.el)[0];
    for (const child of children(first.el)) {
      if (local(child) !== 'pPr') first.el.removeChild(child);
    }
    first.el.appendChild(newRun(first.part.doc, tag, firstRun));
    for (const extra of covered.slice(1)) parent.removeChild(extra);
    first.text = tag;
    return;
  }
  const after = section.after ? paragraph(index, section.after, problems) : null;
  if (!after) {
    if (!section.after)
      problems.push(`Say where "${section.id}" goes: replace some parts, or go after one.`);
    return;
  }
  const doc = after.part.doc;
  const p = doc.createElementNS(W, 'w:p');
  p.appendChild(newRun(doc, tag, ownRuns(after.el)[0]));
  const parent = after.el.parentNode as El;
  parent.insertBefore(p, after.el.nextSibling);
}

function putLoop(
  index: DocxIndex,
  name: string,
  cells: Record<string, string>,
  problems: string[],
): void {
  const entries = Object.entries(cells).map(([column, id]) => ({
    column,
    para: paragraph(index, id, problems),
  }));
  if (entries.some((e) => !e.para)) return;
  const located = entries.map((e) => ({
    column: e.column,
    para: e.para as Para,
    cell: closest((e.para as Para).el, 'tc'),
  }));
  if (located.some((l) => !l.cell)) {
    problems.push(`The cells of {${name}} must be in a table.`);
    return;
  }
  const row = closest(located[0]?.cell as El, 'tr');
  if (!row || located.some((l) => closest(l.cell as El, 'tr') !== row)) {
    problems.push(`The cells of {${name}} must all be in one row of one table.`);
    return;
  }
  const rowCells = children(row).filter((c) => local(c) === 'tc');
  const byCell = new Map(located.map((l) => [l.cell as El, l]));
  rowCells.forEach((cell, i) => {
    const found = byCell.get(cell);
    const paras = children(cell).filter((c) => local(c) === 'p');
    const first = paras[0] as El;
    const doc = (found?.para.part ?? located[0]?.para.part)?.doc as Doc;
    let text = found ? `{${found.column}}` : '';
    if (i === 0) text = `{#${name}}${text}`;
    if (i === rowCells.length - 1) text = `${text}{/${name}}`;
    for (const extra of paras.slice(1)) cell.removeChild(extra);
    const like = ownRuns(first)[0];
    for (const child of children(first)) if (local(child) !== 'pPr') first.removeChild(child);
    if (text) first.appendChild(newRun(doc, text, like));
  });
}

function dropRow(index: DocxIndex, id: string, problems: string[]): void {
  const para = paragraph(index, id, problems);
  const row = para && closest(para.el, 'tr');
  if (!para || !row) {
    if (para) problems.push(`${id} is not in a table row.`);
    return;
  }
  const parent = row.parentNode as El | null;
  if (!parent) return;
  if (children(parent).filter((c) => local(c) === 'tr').length <= 1) {
    problems.push(`${id} is in the only row of its table, which cannot be taken out.`);
    return;
  }
  parent.removeChild(row);
}

function dropPart(index: DocxIndex, id: string, problems: string[]): void {
  const para = paragraph(index, id, problems);
  if (!para) return;
  const parent = para.el.parentNode as El | null;
  if (!parent) return;
  const alone =
    local(parent) === 'tc' && children(parent).filter((c) => local(c) === 'p').length === 1;
  if (alone) {
    for (const child of children(para.el)) if (local(child) !== 'pPr') para.el.removeChild(child);
  } else {
    parent.removeChild(para.el);
  }
}

/**
 * Puts the placeholders into the sample, as the plan says, and returns the new file. Any part the
 * plan names that is not there, or text that cannot be found, is a problem for the AI to fix.
 */
export function applyPlan(
  docx: Buffer,
  plan: Pick<PrepareTemplateBody, 'sections' | 'dropParts' | 'dropRows'>,
): { docx: Buffer; problems: string[] } {
  const index = indexDocx(docx);
  const problems: string[] = [];
  for (const section of plan.sections) {
    if (section.kind !== 'fields') continue;
    for (const [name, field] of Object.entries(section.fields)) {
      if (field.from === 'project.team') {
        if (!field.cells || Object.keys(field.cells).length === 0) {
          problems.push(
            `{${name}} is the team table: say which cell of a filled row holds each column.`,
          );
        } else putLoop(index, name, field.cells, problems);
        continue;
      }
      if (field.at.length === 0) {
        problems.push(`Say where {${name}} goes in the sample (a part, and the words to replace).`);
      }
      for (const anchor of field.at) {
        const para = paragraph(index, anchor.part, problems);
        if (para) putField(para, name, anchor, problems);
      }
    }
  }
  for (const section of plan.sections) {
    if (section.kind === 'written') putWritten(index, section, problems);
  }
  for (const id of plan.dropRows) dropRow(index, id, problems);
  for (const id of plan.dropParts) dropPart(index, id, problems);
  if (problems.length > 0) return { docx, problems };

  const serializer = new XMLSerializer();
  for (const part of index.parts) index.zip.file(part.name, serializer.serializeToString(part.doc));
  return {
    docx: index.zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }),
    problems,
  };
}
