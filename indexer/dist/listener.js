import { ethers } from 'ethers';
import { CONTROLLER_EVENTS, MARKET_EVENTS, REGISTRAR_EVENTS, TOPICS, labelToId } from './abis.js';
import { insertRenewal, insertSale, insertTransfer, markListingStatus, upsertListing, upsertRegistration } from './db.js';
const CONTROLLER_ADDRESS = process.env.CONTROLLER_ADDRESS;
const REGISTRAR_ADDRESS = process.env.REGISTRAR_ADDRESS;
const MARKET_ADDRESS = process.env.MARKET_ADDRESS;
// One handler per log, reused verbatim from backfill's per-log logic, just
// wired to a live subscription instead of a chunked historical scan.
async function handleLog(log) {
    try {
        if (log.address.toLowerCase() === CONTROLLER_ADDRESS.toLowerCase()) {
            if (log.topics[0] === TOPICS.NameRegistered) {
                const parsed = CONTROLLER_EVENTS.parseLog(log);
                if (!parsed)
                    return;
                const name = String(parsed.args.name).trim().toLowerCase().replace('.arc', '');
                if (!name)
                    return;
                await upsertRegistration({
                    name,
                    tokenId: labelToId(name),
                    owner: parsed.args.owner,
                    costWei: parsed.args.cost.toString(),
                    expiresAt: Number(parsed.args.expires),
                    blockNumber: log.blockNumber,
                    txHash: log.transactionHash
                });
                console.log(`[listener] registered ${name}.arc @ block ${log.blockNumber}`);
            }
            else if (log.topics[0] === TOPICS.NameRenewed) {
                const parsed = CONTROLLER_EVENTS.parseLog(log);
                if (!parsed)
                    return;
                const name = String(parsed.args.name).trim().toLowerCase().replace('.arc', '');
                if (!name)
                    return;
                await insertRenewal({
                    name,
                    costWei: parsed.args.cost.toString(),
                    expiresAt: Number(parsed.args.expires),
                    blockNumber: log.blockNumber,
                    txHash: log.transactionHash,
                    logIndex: log.index
                });
                console.log(`[listener] renewed ${name}.arc @ block ${log.blockNumber}`);
            }
        }
        else if (log.address.toLowerCase() === REGISTRAR_ADDRESS.toLowerCase()) {
            if (log.topics[0] === TOPICS.Transfer) {
                const parsed = REGISTRAR_EVENTS.parseLog(log);
                if (!parsed)
                    return;
                await insertTransfer({
                    tokenId: parsed.args.id.toString(),
                    fromAddr: parsed.args.from,
                    toAddr: parsed.args.to,
                    blockNumber: log.blockNumber,
                    txHash: log.transactionHash,
                    logIndex: log.index
                });
                console.log(`[listener] transfer token ${parsed.args.id} -> ${parsed.args.to} @ block ${log.blockNumber}`);
            }
        }
        else if (log.address.toLowerCase() === MARKET_ADDRESS.toLowerCase()) {
            const parsed = MARKET_EVENTS.parseLog(log);
            if (!parsed)
                return;
            if (log.topics[0] === TOPICS.Listed || log.topics[0] === TOPICS.PriceChanged) {
                await upsertListing({
                    tokenId: parsed.args.id.toString(),
                    seller: parsed.args.seller,
                    priceWei: parsed.args.price.toString(),
                    blockNumber: log.blockNumber,
                    txHash: log.transactionHash
                });
            }
            else if (log.topics[0] === TOPICS.Unlisted) {
                await markListingStatus(parsed.args.id.toString(), 'cancelled');
            }
            else if (log.topics[0] === TOPICS.Sold) {
                const tokenId = parsed.args.id.toString();
                await insertSale({
                    tokenId,
                    seller: parsed.args.seller,
                    buyer: parsed.args.buyer,
                    priceWei: parsed.args.price.toString(),
                    feeWei: parsed.args.fee.toString(),
                    blockNumber: log.blockNumber,
                    txHash: log.transactionHash,
                    logIndex: log.index
                });
                await markListingStatus(tokenId, 'sold');
            }
        }
    }
    catch (err) {
        // A single bad log should never take down the listener — log it and
        // move on; the next backfill run will reconcile anything missed.
        console.error('[listener] failed to handle log', log.transactionHash, err);
    }
}
export function startListener(wssUrl) {
    const addresses = [CONTROLLER_ADDRESS, REGISTRAR_ADDRESS, MARKET_ADDRESS];
    let reconnectAttempt = 0;
    // Reconnects in place rather than exiting the process. The original
    // version called process.exit(1) on disconnect, assuming a process
    // manager (pm2/systemd/Docker) would restart it — fine on a real server,
    // but on Termux (or any plain `node dist/index.js` with nothing watching
    // it) that just kills the entire indexer, API included, until someone
    // notices and reruns `npm start` by hand. A dropped WebSocket is common on
    // mobile networks / backgrounded apps, so this needs to recover on its
    // own instead of treating every drop as fatal.
    function connect() {
        const provider = new ethers.WebSocketProvider(wssUrl);
        provider.on({ address: addresses }, (log) => {
            void handleLog(log);
        });
        const ws = provider.websocket;
        ws?.on('open', () => {
            reconnectAttempt = 0;
            console.log('[listener] subscribed to NameRegistered/NameRenewed/Transfer/Listed/Unlisted/Sold');
        });
        ws?.on('error', (err) => {
            console.error('[listener] websocket error:', err);
        });
        ws?.on('close', () => {
            reconnectAttempt++;
            const delayMs = Math.min(1000 * 2 ** reconnectAttempt, 30_000);
            console.error(`[listener] websocket closed — reconnecting in ${delayMs}ms (attempt ${reconnectAttempt})`);
            setTimeout(connect, delayMs);
        });
    }
    connect();
}
