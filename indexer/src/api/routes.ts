import { Router } from 'express';
import {
  getActivity,
  getAvailability,
  getDomain,
  getDomainsByOwner,
  getMarketplace,
  getStats,
  getSyncStreams,
} from '../db/repositories.js';
import { getChainHead } from '../chain/provider.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import {
  ApiError,
  asyncHandler,
  optionalCursor,
  optionalLimit,
  optionalName,
  requireAddress,
  requireName,
} from './errors.js';

const log = createLogger('api');

/**
 * `/api/v1` routes.
 *
 * Every response shape here is declared in `src/lib/indexer.ts` on the
 * frontend side; the two files are a contract and must be changed together.
 * The naming is camelCase throughout — v1 returned raw snake_case database
 * columns, which meant the frontend had to know the schema.
 */
export function createV1Router(): Router {
  const router = Router();

  router.get(
    '/stats',
    asyncHandler(async (_req, res) => {
      res.json(await getStats());
    }),
  );

  router.get(
    '/availability',
    asyncHandler(async (req, res) => {
      const name = requireName(req.query.name, 'name');
      res.json(await getAvailability(name));
    }),
  );

  router.get(
    '/domains',
    asyncHandler(async (req, res) => {
      const owner = requireAddress(req.query.owner, 'owner');
      const items = await getDomainsByOwner(owner);
      res.json({ items });
    }),
  );

  router.get(
    '/domains/:name',
    asyncHandler(async (req, res) => {
      const name = requireName(req.params.name, 'name');
      const domain = await getDomain(name);
      if (!domain) throw ApiError.notFound(`${name} has never been registered`);
      res.json(domain);
    }),
  );

  router.get(
    '/marketplace',
    asyncHandler(async (req, res) => {
      const limit = optionalLimit(req.query.limit, 50, 200);
      const cursor = optionalCursor(req.query.cursor);
      res.json(await getMarketplace({ limit, cursor }));
    }),
  );

  router.get(
    '/activity',
    asyncHandler(async (req, res) => {
      const limit = optionalLimit(req.query.limit, 25, 100);
      const cursor = optionalCursor(req.query.cursor);
      const name = optionalName(req.query.name, 'name');
      res.json(await getActivity({ limit, cursor, name }));
    }),
  );

  /**
   * How far behind the indexer is.
   *
   * `indexedBlock` is the *minimum* across streams, not the maximum: the
   * indexer is only as caught-up as its furthest-behind stream, and reporting
   * the max would claim freshness the market data doesn't have.
   */
  router.get(
    '/sync-status',
    asyncHandler(async (_req, res) => {
      const streams = await getSyncStreams();
      const indexedBlock = streams.length
        ? Math.min(...streams.map((stream) => stream.lastBlock))
        : 0;

      let chainHead: number | null = null;
      try {
        chainHead = await getChainHead();
      } catch (error) {
        // The head is a nicety. Returning the checkpoints without it beats
        // failing the whole request because the RPC blinked.
        log.debug('chain head unavailable', { error });
      }

      const blocksBehind = chainHead === null ? null : Math.max(0, chainHead - indexedBlock);

      /**
       * Seconds since any stream last checkpointed.
       *
       * This is the liveness signal that does not depend on the RPC being
       * reachable from *this* request. A reconcile pass touches `updated_at`
       * every time it completes, even on a quiet chain where `last_block`
       * doesn't move — so if this goes stale, ingestion has actually stopped.
       * Judging health on `blocksBehind` alone would report a perfectly
       * healthy indexer whenever the head lookup failed, which is precisely
       * when the RPC is down and it is *not* healthy.
       */
      const checkpointAgeSeconds = streams.length
        ? Math.floor(
            (Date.now() - Math.max(...streams.map((s) => Date.parse(s.updatedAt)))) / 1000,
          )
        : null;

      const reconcileSeconds = config.reconcileIntervalMs / 1000;
      const checkpointFresh =
        checkpointAgeSeconds !== null && checkpointAgeSeconds <= reconcileSeconds * 3;

      res.json({
        indexedBlock,
        chainHead,
        blocksBehind,
        checkpointAgeSeconds,
        healthy:
          streams.length > 0 &&
          checkpointFresh &&
          (blocksBehind === null || blocksBehind <= config.staleAfterBlocks),
        streams,
      });
    }),
  );

  return router;
}
