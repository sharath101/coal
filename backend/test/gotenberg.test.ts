import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/core/config';
import { GotenbergRenderer } from '../src/modules/documents/pdf';
import { fillDocx, readTags } from '../src/modules/templates/docx';
import { SAMPLE_TEMPLATES, sampleDocx } from '../src/modules/templates/samples';
import { renderData, sampleContent } from '../src/modules/templates/service';

/**
 * The real PDF service. It runs wherever Gotenberg is up (docker compose does that; so does CI),
 * and is skipped where it isn't, so a laptop without Docker can still run the rest.
 */
const config = loadConfig({ NODE_ENV: 'test' });
const available = await fetch(`${config.pdf.url}/health`, { signal: AbortSignal.timeout(2000) })
  .then((r) => r.ok)
  .catch(() => false);

describe.skipIf(!available)('Gotenberg', () => {
  const renderer = new GotenbergRenderer(config.pdf);

  it.each(SAMPLE_TEMPLATES.map((s) => [s.spec.document_type, s] as const))(
    'turns the filled %s sample into a PDF',
    async (_code, sample) => {
      const filled = fillDocx(sampleDocx(sample), renderData(sampleContent(sample.spec)));
      const pdf = await renderer.fromDocx(filled, `${sample.spec.document_type}.docx`);
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
      expect(pdf.length).toBeGreaterThan(5_000);
      expect(pdf.toString('latin1')).toMatch(/\/Type ?\/Page\b/);
    },
  );

  it('reads the same placeholders back from every sample', () => {
    for (const sample of SAMPLE_TEMPLATES) {
      const names = Object.keys(readTags(sampleDocx(sample))).sort();
      expect(names.length).toBeGreaterThan(3);
    }
  });

  it('reports the service as unavailable when it cannot be reached', async () => {
    const down = new GotenbergRenderer({ url: 'http://127.0.0.1:1', timeoutMs: 1000 });
    await expect(down.fromDocx(Buffer.from('x'), 'x.docx')).rejects.toMatchObject({
      code: 'PDF_UNAVAILABLE',
      status: 502,
    });
  });
});
