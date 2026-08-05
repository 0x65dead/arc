import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, withTransaction } from './pool.js';
import { createLogger } from '../logger.js';

const log = createLogger('migrate');

/**
 * Migration runner.
 *
 * The previous `migrate.ts` read a single `schema.sql` and re-executed the whole
 * thing on every deploy. That works only as long as every statement in the file
 * is idempotent — the moment one isn't (an `ALTER TABLE ... ADD COLUMN`, a data
 * fix-up), running it twice either errors out or does the wrong thing, and there
 * was no record of what had already been applied.
 *
 * This applies each file in `migrations/` exactly once, in filename order, in a
 * transaction, and records it in `schema_migrations`. Each file is also written
 * to be idempotent on its own, so an existing v1 database converges on the same
 * schema as a fresh one.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

async function ensureLedger(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  } catch (error) {
    // Postgres 15 revoked CREATE on `public` from PUBLIC, so a role that owns
    // nothing fails here on an otherwise perfectly reachable database. The
    // driver's message ("permission denied for schema public") names the
    // symptom but not the grant, and this is the first statement the service
    // runs — so it is the error every new deployment hits first.
    if ((error as { code?: string }).code === '42501') {
      throw new Error(
        'permission denied creating tables: the DATABASE_URL role cannot CREATE in its schema.\n' +
          'On Postgres 15+ this is not granted by default. Either give the role its own database:\n' +
          '  CREATE DATABASE arc_indexer OWNER <role>;   (or ALTER DATABASE arc_indexer OWNER TO <role>;)\n' +
          'or grant it explicitly on a database you cannot re-own:\n' +
          '  GRANT USAGE, CREATE ON SCHEMA public TO <role>;',
      );
    }
    throw error;
  }
}

export async function runMigrations(): Promise<void> {
  await ensureLedger();

  const { rows } = await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.filename));

  let files: string[];
  try {
    files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort();
  } catch (error) {
    throw new Error(`Cannot read migrations directory ${MIGRATIONS_DIR}: ${(error as Error).message}`);
  }

  if (files.length === 0) throw new Error(`No .sql files found in ${MIGRATIONS_DIR}`);

  const pending = files.filter((name) => !applied.has(name));
  if (pending.length === 0) {
    log.info('schema up to date', { applied: applied.size });
    return;
  }

  for (const filename of pending) {
    const sql = await readFile(join(MIGRATIONS_DIR, filename), 'utf8');
    log.info('applying migration', { filename });

    // DDL is transactional in Postgres, so a migration that fails halfway
    // leaves no partial schema behind and can simply be re-run once fixed.
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
    });
  }

  log.info('migrations complete', { applied: pending.length });
}
