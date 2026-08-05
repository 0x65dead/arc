import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { TOPICS } from '../chain/abis.js';
import { provider, getSafeHead } from '../chain/provider.js';
import { fetchLogsSince } from '../chain/blockscout.js';
import { getSyncBlock, setSyncBlock } from '../db/repositories.js';
import { processLogs, toNormalized } from './processor.js';
const log = createLogger('backfill');
const STREAMS = [
    {
        name: 'controller',
        address: config.contracts.controller,
        topics: [[TOPICS.NameRegistered, TOPICS.NameRenewed]],
    },
    {
        name: 'registrar',
        address: config.contracts.registrar,
        topics: [TOPICS.Transfer],
    },
    {
        name: 'market',
        address: config.contracts.market,
        topics: [[TOPICS.Listed, TOPICS.PriceChanged, TOPICS.Unlisted, TOPICS.Sold]],
    },
];
/** Shrinks itself for the rest of the run when a provider advertises a range cap. */
const chunkSize = { value: config.backfillChunkSize };
function parseSuggestedRange(error) {
    const candidates = [
        error?.error?.message,
        error?.info?.error?.message,
        error?.shortMessage,
        error?.message,
    ].filter(Boolean);
    for (const message of candidates) {
        const match = String(message).match(/up to an?\s*(\d+)\s*block range/i);
        if (match)
            return Number.parseInt(match[1], 10);
    }
    return null;
}
async function getLogsWithRetry(stream, fromBlock, toBlockRequested, maxRetries = 5) {
    let attempt = 0;
    let toBlock = toBlockRequested;
    for (;;) {
        try {
            const logs = await provider.getLogs({
                address: stream.address,
                topics: stream.topics,
                fromBlock,
                toBlock,
            });
            return { logs, usedTo: toBlock };
        }
        catch (error) {
            const suggested = parseSuggestedRange(error);
            if (suggested !== null && suggested >= 1) {
                if (suggested < chunkSize.value) {
                    log.warn('provider enforces a smaller getLogs range — shrinking for the rest of this run', {
                        stream: stream.name,
                        from: chunkSize.value,
                        to: suggested,
                    });
                    chunkSize.value = suggested;
                }
                toBlock = Math.min(toBlockRequested, fromBlock + chunkSize.value - 1);
                continue;
            }
            attempt += 1;
            if (attempt > maxRetries) {
                throw new Error(`[${stream.name}] gave up on blocks ${fromBlock}-${toBlock} after ${maxRetries} retries: ${error}`);
            }
            const delayMs = Math.min(1000 * 2 ** attempt, 30_000);
            log.warn('getLogs failed, retrying', {
                stream: stream.name,
                fromBlock,
                toBlock,
                attempt,
                delayMs,
            });
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
}
/** Chunked `eth_getLogs`, checkpointing after each chunk it fully applied. */
async function scanViaRpc(stream, fromBlock, safeHead) {
    let from = fromBlock;
    while (from <= safeHead) {
        const toRequested = Math.min(from + chunkSize.value - 1, safeHead);
        const { logs, usedTo } = await getLogsWithRetry(stream, from, toRequested);
        const { failed } = await processLogs(logs.map(toNormalized));
        if (failed > 0) {
            // Deliberately does not checkpoint: leaving the mark where it is means
            // the next pass re-reads this range and retries the rows that failed.
            // Every write is idempotent, so re-reading costs nothing but time.
            throw new Error(`[${stream.name}] ${failed} log(s) failed in ${from}-${usedTo}; not advancing`);
        }
        await setSyncBlock(stream.name, usedTo);
        from = usedTo + 1;
    }
}
async function scanViaBlockscout(stream, fromBlock, safeHead) {
    return fetchLogsSince(stream.address, fromBlock - 1, safeHead);
}
/**
 * Per-stream instant before which Blockscout is skipped.
 *
 * A stream that just failed against Blockscout will almost certainly fail
 * again on the next pass a few minutes later, and each attempt costs a full
 * request timeout per page before the RPC fallback even starts. Backing off
 * for a while means a Blockscout outage degrades to "the RPC path, promptly"
 * instead of "the RPC path, after re-timing-out every five minutes".
 *
 * In memory on purpose — a restart should re-test the fast path immediately.
 */
const blockscoutSkipUntil = new Map();
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
async function runStream(stream, safeHead) {
    const checkpoint = await getSyncBlock(stream.name);
    const from = checkpoint === null ? config.deployBlock : checkpoint + 1;
    if (from > safeHead) {
        log.debug('stream already current', { stream: stream.name, checkpoint, safeHead });
        return;
    }
    log.info('catching up', { stream: stream.name, from, to: safeHead });
    const skipUntil = blockscoutSkipUntil.get(stream.name) ?? 0;
    const now = Date.now();
    if (now >= skipUntil) {
        try {
            const logs = await scanViaBlockscout(stream, from, safeHead);
            const { failed } = await processLogs(logs);
            if (failed > 0) {
                throw new Error(`${failed} log(s) failed to apply`);
            }
            await setSyncBlock(stream.name, safeHead);
            blockscoutSkipUntil.delete(stream.name);
            log.info('stream current', {
                stream: stream.name,
                block: safeHead,
                logs: logs.length,
                via: 'blockscout',
            });
            return;
        }
        catch (error) {
            if (config.blockscoutCooldownMs > 0) {
                blockscoutSkipUntil.set(stream.name, Date.now() + config.blockscoutCooldownMs);
            }
            log.warn('blockscout path failed, falling back to RPC', {
                stream: stream.name,
                error: describeError(error),
                cooldownSeconds: config.blockscoutCooldownMs / 1000,
            });
        }
    }
    else {
        log.debug('skipping blockscout, still cooling down', {
            stream: stream.name,
            resumesInSeconds: Math.ceil((skipUntil - now) / 1000),
        });
    }
    await scanViaRpc(stream, from, safeHead);
    log.info('stream current', { stream: stream.name, block: safeHead, via: 'rpc' });
}
/**
 * Runs every stream to the safe head.
 *
 * Streams run sequentially rather than in parallel: they share a bounded
 * connection pool and a public Blockscout instance with its own rate limits,
 * and this is a background catch-up whose latency nobody is waiting on.
 */
export async function runBackfill() {
    const safeHead = await getSafeHead();
    log.info('backfill pass starting', { safeHead, confirmations: config.confirmations });
    for (const stream of STREAMS) {
        try {
            await runStream(stream, safeHead);
        }
        catch (error) {
            // One stream failing must not stop the others — a market outage should
            // not stall registration indexing. The checkpoint stays put, so the next
            // pass picks up exactly where this one stopped.
            log.error('stream failed', { stream: stream.name, error: describeError(error) });
        }
    }
}
export const STREAM_NAMES = STREAMS.map((stream) => stream.name);
