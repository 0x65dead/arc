-- 001_baseline.sql
--
-- The v1 shape, reproduced verbatim so that this migration is a no-op against
-- a database that already ran the original schema.sql. Everything the redesign
-- changes lives in 002; splitting it this way means a fresh database and an
-- existing one converge on exactly the same final schema.

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

CREATE TABLE IF NOT EXISTS renewals (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  cost_wei      NUMERIC NOT NULL,
  expires_at    BIGINT NOT NULL,
  block_number  BIGINT NOT NULL,
  tx_hash       TEXT NOT NULL,
  log_index     INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_renewals_tx_log ON renewals (tx_hash, log_index);

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

CREATE TABLE IF NOT EXISTS listings (
  token_id      NUMERIC PRIMARY KEY,
  name          TEXT,
  seller        TEXT NOT NULL,
  price_wei     NUMERIC NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  block_number  BIGINT NOT NULL,
  tx_hash       TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings (status);

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

CREATE TABLE IF NOT EXISTS sync_state (
  stream        TEXT PRIMARY KEY,
  last_block    BIGINT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
