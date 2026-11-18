// COAL's own lint rules. They keep the parts and the backend modules apart
// (AGENTS.md rule 7, docs/architecture.md#repository-layout).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PARTS = ['backend', 'web', 'shared', 'app'];

/** Which parts each part may import from. */
const ALLOWED = {
  backend: ['backend', 'shared'],
  web: ['web', 'shared'],
  app: ['app', 'shared'],
  shared: ['shared'],
};

function partOfFile(file) {
  const [first] = path.relative(ROOT, file).split(path.sep);
  return PARTS.includes(first) ? first : null;
}

function partOfImport(file, source) {
  const scoped = /^@coal\/([a-z]+)/.exec(source);
  if (scoped) return scoped[1];
  if (!source.startsWith('.')) return null;
  return partOfFile(path.resolve(path.dirname(file), source));
}

function importVisitors(check) {
  const visit = (node) => {
    if (node.source && typeof node.source.value === 'string') check(node, node.source.value);
  };
  return {
    ImportDeclaration: visit,
    ExportNamedDeclaration: visit,
    ExportAllDeclaration: visit,
    ImportExpression: visit,
  };
}

const partBoundaries = {
  meta: {
    type: 'problem',
    docs: {
      description: 'web/ and app/ import only from shared/; shared/ imports from no other part',
    },
    messages: {
      forbidden:
        '{{from}}/ may not import from {{to}}/. Put what both need in shared/, or use the API.',
    },
    schema: [],
  },
  create(context) {
    const from = partOfFile(context.filename);
    if (!from) return {};
    return importVisitors((node, source) => {
      const to = partOfImport(context.filename, source);
      if (to && PARTS.includes(to) && !ALLOWED[from].includes(to)) {
        context.report({ node: node.source, messageId: 'forbidden', data: { from, to } });
      }
    });
  },
};

/** `backend/src/modules/users/x.ts` → `modules/users`; `backend/src/core/http/x.ts` → `core/http`. */
function ownerOf(file) {
  const match = /backend[\\/]src[\\/]((?:modules|core)[\\/][^\\/]+)[\\/]/.exec(file);
  return match ? match[1].replaceAll('\\', '/') : null;
}

const moduleTables = {
  meta: {
    type: 'problem',
    docs: { description: "Backend modules use each other's services, never each other's tables" },
    messages: {
      foreign:
        "Don't use {{owner}}'s tables from here. Call a function in {{owner}}'s service instead.",
    },
    schema: [],
  },
  create(context) {
    const file = context.filename;
    const isTablesFile = /[\\/]tables\.ts$/.test(file);
    const isTest = /\.test\.ts$/.test(file) || /backend[\\/]test[\\/]/.test(file);
    // Table files may reference other tables for foreign keys; tests may inspect any table.
    if (isTablesFile || isTest) return {};
    const from = ownerOf(file);
    return importVisitors((node, source) => {
      if (!source.startsWith('.')) return;
      const target = path.resolve(path.dirname(file), source);
      if (!/[\\/]tables(\.ts)?$/.test(target)) return;
      const owner = ownerOf(target);
      if (owner && owner !== from) {
        context.report({ node: node.source, messageId: 'foreign', data: { owner } });
      }
    });
  },
};

export default {
  meta: { name: 'eslint-plugin-coal' },
  rules: { 'part-boundaries': partBoundaries, 'module-tables': moduleTables },
};
