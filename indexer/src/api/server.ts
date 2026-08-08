import cors from 'cors';
import express, { type Express } from 'express';
import { config, isWaitlistEnabled, missingWaitlistConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { getSyncStreams, ping } from '../db/repositories.js';
import { createV1Router } from './routes.js';
import { createWaitlistRouter } from '../waitlist/routes.js';
import { errorHandler, notFoundHandler } from './errors.js';

const log = createLogger('api');

export function createApiServer(): Express {
  const app = express();

  app.disable('x-powered-by');

  /**
   * Whether to believe X-Forwarded-For.
   *
   * Opt-in, because getting this wrong is a security bug in both directions.
   * Left off behind a proxy, every request appears to come from the proxy and
   * the waitlist rate limits apply to all users as one bucket. Turned on
   * without a proxy actually in front, any client can set the header and
   * choose its own rate-limit key. This deployment sits behind a Vercel
   * rewrite, so it wants `TRUST_PROXY=1` — the number of hops, not `true`,
   * which would trust the leftmost (client-supplied) entry.
   */
  const trustProxy = process.env.TRUST_PROXY?.trim();
  if (trustProxy) {
    app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  }

  app.use(
    cors({
      origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
      // POST is here for the waitlist routes only; everything under /api/v1
      // that serves chain data is still read-only. `authorization` has to be
      // named explicitly because a bearer header makes the request
      // non-simple, so the browser preflights it and a default allowlist
      // would fail that preflight.
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['content-type', 'authorization'],
    }),
  );

  // Request logging at debug level only — an indexer's API is polled
  // continuously by every open browser tab, and logging each hit at info
  // buries anything worth reading.
  app.use((req, _res, next) => {
    log.debug('request', { method: req.method, path: req.path });
    next();
  });

  /**
   * Liveness + readiness.
   *
   * Returns 503 when the database is unreachable, so a load balancer or
   * container orchestrator can act on it. v1 had no health endpoint at all:
   * the only way to discover the database had gone away was for a user to hit
   * a 500 on the page they were looking at.
   */
  app.get('/health', async (_req, res) => {
    try {
      await ping();
    } catch (error) {
      log.error('health check failed', { error });
      res.status(503).json({ status: 'unhealthy', database: false });
      return;
    }

    const streams = await getSyncStreams().catch(() => []);
    res.json({
      status: 'ok',
      database: true,
      streams: streams.length,
      indexedBlock: streams.length ? Math.min(...streams.map((s) => s.lastBlock)) : 0,
    });
  });

  /**
   * Waitlist routes.
   *
   * Mounted ahead of the v1 router, and with its own body parser rather than
   * an app-wide one. The chain-data routes are all GET and parse nothing, so
   * an `express.json()` at app scope would have them accepting and buffering
   * bodies they never read — a free 100kb of work per request for anyone who
   * cares to send it. 16kb is generous for the largest real payload here (a
   * signature).
   *
   * The paths are duplicated under /api and /api/v1 to match how the chain
   * routes are served, so DISCORD_REDIRECT_URI can be registered as either.
   */
  const waitlist = createWaitlistRouter();
  app.use('/api/v1/waitlist', express.json({ limit: '16kb' }), waitlist);
  app.use('/api/waitlist', express.json({ limit: '16kb' }), waitlist);

  if (isWaitlistEnabled()) {
    log.info('waitlist enabled', { guild: config.waitlist.discord.guildId });
  } else {
    // Warn, not throw. The waitlist is not what this service is for, and a
    // missing Discord secret must not stop it serving chain data — but a
    // silent 503 from a route the frontend is calling is the kind of thing
    // that gets debugged from the browser for an hour, so name the gaps here.
    log.warn('waitlist disabled — set these to enable it', {
      missing: missingWaitlistConfig().join(', '),
    });
  }

  const v1 = createV1Router();
  app.use('/api/v1', v1);

  // The unversioned paths the previous frontend used, kept alive so an old
  // deployed bundle keeps working through a rollout. Same handlers — the
  // response shapes are the new ones, which is the point: the shapes v1
  // returned were the bug.
  app.use('/api', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
