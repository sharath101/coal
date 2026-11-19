import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { DraftContent } from './content';
import { toPdf } from './convert';
import { buildDocx } from './docx';

const draft = (over: Partial<DraftContent> = {}): DraftContent => ({
  title: 'Example Plan',
  documentNumber: 'EX/F-01',
  blocks: [{ type: 'paragraph', text: 'New body text for the example plan.' }],
  gaps: [],
  ...over,
});

const bodyOf = (documentXml: string) => /<w:body>([\s\S]*)<\/w:body>/.exec(documentXml)?.[1] ?? '';

describe('buildDocx on a template', () => {
  it('replaces only the body and keeps header, images, styles and page setup', async () => {
    const out = await buildDocx(await fakeTemplate(), draft());
    const parts = await readParts(out);
    const doc = parts.get('word/document.xml')!;

    expect(doc).not.toContain('Old body text');
    expect(doc).not.toContain('Old table cell');
    expect(doc).toContain('Example Plan');
    expect(doc).toContain('Document No.: EX/F-01');
    expect(doc).toContain('New body text for the example plan.');
    // The section properties stay last in the body, with the header reference and margins.
    expect(bodyOf(doc)).toMatch(
      /<w:sectPr><w:headerReference w:type="default" r:id="rId5"\/><w:pgSz w:w="11906" w:h="16838"\/><w:pgMar [^>]*w:left="1000"[^>]*\/>.*<\/w:sectPr>$/,
    );

    expect(parts.get('word/header1.xml')).toContain('Example Works Ltd');
    expect(parts.get('word/_rels/header1.xml.rels')).toContain('media/logo.png');
    expect(parts.get('word/styles.xml')).toBe(FAKE_STYLES);
    const zip = await JSZip.loadAsync(out);
    expect(await zip.file('word/media/logo.png')!.async('nodebuffer')).toEqual(FAKE_LOGO);

    // The old body's footnote goes; the separators stay.
    const notes = parts.get('word/footnotes.xml')!;
    expect(notes).not.toContain('Old footnote');
    expect(notes).toContain('w:type="separator"');
    expect(notes).toContain('w:type="continuationSeparator"');

    for (const [name, xml] of parts) expectWellFormed(xml, name);
  });

  it('fills the title and document number into the header, keeping the run formatting', async () => {
    const out = await buildDocx(
      await fakeTemplate(),
      draft({ title: 'Bracket & Plate Check', documentNumber: '[[to fill: form number]]' }),
    );
    const headerXml = (await readParts(out)).get('word/header1.xml')!;
    expect(headerXml).not.toContain('{{');
    expect(headerXml).toContain(
      '<w:r><w:rPr><w:b/><w:sz w:val="20"/><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">Bracket &amp; Plate Check</w:t></w:r>',
    );
    // A gap in the header is highlighted, the highlight placed before <w:u> as the schema wants.
    expect(headerXml).toContain(
      '<w:r><w:rPr><w:b/><w:highlight w:val="yellow"/></w:rPr><w:t xml:space="preserve">[[to fill: form number]]</w:t></w:r>',
    );
    expectWellFormed(headerXml);
  });

  it('highlights each gap yellow and nothing else', async () => {
    const out = await buildDocx(
      await fakeTemplate(),
      draft({
        documentNumber: '',
        blocks: [
          {
            type: 'paragraph',
            text: 'Measure [[to fill: batch size]] parts from lot [[to fill: lot]].',
          },
          { type: 'fields', items: [{ label: 'Date', value: '[[to fill: date]]' }] },
        ],
        gaps: ['batch size', 'lot', 'date'],
      }),
    );
    const doc = (await readParts(out)).get('word/document.xml')!;
    const highlighted = [
      ...doc.matchAll(
        /<w:r><w:rPr>(?:(?!<\/w:r>).)*?<w:highlight w:val="yellow"\/><\/w:rPr><w:t xml:space="preserve">([^<]*)<\/w:t><\/w:r>/g,
      ),
    ].map((m) => m[1]);
    expect(highlighted).toEqual([
      '[[to fill: batch size]]',
      '[[to fill: lot]]',
      '[[to fill: date]]',
    ]);
    expect(doc.match(/<w:highlight /g)).toHaveLength(3);
    expect(doc).toContain('<w:t xml:space="preserve">Measure </w:t>');
    expect(doc).not.toContain('Document No.');
  });

  it('escapes XML and drops characters XML cannot hold', async () => {
    const nasty = `Rods & Plates <v2> "A" 'B' </w:t></w:r><w:r><w:t>injected\u0001\u0008`;
    const out = await buildDocx(
      await fakeTemplate(),
      draft({
        title: nasty,
        blocks: [
          { type: 'paragraph', text: nasty },
          { type: 'table', header: ['<Name>'], rows: [[nasty]] },
          { type: 'list', ordered: false, items: [nasty] },
          { type: 'signatures', rows: [{ role: 'A & B', name: '<C>' }] },
        ],
      }),
    );
    const parts = await readParts(out);
    const doc = parts.get('word/document.xml')!;
    expect(doc).toContain(
      'Rods &amp; Plates &lt;v2&gt; &quot;A&quot; &apos;B&apos; &lt;/w:t&gt;&lt;/w:r&gt;&lt;w:r&gt;&lt;w:t&gt;injected',
    );
    expect(doc).not.toContain('<w:t>injected');
    expect(doc).not.toContain('\u0001');
    expect(doc).not.toContain('\u0008');
    expect(doc).toContain('&lt;Name&gt;');
    for (const [name, xml] of parts) expectWellFormed(xml, name);
  });

  it('lays out headings, fields, tables, lists and signatures', async () => {
    const out = await buildDocx(
      await fakeTemplate({ numbering: true }),
      draft({
        blocks: [
          { type: 'heading', level: '1', text: 'Purpose' },
          { type: 'heading', level: '3', text: 'Detail' },
          { type: 'fields', items: [{ label: 'Part', value: 'Example bracket' }] },
          {
            type: 'table',
            header: ['No.', 'Check'],
            rows: [
              ['1', 'Length'],
              ['2', 'Width', 'extra'],
            ],
          },
          { type: 'list', ordered: true, items: ['First', 'Second'] },
          { type: 'list', ordered: true, items: ['Again one'] },
          { type: 'list', ordered: false, items: ['Dot'] },
          { type: 'list', ordered: false, items: ['Dot again'] },
          { type: 'signatures', rows: [{ role: 'Prepared by', name: 'A. Example' }] },
        ],
      }),
    );
    const parts = await readParts(out);
    const doc = parts.get('word/document.xml')!;

    // Headings: direct bold formatting and an outline level.
    expect(doc).toMatch(
      /<w:outlineLvl w:val="0"\/><\/w:pPr><w:r><w:rPr><w:b\/><w:bCs\/><w:sz w:val="28"\/>.*?Purpose/,
    );
    expect(doc).toMatch(
      /<w:outlineLvl w:val="2"\/><\/w:pPr><w:r><w:rPr><w:b\/><w:bCs\/><w:sz w:val="22"\/>.*?Detail/,
    );

    // Bordered tables; the ragged row gets a third column; header rows repeat.
    const tables = doc.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g)!;
    expect(tables).toHaveLength(3);
    for (const t of tables) expect(t).toContain('<w:insideV w:val="single"');
    expect(tables[1]!.match(/<w:gridCol /g)).toHaveLength(3);
    expect(tables[1]).toContain('<w:tblHeader/>');
    const signatureHeader = [...tables[2]!.matchAll(/<w:t xml:space="preserve">([^<]*)<\/w:t>/g)]
      .map((m) => m[1])
      .slice(0, 4);
    expect(signatureHeader).toEqual(['Role', 'Name', 'Signature', 'Date']);
    // Table widths add up to the text width (11906 - 2 x 1000).
    for (const t of tables) {
      const cols = [...t.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((m) => Number(m[1]));
      expect(cols.reduce((a, b) => a + b, 0)).toBe(9906);
    }

    // Lists use new numbering definitions after the template's own; each numbered list restarts.
    const numIds = [...doc.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => Number(m[1]));
    expect(numIds).toEqual([2, 2, 3, 4, 4]);
    const numbering = parts.get('word/numbering.xml')!;
    expect(numbering).toContain('<w:abstractNum w:abstractNumId="0">');
    expect(numbering).toContain('<w:abstractNum w:abstractNumId="1">');
    expect(numbering).toContain('<w:abstractNum w:abstractNumId="2">');
    expect(numbering.lastIndexOf('<w:abstractNum ')).toBeLessThan(numbering.indexOf('<w:num '));
    expect(numbering).toMatch(/<w:num w:numId="2"><w:abstractNumId w:val="2"\/><w:lvlOverride/);
    expect(numbering).toMatch(/<w:num w:numId="3"><w:abstractNumId w:val="2"\/><w:lvlOverride/);
    expect(numbering).toContain('<w:num w:numId="4"><w:abstractNumId w:val="1"/></w:num>');

    for (const [name, xml] of parts) expectWellFormed(xml, name);
  });

  it("uses a multi-section template's first section and drops a cover-page flag", async () => {
    const two = (
      await readParts(await buildDocx(await fakeTemplate({ sections: 'two' }), draft()))
    ).get('word/document.xml')!;
    const sect = bodyOf(two).match(/<w:sectPr[\s\S]*<\/w:sectPr>/g)!;
    expect(sect).toHaveLength(1);
    expect(sect[0]).toContain('r:id="rId5"');
    expect(sect[0]).not.toContain('landscape');
    expect(sect[0]).not.toContain('<w:type');
    expect(two).not.toContain('Old annex text');

    const cover = (
      await readParts(await buildDocx(await fakeTemplate({ coverPage: true }), draft()))
    ).get('word/document.xml')!;
    expect(cover).not.toContain('<w:titlePg');
    expect(cover).not.toContain('w:start="0"');
  });
});

