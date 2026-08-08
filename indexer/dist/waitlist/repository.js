import { createHash, randomBytes } from 'node:crypto';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
/**
 * Waitlist persistence.
 *
 * Kept out of `db/repositories.ts` because that file is the chain-data layer —
 * every query in it is a projection of an on-chain log, and every write is
 * guarded by `(block_number, log_index)` ordering. Nothing here has a block
 * number: these rows come from a browser, and their integrity comes from the
 * signature and the OAuth handshake instead.
 */
// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------
/**
 * 32 bytes from the CSPRNG, base64url.
 *
 * `randomBytes`, not `Math.random()`: these values are the entire authority a
 * session carries, and a predictable one is a session anyone can mint.
 */
function newToken() {
    return randomBytes(32).toString('base64url');
}
/**
 * Sessions and OAuth state are stored hashed.
 *
 * SHA-256 with no salt or stretching is the right primitive here and a wrong
 * one for passwords: the input is already 256 bits of uniform randomness, so
 * there is no dictionary to attack and nothing for a work factor to buy. What
 * it does buy is that a leaked database — or a stray log line containing a row
 * — yields no usable token.
 */
function hashToken(token) {
    return createHash('sha256').update(token).digest('hex');
}
export async function createNonce(address, message) {
    const nonce = randomBytes(16).toString('hex');
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + config.waitlist.nonceTtlMs);
    const text = message(nonce, issuedAt, expiresAt);
    await pool.query(`INSERT INTO waitlist_nonces (nonce, address, message, issued_at, expires_at)
     VALUES ($1, $2, $3, $4, $5)`, [nonce, address.toLowerCase(), text, issuedAt, expiresAt]);
    return { nonce, message: text, expiresAt };
}
/**
 * Claims a nonce, atomically.
 *
 * The UPDATE both reads the row and marks it consumed in one statement, so two
 * concurrent verifications of the same nonce cannot both succeed — the second
 * matches zero rows. Doing this as SELECT-then-UPDATE would leave exactly that
 * window open, and a replayed signature is precisely what the nonce exists to
 * prevent.
 *
 * The follow-up SELECT runs only when nothing was claimed, and exists to say
 * *why* — "your challenge expired, sign again" and "that challenge was already
 * used" send the user to different places.
 */
export async function claimNonce(nonce, address) {
    const claimed = await pool.query(`UPDATE waitlist_nonces
        SET consumed_at = now()
      WHERE nonce = $1
        AND address = $2
        AND consumed_at IS NULL
        AND expires_at > now()
      RETURNING message`, [nonce, address.toLowerCase()]);
    if (claimed.rowCount)
        return { ok: true, message: claimed.rows[0].message };
    const existing = await pool.query(`SELECT address, consumed_at, expires_at FROM waitlist_nonces WHERE nonce = $1`, [nonce]);
    if (!existing.rowCount)
        return { ok: false, reason: 'unknown' };
    const row = existing.rows[0];
    if (row.address !== address.toLowerCase())
        return { ok: false, reason: 'address-mismatch' };
    if (row.consumed_at)
        return { ok: false, reason: 'consumed' };
    return { ok: false, reason: 'expired' };
}
// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
export async function createSession(address) {
    const token = newToken();
    const expiresAt = new Date(Date.now() + config.waitlist.sessionTtlMs);
    await pool.query(`INSERT INTO waitlist_sessions (token_hash, address, expires_at) VALUES ($1, $2, $3)`, [hashToken(token), address.toLowerCase(), expiresAt]);
    return { token, expiresAt };
}
export async function findSession(token) {
    const { rows } = await pool.query(`SELECT address FROM waitlist_sessions WHERE token_hash = $1 AND expires_at > now()`, [hashToken(token)]);
    return rows[0] ?? null;
}
/**
 * Issues the OAuth `state` for a session's Discord handshake.
 *
 * One in flight per session: re-authorizing overwrites the previous state,
 * which invalidates an abandoned handshake rather than leaving it usable.
 */
export async function issueOAuthState(token) {
    const state = newToken();
    const { rowCount } = await pool.query(`UPDATE waitlist_sessions
        SET oauth_state = $2, oauth_state_at = now()
      WHERE token_hash = $1 AND expires_at > now()`, [hashToken(token), hashToken(state)]);
    return rowCount ? state : null;
}
/**
 * Consumes an OAuth state and returns the address it was bound to.
 *
 * Single-use and time-boxed in the same statement that reads it, for the same
 * reason as `claimNonce`. This is the check that makes the callback safe: an
 * authorization code delivered without a state that this server issued, to
 * this session, within the window, is not the result of a flow this server
 * started — it is someone else's code being pushed into this user's session.
 */
