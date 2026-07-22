// Pulls a contract's entire event-log history from ArcScan's Blockscout v2
// REST API instead of chunked eth_getLogs — no 10-block range cap, since
// this queries an already-indexed dataset rather than paying per-call
// against a JSON-RPC node. Given this app has only ever seen a handful of
// registered names, each contract's full history almost certainly fits in
// one or two pages.
//
// Caveats worth remembering (see conversation): this is a public hosted
// Blockscout instance, so it has its own rate limits, and Blockscout's docs
// flag per-instance log endpoints as eventually moving to a "PRO API".
// If ArcScan ever stops answering this, backfill.ts falls back to the
// RPC-based scan automatically — nothing here is load-bearing on its own.
const ARCSCAN_API_URL = process.env.ARCSCAN_API_URL ?? 'https://testnet.arcscan.app';
const PAGE_DELAY_MS = 300; // politeness delay between pages on a shared public instance
const MAX_PAGES = 200; // safety valve, not a expected case given this app's tiny log volume
function toNormalizedLog(item) {
    return {
        // Blockscout pads unused topic slots with null (e.g. a 3-topic event
        // still shows a 4th null entry) — ethers only reads however many topics
        // the matched event actually needs, but strip the nulls anyway so the
        // array only ever contains real hex topics.
        topics: item.topics.filter((t) => t !== null),
        data: item.data,
        blockNumber: item.block_number,
        transactionHash: item.transaction_hash,
        logIndex: item.index
    };
}
export async function fetchAllLogsForAddress(address) {
    const all = [];
    let pageParams = null;
    let page = 0;
    while (true) {
        const url = new URL(`${ARCSCAN_API_URL}/api/v2/addresses/${address}/logs`);
        if (pageParams) {
            for (const [key, value] of Object.entries(pageParams)) {
                url.searchParams.set(key, String(value));
            }
        }
        const res = await fetch(url.toString());
        if (!res.ok) {
            throw new Error(`ArcScan logs API returned ${res.status} for ${address} (page ${page + 1})`);
        }
        const body = (await res.json());
        all.push(...body.items.map(toNormalizedLog));
        page++;
        if (!body.next_page_params || page >= MAX_PAGES)
            break;
        pageParams = body.next_page_params;
        await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    }
    console.log(`[blockscout] fetched ${all.length} log(s) for ${address} across ${page} page(s)`);
    return all;
}
