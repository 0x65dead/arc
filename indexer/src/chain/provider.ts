import { ethers } from 'ethers';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { MARKET_VIEW } from './abis.js';

const log = createLogger('chain');

/**
 * Shared HTTP provider.
 *
 * `staticNetwork` skips the per-request chain-id check ethers otherwise makes;
 * the chain this indexer talks to never changes underneath it, and the extra
 * round trip on every call was pure overhead during a backfill.
 */
export const provider = new ethers.JsonRpcProvider(config.rpc.http, undefined, {
  staticNetwork: true,
});

export async function getChainHead(): Promise<number> {
  return provider.getBlockNumber();
}

/**
 * The highest block considered final.
 *
 * Everything the indexer checkpoints stops here rather than at the head. v1
 * wrote its checkpoint straight up to the head, so a reorg dropped logs it had
 * already recorded and had already advanced past — nothing would ever re-read
 * that range, and the bad rows stayed forever.
 */
export async function getSafeHead(): Promise<number> {
  const head = await getChainHead();
  return Math.max(0, head - config.confirmations);
}

// ---------------------------------------------------------------------------
// Block timestamps
//
// Events carry no timestamp, so an activity feed needs one per block. Fetching
// a block per log would be one extra RPC round trip per event; a bounded cache
// collapses that to one per distinct block, and a backfill's logs cluster
// heavily into a handful of blocks.
// ---------------------------------------------------------------------------

const MAX_CACHED_BLOCKS = 2_000;
const blockTimes = new Map<number, number>();

export async function getBlockTime(blockNumber: number): Promise<number | null> {
  const cached = blockTimes.get(blockNumber);
  if (cached !== undefined) return cached;

  try {
    const block = await provider.getBlock(blockNumber);
    if (!block) return null;

    if (blockTimes.size >= MAX_CACHED_BLOCKS) {
      // Plain FIFO eviction. Blocks are processed in ascending order, so the
      // oldest inserted key is also the least likely to be asked for again.
      const oldest = blockTimes.keys().next().value;
      if (oldest !== undefined) blockTimes.delete(oldest);
    }
    blockTimes.set(blockNumber, block.timestamp);
    return block.timestamp;
  } catch (error) {
    // A missing timestamp degrades the activity feed's `at` field to the row's
    // insertion time. Not worth failing an entire chunk over.
    log.debug('block timestamp unavailable', { blockNumber, error });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Contract reads
// ---------------------------------------------------------------------------

const marketContract = new ethers.Contract(config.contracts.market, MARKET_VIEW, provider);

/**
 * Reads the currency discriminant for a listing.
 *
 * `Listed` and `PriceChanged` don't carry it, but `ArcMarket.buy()` requires
 * `listingCurrency[id] == 0`. Without this the API cannot tell a purchasable
 * native listing from an ERC-20 one — which is exactly why the old UI showed a
 * Buy button on USDC listings that always reverted.
 *
 * Defaults to 0 (native) on failure, matching the contract's own default for
 * an unset mapping entry.
 */
export async function readListingCurrency(tokenId: string): Promise<number> {
  try {
    const value = await marketContract.listingCurrency(tokenId);
    return Number(value);
  } catch (error) {
    log.debug('listingCurrency read failed, assuming native', { tokenId, error });
    return 0;
  }
}
