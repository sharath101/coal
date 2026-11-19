import PizZip from 'pizzip';
import {
  FIELD_SOURCES,
  TABLE_COLUMNS,
  fieldLabel,
  readable,
  specTitle,
  type TemplateSpec,
} from '@coal/shared';

/**
 * Builds plain Word files in code: the made-up sample templates, and the layout of COAL's own
 * records (the step sign-off record). Jayon's real templates are their own Word files.
 */
export type Block =
  | { type: 'title'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string }
  | { type: 'rows'; rows: [label: string, text: string][] }
  | { type: 'loop'; name: string; columns: { header: string; tag: string }[] };

const esc = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const run = (text: string, props = '') =>
  `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;

const para = (text: string, style?: string, runProps = '') =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${run(text, runProps)}</w:p>`;

const cell = (inner: string, width: number, shade = false) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${
    shade ? '<w:shd w:val="clear" w:color="auto" w:fill="EEF1F5"/>' : ''
  }</w:tcPr>${inner}</w:tc>`;

const table = (rows: string[]) =>
  `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="9000" w:type="dxa"/></w:tblPr>${rows.join('')}</w:tbl><w:p/>`;

function blockXml(block: Block): string {
  switch (block.type) {
    case 'title':
      return para(block.text, 'Title');
    case 'heading':
      return para(block.text, 'Heading1');
    case 'text':
      return para(block.text);
    case 'rows':
      return table(
        block.rows.map(
          ([label, text]) =>
            `<w:tr>${cell(para(label, undefined, '<w:b/>'), 3000, true)}${cell(para(text), 6000)}</w:tr>`,
        ),
      );
    case 'loop': {
      const width = Math.floor(9000 / block.columns.length);
      const header = `<w:tr>${block.columns.map((c) => cell(para(c.header, undefined, '<w:b/>'), width, true)).join('')}</w:tr>`;
      const last = block.columns.length - 1;
      const body = `<w:tr>${block.columns
        .map((c, i) =>
          cell(
            para(
              `${i === 0 ? `{#${block.name}}` : ''}{${c.tag}}${i === last ? `{/${block.name}}` : ''}`,
            ),
            width,
          ),
        )
        .join('')}</w:tr>`;
      return table([header, body]);
    }
  }
}

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const STYLES = `${XML}<w:styles ${NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="9AA3AF"/><w:left w:val="single" w:sz="4" w:space="0" w:color="9AA3AF"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="9AA3AF"/><w:right w:val="single" w:sz="4" w:space="0" w:color="9AA3AF"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="9AA3AF"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="9AA3AF"/></w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

export function buildDocx(blocks: Block[], footer: string): Buffer {
  const zip = new PizZip();
  zip.file(
    '[Content_Types].xml',
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`,
  );
  zip.file(
    '_rels/.rels',
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`,
  );
  zip.file('word/styles.xml', STYLES);
  zip.file(
    'word/footer1.xml',
    `${XML}<w:ftr ${NS}><w:p><w:pPr><w:jc w:val="center"/></w:pPr>${run(footer, '<w:color w:val="6B7280"/><w:sz w:val="16"/>')}</w:p></w:ftr>`,
  );
  zip.file(
    'word/document.xml',
    `${XML}<w:document ${NS}><w:body>${blocks.map(blockXml).join('')}<w:sectPr><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1300" w:right="1300" w:bottom="1300" w:left="1300" w:header="700" w:footer="700" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** The layout of a specification: its fields as a two-column form, its written sections as headings. */
export function blocksFromSpec(spec: TemplateSpec, intro?: string): Block[] {
  const blocks: Block[] = [{ type: 'title', text: spec.template }];
  if (intro) blocks.push({ type: 'text', text: intro });
  for (const section of spec.sections) {
    blocks.push({ type: 'heading', text: specTitle(section) });
    if (section.kind === 'written') {
      blocks.push({ type: 'text', text: `{${section.id}}` });
      continue;
    }
    const rows: [string, string][] = [];
    for (const [name, field] of Object.entries(section.fields)) {
      if (FIELD_SOURCES[field.from] === 'table') {
        if (rows.length) blocks.push({ type: 'rows', rows: rows.splice(0) });
        const columns = TABLE_COLUMNS[field.from] ?? [];
        blocks.push({
          type: 'loop',
          name,
          columns: columns.map((tag) => ({ header: readable(tag), tag })),
        });
      } else {
        rows.push([fieldLabel(name, field), `{${name}}`]);
      }
    }
    if (rows.length) blocks.push({ type: 'rows', rows });
  }
  return blocks;
}