export async function consumeOAuthState(state) {
    const { rows } = await pool.query(`UPDATE waitlist_sessions
        SET oauth_state = NULL, oauth_state_at = NULL
      WHERE oauth_state = $1
        AND expires_at > now()
        AND oauth_state_at > now() - INTERVAL '15 minutes'
      RETURNING address`, [hashToken(state)]);
    return rows[0] ?? null;
}
function toEntry(row) {
    return {
        address: row.address,
        discordId: row.discord_id,
        discordUsername: row.discord_username,
        discordAvatar: row.discord_avatar,
        verified: row.verified,
        guildMember: row.guild_member,
        roleGranted: row.role_granted,
        createdAt: row.created_at.toISOString(),
        // Postgres counts as BIGINT, which node-postgres returns as a string to
        // avoid a lossy conversion. Number() is safe for a queue position.
        position: row.position === null ? null : Number(row.position),
    };
}
/**
 * Position among verified entries, oldest first.
 *
 * Computed on read rather than stored. A stored position would have to be
 * rewritten for every later row whenever an earlier one changed, and would
 * drift the first time that failed halfway; ranking by `verified_at` is
 * derived from the fact that actually determines the order.
 */
const ENTRY_SELECT = `
  SELECT e.address, e.discord_id, e.discord_username, e.discord_avatar,
         e.verified, e.guild_member, e.role_granted, e.created_at,
         CASE WHEN e.verified THEN (
           SELECT COUNT(*) FROM waitlist_entries p
            WHERE p.verified AND p.verified_at <= e.verified_at
         ) END AS position
    FROM waitlist_entries e
`;
export async function getEntry(address) {
    const { rows } = await pool.query(`${ENTRY_SELECT} WHERE e.address = $1`, [
        address.toLowerCase(),
    ]);
    return rows[0] ? toEntry(rows[0]) : null;
}
/** Records the signature step. Idempotent — re-signing is not an error. */
export async function upsertSigned(address) {
    await pool.query(`INSERT INTO waitlist_entries (address, signed_at)
     VALUES ($1, now())
     ON CONFLICT (address) DO UPDATE SET signed_at = now(), updated_at = now()`, [address.toLowerCase()]);
}
export class DiscordAlreadyLinkedError extends Error {
    linkedAddress;
    constructor(linkedAddress) {
        super('That Discord account is already linked to a different wallet');
        this.linkedAddress = linkedAddress;
        this.name = 'DiscordAlreadyLinkedError';
    }
}
/**
 * Links a Discord account to a wallet and records the membership result.
 *
 * The unique index on `discord_id` is what enforces one-account-one-wallet,
 * and hitting it surfaces as a specific error rather than a 500. Checking
 * first with a SELECT would be a race — two callbacks for the same Discord
 * account can both find nothing and both proceed — so the constraint is left
 * to do its job and the violation is translated here.
 */
export async function linkDiscord(params) {
    const address = params.address.toLowerCase();
    try {
        await pool.query(`INSERT INTO waitlist_entries
         (address, discord_id, discord_username, discord_avatar,
          guild_member, role_granted, verified, signed_at, verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $5, now(), CASE WHEN $5 THEN now() END)
       ON CONFLICT (address) DO UPDATE SET
         discord_id       = EXCLUDED.discord_id,
         discord_username = EXCLUDED.discord_username,
         discord_avatar   = EXCLUDED.discord_avatar,
         guild_member     = EXCLUDED.guild_member,
         role_granted     = EXCLUDED.role_granted,
         verified         = waitlist_entries.verified OR EXCLUDED.verified,
         -- Set once and never moved: the queue position is ordered by it, and
         -- re-running the flow to refresh a role must not cost someone their
         -- place in the queue.
         verified_at      = COALESCE(waitlist_entries.verified_at, EXCLUDED.verified_at),
         updated_at       = now()`, [
            address,
            params.discordId,
            params.username,
            params.avatarUrl,
            params.guildMember,
            params.roleGranted,
        ]);
    }
    catch (error) {
        if (error.code === '23505') {
            const { rows } = await pool.query(`SELECT address FROM waitlist_entries WHERE discord_id = $1`, [params.discordId]);
            throw new DiscordAlreadyLinkedError(rows[0]?.address ?? 'another wallet');
        }
        throw error;
    }
    const entry = await getEntry(address);
    if (!entry)
        throw new Error('waitlist entry vanished immediately after write');
    return entry;
}
export async function countVerified() {
    const { rows } = await pool.query(`SELECT COUNT(*) AS count FROM waitlist_entries WHERE verified`);
    return Number(rows[0]?.count ?? 0);
}
/**
 * Drops expired challenges and sessions.
 *
 * Without this the two tables grow without bound — every abandoned signature
 * prompt leaves a row that no query will ever match again. Consumed nonces are
 * kept for a day before deletion so that a replay attempt within the window
 * can still be reported as "already used" rather than "unknown", which is a
 * more accurate thing to tell the user and a more useful thing to log.
 */
export async function pruneExpired() {
    const nonces = await pool.query(`DELETE FROM waitlist_nonces
      WHERE (expires_at < now() - INTERVAL '1 day')
         OR (consumed_at IS NOT NULL AND consumed_at < now() - INTERVAL '1 day')`);
    const sessions = await pool.query(`DELETE FROM waitlist_sessions WHERE expires_at < now()`);
    return (nonces.rowCount ?? 0) + (sessions.rowCount ?? 0);
}
