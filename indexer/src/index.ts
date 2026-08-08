import type { Server } from 'node:http';
import { assertConfigValid, config } from './config.js';
import { createLogger } from './logger.js';
import { closePool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { runBackfill } from './ingest/backfill.js';
import { startListener, type Listener } from './ingest/listener.js';
import { createApiServer } from './api/server.js';
import { pruneExpired } from './waitlist/repository.js';

const log = createLogger('startup');

/**
 * Entry point.
 *
 * Ordering matters and differs from v1 in one important way: the API starts
 * *before* the backfill, not after. v1 awaited a full historical scan before
 * calling `listen`, so on a cold start with a large gap the service was
 * unreachable — no health check, no connection refused explanation, just a
 * port that wasn't open yet — for however long the catch-up took.
 */
async function main(): Promise<void> {
  assertConfigValid();

  log.info('starting', {
    chainRpc: new URL(config.rpc.http).host,
    live: config.rpc.ws ? 'websocket' : 'polling',
    confirmations: config.confirmations,
  });

  await runMigrations();

  const server: Server = createApiServer().listen(config.port, config.host, () => {
    log.info('API listening', { host: config.host, port: config.port });
  });

  // The listener covers new blocks from now on; the backfill below closes the
  // gap behind it. Starting it first means nothing is missed in the window
  // where the backfill is still working.
  const listener: Listener = startListener();

  runBackfill().catch((error) => log.error('initial backfill failed', { error }));

  // Periodic reconcile: re-reads from each stream's checkpoint to the safe
  // head. Covers a silently-dropped websocket, a process restart, and any log
  // the live path failed to write.
  const reconcile = setInterval(() => {
    runBackfill().catch((error) => log.error('reconcile pass failed', { error }));
  }, config.reconcileIntervalMs);

  /**
   * Expire waitlist challenges and sessions.
   *
   * Both tables are append-mostly and nothing else ever deletes from them —
   * every abandoned signing prompt leaves a row that no query will match
   * again. Hourly is far more often than necessary for the row count, and is
   * chosen instead so that an expired session stops being a row in the
   * database shortly after it stops being useful.
   */
  const prune = setInterval(
    () => {
      pruneExpired()
        .then((removed) => {
          if (removed > 0) log.debug('pruned expired waitlist rows', { removed });
        })
        .catch((error) => log.warn('waitlist prune failed', { error }));
    },
    60 * 60 * 1000,
  );
  prune.unref();

  installShutdownHandlers({ server, listener, reconcile, prune });
}

/**
 * Graceful shutdown.
 *
 * v1 had none: SIGTERM killed the process mid-write, which with un-transacted
 * multi-statement updates could leave a listing marked active for a name that
 * had already been sold.
 */
function installShutdownHandlers(resources: {
  server: Server;
  listener: Listener;
  reconcile: NodeJS.Timeout;
  prune: NodeJS.Timeout;
}): void {
  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down', { signal });

    clearInterval(resources.reconcile);
    clearInterval(resources.prune);

    const forceExit = setTimeout(() => {
      log.warn('shutdown timed out — exiting');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    try {
      await new Promise<void>((resolve) => resources.server.close(() => resolve()));
      await resources.listener.stop();
      await closePool();
      log.info('shutdown complete');
      process.exit(0);
    } catch (error) {
      log.error('shutdown failed', { error });
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // A rejection nobody handled is a bug, but killing a running indexer over
  // one is worse than logging it — the reconcile pass repairs whatever the
  // failed path skipped.
  process.on('unhandledRejection', (reason) => {
    log.error('unhandled rejection', { error: reason });
  });

  process.on('uncaughtException', (error) => {
    // An uncaught exception leaves the process in an undefined state; unlike a
    // rejection, this one is not safe to continue from.
    log.error('uncaught exception — exiting', { error });
    void shutdown('uncaughtException');
  });
}

main().catch((error) => {
  log.error('fatal', { error: error instanceof Error ? error.message : error });
  if (error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
