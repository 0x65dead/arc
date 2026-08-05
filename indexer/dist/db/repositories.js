import { pool } from './pool.js';
import { GRACE_PERIOD_SECONDS, toFullName } from '../chain/abis.js';
function exec(client) {
    return client ?? pool;
}
const nowSeconds = () => Math.floor(Date.now() / 1000);
// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
export async function upsertRegistration(row, client) {
    const db = exec(client);
    await db.query(`INSERT INTO registrations
       (name, token_id, owner, cost_wei, expires_at, block_number, log_index, tx_hash,
        registered_at, owner_block, owner_log_index)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $6, $7)
     ON CONFLICT (name) DO UPDATE SET
       token_id      = EXCLUDED.token_id,
       -- Expiry only ever moves forward: register sets it, renew extends it,
       -- and re-registering after grace sets a strictly later one. GREATEST is
       -- therefore correct regardless of the order the two streams arrive in.
       expires_at    = GREATEST(registrations.expires_at, EXCLUDED.expires_at),
       cost_wei      = CASE WHEN (EXCLUDED.block_number, EXCLUDED.log_index)
                               > (registrations.block_number, registrations.log_index)
                            THEN EXCLUDED.cost_wei ELSE registrations.cost_wei END,
       registered_at = CASE WHEN (EXCLUDED.block_number, EXCLUDED.log_index)
                               > (registrations.block_number, registrations.log_index)
                            THEN EXCLUDED.registered_at ELSE registrations.registered_at END,
       tx_hash       = CASE WHEN (EXCLUDED.block_number, EXCLUDED.log_index)
                               > (registrations.block_number, registrations.log_index)
                            THEN EXCLUDED.tx_hash ELSE registrations.tx_hash END,
       block_number  = GREATEST(registrations.block_number, EXCLUDED.block_number),
       log_index     = CASE WHEN (EXCLUDED.block_number, EXCLUDED.log_index)
                               > (registrations.block_number, registrations.log_index)
                            THEN EXCLUDED.log_index ELSE registrations.log_index END,
       -- Ownership has its own checkpoint because it is maintained by the
       -- Transfer stream, which advances independently of this one.
       owner         = CASE WHEN (EXCLUDED.owner_block, EXCLUDED.owner_log_index)
                               > (registrations.owner_block, registrations.owner_log_index)
                            THEN EXCLUDED.owner ELSE registrations.owner END,
       owner_block   = GREATEST(registrations.owner_block, EXCLUDED.owner_block),
       owner_log_index = CASE WHEN (EXCLUDED.owner_block, EXCLUDED.owner_log_index)
                               > (registrations.owner_block, registrations.owner_log_index)
                            THEN EXCLUDED.owner_log_index ELSE registrations.owner_log_index END`, [
        row.name,
        row.tokenId,
        row.owner.toLowerCase(),
        row.costWei,
        row.expiresAt,
        row.blockNumber,
        row.logIndex,
        row.txHash,
        row.blockTime,
    ]);
    // Catch-up 1: renewals recorded before this registration row existed. Without
    // this, a name renewed in a range the backfill read before it read the
    // registration would show its original expiry forever.
    await db.query(`UPDATE registrations r
        SET expires_at = GREATEST(r.expires_at,
              COALESCE((SELECT MAX(expires_at) FROM renewals WHERE name = r.name), 0))
      WHERE r.name = $1`, [row.name]);
    // Catch-up 2: the registrar's mint Transfer fires earlier in the same
    // transaction than the controller's NameRegistered, so the transfer row is
    // written before the name is known. v1 left `transfers.name` NULL forever.
    await db.query(`UPDATE transfers SET name = $1 WHERE token_id = $2 AND name IS NULL`, [
        row.name,
        row.tokenId,
    ]);
    await db.query(`UPDATE listings SET name = $1 WHERE token_id = $2 AND name IS NULL`, [
        row.name,
        row.tokenId,
    ]);
    await db.query(`UPDATE sales SET name = $1 WHERE token_id = $2 AND name IS NULL`, [
        row.name,
        row.tokenId,
    ]);
    await db.query(`UPDATE events SET name = $1 WHERE token_id = $2::NUMERIC AND name IS NULL`, [row.name, row.tokenId]);
}
export async function insertRenewal(row, client) {
    const db = exec(client);
    // Recorded unconditionally. The registration row may not exist yet; that is
    // not a reason to discard a renewal that happened.
    await db.query(`INSERT INTO renewals (name, cost_wei, expires_at, block_number, tx_hash, log_index, block_time)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tx_hash, log_index) DO NOTHING`, [row.name, row.costWei, row.expiresAt, row.blockNumber, row.txHash, row.logIndex, row.blockTime]);
    await db.query(`UPDATE registrations SET expires_at = GREATEST(expires_at, $2) WHERE name = $1`, [
        row.name,
        row.expiresAt,
    ]);
}
export async function insertTransfer(row, client) {
    const db = exec(client);
    await db.query(`INSERT INTO transfers (token_id, name, from_addr, to_addr, block_number, tx_hash, log_index, block_time)
     VALUES ($1, (SELECT name FROM registrations WHERE token_id = $1), $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tx_hash, log_index) DO NOTHING`, [
        row.tokenId,
        row.from.toLowerCase(),
        row.to.toLowerCase(),
        row.blockNumber,
        row.txHash,
        row.logIndex,
        row.blockTime,
    ]);
    await db.query(`UPDATE registrations
        SET owner = $2, owner_block = $3, owner_log_index = $4
      WHERE token_id = $1
        AND (owner_block, owner_log_index) < ($3, $4)`, [row.tokenId, row.to.toLowerCase(), row.blockNumber, row.logIndex]);
    // A transfer out from under a listing makes it unfillable — `getListing`
    // would report inactive, so the API must not keep offering it.
    await db.query(`UPDATE listings
        SET status = 'stale', updated_at = now()
      WHERE token_id = $1
        AND status = 'active'
        AND lower(seller) <> $2
        AND (block_number, log_index) < ($3, $4)`, [row.tokenId, row.to.toLowerCase(), row.blockNumber, row.logIndex]);
}
export async function upsertListing(row, client) {
    await exec(client).query(`INSERT INTO listings
       (token_id, name, seller, price_wei, currency, status, block_number, log_index, tx_hash, updated_at)
     VALUES ($1, (SELECT name FROM registrations WHERE token_id = $1), $2, $3, $4, 'active', $5, $6, $7, now())
     ON CONFLICT (token_id) DO UPDATE SET
       name         = COALESCE(EXCLUDED.name, listings.name),
       seller       = EXCLUDED.seller,
       price_wei    = EXCLUDED.price_wei,
       currency     = EXCLUDED.currency,
       status       = 'active',
       block_number = EXCLUDED.block_number,
       log_index    = EXCLUDED.log_index,
       tx_hash      = EXCLUDED.tx_hash,
       updated_at   = now()
     WHERE (EXCLUDED.block_number, EXCLUDED.log_index)
         > (listings.block_number, listings.log_index)`, [
        row.tokenId,
        row.seller.toLowerCase(),
        row.priceWei,
        row.currency,
        row.blockNumber,
        row.logIndex,
        row.txHash,
    ]);
}
export async function closeListing(args, client) {
    await exec(client).query(`UPDATE listings
        SET status = $2, block_number = $3, log_index = $4, tx_hash = $5, updated_at = now()
      WHERE token_id = $1
        AND (block_number, log_index) < ($3, $4)`, [args.tokenId, args.status, args.blockNumber, args.logIndex, args.txHash]);
}
export async function insertSale(row, client) {
    await exec(client).query(`INSERT INTO sales
       (token_id, name, seller, buyer, price_wei, fee_wei, block_number, tx_hash, log_index, block_time)
     VALUES ($1, (SELECT name FROM registrations WHERE token_id = $1), $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (tx_hash, log_index) DO NOTHING`, [
        row.tokenId,
        row.seller.toLowerCase(),
        row.buyer.toLowerCase(),
        row.priceWei,
        row.feeWei,
        row.blockNumber,
        row.txHash,
        row.logIndex,
        row.blockTime,
    ]);
}
export async function insertEvent(row, client) {
    await exec(client).query(`INSERT INTO events
       (kind, name, token_id, actor, counterparty, amount_wei, block_number, log_index, block_time, tx_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (tx_hash, log_index, kind) DO NOTHING`, [
        row.kind,
        row.name,
        row.tokenId,
        row.actor?.toLowerCase() ?? null,
        row.counterparty?.toLowerCase() ?? null,
        row.amountWei,
        row.blockNumber,
        row.logIndex,
        row.blockTime,
        row.txHash,
    ]);
}
// ---------------------------------------------------------------------------
// Sync checkpoints
// ---------------------------------------------------------------------------
export async function getSyncBlock(stream) {
    const { rows } = await pool.query('SELECT last_block FROM sync_state WHERE stream = $1', [stream]);
    return rows[0] ? Number(rows[0].last_block) : null;
}
/**
 * Advances a checkpoint. `GREATEST` means a slow backfill catching up over a
 * range the live listener already covered cannot rewind it — v1 had no such
 * guard, and a restart could re-open a window that had already been indexed.
 */
