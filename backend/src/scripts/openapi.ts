import { writeFile } from 'node:fs/promises';
import { buildApp } from '../app';
import { annotateOpenApi } from '../core/http/openapi';
import { createRuntime } from '../runtime';

// Writes the OpenAPI spec generated from the zod schemas in shared/ to backend/openapi.json.
const { deps, pool } = await createRuntime();
const app = await buildApp(deps);
const target = new URL('../../openapi.json', import.meta.url);
await writeFile(target, `${JSON.stringify(annotateOpenApi(app.swagger()), null, 2)}\n`);
await app.close();
await pool.end();
console.log(`Wrote ${target.pathname}`);
