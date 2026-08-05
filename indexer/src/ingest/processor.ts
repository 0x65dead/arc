import { ethers } from 'ethers';
import {
  CONTROLLER_EVENTS,
  MARKET_EVENTS,
  REGISTRAR_EVENTS,
  TOPICS,
  labelToId,
  normalizeLabel,
  toFullName,
} from '../chain/abis.js';
import { getBlockTime, readListingCurrency } from '../chain/provider.js';
import type { NormalizedLog } from '../chain/blockscout.js';
import { withTransaction } from '../db/pool.js';
import {
  closeListing,
  insertEvent,
  insertRenewal,
  insertSale,
  insertTransfer,
  upsertListing,
  upsertRegistration,
} from '../db/repositories.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('ingest');

/**
 * The single place a log becomes rows.
 *
 * v1 had two copies of this logic — one in `backfill.ts` and one in
 * `listener.ts` — which had already drifted apart: the backfill sorted logs
 * chronologically and the listener didn't, and only the backfill knew how to
 * derive a token id from a label. Any fix had to be made twice, and one of the
 * two was always a little behind.
 *
 * Everything a single log implies is written in one transaction, so a crash
 * can't leave a sale recorded with its listing still marked active.
 */

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Chronological order. Required so a rename/renew never lands before its registration. */
export function sortChronological(logs: NormalizedLog[]): NormalizedLog[] {
  return [...logs].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
}

export function toNormalized(log: ethers.Log): NormalizedLog {
  return {
    address: log.address.toLowerCase(),
    topics: [...log.topics],
    data: log.data,
    blockNumber: log.blockNumber,
    transactionHash: log.transactionHash,
    logIndex: log.index,
  };
}

async function handleController(entry: NormalizedLog, blockTime: number | null): Promise<void> {
  const topic = entry.topics[0];

  if (topic === TOPICS.NameRegistered) {
    const parsed = CONTROLLER_EVENTS.parseLog(entry);
    if (!parsed) return;

    const label = normalizeLabel(String(parsed.args.name));
    if (!label) return;

    const name = toFullName(label);
    const tokenId = labelToId(label);
    const owner = String(parsed.args.owner);
    const costWei = parsed.args.cost.toString();

    await withTransaction(async (client) => {
      await upsertRegistration(
        {
          name,
          tokenId,
          owner,
          costWei,
          expiresAt: Number(parsed.args.expires),
          blockNumber: entry.blockNumber,
          logIndex: entry.logIndex,
          txHash: entry.transactionHash,
          blockTime,
        },
        client,
      );
      await insertEvent(
        {
          kind: 'registration',
          name,
          tokenId,
          actor: owner,
          counterparty: null,
          amountWei: costWei,
          blockNumber: entry.blockNumber,
          logIndex: entry.logIndex,
          txHash: entry.transactionHash,
          blockTime,
        },
        client,
      );
    });

    log.debug('registration', { name, block: entry.blockNumber });
    return;
  }

  if (topic === TOPICS.NameRenewed) {
    const parsed = CONTROLLER_EVENTS.parseLog(entry);
    if (!parsed) return;

    const label = normalizeLabel(String(parsed.args.name));
    if (!label) return;

    const name = toFullName(label);
    const costWei = parsed.args.cost.toString();

    await withTransaction(async (client) => {
      await insertRenewal(
        {
          name,
          costWei,
          expiresAt: Number(parsed.args.expires),
          blockNumber: entry.blockNumber,
          logIndex: entry.logIndex,
          txHash: entry.transactionHash,
          blockTime,
        },
        client,
      );
      await insertEvent(
        {
          kind: 'renewal',
          name,
          tokenId: labelToId(label),
          actor: null,
          counterparty: null,
          amountWei: costWei,
          blockNumber: entry.blockNumber,
          logIndex: entry.logIndex,
          txHash: entry.transactionHash,
          blockTime,
        },
        client,
      );
    });

    log.debug('renewal', { name, block: entry.blockNumber });
  }
}

async function handleRegistrar(entry: NormalizedLog, blockTime: number | null): Promise<void> {
  if (entry.topics[0] !== TOPICS.Transfer) return;

  const parsed = REGISTRAR_EVENTS.parseLog(entry);
  if (!parsed) return;

  const tokenId = parsed.args.id.toString();
  const from = String(parsed.args.from);
  const to = String(parsed.args.to);

  await withTransaction(async (client) => {
    await insertTransfer(
      {
        tokenId,
        from,
        to,
        blockNumber: entry.blockNumber,
        logIndex: entry.logIndex,
        txHash: entry.transactionHash,
        blockTime,
      },
      client,
    );

    // A mint's Transfer comes from the zero address and is already represented
    // by the controller's `registration` event in the same transaction —
    // recording it again would show every registration twice in the feed.
    if (from.toLowerCase() !== ZERO_ADDRESS) {
      await insertEvent(
        {
          kind: 'transfer',
          name: null,
          tokenId,
          actor: from,
          counterparty: to,
          amountWei: null,
          blockNumber: entry.blockNumber,
          logIndex: entry.logIndex,
          txHash: entry.transactionHash,
          blockTime,
        },
        client,
      );
    }
  });
}