export async function setSyncBlock(stream, block, client) {
    await exec(client).query(`INSERT INTO sync_state (stream, last_block, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (stream) DO UPDATE
       SET last_block = GREATEST(sync_state.last_block, EXCLUDED.last_block),
           updated_at = now()`, [stream, block]);
}
export async function getSyncStreams() {
    const { rows } = await pool.query('SELECT stream, last_block, updated_at FROM sync_state ORDER BY stream');
    return rows.map((row) => ({
        stream: row.stream,
        lastBlock: Number(row.last_block),
        updatedAt: row.updated_at.toISOString(),
    }));
}
export async function getStats() {
    const now = nowSeconds();
    // One round trip. NUMERIC comes back from pg as a string, which is what the
    // API returns — these are wei values and must never touch a JS number.
    const { rows } = await pool.query(`SELECT
       (SELECT COALESCE(SUM(cost_wei), 0) FROM registrations)
         + (SELECT COALESCE(SUM(cost_wei), 0) FROM renewals)          AS total_revenue,
       (SELECT COUNT(*) FROM registrations)                            AS names_registered,
       (SELECT COUNT(*) FROM registrations WHERE expires_at > $1)      AS names_active,
       (SELECT COUNT(*) FROM registrations
         WHERE expires_at <= $1 AND expires_at + $2 > $1)              AS names_in_grace,
       (SELECT COUNT(*) FROM listings WHERE status = 'active')         AS active_listings,
       (SELECT COALESCE(SUM(price_wei), 0) FROM sales)                 AS sales_volume`, [now, GRACE_PERIOD_SECONDS]);
    const row = rows[0];
    return {
        totalRevenueWei: row.total_revenue,
        namesRegistered: Number(row.names_registered),
        namesActive: Number(row.names_active),
        namesInGrace: Number(row.names_in_grace),
        activeListings: Number(row.active_listings),
        totalSalesVolumeWei: row.sales_volume,
    };
}
/**
 * v1 answered this with `expires_at > now`, which reported a name as available
 * the instant it expired — 90 days before the registrar would actually let
 * anyone register it. Every such answer was wrong, and `register` reverted.
 */
