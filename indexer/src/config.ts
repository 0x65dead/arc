import 'dotenv/config';

/**
 * Validated configuration.
 *
 * Every value the service depends on is read, checked and frozen here, once,
 * at startup. The previous code reached for `process.env.X!` at module scope
 * across five files — the non-null assertion meant a missing or malformed
 * variable produced `undefined` inside an ethers filter and a confusing
 * failure thousands of blocks into a backfill, rather than a clear message
 * before anything started.
 */

class ConfigError extends Error {
  constructor(problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}\n\nSee .env.example.`);
    this.name = 'ConfigError';
  }
}

const problems: string[] = [];

function required(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    problems.push(`${key} is required but not set`);
    return '';
  }
  return value;
}

function address(key: string): string {
  const value = required(key);
  if (value && !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    problems.push(`${key} is not a valid address: "${value}"`);
    return '';
  }
  return value.toLowerCase();
}

function integer(key: string, fallback: number, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    problems.push(`${key} must be an integer between ${min} and ${max}, got "${raw}"`);
    return fallback;
  }
  return value;
}

function url(key: string, fallback?: string): string {
  const raw = process.env[key]?.trim() ?? fallback;
  if (!raw) {
    problems.push(`${key} is required but not set`);
    return '';
  }
  try {
    new URL(raw);
  } catch {
    problems.push(`${key} is not a valid URL: "${raw}"`);
    return '';
  }
  return raw.replace(/\/$/, '');
}

function optional(key: string): string | null {
  return process.env[key]?.trim() || null;
}

function boolean(key: string, fallback: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  problems.push(`${key} must be a boolean ("true" or "false"), got "${raw}"`);
  return fallback;
}

const httpRpcUrl = url('RPC_HTTP_URL', process.env.ALCHEMY_HTTP_URL);
const wsRpcUrl = process.env.RPC_WS_URL?.trim() ?? process.env.ALCHEMY_WSS_URL?.trim() ?? '';

if (wsRpcUrl) {
  try {
    new URL(wsRpcUrl);
  } catch {
    problems.push(`RPC_WS_URL is not a valid URL: "${wsRpcUrl}"`);
  }
}

/*
 * Rough block frequency on Arc Testnet — used only to derive a
 * sensible `staleAfterBlocks` default. Arc produces a block every
 * ~0.48s; the constant is rounded conservatively so the default
 * stays valid even if the chain slows down.
 */
const ARC_BLOCK_SECONDS = 1;
const reconcileSeconds =
  integer('RECONCILE_INTERVAL_SECONDS', 300, { min: 10 });

export const config = Object.freeze({
  databaseUrl: required('DATABASE_URL'),

  rpc: Object.freeze({
    http: httpRpcUrl,
    /**
     * Optional. Without it the indexer polls instead of subscribing, which is
     * slower to react but perfectly correct — so a deployment with only an
     * HTTP endpoint is supported rather than refused at startup, which is what
     * the old `REQUIRED_ENV` list did.
     */
    ws: wsRpcUrl || null,
  }),

  contracts: Object.freeze({
    controller: address('CONTROLLER_ADDRESS'),
    registrar: address('REGISTRAR_ADDRESS'),
    market: address('MARKET_ADDRESS'),
  }),

  deployBlock: integer('DEPLOY_BLOCK', 0),

  /**
   * Blocks to stay behind the head before treating a range as final.
   *
   * The old indexer checkpointed straight up to the chain head, so a reorg
   * left rows for logs that no longer existed and the checkpoint had already
   * advanced past them — nothing would ever re-read that range. Holding back a
   * few blocks means the checkpoint only ever covers history that is settled.
   */
  confirmations: integer('CONFIRMATIONS', 5, { min: 0, max: 200 }),

  backfillChunkSize: integer('BACKFILL_CHUNK_SIZE', 10_000, { min: 1 }),

  reconcileIntervalMs: reconcileSeconds * 1000,

  /** Poll interval used when no websocket URL is configured. */
  pollIntervalMs: integer('POLL_INTERVAL_SECONDS', 15, { min: 1 }) * 1000,

  blockscoutUrl: url('ARCSCAN_API_URL', 'https://testnet.arcscan.app'),

  /**
   * Per-request timeout for Blockscout.
   *
   * A busy address takes the public instance well over 15s to answer for the
   * first page of a full-history walk, and an abort there costs the whole pull
   * — the stream then falls back to a 300-call `eth_getLogs` scan it did not
   * need. Generous by design: this is a background catch-up, and the fallback
   * is far more expensive than waiting.
   */
  blockscoutTimeoutMs: integer('BLOCKSCOUT_TIMEOUT_MS', 30_000, { min: 1_000, max: 120_000 }),

  /**
   * How long a stream skips Blockscout after it fails.
   *
   * Without this every reconcile pass re-pays the full timeout against a source
   * already known to be failing, before falling back to the RPC path that
   * actually works.
   */
  blockscoutCooldownMs: integer('BLOCKSCOUT_COOLDOWN_SECONDS', 900, { min: 0 }) * 1000,

  /**
   * How far behind the head the API may be before it reports itself unhealthy.
   *
   * The default is derived, not guessed. A batch indexer is *expected* to sit
   * up to one reconcile interval behind the head — that is how it works, not a
   * fault — so any fixed threshold below `interval x blocks-per-second` marks a
   * perfectly healthy service unhealthy. Arc produces a block roughly every
   * half-second, so a 300s interval means ~630 blocks of normal drift; the old
   * fixed default of 200 could never be satisfied and would have alerted
   * permanently.
   *
   * Two reconcile intervals' worth, floored at 200, keeps one slow or failed
   * pass from flapping the alert while still catching a stream that has
   * genuinely stopped. `checkpointAgeSeconds` in /sync-status is the sharper
   * liveness signal — this one only bounds how far behind is tolerable.
   */
  staleAfterBlocks: integer(
    'STALE_AFTER_BLOCKS',
    Math.max(200, Math.ceil((reconcileSeconds * 2) / ARC_BLOCK_SECONDS)),
    { min: 1 },
  ),

  port: integer('PORT', 8787, { min: 1, max: 65535 }),
  host: process.env.HOST?.trim() || '0.0.0.0',

  logLevel: (process.env.LOG_LEVEL?.trim().toLowerCase() ?? 'info') as 'debug' | 'info' | 'warn' | 'error',

  /**
   * Comma-separated list of allowed origins. Defaults to `*` — this API serves
   * only public chain data and has no authentication, so an open CORS policy
   * is not a leak, but a deployment can lock it down.
   */
  corsOrigins: (process.env.CORS_ORIGINS?.trim() || '*')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),

  /**
   * Mainnet waitlist.
   *
   * Deliberately *not* validated through `required()`. Every other setting in
   * this file is load-bearing for indexing, and a missing one should stop the
   * process — but the indexer's actual job (backfill, listener, /api/v1) has no
   * dependency on Discord. Making these required would mean deploying this
   * code before the secrets are set in the environment takes down the live read
   * API, which is a much worse outcome than the waitlist being unavailable.
   * With anything missing, `isWaitlistEnabled()` is false and those routes
   * answer 503; `missingWaitlistConfig()` names the gaps at startup so they
   * show up in the logs rather than being discovered by a user.
   */
  waitlist: Object.freeze({
    discord: Object.freeze({
      clientId: optional('DISCORD_CLIENT_ID'),
      clientSecret: optional('DISCORD_CLIENT_SECRET'),
      /**
       * Must match a redirect URI registered on the Discord application
       * exactly — Discord compares the string, not the resolved URL, so a
       * trailing slash or a different port is a mismatch.
       */
      redirectUri: optional('DISCORD_REDIRECT_URI'),
      botToken: optional('DISCORD_BOT_TOKEN'),
      guildId: optional('DISCORD_GUILD_ID'),
      /** Optional — leave unset to skip the role grant entirely. */
      waitlistRoleId: optional('DISCORD_WAITLIST_ROLE_ID'),
      /** Surfaced to the UI as the "Join Discord" destination. */
      inviteUrl: optional('DISCORD_INVITE_URL'),
      /**
       * Optional signup notification channel. A webhook URL is a bearer
       * credential in the shape of a URL — anyone holding it can post to that
       * channel — so it stays server-side and is never sent to the browser.
       */
      webhookUrl: optional('DISCORD_WEBHOOK_URL'),
      /**
       * Add non-members to the guild via `guilds.join` rather than asking them
       * to use the invite. Off by default: it needs the extra `guilds.join`
       * scope, and someone who authorized an `identify`-only consent screen
       * has not agreed to be added to a server.
       */
      autoJoin: boolean('DISCORD_AUTO_JOIN', false),
    }),

    /**
     * Where to send the browser after the OAuth callback. The callback is a
     * top-level navigation from Discord rather than a fetch, so it cannot
     * answer with JSON — it has to redirect back into the SPA.
     */
    appUrl: optional('APP_URL'),

    /** A session outlives the signature by just enough to finish the flow. */
    sessionTtlMs: integer('WAITLIST_SESSION_TTL_MINUTES', 60, { min: 5, max: 1440 }) * 60_000,
    nonceTtlMs: integer('WAITLIST_NONCE_TTL_MINUTES', 10, { min: 1, max: 60 }) * 60_000,
  }),
});

/**
 * Which waitlist settings are absent.
 *
 * Returns the list instead of throwing so `index.ts` can log it and carry on
 * serving chain data. The invite URL and the role are not included — the flow
 * completes without either.
 */
export function missingWaitlistConfig(): string[] {
  const { discord } = config.waitlist;
  const missing: string[] = [];
  if (!discord.clientId) missing.push('DISCORD_CLIENT_ID');
  if (!discord.clientSecret) missing.push('DISCORD_CLIENT_SECRET');
  if (!discord.redirectUri) missing.push('DISCORD_REDIRECT_URI');
  if (!discord.botToken) missing.push('DISCORD_BOT_TOKEN');
  if (!discord.guildId) missing.push('DISCORD_GUILD_ID');
  return missing;
}

export function isWaitlistEnabled(): boolean {
  return missingWaitlistConfig().length === 0;
}

export function assertConfigValid(): void {
  if (problems.length > 0) throw new ConfigError(problems);
}
