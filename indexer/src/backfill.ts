import { ethers } from 'ethers';
import { CONTROLLER_EVENTS, MARKET_EVENTS, REGISTRAR_EVENTS, TOPICS, labelToId } from './abis.js';
import {
  getSyncBlock,
  insertRenewal,
  insertSale,
  insertTransfer,
  markListingStatus,
  setSyncBlock,
  upsertListing,
  upsertRegistration
} from './db.js';
import { fetchAllLogsForAddress, NormalizedLog } from './blockscout.js';

const CONTROLLER_ADDRESS = process.env.CONTROLLER_ADDRESS!;
const REGISTRAR_ADDRESS = process.env.REGISTRAR_ADDRESS!;
const MARKET_ADDRESS = process.env.MARKET_ADDRESS!;
const DEPLOY_BLOCK = Number(process.env.DEPLOY_BLOCK ?? '0');

// ================================================================
// Primary path: ArcScan (Blockscout) — see blockscout.ts for why.
// ================================================================

function sortChronological(logs: NormalizedLog[]): NormalizedLog[] {
  return [...logs].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
}

// Processing each address's logs in chronological order matters for one
// reason: insertRenewal requires the name's registration row to already
// exist. Since a name can never be renewed before it's registered, sorting
// the controller's own log stream ascending guarantees that ordering
// without needing any special-casing.
async function processControllerLog(log: NormalizedLog): Promise<void> {
  if (log.topics[0] === TOPICS.NameRegistered) {
    const parsed = CONTROLLER_EVENTS.parseLog(log);
    if (!parsed) return;
    const name = String(parsed.args.name).trim().toLowerCase().replace('.arc', '');
    if (!name) return;
    await upsertRegistration({
      name,
      tokenId: labelToId(name),
      owner: parsed.args.owner,
      costWei: parsed.args.cost.toString(),
      expiresAt: Number(parsed.args.expires),
      blockNumber: log.blockNumber,
      txHash: log.transactionHash
    });
  } else if (log.topics[0] === TOPICS.NameRenewed) {
    const parsed = CONTROLLER_EVENTS.parseLog(log);
    if (!parsed) return;
    const name = String(parsed.args.name).trim().toLowerCase().replace('.arc', '');
    if (!name) return;
    await insertRenewal({
      name,
      costWei: parsed.args.cost.toString(),
      expiresAt: Number(parsed.args.expires),
      blockNumber: log.blockNumber,
      txHash: log.transactionHash,
      logIndex: log.logIndex
    });
  }
}

async function processRegistrarLog(log: NormalizedLog): Promise<void> {
  if (log.topics[0] !== TOPICS.Transfer) return;
  const parsed = REGISTRAR_EVENTS.parseLog(log);
  if (!parsed) return;
  await insertTransfer({
    tokenId: parsed.args.id.toString(),
    fromAddr: parsed.args.from,
    toAddr: parsed.args.to,
    blockNumber: log.blockNumber,
    txHash: log.transactionHash,
    logIndex: log.logIndex
  });
}

async function processMarketLog(log: NormalizedLog): Promise<void> {
  const parsed = MARKET_EVENTS.parseLog(log);
  if (!parsed) return;

  if (log.topics[0] === TOPICS.Listed || log.topics[0] === TOPICS.PriceChanged) {
    await upsertListing({
      tokenId: parsed.args.id.toString(),
      seller: parsed.args.seller,
      priceWei: parsed.args.price.toString(),
      blockNumber: log.blockNumber,
      txHash: log.transactionHash
    });
  } else if (log.topics[0] === TOPICS.Unlisted) {
    await markListingStatus(parsed.args.id.toString(), 'cancelled');
  } else if (log.topics[0] === TOPICS.Sold) {
    const tokenId = parsed.args.id.toString();
    await insertSale({
      tokenId,
      seller: parsed.args.seller,
      buyer: parsed.args.buyer,
      priceWei: parsed.args.price.toString(),
      feeWei: parsed.args.fee.toString(),
      blockNumber: log.blockNumber,
      txHash: log.transactionHash,
      logIndex: log.logIndex
    });
    await markListingStatus(tokenId, 'sold');
  }
}

async function runBackfillFromArcScan(): Promise<void> {
  console.log('[backfill:arcscan] fetching full log history for all 3 contracts...');

  const [controllerLogs, registrarLogs, marketLogs] = await Promise.all([
    fetchAllLogsForAddress(CONTROLLER_ADDRESS),
    fetchAllLogsForAddress(REGISTRAR_ADDRESS),
    fetchAllLogsForAddress(MARKET_ADDRESS)
  ]);

  for (const log of sortChronological(controllerLogs)) await processControllerLog(log);
  for (const log of sortChronological(registrarLogs)) await processRegistrarLog(log);
  for (const log of sortChronological(marketLogs)) await processMarketLog(log);

  console.log(
    `[backfill:arcscan] processed ${controllerLogs.length} controller / ` +
    `${registrarLogs.length} registrar / ${marketLogs.length} market log(s)`
  );
}

// ================================================================
// Fallback path: direct RPC eth_getLogs, chunked and rate-limit-aware.
// Only used if the ArcScan pull above throws (network error, ArcScan down,
// unexpected response shape). Kept in full working order rather than
// deleted, since it's the one guaranteed-available path if ArcScan's public
// instance is ever unreachable or its API changes shape.
// ================================================================

const chunkSizeRef = { value: Number(process.env.BACKFILL_CHUNK_SIZE ?? '10000') };

