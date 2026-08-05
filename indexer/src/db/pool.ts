import pg from 'pg';
import { config } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('db');

/**
 * The connection pool.
 *
 * Bounded and with timeouts, unlike the previous bare `new Pool({ connectionString })`.
 * A pool with no `max` will happily open a connection per concurrent query,
 * which is how a backfill running alongside API traffic exhausts a managed
 * Postgres instance's connection limit and starts refusing everything.
 */
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: Number(process.env.DB_POOL_MAX ?? '10'),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (error) => {
  // An idle client erroring out is not fatal — the pool discards it and opens a
  // new one on the next query. Left unhandled this becomes an uncaught
  // exception and takes the whole process down.
  log.error('idle client error', { error });
});

/**
 * Runs a set of statements in a single transaction.
 *
 * Used wherever one on-chain log implies more than one row (a sale both
 * records the sale and closes the listing). Previously those were separate
 * un-transacted queries, so a crash between them left the listing marked
 * active with the name already transferred.
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      log.error('rollback failed', { error: rollbackError });
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
