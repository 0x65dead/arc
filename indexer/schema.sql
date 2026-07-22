-- schema.sql
-- Run once against a fresh Postgres database (or via your migration tool of choice):
--   psql "$DATABASE_URL" -f schema.sql

-- One row per name that has ever been registered. `owner` is kept current by
-- the Transfer handler, so this table alone answers "who owns what right now"
-- without re-deriving it from the full transfer history on every read.
CREATE TABLE IF NOT EXISTS registrations (
  name          TEXT PRIMARY KEY,
  token_id      NUMERIC NOT NULL,
  owner         TEXT NOT NULL,
  cost_wei      NUMERIC NOT NULL,
  expires_at    BIGINT NOT NULL,
  block_number  BIGINT NOT NULL,
  tx_hash       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_registrations_owner ON registrations (lower(owner));
CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_token_id ON registrations (token_id);

-- Append-only renewal history. Revenue sums over this + registrations.cost_wei.
-- (tx_hash, log_index) uniquely identifies one on-chain log — the backfill
-- (ArcScan pull or RPC scan) and the live listener can both process the same
-- event and this constraint keeps that from becoming a duplicate row.
CREATE TABLE IF NOT EXISTS renewals (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL REFERENCES registrations(name) ON DELETE CASCADE,
  cost_wei      NUMERIC NOT NULL,
  expires_at    BIGINT NOT NULL,
  block_number  BIGINT NOT NULL,
  tx_hash       TEXT NOT NULL,
  log_index     INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_renewals_tx_log ON renewals (tx_hash, log_index);

-- Every Transfer log from the registrar (mints included, from = zero address).
-- This is the append-only audit trail; current ownership lives on
-- registrations.owner, updated each time a row lands here.
CREATE TABLE IF NOT EXISTS transfers (
  id            BIGSERIAL PRIMARY KEY,
  token_id      NUMERIC NOT NULL,
  name          TEXT,
  from_addr     TEXT NOT NULL,
  to_addr       TEXT NOT NULL,
  block_number  BIGINT NOT NULL,
  tx_hash       TEXT NOT NULL,
  log_index     INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transfers_to ON transfers (lower(to_addr));
CREATE INDEX IF NOT EXISTS idx_transfers_token ON transfers (token_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transfers_tx_log ON transfers (tx_hash, log_index);

-- Current marketplace listing state per token. status flips in place rather
-- than accumulating rows, since only "what's listed right now" matters for
-- the marketplace tab.
CREATE TABLE IF NOT EXISTS listings (
  token_id      NUMERIC PRIMARY KEY,
  name          TEXT,
  seller        TEXT NOT NULL,
  price_wei     NUMERIC NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active', -- active | sold | cancelled
  block_number  BIGINT NOT NULL,
  tx_hash       TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings (status);

-- Append-only sales history (for revenue/analytics later; marketplace tab
-- only needs `listings`).
CREATE TABLE IF NOT EXISTS sales (
  id            BIGSERIAL PRIMARY KEY,
  token_id      NUMERIC NOT NULL,
  name          TEXT,
  seller        TEXT NOT NULL,
  buyer         TEXT NOT NULL,
  price_wei     NUMERIC NOT NULL,
  fee_wei       NUMERIC NOT NULL,
  block_number  BIGINT NOT NULL,
  tx_hash       TEXT NOT NULL,
  log_index     INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_tx_log ON sales (tx_hash, log_index);

-- Tracks how far each event stream has been indexed, so a restart resumes
-- from the last confirmed block instead of rescanning full history (the
-- thing the old frontend was doing on every tab switch).
CREATE TABLE IF NOT EXISTS sync_state (
  stream        TEXT PRIMARY KEY, -- registered | renewed | transfer | listed | unlisted | sold
  last_block    BIGINT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