describe('buildDocx without a base', () => {
  it('makes a complete minimal document', async () => {
    const out = await buildDocx(null, draft());
    const parts = await readParts(out);
    expect([...parts.keys()].sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/_rels/document.xml.rels',
      'word/document.xml',
      'word/settings.xml',
      'word/styles.xml',
    ]);
    expect(parts.get('word/document.xml')).toMatch(/<w:pgSz w:w="11906" w:h="16838"\/>/);
    for (const [name, xml] of parts) expectWellFormed(xml, name);
  });

  it('adds a numbering part, its relationship and content type for lists', async () => {
    const out = await buildDocx(
      null,
      draft({ blocks: [{ type: 'list', ordered: false, items: ['One', 'Two'] }] }),
    );
    const parts = await readParts(out);
    expect(parts.get('word/numbering.xml')).toContain('<w:numFmt w:val="bullet"/>');
    expect(parts.get('word/_rels/document.xml.rels')).toContain('Target="numbering.xml"');
    expect(parts.get('[Content_Types].xml')).toContain('PartName="/word/numbering.xml"');
    for (const [name, xml] of parts) expectWellFormed(xml, name);
  });
});

const gotenbergUp = await fetch(`${process.env.GOTENBERG_URL || 'http://localhost:3100'}/health`, {
  signal: AbortSignal.timeout(1500),
})
  .then((r) => r.ok)
  .catch(() => false);

