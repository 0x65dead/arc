import { assertConfigValid } from '../config.js';
import { createLogger } from '../logger.js';
import { closePool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';

/**
 * Standalone migration entry point (`npm run migrate`).
 *
 * Separate from the server so a deploy can run migrations as its own step —
 * from CI, or against a database the service itself has no DDL rights on —
 * rather than only ever as a side effect of booting.
 */
const log = createLogger('migrate');

assertConfigValid();

runMigrations()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (error: unknown) => {
    log.error('migration failed', { error: error instanceof Error ? error.message : error });
    if (error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`);
    await closePool().catch(() => {});
    process.exit(1);
  });