export async function getAvailability(input) {
    const name = toFullName(input);
    const now = nowSeconds();
    const { rows } = await pool.query('SELECT owner, expires_at FROM registrations WHERE name = $1', [name]);
    if (rows.length === 0) {
        return { name, taken: false, status: 'available' };
    }
    const expiresAt = Number(rows[0].expires_at);
    const releasesAt = expiresAt + GRACE_PERIOD_SECONDS;
    if (expiresAt > now) {
        return { name, taken: true, status: 'registered', owner: rows[0].owner, expiresAt, releasesAt };
    }
    if (releasesAt > now) {
        return { name, taken: true, status: 'grace', owner: rows[0].owner, expiresAt, releasesAt };
    }
    return { name, taken: false, status: 'available', expiresAt, releasesAt };
}
const DOMAIN_SELECT = `
  SELECT r.name, r.token_id, r.owner, r.expires_at, r.registered_at, r.block_number, r.tx_hash,
         l.token_id     AS l_token_id,
         l.name         AS l_name,
         l.seller       AS l_seller,
         l.price_wei    AS l_price_wei,
         l.currency     AS l_currency,
         l.block_number AS l_block_number,
         l.updated_at   AS l_updated_at
    FROM registrations r
    LEFT JOIN listings l ON l.token_id = r.token_id AND l.status = 'active'
`;
function toDomain(row) {
    return {
        name: row.name,
        tokenId: row.token_id,
        owner: row.owner,
        expiresAt: Number(row.expires_at),
        registeredAt: Number(row.registered_at ?? 0),
        blockNumber: Number(row.block_number),
        txHash: row.tx_hash,
        listing: row.l_token_id && row.l_seller && row.l_price_wei
            ? {
                tokenId: row.l_token_id,
                name: row.l_name ?? row.name,
                seller: row.l_seller,
                priceWei: row.l_price_wei,
                currency: Number(row.l_currency ?? 0),
                blockNumber: Number(row.l_block_number ?? 0),
                updatedAt: (row.l_updated_at ?? new Date(0)).toISOString(),
            }
            : null,
    };
}
export async function getDomainsByOwner(owner, limit = 200) {
    const { rows } = await pool.query(`${DOMAIN_SELECT} WHERE lower(r.owner) = lower($1) ORDER BY r.expires_at ASC LIMIT $2`, [owner, limit]);
    return rows.map(toDomain);
}
export async function getDomain(input) {
    const { rows } = await pool.query(`${DOMAIN_SELECT} WHERE r.name = $1`, [
        toFullName(input),
    ]);
    return rows[0] ? toDomain(rows[0]) : null;
}
export function encodeCursor(cursor) {
    return Buffer.from(`${cursor.blockNumber}:${cursor.logIndex}`).toString('base64url');
}
export function decodeCursor(raw) {
    if (!raw)
        return null;
    try {
        const [block, index] = Buffer.from(raw, 'base64url').toString('utf8').split(':');
        const blockNumber = Number(block);
        const logIndex = Number(index);
        if (!Number.isInteger(blockNumber) || !Number.isInteger(logIndex))
            return null;
        return { blockNumber, logIndex };
    }
    catch {
        return null;
    }
}
export async function getMarketplace(options) {
    const cursor = decodeCursor(options.cursor);
    const { rows } = await pool.query(`SELECT token_id, name, seller, price_wei, currency, block_number, log_index, updated_at
       FROM listings
      WHERE status = 'active'
        AND ($1::BIGINT IS NULL OR (block_number, log_index) < ($1::BIGINT, $2::INTEGER))
      ORDER BY block_number DESC, log_index DESC
      LIMIT $3`, [cursor?.blockNumber ?? null, cursor?.logIndex ?? 0, options.limit + 1]);
    const hasMore = rows.length > options.limit;
    const page = hasMore ? rows.slice(0, options.limit) : rows;
    const last = page[page.length - 1];
    return {
        items: page.map((row) => ({
            tokenId: row.token_id,
            name: row.name,
            seller: row.seller,
            priceWei: row.price_wei,
            currency: Number(row.currency ?? 0),
            blockNumber: Number(row.block_number),
            updatedAt: row.updated_at.toISOString(),
        })),
        nextCursor: hasMore && last
            ? encodeCursor({ blockNumber: Number(last.block_number), logIndex: last.log_index })
            : null,
    };
}
export async function getActivity(options) {
    const cursor = decodeCursor(options.cursor);
    const name = options.name ? toFullName(options.name) : null;
    const { rows } = await pool.query(
    /*
     * The name is resolved against `registrations` rather than trusted from the
     * event row.
     *
     * Market and transfer logs carry only a token id — the name lives in the
     * registration. `upsertRegistration` backfills `events.name` for rows that
     * already exist, but that only fixes one ordering: an event ingested
     * *after* its registration (the normal case, since the streams run
     * controller-first) is written with NULL and nothing ever revisits it. The
     * join covers both directions and cannot drift. `registrations.token_id` is
     * uniquely indexed, so this stays a single index lookup per row.
     */
    `SELECT e.kind,
            COALESCE(e.name, r.name) AS name,
            e.token_id, e.actor, e.counterparty, e.amount_wei,
            e.block_number, e.log_index, e.block_time, e.tx_hash, e.created_at
       FROM events e
       LEFT JOIN registrations r ON r.token_id = e.token_id
      WHERE ($1::TEXT IS NULL OR e.name = $1::TEXT OR (e.name IS NULL AND r.name = $1::TEXT))
        AND ($2::BIGINT IS NULL OR (e.block_number, e.log_index) < ($2::BIGINT, $3::INTEGER))
      ORDER BY e.block_number DESC, e.log_index DESC
      LIMIT $4`, [name, cursor?.blockNumber ?? null, cursor?.logIndex ?? 0, options.limit + 1]);
    const hasMore = rows.length > options.limit;
    const page = hasMore ? rows.slice(0, options.limit) : rows;
    const last = page[page.length - 1];
    return {
        items: page.map((row) => ({
            kind: row.kind,
            name: row.name,
            tokenId: row.token_id,
            actor: row.actor,
            counterparty: row.counterparty,
            amountWei: row.amount_wei,
            blockNumber: Number(row.block_number),
            txHash: row.tx_hash,
            // Prefer the block timestamp; `created_at` only says when this database
            // happened to write the row, which after a backfill is meaningless.
            at: row.block_time
                ? new Date(Number(row.block_time) * 1000).toISOString()
                : row.created_at.toISOString(),
        })),
        nextCursor: hasMore && last
            ? encodeCursor({ blockNumber: Number(last.block_number), logIndex: last.log_index })
            : null,
    };
}
/** Cheapest possible query that proves the database is reachable and writable. */
export async function ping() {
    await pool.query('SELECT 1');
}
