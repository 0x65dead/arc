-- 002_v2.sql
--
-- Everything the redesign changes. Written so it can run against a database
-- that already has v1 data, and against an empty one, with the same result.

-- ---------------------------------------------------------------------------
-- Drop the renewals -> registrations foreign key.
--
-- This constraint was the cause of a silent data-loss path. `insertRenewal`
-- had to check whether the registration row existed and skip the renewal if it
-- didn't, with a comment claiming "a later re-run of backfill will backfill the
-- gap". It won't: the RPC backfill advances `sync_state` for the `renewed`
-- stream as it goes, so the skipped range is never re-read, and the renewal —
-- along with its revenue — is gone permanently. A renewal is a fact about the
-- chain; it does not depend on this database having seen the registration.
-- ---------------------------------------------------------------------------
ALTER TABLE renewals DROP CONSTRAINT IF EXISTS renewals_name_fkey;

-- ---------------------------------------------------------------------------
-- Ordering guards.
--
-- The backfill re-reads history while the live listener is writing, so the two
-- can apply events to the same token out of order — an older `Unlisted` from a
-- replay could land after a newer `Listed` and wrongly hide a live listing.
-- Recording (block_number, log_index) lets every mutating write assert it is
-- strictly newer than what is already stored.
-- ---------------------------------------------------------------------------
ALTER TABLE listings      ADD COLUMN IF NOT EXISTS log_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS log_index INTEGER NOT NULL DEFAULT 0;

-- Ownership is maintained from the Transfer stream; without this the same
-- replay race can revert `owner` to a previous holder.
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS owner_block BIGINT NOT NULL DEFAULT 0;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS owner_log_index INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Marketplace currency.
--
-- `ArcMarket.buy()` requires `listingCurrency[id] == 0` (native). The event
-- doesn't carry the discriminant, so it's read from the contract when a
-- listing is indexed. Without this column the frontend cannot tell a native
-- listing from an ERC-20 one, and the old UI offered a Buy button on both —
-- the ERC-20 ones always reverted.
-- ---------------------------------------------------------------------------
ALTER TABLE listings ADD COLUMN IF NOT EXISTS currency SMALLINT NOT NULL DEFAULT 0;

-- Block timestamps, so the API can report when something happened rather than
-- when this database happened to write the row.
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS registered_at BIGINT;
ALTER TABLE renewals      ADD COLUMN IF NOT EXISTS block_time BIGINT;
ALTER TABLE transfers     ADD COLUMN IF NOT EXISTS block_time BIGINT;
ALTER TABLE sales         ADD COLUMN IF NOT EXISTS block_time BIGINT;

-- ---------------------------------------------------------------------------
-- Unified activity feed.
--
-- Append-only, one row per indexed log. Previously an "activity" view would
-- have meant UNION-ing four tables with different shapes at query time; this
-- is written once at ingest and paginates cleanly.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id            BIGSERIAL PRIMARY KEY,
  kind          TEXT NOT NULL,
  name          TEXT,
  token_id      NUMERIC,
  actor         TEXT,
  counterparty  TEXT,
  amount_wei    NUMERIC,
  block_number  BIGINT NOT NULL,
  log_index     INTEGER NOT NULL,
  block_time    BIGINT,
  tx_hash       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One log can produce two rows (a Sold both records a sale and closes a
-- listing), so `kind` is part of the identity.
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_tx_log_kind ON events (tx_hash, log_index, kind);
CREATE INDEX IF NOT EXISTS idx_events_recent ON events (block_number DESC, log_index DESC);
CREATE INDEX IF NOT EXISTS idx_events_name ON events (name) WHERE name IS NOT NULL;

-- Supports the marketplace listing query without a sequential scan once there
-- are more than a handful of listings.
CREATE INDEX IF NOT EXISTS idx_listings_active ON listings (updated_at DESC) WHERE status = 'active';

-- Availability and stats both filter on expiry.
CREATE INDEX IF NOT EXISTS idx_registrations_expires ON registrations (expires_at);

-- Backfill the new timestamp column for rows written by v1, using the row's
-- own insertion time. Approximate, but strictly better than NULL, and only
-- ever applies to history already in the table.
UPDATE registrations
   SET registered_at = EXTRACT(EPOCH FROM created_at)::BIGINT
 WHERE registered_at IS NULL;

-- ---------------------------------------------------------------------------
-- Normalize `name` to the fully-qualified form.
--
-- v1 stripped the suffix before storing (`.replace('.arc', '')`), so the API
-- returned "alice" where the frontend renders `domain.name` directly — the
-- name displayed without its TLD. Storing the canonical "alice.arc" also makes
-- the column safe to compare against a user-supplied query without having to
-- remember which form each table happens to hold.
--
-- Safe to run against a mixed table: the WHERE only touches bare labels, and
-- because label -> name is injective there is no primary-key collision.
-- ---------------------------------------------------------------------------
UPDATE registrations SET name = name || '.arc' WHERE name NOT LIKE '%.arc';
UPDATE renewals      SET name = name || '.arc' WHERE name NOT LIKE '%.arc';
UPDATE listings      SET name = name || '.arc' WHERE name IS NOT NULL AND name NOT LIKE '%.arc';
UPDATE transfers     SET name = name || '.arc' WHERE name IS NOT NULL AND name NOT LIKE '%.arc';
UPDATE sales         SET name = name || '.arc' WHERE name IS NOT NULL AND name NOT LIKE '%.arc';
