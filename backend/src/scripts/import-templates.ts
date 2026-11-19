import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { systemContext } from '../core/http/context';
import { createRuntime } from '../runtime';
import { importTemplateFolder } from '../modules/templates/import';
import { loadSampleTemplates } from '../modules/templates/service';

/**
 * Loads templates into COAL's library (docs/documents-and-signing.md#adding-a-template).
 *
 *   pnpm --filter @coal/backend templates:import            Jayon's forms in private/templates/
 *   pnpm --filter @coal/backend templates:import <folder>   forms in another folder
 *   pnpm --filter @coal/backend templates:import --samples  COAL's made-up sample templates
 *
 * A form is two files with the same name: `PID.docx` and `PID.spec.yaml`. Each is checked like an
 * upload, and saved as a draft: the VP or the R&D Head makes it active on the Templates page.
 */
const REPO_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

const args = process.argv.slice(2);
const runtime = await createRuntime();
const ctx = systemContext(runtime.deps.config.orgId, 'import');
let failed = false;

try {
  if (args.includes('--samples')) {
    const added = await loadSampleTemplates(runtime.deps, ctx);
    console.log(
      added.length > 0
        ? `Added and activated the sample templates for ${added.join(', ')}.`
        : 'Every document type that uses a template already has one.',
    );
  } else {
    const folder = resolve(
      args.find((a) => !a.startsWith('--')) ?? `${REPO_ROOT}/private/templates`,
    );
    const results = await importTemplateFolder(runtime.deps, ctx, folder);
    if (results.length === 0) console.log(`No *.spec.yaml files in ${folder}. Nothing to import.`);
    for (const result of results) {
      const [first, ...rest] = result.lines;
      console.log(`${result.ok ? '✓' : '✗'} ${result.name}: ${first}`);
      for (const line of rest) console.log(`    ${line}`);
      if (!result.ok) failed = true;
    }
  }
} finally {
  await runtime.pool.end();
}
process.exit(failed ? 1 : 0);
