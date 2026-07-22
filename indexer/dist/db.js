import pg from 'pg';
const { Pool } = pg;
export const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});
// ---------- sync checkpoints ----------
export async function getSyncBlock(stream, fallback) {
    const { rows } = await pool.query('SELECT last_block FROM sync_state WHERE stream = $1', [stream]);
    return rows.length > 0 ? Number(rows[0].last_block) : fallback;
}
export async function setSyncBlock(stream, block) {
    await pool.query(`INSERT INTO sync_state (stream, last_block, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (stream) DO UPDATE SET last_block = $2, updated_at = now()`, [stream, block]);
}
// ---------- writes (shared by backfill + live listener) ----------
export async function upsertRegistration(row) {
    await pool.query(`INSERT INTO registrations (name, token_id, owner, cost_wei, expires_at, block_number, tx_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (name) DO UPDATE SET
       owner = EXCLUDED.owner,
       cost_wei = EXCLUDED.cost_wei,
       expires_at = EXCLUDED.expires_at,
       block_number = EXCLUDED.block_number,
       tx_hash = EXCLUDED.tx_hash`, [row.name, row.tokenId, row.owner, row.costWei, row.expiresAt, row.blockNumber, row.txHash]);
}
export async function insertRenewal(row) {
    // Renewal events can arrive for names this indexer hasn't seen a
    // NameRegistered for yet (e.g. backfill processing renewals before
    // registrations in the same pass) — skip quietly rather than violating
    // the foreign key; a later re-run of backfill will backfill the gap.
    const { rows } = await pool.query('SELECT 1 FROM registrations WHERE name = $1', [row.name]);
    if (rows.length === 0) {
        console.warn(`[db] renewal for unknown name "${row.name}" — skipping until registration is indexed`);
        return;
    }
    // ON CONFLICT DO NOTHING: the same log can be seen twice (ArcScan backfill
    // re-pulling full history on every reconcile pass, the live listener
    // picking up the same event the next backfill also covers, etc.) —
    // (tx_hash, log_index) uniquely identifies one on-chain log, so a repeat
    // is silently a no-op instead of a duplicate row.
    await pool.query(`INSERT INTO renewals (name, cost_wei, expires_at, block_number, tx_hash, log_index)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tx_hash, log_index) DO NOTHING`, [row.name, row.costWei, row.expiresAt, row.blockNumber, row.txHash, row.logIndex]);
    await pool.query(`UPDATE registrations SET expires_at = GREATEST(expires_at, $2) WHERE name = $1`, [row.name, row.expiresAt]);
}
export async function insertTransfer(row) {
    await pool.query(`INSERT INTO transfers (token_id, from_addr, to_addr, block_number, tx_hash, log_index)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tx_hash, log_index) DO NOTHING`, [row.tokenId, row.fromAddr, row.toAddr, row.blockNumber, row.txHash, row.logIndex]);
    // Keep registrations.owner current. Always safe to re-run even when the
    // insert above was a no-op — setting the same owner again is harmless,
    // and this still needs to run for a genuinely new transfer regardless of
    // whether the transfers-table insert was itself a duplicate.
    await pool.query(`UPDATE registrations SET owner = $2 WHERE token_id = $1`, [row.tokenId, row.toAddr]);
}
export async function upsertListing(row) {
    await pool.query(`INSERT INTO listings (token_id, seller, price_wei, status, block_number, tx_hash, updated_at)
     VALUES ($1, $2, $3, 'active', $4, $5, now())
     ON CONFLICT (token_id) DO UPDATE SET
       seller = EXCLUDED.seller,
       price_wei = EXCLUDED.price_wei,
       status = 'active',
       block_number = EXCLUDED.block_number,
       tx_hash = EXCLUDED.tx_hash,
       updated_at = now()`, [row.tokenId, row.seller, row.priceWei, row.blockNumber, row.txHash]);
}
export async function markListingStatus(tokenId, status) {
    await pool.query(`UPDATE listings SET status = $2, updated_at = now() WHERE token_id = $1`, [tokenId, status]);
}
export async function insertSale(row) {
    await pool.query(`INSERT INTO sales (token_id, seller, buyer, price_wei, fee_wei, block_number, tx_hash, log_index)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tx_hash, log_index) DO NOTHING`, [row.tokenId, row.seller, row.buyer, row.priceWei, row.feeWei, row.blockNumber, row.txHash, row.logIndex]);
}
// ---------- reads (used by the API layer) ----------
export async function getStats() {
    const { rows } = await pool.query(`
    SELECT
      (SELECT COALESCE(SUM(cost_wei), 0) FROM registrations) AS reg_revenue,
      (SELECT COALESCE(SUM(cost_wei), 0) FROM renewals) AS renew_revenue,
      (SELECT COUNT(*) FROM registrations) AS names_claimed
  `);
    const row = rows[0];
    const totalRevenueWei = (BigInt(row.reg_revenue) + BigInt(row.renew_revenue)).toString();
    return {
        totalRevenueWei,
        namesClaimed: Number(row.names_claimed)
    };
}
export async function getAvailability(name) {
    const { rows } = await pool.query('SELECT owner, expires_at FROM registrations WHERE name = $1', [name]);
    if (rows.length === 0) {
        return { taken: false };
    }
    const row = rows[0];
    const expiresAt = Number(row.expires_at);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (expiresAt < nowSeconds) {
        // Expired — the contract's own available() is still the final word if
        // there's a grace period this table doesn't model, but there's no
        // reason to report it as taken here.
        return { taken: false };
    }
    return { taken: true, owner: row.owner, expiresAt };
}
export async function getDomainsByOwner(owner) {
    const { rows } = await pool.query(`SELECT name, token_id, owner, expires_at, block_number, tx_hash
     FROM registrations
     WHERE lower(owner) = lower($1)
     ORDER BY block_number DESC`, [owner]);
    return rows;
}
export async function getActiveListings() {
    const { rows } = await pool.query(`SELECT l.token_id, r.name AS name, l.seller, l.price_wei, l.updated_at
     FROM listings l
     LEFT JOIN registrations r ON r.token_id = l.token_id
     WHERE l.status = 'active'
     ORDER BY l.updated_at DESC`);
    return rows;
}
export async function getSyncStatus() {
    const { rows } = await pool.query('SELECT stream, last_block, updated_at FROM sync_state ORDER BY stream');
    return rows;
}
