-- 003_waitlist.sql
--
-- Mainnet waitlist: a wallet proven by signature, linked to a Discord account
-- proven by OAuth, with membership of the Arc Names guild checked by the bot.
--
-- Three tables rather than one. The nonce and session rows are short-lived
-- authentication state that must be deletable on a timer; the entry row is the
-- durable record. Mixing them would mean either expiring real signups or
-- keeping dead challenges forever.

-- ---------------------------------------------------------------------------
-- Sign-in challenges.
--
-- Single-use, and the message is stored rather than reconstructed at verify
-- time. Rebuilding it from parts would mean the verifier and the issuer each
-- have their own copy of the format, and any drift between them (a trailing
-- newline, a re-ordered field) makes every signature look forged. Storing the
-- exact bytes that were handed out removes the possibility.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS waitlist_nonces (
  nonce      TEXT PRIMARY KEY,
  address    TEXT NOT NULL,
  message    TEXT NOT NULL,
  issued_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  -- Set the moment a signature is accepted. A replayed signature finds the
  -- row already consumed and is refused, which a plain DELETE could not
  -- distinguish from "expired" when reporting the failure.
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_waitlist_nonces_expiry ON waitlist_nonces (expires_at);

-- ---------------------------------------------------------------------------
-- Post-signature sessions.
--
-- `.env` points the browser bundle at the indexer's own origin
-- (VITE_INDEXER_API_URL), so the app calls this API cross-origin and a cookie
-- session would be a third-party cookie — blocked by default in Safari and
-- Firefox and on its way out in Chrome. The token is therefore returned in the
-- response body and sent as a bearer header.
--
-- Only the SHA-256 of the token is stored. A leaked database dump then yields
-- no usable sessions, and there is no reason for the server to ever need the
-- original back.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS waitlist_sessions (
  token_hash TEXT PRIMARY KEY,
  address    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  -- The OAuth `state` value for this session's in-flight Discord handshake,
  -- and when it was issued. Binding state to the session is what stops a
  -- third party from feeding their own authorization code into someone else's
  -- flow (CSRF), and stops a code from being replayed against a new session.
  oauth_state      TEXT,
  oauth_state_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_waitlist_sessions_expiry ON waitlist_sessions (expires_at);
-- Looked up on every callback. Partial: most rows have no state in flight.
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_sessions_state
  ON waitlist_sessions (oauth_state) WHERE oauth_state IS NOT NULL;

-- ---------------------------------------------------------------------------
-- The waitlist itself.
--
-- `address` is the primary key: one entry per wallet, and re-running the flow
-- from the same wallet updates that row rather than adding a second one.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS waitlist_entries (
  address          TEXT PRIMARY KEY,
  discord_id       TEXT,
  discord_username TEXT,
  discord_avatar   TEXT,
  -- True only when all three facts hold: signature verified, Discord linked,
  -- and guild membership confirmed by the bot. Kept as a stored column rather
  -- than derived at read time because the membership check is a network call
  -- to Discord — a status endpoint that re-checked it on every poll would
  -- burn the rate limit and fail closed during an outage.
  verified         BOOLEAN NOT NULL DEFAULT FALSE,
  guild_member     BOOLEAN NOT NULL DEFAULT FALSE,
  role_granted     BOOLEAN NOT NULL DEFAULT FALSE,
  signed_at        TIMESTAMPTZ,
  verified_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- One Discord account cannot back two wallets.
--
-- Partial, because `discord_id` is NULL for the window between signing and
-- completing the OAuth handshake — a plain UNIQUE constraint permits many
-- NULLs so it would work here too, but stating the predicate documents that
-- the NULLs are an expected intermediate state and not missing data.
--
-- Enforced in the database rather than by a SELECT-then-INSERT in the route,
-- which is a race: two concurrent callbacks for the same Discord account both
-- see no conflict and both write.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_discord_id
  ON waitlist_entries (discord_id) WHERE discord_id IS NOT NULL;

-- Supports the public counter without scanning the table.
CREATE INDEX IF NOT EXISTS idx_waitlist_verified
  ON waitlist_entries (created_at DESC) WHERE verified;
