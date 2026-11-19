import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadOrgCatalogue } from '../../modules/org/service';
import { loadProcessVersions } from '../../modules/process/service';
import { loadDocumentTypes } from '../../modules/templates/service';
import { loadProductLines } from '../../modules/rnd/service';
import { createDb } from './client';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../migrations', import.meta.url));

/** Runs the migrations, then loads the reference data (departments, roles, product lines, routes, document types). */
export async function migrateAndSeed(databaseUrl: string, orgId: string): Promise<void> {
  const { db, pool } = createDb(databaseUrl, 1);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    await db.transaction(async (tx) => {
      await loadOrgCatalogue(tx, orgId);
      await loadProductLines(tx, orgId);
      await loadProcessVersions(tx, orgId);
      await loadDocumentTypes(tx, orgId);
    });
  } finally {
    await pool.end();
  }
}