function parseSuggestedRange(err: any): number | null {
  const candidates = [
    err?.error?.message,
    err?.info?.error?.message,
    err?.shortMessage,
    err?.message
  ].filter(Boolean);

  for (const msg of candidates) {
    const match = String(msg).match(/up to an?\s*(\d+)\s*block range/i);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}

async function getLogsWithRetry(
  provider: ethers.JsonRpcProvider,
  filter: { address: string; topics: (string | string[] | null)[] },
  fromBlock: number,
  toBlockRequested: number,
  label: string,
  maxRetries = 5
): Promise<{ logs: ethers.Log[]; usedTo: number }> {
  let attempt = 0;
  let toBlock = toBlockRequested;

  while (true) {
    try {
      const logs = await provider.getLogs({ ...filter, fromBlock, toBlock });
      return { logs, usedTo: toBlock };
    } catch (err) {
      const suggested = parseSuggestedRange(err);

      if (suggested !== null) {
        const newSize = Math.max(1, suggested);
        if (newSize < chunkSizeRef.value) {
          console.warn(
            `[backfill:rpc:${label}] provider enforces a ${newSize}-block eth_getLogs range cap — ` +
            `shrinking chunk size from ${chunkSizeRef.value} to ${newSize} for the rest of this run`
          );
          chunkSizeRef.value = newSize;
        }
        toBlock = Math.min(toBlockRequested, fromBlock + chunkSizeRef.value - 1);
        continue;
      }

      attempt++;
      if (attempt > maxRetries) {
        throw new Error(`[backfill:rpc:${label}] giving up on blocks ${fromBlock}-${toBlock} after ${maxRetries} retries: ${err}`);
      }
      const delayMs = Math.min(1000 * 2 ** attempt, 30_000);
      console.warn(`[backfill:rpc:${label}] blocks ${fromBlock}-${toBlock} failed (attempt ${attempt}/${maxRetries}), retrying in ${delayMs}ms:`, err);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function scanStream(
  provider: ethers.JsonRpcProvider,
  stream: string,
  address: string,
  topics: (string | string[] | null)[],
  latestBlock: number,
  onLogs: (logs: ethers.Log[]) => Promise<void>
): Promise<void> {
  const lastScanned = await getSyncBlock(stream, DEPLOY_BLOCK - 1);
  let from = lastScanned + 1;
  let chunksProcessed = 0;

  while (from <= latestBlock) {
    const toRequested = Math.min(from + chunkSizeRef.value - 1, latestBlock);
    const { logs, usedTo } = await getLogsWithRetry(provider, { address, topics }, from, toRequested, stream);

    if (logs.length > 0) {
      await onLogs(logs);
    }
    await setSyncBlock(stream, usedTo);
    from = usedTo + 1;
    chunksProcessed++;

    if (chunksProcessed % 200 === 0) {
      const remaining = latestBlock - from;
      console.log(`[backfill:rpc:${stream}] at block ${from} (${remaining} blocks remaining, chunk size ${chunkSizeRef.value})`);
    }
  }
}

async function runBackfillFromRpc(provider: ethers.JsonRpcProvider): Promise<void> {
  const latestBlock = await provider.getBlockNumber();
  console.log(`[backfill:rpc] chain head is ${latestBlock}, chunk size starting at ${chunkSizeRef.value}`);

  await scanStream(provider, 'registered', CONTROLLER_ADDRESS, [TOPICS.NameRegistered], latestBlock, async (logs) => {
    for (const log of logs) {
      await processControllerLog({
        topics: [...log.topics],
        data: log.data,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        logIndex: log.index
      });
    }
  });

  await scanStream(provider, 'renewed', CONTROLLER_ADDRESS, [TOPICS.NameRenewed], latestBlock, async (logs) => {
    for (const log of logs) {
      await processControllerLog({
        topics: [...log.topics],
        data: log.data,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        logIndex: log.index
      });
    }
  });

  await scanStream(provider, 'transfer', REGISTRAR_ADDRESS, [TOPICS.Transfer], latestBlock, async (logs) => {
    for (const log of logs) {
      await processRegistrarLog({
        topics: [...log.topics],
        data: log.data,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        logIndex: log.index
      });
    }
  });

  await scanStream(provider, 'listed', MARKET_ADDRESS, [[TOPICS.Listed, TOPICS.PriceChanged]], latestBlock, async (logs) => {
    for (const log of logs) {
      await processMarketLog({
        topics: [...log.topics],
        data: log.data,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        logIndex: log.index
      });
    }
  });

  await scanStream(provider, 'unlisted', MARKET_ADDRESS, [TOPICS.Unlisted], latestBlock, async (logs) => {
    for (const log of logs) {
      await processMarketLog({
        topics: [...log.topics],
        data: log.data,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        logIndex: log.index
      });
    }
  });

  await scanStream(provider, 'sold', MARKET_ADDRESS, [TOPICS.Sold], latestBlock, async (logs) => {
    for (const log of logs) {
      await processMarketLog({
        topics: [...log.topics],
        data: log.data,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        logIndex: log.index
      });
    }
  });

  console.log('[backfill:rpc] caught up to chain head');
}

// ================================================================
// Entry point
// ================================================================

export async function runBackfill(provider: ethers.JsonRpcProvider): Promise<void> {
  try {
    await runBackfillFromArcScan();
    return;
  } catch (err) {
    console.error('[backfill] ArcScan pull failed, falling back to direct RPC log scan:', err);
  }
  await runBackfillFromRpc(provider);
}
