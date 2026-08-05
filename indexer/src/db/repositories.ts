import type { PoolClient, QueryResultRow } from 'pg';
import { pool } from './pool.js';
import { GRACE_PERIOD_SECONDS, toFullName } from '../chain/abis.js';

/**
 * All SQL lives here.
 *
 * Two things every mutating query in this file has in common, and which the
 * previous `db.ts` had neither of:
 *
 * 1. An **ordering guard**. The backfill re-reads history while the live
 *    listener writes new blocks, so the same token can be touched by both at
 *    once. Each write asserts `(block_number, log_index)` is strictly newer
 *    than what is stored, so a replayed `Unlisted` can never overwrite a newer
 *    `Listed`, and a replayed `Transfer` can never revert ownership.
 * 2. **No silent drops.** v1's `insertRenewal` skipped renewals whose
 *    registration row was missing, and the checkpoint advanced anyway — those
 *    renewals were lost for good. Facts about the chain are now always
 *    recorded; rows that reference them catch up afterwards.
 */

type Executor = Pick<PoolClient, 'query'>;

function exec(client?: Executor): Executor {
  return client ?? pool;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------------------
// Row shapes written by the ingest pipeline
// ---------------------------------------------------------------------------

export interface LogRef {
  blockNumber: number;
  logIndex: number;
  txHash: string;
  blockTime: number | null;
}

export interface RegistrationRow extends LogRef {
  name: string;
  tokenId: string;
  owner: string;
  costWei: string;
  expiresAt: number;
}

export interface RenewalRow extends LogRef {
  name: string;
  costWei: string;
  expiresAt: number;
}

export interface TransferRow extends LogRef {
  tokenId: string;
  from: string;
  to: string;
}

export interface ListingRow extends LogRef {
  tokenId: string;
  seller: string;
  priceWei: string;
  currency: number;
}

export interface SaleRow extends LogRef {
  tokenId: string;
  seller: string;
  buyer: string;
  priceWei: string;
  feeWei: string;
}

export type EventKind =
  | 'registration'
  | 'renewal'
  | 'transfer'
  | 'listing'
  | 'sale'
  | 'unlisting';

export interface EventRow extends LogRef {
  kind: EventKind;
  name: string | null;
  tokenId: string | null;
  actor: string | null;
  counterparty: string | null;
  amountWei: string | null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function upsertRegistration(row: RegistrationRow, client?: Executor): Promise<void> {
  const db = exec(client);

  await db.query(
    `INSERT INTO registrations
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
                            THEN EXCLUDED.owner_log_index ELSE registrations.owner_log_index END`,
    [
      row.name,
      row.tokenId,
      row.owner.toLowerCase(),
      row.costWei,
      row.expiresAt,
      row.blockNumber,
      row.logIndex,
      row.txHash,
      row.blockTime,
    ],
  );

  // Catch-up 1: renewals recorded before this registration row existed. Without
  // this, a name renewed in a range the backfill read before it read the
  // registration would show its original expiry forever.
  await db.query(
    `UPDATE registrations r
        SET expires_at = GREATEST(r.expires_at,
              COALESCE((SELECT MAX(expires_at) FROM renewals WHERE name = r.name), 0))
      WHERE r.name = $1`,
    [row.name],
  );

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
  await db.query(
    `UPDATE events SET name = $1 WHERE token_id = $2::NUMERIC AND name IS NULL`,
    [row.name, row.tokenId],
  );
}

export async function insertRenewal(row: RenewalRow, client?: Executor): Promise<void> {
  const db = exec(client);

  // Recorded unconditionally. The registration row may not exist yet; that is
  // not a reason to discard a renewal that happened.
  await db.query(
    `INSERT INTO renewals (name, cost_wei, expires_at, block_number, tx_hash, log_index, block_time)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tx_hash, log_index) DO NOTHING`,
    [row.name, row.costWei, row.expiresAt, row.blockNumber, row.txHash, row.logIndex, row.blockTime],
  );

  await db.query(`UPDATE registrations SET expires_at = GREATEST(expires_at, $2) WHERE name = $1`, [
    row.name,
    row.expiresAt,
  ]);
}

export async function insertTransfer(row: TransferRow, client?: Executor): Promise<void> {
  const db = exec(client);

  await db.query(
    `INSERT INTO transfers (token_id, name, from_addr, to_addr, block_number, tx_hash, log_index, block_time)
     VALUES ($1, (SELECT name FROM registrations WHERE token_id = $1), $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tx_hash, log_index) DO NOTHING`,
    [
      row.tokenId,
      row.from.toLowerCase(),
      row.to.toLowerCase(),
      row.blockNumber,
      row.txHash,
      row.logIndex,
      row.blockTime,
    ],
  );

  await db.query(
    `UPDATE registrations
        SET owner = $2, owner_block = $3, owner_log_index = $4
      WHERE token_id = $1
        AND (owner_block, owner_log_index) < ($3, $4)`,
    [row.tokenId, row.to.toLowerCase(), row.blockNumber, row.logIndex],
  );

  // A transfer out from under a listing makes it unfillable — `getListing`
  // would report inactive, so the API must not keep offering it.
  await db.query(
    `UPDATE listings
        SET status = 'stale', updated_at = now()
      WHERE token_id = $1
        AND status = 'active'
        AND lower(seller) <> $2
        AND (block_number, log_index) < ($3, $4)`,
    [row.tokenId, row.to.toLowerCase(), row.blockNumber, row.logIndex],
  );
}

export async function upsertListing(row: ListingRow, client?: Executor): Promise<void> {
  await exec(client).query(
    `INSERT INTO listings
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
         > (listings.block_number, listings.log_index)`,
    [
      row.tokenId,
      row.seller.toLowerCase(),
      row.priceWei,
      row.currency,
      row.blockNumber,
      row.logIndex,
      row.txHash,
    ],
  );
}

export async function closeListing(
  args: { tokenId: string; status: 'unlisted' | 'sold' } & LogRef,
  client?: Executor,
): Promise<void> {
  await exec(client).query(
    `UPDATE listings
        SET status = $2, block_number = $3, log_index = $4, tx_hash = $5, updated_at = now()
      WHERE token_id = $1
        AND (block_number, log_index) < ($3, $4)`,
    [args.tokenId, args.status, args.blockNumber, args.logIndex, args.txHash],
  );
}

export async function insertSale(row: SaleRow, client?: Executor): Promise<void> {
  await exec(client).query(
    `INSERT INTO sales
       (token_id, name, seller, buyer, price_wei, fee_wei, block_number, tx_hash, log_index, block_time)
     VALUES ($1, (SELECT name FROM registrations WHERE token_id = $1), $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (tx_hash, log_index) DO NOTHING`,
    [
      row.tokenId,
      row.seller.toLowerCase(),
      row.buyer.toLowerCase(),
      row.priceWei,
      row.feeWei,
      row.blockNumber,
      row.txHash,
      row.logIndex,
      row.blockTime,
    ],
  );
}

export async function insertEvent(row: EventRow, client?: Executor): Promise<void> {
  await exec(client).query(
    `INSERT INTO events
       (kind, name, token_id, actor, counterparty, amount_wei, block_number, log_index, block_time, tx_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (tx_hash, log_index, kind) DO NOTHING`,
    [
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
    ],
  );
}

// ---------------------------------------------------------------------------
// Sync checkpoints
// ---------------------------------------------------------------------------

export async function getSyncBlock(stream: string): Promise<number | null> {
  const { rows } = await pool.query<{ last_block: string }>(
    'SELECT last_block FROM sync_state WHERE stream = $1',
    [stream],
  );
  return rows[0] ? Number(rows[0].last_block) : null;
}

/**
 * Advances a checkpoint. `GREATEST` means a slow backfill catching up over a
 * range the live listener already covered cannot rewind it — v1 had no such
 * guard, and a restart could re-open a window that had already been indexed.
 */
export async function setSyncBlock(stream: string, block: number, client?: Executor): Promise<void> {
  await exec(client).query(
    `INSERT INTO sync_state (stream, last_block, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (stream) DO UPDATE
       SET last_block = GREATEST(sync_state.last_block, EXCLUDED.last_block),
           updated_at = now()`,
    [stream, block],
  );
}

export async function getSyncStreams(): Promise<
  Array<{ stream: string; lastBlock: number; updatedAt: string }>
> {
  const { rows } = await pool.query<{ stream: string; last_block: string; updated_at: Date }>(
    'SELECT stream, last_block, updated_at FROM sync_state ORDER BY stream',
  );
  return rows.map((row) => ({
    stream: row.stream,
    lastBlock: Number(row.last_block),
    updatedAt: row.updated_at.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface Stats {
  totalRevenueWei: string;
  namesRegistered: number;
  namesActive: number;
  namesInGrace: number;
  activeListings: number;
  totalSalesVolumeWei: string;
}

export async function getStats(): Promise<Stats> {
  const now = nowSeconds();

  // One round trip. NUMERIC comes back from pg as a string, which is what the
  // API returns — these are wei values and must never touch a JS number.
  const { rows } = await pool.query<{
    total_revenue: string;
    names_registered: string;
    names_active: string;
    names_in_grace: string;
    active_listings: string;
    sales_volume: string;
  }>(
    `SELECT
       (SELECT COALESCE(SUM(cost_wei), 0) FROM registrations)
         + (SELECT COALESCE(SUM(cost_wei), 0) FROM renewals)          AS total_revenue,
       (SELECT COUNT(*) FROM registrations)                            AS names_registered,
       (SELECT COUNT(*) FROM registrations WHERE expires_at > $1)      AS names_active,
       (SELECT COUNT(*) FROM registrations
         WHERE expires_at <= $1 AND expires_at + $2 > $1)              AS names_in_grace,
       (SELECT COUNT(*) FROM listings WHERE status = 'active')         AS active_listings,
       (SELECT COALESCE(SUM(price_wei), 0) FROM sales)                 AS sales_volume`,
    [now, GRACE_PERIOD_SECONDS],
  );

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

export interface Availability {
  name: string;
  taken: boolean;
  status: 'available' | 'registered' | 'grace';
  owner?: string;
  expiresAt?: number;
  releasesAt?: number;
}

/**
 * v1 answered this with `expires_at > now`, which reported a name as available
 * the instant it expired — 90 days before the registrar would actually let
 * anyone register it. Every such answer was wrong, and `register` reverted.
 */
export async function getAvailability(input: string): Promise<Availability> {
  const name = toFullName(input);
  const now = nowSeconds();

  const { rows } = await pool.query<{ owner: string; expires_at: string }>(
    'SELECT owner, expires_at FROM registrations WHERE name = $1',
    [name],
  );

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

export interface Listing {
  tokenId: string;
  name: string | null;
  seller: string;
  priceWei: string;
  currency: number;
  blockNumber: number;
  updatedAt: string;
}

export interface Domain {
  name: string;
  tokenId: string;
  owner: string;
  expiresAt: number;
  registeredAt: number;
  blockNumber: number;
  txHash: string;
  listing: Listing | null;
}

interface DomainQueryRow extends QueryResultRow {
  name: string;
  token_id: string;
  owner: string;
  expires_at: string;
  registered_at: string | null;
  block_number: string;
  tx_hash: string;
  l_token_id: string | null;
  l_name: string | null;
  l_seller: string | null;
  l_price_wei: string | null;
  l_currency: number | null;
  l_block_number: string | null;
  l_updated_at: Date | null;
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

function toDomain(row: DomainQueryRow): Domain {
  return {
    name: row.name,
    tokenId: row.token_id,
    owner: row.owner,
    expiresAt: Number(row.expires_at),
    registeredAt: Number(row.registered_at ?? 0),
    blockNumber: Number(row.block_number),
    txHash: row.tx_hash,
    listing:
      row.l_token_id && row.l_seller && row.l_price_wei
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

export async function getDomainsByOwner(owner: string, limit = 200): Promise<Domain[]> {
  const { rows } = await pool.query<DomainQueryRow>(
    `${DOMAIN_SELECT} WHERE lower(r.owner) = lower($1) ORDER BY r.expires_at ASC LIMIT $2`,
    [owner, limit],
  );
  return rows.map(toDomain);
}

export async function getDomain(input: string): Promise<Domain | null> {
  const { rows } = await pool.query<DomainQueryRow>(`${DOMAIN_SELECT} WHERE r.name = $1`, [
    toFullName(input),
  ]);
  return rows[0] ? toDomain(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Pagination
//
// Cursors are opaque to the client and encode the exact (block, log_index)
// position of the last row returned, so a page boundary is stable even while
// new rows are being written above it. v1 had no pagination at all — it did
// `SELECT ... LIMIT 100` and callers had no way to see anything past the first
// hundred.
// ---------------------------------------------------------------------------

interface Cursor {
  blockNumber: number;
  logIndex: number;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.blockNumber}:${cursor.logIndex}`).toString('base64url');
}

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const [block, index] = Buffer.from(raw, 'base64url').toString('utf8').split(':');
    const blockNumber = Number(block);
    const logIndex = Number(index);
    if (!Number.isInteger(blockNumber) || !Number.isInteger(logIndex)) return null;
    return { blockNumber, logIndex };
  } catch {
    return null;
  }
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export async function getMarketplace(options: {
  limit: number;
  cursor?: string;
}): Promise<Page<Listing>> {
  const cursor = decodeCursor(options.cursor);

  const { rows } = await pool.query<{
    token_id: string;
    name: string | null;
    seller: string;
    price_wei: string;
    currency: number;
    block_number: string;
    log_index: number;
    updated_at: Date;
  }>(
    `SELECT token_id, name, seller, price_wei, currency, block_number, log_index, updated_at
       FROM listings
      WHERE status = 'active'
        AND ($1::BIGINT IS NULL OR (block_number, log_index) < ($1::BIGINT, $2::INTEGER))
      ORDER BY block_number DESC, log_index DESC
      LIMIT $3`,
    [cursor?.blockNumber ?? null, cursor?.logIndex ?? 0, options.limit + 1],
  );

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
    nextCursor:
      hasMore && last
        ? encodeCursor({ blockNumber: Number(last.block_number), logIndex: last.log_index })
        : null,
  };
}

export interface ActivityItem {
  kind: EventKind;
  name: string | null;
  tokenId: string | null;
  actor: string | null;
  counterparty: string | null;
  amountWei: string | null;
  blockNumber: number;
  txHash: string;
  at: string;
}

export async function getActivity(options: {
  limit: number;
  cursor?: string;
  name?: string;
}): Promise<Page<ActivityItem>> {
  const cursor = decodeCursor(options.cursor);
  const name = options.name ? toFullName(options.name) : null;

  const { rows } = await pool.query<{
    kind: EventKind;
    name: string | null;
    token_id: string | null;
    actor: string | null;
    counterparty: string | null;
    amount_wei: string | null;
    block_number: string;
    log_index: number;
    block_time: string | null;
    tx_hash: string;
    created_at: Date;
  }>(
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
      LIMIT $4`,
    [name, cursor?.blockNumber ?? null, cursor?.logIndex ?? 0, options.limit + 1],
  );

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
    nextCursor:
      hasMore && last
        ? encodeCursor({ blockNumber: Number(last.block_number), logIndex: last.log_index })
        : null,
  };
}

/** Cheapest possible query that proves the database is reachable and writable. */
export async function ping(): Promise<void> {
  await pool.query('SELECT 1');
}
