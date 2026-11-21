import { DEFAULT_ORG_ID } from '../src/core/config';
import { migrateAndSeed } from '../src/core/db/migrate';
import { DB_PREFIX, TEMPLATE_DB, databaseUrl, withAdmin } from './databases';

/** Builds a migrated, seeded template database once; each test file copies it. */
export default async function setup() {
  await withAdmin(async (admin) => {
    const { rows } = await admin.query<{ datname: string }>(
      `select datname from pg_database where datname like $1`,
      [`${DB_PREFIX}_%`],
    );
    for (const { datname } of rows)
      await admin.query(`drop database if exists "${datname}" with (force)`);
    await admin.query(`create database "${TEMPLATE_DB}"`);
  });
  await migrateAndSeed(databaseUrl(TEMPLATE_DB), DEFAULT_ORG_ID);
}
