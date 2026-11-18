import { loadConfig } from '../core/config';
import { migrateAndSeed } from '../core/db/migrate';

const config = loadConfig();
await migrateAndSeed(config.databaseUrl, config.orgId);
console.log('Database migrated and reference data loaded.');