describe.skipIf(!gotenbergUp)('LibreOffice (Gotenberg running)', () => {
  it('opens the built files and converts them to PDF', async () => {
    const content = draft({
      blocks: [
        { type: 'heading', level: '1', text: 'Checks' },
        { type: 'table', header: ['No.', 'Check'], rows: [['1', '[[to fill: check]]']] },
        { type: 'list', ordered: true, items: ['One'] },
        { type: 'signatures', rows: [{ role: 'Approved by', name: '' }] },
      ],
    });
    for (const base of [null, await fakeTemplate({ numbering: true })]) {
      const pdf = await toPdf(await buildDocx(base, content), 'example.docx');
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    }
  });
});

// ─── A made-up Word template, built in memory ──────────────────────────────────────────────

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

const FAKE_LOGO = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const FAKE_STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W_NS}">` +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
  '<w:pPr><w:jc w:val="both"/></w:pPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="ExampleBody"><w:name w:val="Example Body"/></w:style>' +
  '</w:styles>';

interface FakeTemplateOptions {
  /** 'two': a portrait first section (header1) then a landscape one (header2). */
  sections?: 'one' | 'two';
  /** Include a numbering part with one list definition. */
  numbering?: boolean;
  /** Mark the section as having a cover page (titlePg, numbering from 0). */
  coverPage?: boolean;
}

const sectPr = (headerRid: string, extra: string, landscape = false) =>
  `<w:sectPr><w:headerReference w:type="default" r:id="${headerRid}"/>` +
  (landscape
    ? '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>'
    : '<w:pgSz w:w="11906" w:h="16838"/>') +
  '<w:pgMar w:top="1440" w:right="1000" w:bottom="1440" w:left="1000" w:header="700" w:footer="700" w:gutter="0"/>' +
  `${extra}<w:cols w:space="708"/></w:sectPr>`;

