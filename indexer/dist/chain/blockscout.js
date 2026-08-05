import { config } from '../config.js';
import { createLogger } from '../logger.js';
const log = createLogger('blockscout');
/**
 * Blockscout log source.
 *
 * Two things differ from v1's `fetchAllLogsForAddress`:
 *
 * 1. It takes a `fromBlock` and stops paging once it walks past it. v1 pulled
 *    the *entire* history of all three contracts every five minutes forever,
 *    because `runBackfillFromArcScan` never wrote a checkpoint — it also meant
 *    `/api/sync-status` stayed empty on the primary path, since nothing ever
 *    called `setSyncBlock`.
 * 2. It reports the highest block it actually observed, so the caller can
 *    checkpoint honestly rather than assuming it reached the head.
 */
const PAGE_DELAY_MS = 300;
const MAX_PAGES = 200;
function toNormalizedLog(address, item) {
    return {
        address: address.toLowerCase(),
        // Blockscout pads unused topic slots with null — a 3-topic event still
        // shows a 4th null entry. ethers only reads as many topics as the matched
        // event needs, but the nulls are stripped so the array only ever holds
        // real hex topics.
        topics: item.topics.filter((topic) => topic !== null),
        data: item.data,
        blockNumber: item.block_number,
        transactionHash: item.transaction_hash,
        logIndex: item.index,
    };
}
async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.blockscoutTimeoutMs);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { accept: 'application/json' },
        });
        if (!response.ok) {
            throw new Error(`Blockscout returned HTTP ${response.status} for ${url}`);
        }
        return (await response.json());
    }
    catch (error) {
        // `AbortError` says nothing about what was aborted or why, and it is the
        // failure this path hits most often. Name the timeout so the log line
        // points at the knob that fixes it.
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error(`Blockscout timed out after ${config.blockscoutTimeoutMs}ms (BLOCKSCOUT_TIMEOUT_MS): ${url}`);
        }
        throw error;
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * Fetches logs for an address newer than `fromBlock`, up to and including
 * `toBlock`.
 *
 * Blockscout returns logs newest-first, which is what makes the early exit
 * possible: once a page's oldest entry is at or below `fromBlock`, every
 * remaining page is older still and there is nothing left to read.
 */
export async function fetchLogsSince(address, fromBlock, toBlock) {
    const collected = [];
    let pageParams = null;
    let page = 0;
    while (page < MAX_PAGES) {
        const url = new URL(`${config.blockscoutUrl}/api/v2/addresses/${address}/logs`);
        for (const [key, value] of Object.entries(pageParams ?? {})) {
            url.searchParams.set(key, String(value));
        }
        const body = await fetchJson(url.toString());
        const items = body.items ?? [];
        let reachedFloor = false;
        for (const item of items) {
            if (item.block_number <= fromBlock) {
                reachedFloor = true;
                continue;
            }
            // Logs above the safe head are deliberately skipped: they are not final
            // yet, and including them would let the checkpoint advance past blocks a
            // reorg could still take back.
            if (item.block_number > toBlock)
                continue;
            collected.push(toNormalizedLog(address, item));
        }
        page += 1;
        if (reachedFloor || !body.next_page_params)
            break;
        pageParams = body.next_page_params;
        await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
    }
    if (page >= MAX_PAGES) {
        // Not silent: an incomplete pull that looks complete would leave a
        // permanent hole once the caller checkpoints.
        log.warn('hit page limit — range may be incomplete', { address, fromBlock, toBlock, MAX_PAGES });
        throw new Error(`Blockscout paging exceeded ${MAX_PAGES} pages for ${address}`);
    }
    log.debug('fetched logs', { address, count: collected.length, pages: page, fromBlock, toBlock });
    return collected;
}