async function handleMarket(entry: NormalizedLog, blockTime: number | null): Promise<void> {
  const parsed = MARKET_EVENTS.parseLog(entry);
  if (!parsed) return;

  const topic = entry.topics[0];
  const tokenId = parsed.args.id.toString();

  if (topic === TOPICS.Listed || topic === TOPICS.PriceChanged) {
    // Read outside the transaction — an RPC call inside one would hold a
    // pooled connection open for the whole round trip.
    const currency = await readListingCurrency(tokenId);
    const priceWei = parsed.args.price.toString();
    const seller = String(parsed.args.seller);

    await withTransaction(async (client) => {
      await upsertListing(
        {
          tokenId,
          seller,
          priceWei,
          currency,
          blockNumber: entry.blockNumber,
          logIndex: entry.logIndex,
          txHash: entry.transactionHash,
          blockTime,
        },
        client,
      );
      await insertEvent(
        {
          kind: 'listing',
          name: null,
          tokenId,
          actor: seller,
          counterparty: null,
          amountWei: priceWei,
          blockNumber: entry.blockNumber,
          logIndex: entry.logIndex,
          txHash: entry.transactionHash,
          blockTime,
        },
        client,
      );
    });
    return;
  }

  if (topic === TOPICS.Unlisted) {
    const seller = String(parsed.args.seller);
    await withTransaction(async (client) => {
      await closeListing(
        {
          tokenId,
          status: 'unlisted',
          blockNumber: entry.blockNumber,
          logIndex: entry.logIndex,
          txHash: entry.transactionHash,
          blockTime,
        },
        client,
      );
      await insertEvent(
        {
          kind: 'unlisting',
          name: null,
          tokenId,
          actor: seller,
          counterparty: null,
          amountWei: null,
          blockNumber: entry.blockNumber,
          logIndex: entry.logIndex,
          txHash: entry.transactionHash,
          blockTime,
        },
        client,
      );
    });
    return;
  }

  if (topic === TOPICS.Sold) {
    const seller = String(parsed.args.seller);
    const buyer = String(parsed.args.buyer);
    const priceWei = parsed.args.price.toString();

    await withTransaction(async (client) => {
      await insertSale(
        {
          tokenId,
          seller,
          buyer,
          priceWei,
          feeWei: parsed.args.fee.toString(),
          blockNumber: entry.blockNumber,
          logIndex: entry.logIndex,
          txHash: entry.transactionHash,
          blockTime,
        },
        client,
      );
      await closeListing(
        {
          tokenId,
          status: 'sold',
          blockNumber: entry.blockNumber,
          logIndex: entry.logIndex,
          txHash: entry.transactionHash,
          blockTime,
        },
        client,
      );
      await insertEvent(
        {
          kind: 'sale',
          name: null,
          tokenId,
          actor: buyer,
          counterparty: seller,
          amountWei: priceWei,
          blockNumber: entry.blockNumber,
          logIndex: entry.logIndex,
          txHash: entry.transactionHash,
          blockTime,
        },
        client,
      );
    });
  }
}

/**
 * Processes one log. Never throws for a log this indexer doesn't care about;
 * does throw if the database rejects a write, so the caller can decide whether
 * to advance its checkpoint.
 */
export async function processLog(entry: NormalizedLog): Promise<void> {
  const address = entry.address.toLowerCase();
  const blockTime = await getBlockTime(entry.blockNumber);

  if (address === config.contracts.controller) return handleController(entry, blockTime);
  if (address === config.contracts.registrar) return handleRegistrar(entry, blockTime);
  if (address === config.contracts.market) return handleMarket(entry, blockTime);
}

/**
 * Processes a batch in chronological order.
 *
 * Returns the number of logs that failed. A single malformed log must not
 * abort a whole chunk — but the count is returned rather than swallowed, so
 * the caller can refuse to advance its checkpoint over a range it did not
 * fully apply. v1 logged the error and moved on regardless, which is how a
 * failed write became a permanent gap.
 */
export async function processLogs(logs: NormalizedLog[]): Promise<{ failed: number }> {
  let failed = 0;

  for (const entry of sortChronological(logs)) {
    try {
      await processLog(entry);
    } catch (error) {
      failed += 1;
      log.error('failed to process log', {
        tx: entry.transactionHash,
        logIndex: entry.logIndex,
        block: entry.blockNumber,
        error,
      });
    }
  }

  return { failed };
}