const header = (label: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="${W_NS}" xmlns:r="${R_NS}">` +
  `<w:p><w:r><w:t>Example Works Ltd</w:t></w:r><w:r><w:t xml:space="preserve"> ${label}</w:t></w:r></w:p>` +
  '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="5000"/></w:tblGrid>' +
  '<w:tr><w:tc><w:p><w:r><w:t>TITLE</w:t></w:r></w:p></w:tc>' +
  '<w:tc><w:p><w:r><w:rPr><w:b/><w:sz w:val="20"/><w:u w:val="single"/></w:rPr><w:t>{{title}}</w:t></w:r></w:p></w:tc></w:tr>' +
  '<w:tr><w:tc><w:p><w:r><w:t>FORM NO.</w:t></w:r></w:p></w:tc>' +
  '<w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>{{documentNumber}}</w:t></w:r></w:p></w:tc></w:tr>' +
  '</w:tbl></w:hdr>';

/** A small made-up .docx with a header (and its image), styles, footnotes and a body. */
async function fakeTemplate(options: FakeTemplateOptions = {}): Promise<Buffer> {
  const zip = new JSZip();
  const two = options.sections === 'two';
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' +
      `<Override PartName="/word/document.xml" ContentType="${CT}.document.main+xml"/>` +
      `<Override PartName="/word/styles.xml" ContentType="${CT}.styles+xml"/>` +
      `<Override PartName="/word/header1.xml" ContentType="${CT}.header+xml"/>` +
      `<Override PartName="/word/header2.xml" ContentType="${CT}.header+xml"/>` +
      `<Override PartName="/word/footnotes.xml" ContentType="${CT}.footnotes+xml"/>` +
      (options.numbering
        ? `<Override PartName="/word/numbering.xml" ContentType="${CT}.numbering+xml"/>`
        : '') +
      '</Types>',
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL}">` +
      `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL}">` +
      `<Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/>` +
      `<Relationship Id="rId5" Type="${REL}/header" Target="header1.xml"/>` +
      `<Relationship Id="rId6" Type="${REL}/header" Target="header2.xml"/>` +
      `<Relationship Id="rId8" Type="${REL}/footnotes" Target="footnotes.xml"/>` +
      (options.numbering
        ? `<Relationship Id="rId7" Type="${REL}/numbering" Target="numbering.xml"/>`
        : '') +
      '</Relationships>',
  );
  const cover = options.coverPage ? '<w:pgNumType w:start="0"/><w:titlePg/>' : '';
  const oldBody =
    '<w:p><w:r><w:t>Old body text of the example form</w:t></w:r>' +
    '<w:r><w:footnoteReference w:id="1"/></w:r></w:p>' +
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>' +
    '<w:tr><w:tc><w:p><w:r><w:t>Old table cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  const body = two
    ? `${oldBody}<w:p><w:pPr>${sectPr('rId5', '<w:type w:val="nextPage"/>')}</w:pPr></w:p>` +
      `<w:p><w:r><w:t>Old annex text</w:t></w:r></w:p>${sectPr('rId6', '', true)}`
    : `${oldBody}${sectPr('rId5', cover)}`;
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}">` +
      `<w:body>${body}</w:body></w:document>`,
  );
  zip.file('word/styles.xml', FAKE_STYLES);
  zip.file('word/header1.xml', header('first section'));
  zip.file('word/header2.xml', header('annex'));
  for (const n of [1, 2])
    zip.file(
      `word/_rels/header${n}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL}">` +
        `<Relationship Id="rId1" Type="${REL}/image" Target="media/logo.png"/></Relationships>`,
    );
  zip.file('word/media/logo.png', FAKE_LOGO);
  zip.file(
    'word/footnotes.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes xmlns:w="${W_NS}">` +
      '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
      '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
      '<w:footnote w:id="1"><w:p><w:r><w:t>Old footnote</w:t></w:r></w:p></w:footnote>' +
      '</w:footnotes>',
  );
  if (options.numbering)
    zip.file(
      'word/numbering.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${W_NS}">` +
        '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>' +
        '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1)"/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum>' +
        '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
    );
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function readParts(docx: Buffer): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(docx);
  const parts = new Map<string, string>();
  for (const name of Object.keys(zip.files)) {
    const file = zip.file(name);
    if (file && /\.(xml|rels)$/.test(name)) parts.set(name, await file.async('string'));
  }
  return parts;
}

/** Checks tags balance and text holds no unescaped markup characters. */
function expectWellFormed(xml: string, part = 'xml'): void {
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, '');
  const stack: string[] = [];
  const token =
    /<!--[\s\S]*?-->|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/g;
  let last = 0;
  for (const match of body.matchAll(token)) {
    const text = body.slice(last, match.index);
    expect(text, `text in ${part}`).not.toMatch(
      /[<>]|&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/,
    );
    last = match.index + match[0].length;
    const [, closing, name, , selfClosing] = match;
    if (!name) continue;
    if (closing) expect(stack.pop(), `closing </${name}> in ${part}`).toBe(name);
    else if (!selfClosing) stack.push(name);
  }
  expect(body.slice(last).trim(), `trailing text in ${part}`).toBe('');
  expect(stack, `unclosed tags in ${part}`).toEqual([]);
}
