import { config } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('discord');

/**
 * Discord REST client.
 *
 * Only the six calls the waitlist flow needs, written directly against the
 * documented HTTP API rather than pulling in discord.js — that library exists
 * to run a gateway connection and a cache, neither of which a request-scoped
 * OAuth handler wants.
 *
 * Every function here distinguishes three outcomes that a `fetch().json()`
 * one-liner would collapse into one: the call succeeded, the call failed in a
 * way that means something specific about this user (not a member, already
 * linked), or Discord is unreachable. The routes rely on that distinction —
 * telling someone "you have not joined the server" when the truth is "Discord
 * is down" sends them to fix something that is not broken.
 */

const API = 'https://discord.com/api/v10';
const TIMEOUT_MS = 10_000;

/** Discord is reachable but refused this request. */
export class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'DiscordApiError';
  }
}

/** Discord could not be reached at all — network, DNS, timeout. */
export class DiscordUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscordUnavailableError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  auth: string;
  body?: URLSearchParams | Record<string, unknown>;
  /** Status codes to return `null` for rather than throw on. */
  nullOn?: number[];
}

/**
 * One request, with a timeout and a single rate-limit retry.
 *
 * Discord answers 429 with a `retry_after` in seconds and expects the caller
 * to wait. Without honouring it a burst of signups turns into a burst of
 * failures — and, because Discord escalates repeat offenders to a global
 * limit, into failures for every other call the bot makes too. One retry
 * covers the ordinary case; a second consecutive 429 means something is wrong
 * at a level this layer should not paper over.
 */
async function request<T>(path: string, options: RequestOptions): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      const isForm = options.body instanceof URLSearchParams;
      response = await fetch(`${API}${path}`, {
        method: options.method ?? 'GET',
        signal: controller.signal,
        headers: {
          authorization: options.auth,
          accept: 'application/json',
          ...(options.body
            ? {
                'content-type': isForm
                  ? 'application/x-www-form-urlencoded'
                  : 'application/json',
              }
            : {}),
        },
        body: options.body
          ? isForm
            ? (options.body as URLSearchParams).toString()
            : JSON.stringify(options.body)
          : undefined,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new DiscordUnavailableError(
        controller.signal.aborted ? `Discord timed out after ${TIMEOUT_MS}ms` : detail,
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 429 && attempt === 0) {
      const retryAfter = await response
        .json()
        .then((body: { retry_after?: number }) => body?.retry_after ?? 1)
        .catch(() => 1);
      // Bounded: a global limit can report tens of seconds, and an HTTP
      // handler holding a connection open that long is worse than failing.
      const waitMs = Math.min(Math.ceil(retryAfter * 1000), 5_000);
      log.warn('rate limited, retrying', { path, waitMs });
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    if (options.nullOn?.includes(response.status)) return null;

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { message?: string; code?: number; error_description?: string }
        | null;
      throw new DiscordApiError(
        response.status,
        body?.code ?? null,
        body?.error_description ?? body?.message ?? `Discord returned HTTP ${response.status}`,
      );
    }

    // 204 No Content is a success with no body — PUT role, and PUT member for
    // someone already in the guild.
    if (response.status === 204) return null;
    return (await response.json()) as T;
  }

  throw new DiscordApiError(429, null, 'Discord rate limit exceeded, please retry shortly');
}

function botAuth(): string {
  return `Bot ${config.waitlist.discord.botToken}`;
}

// ---------------------------------------------------------------------------
// OAuth2
// ---------------------------------------------------------------------------

export interface DiscordTokens {
  accessToken: string;
  scopes: string[];
}

/**
 * The scopes requested on the authorization URL.
 *
 * `identify` alone is enough to link an account and — with the bot in the
 * guild — to check membership. `guilds.join` is added only when auto-join is
 * turned on, because requesting a scope the flow will not use trains people to
 * click through consent screens without reading them.
 */
export function oauthScopes(): string[] {
  return config.waitlist.discord.autoJoin ? ['identify', 'guilds.join'] : ['identify'];
}

export function authorizeUrl(state: string): string {
  const { clientId, redirectUri } = config.waitlist.discord;
  const params = new URLSearchParams({
    client_id: clientId!,
    redirect_uri: redirectUri!,
    response_type: 'code',
    scope: oauthScopes().join(' '),
    state,
    // Always re-show the consent screen. Discord otherwise silently reuses an
    // existing authorization, which during testing looks like the flow
    // skipping a step, and in production denies someone the chance to notice
    // they are linking a different account than they meant to.
    prompt: 'consent',
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

/** Exchanges a single-use authorization code for a user access token. */
export async function exchangeCode(code: string): Promise<DiscordTokens> {
  const { clientId, clientSecret, redirectUri } = config.waitlist.discord;

  const result = await request<{ access_token: string; scope: string }>('/oauth2/token', {
    method: 'POST',
    // The token endpoint authenticates the *application* with HTTP Basic, not
    // the user — the bot token has no standing here.
    auth: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri!,
    }),
  });

  if (!result?.access_token) {
    throw new DiscordApiError(502, null, 'Discord returned no access token');
  }

  return { accessToken: result.access_token, scopes: (result.scope ?? '').split(' ').filter(Boolean) };
}

export interface DiscordUser {
  id: string;
  username: string;
  globalName: string | null;
  avatarUrl: string | null;
}

export async function fetchUser(accessToken: string): Promise<DiscordUser> {
  const user = await request<{
    id: string;
    username: string;
    global_name: string | null;
    avatar: string | null;
    discriminator: string;
  }>('/users/@me', { auth: `Bearer ${accessToken}` });

  if (!user?.id) throw new DiscordApiError(502, null, 'Discord returned no user');

  return {
    id: user.id,
    username: user.username,
    globalName: user.global_name ?? null,
    // Built here rather than in the frontend so the CDN path and the default
    // -avatar fallback are decided once. Discord retired discriminators for
    // most accounts; `discriminator` is "0" on those, and the legacy modulo
    // only applies to the ones that still have a real one.
    avatarUrl: user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
      : `https://cdn.discordapp.com/embed/avatars/${
          user.discriminator && user.discriminator !== '0'
            ? Number(user.discriminator) % 5
            : (BigInt(user.id) >> 22n) % 6n
        }.png`,
  };
}

// ---------------------------------------------------------------------------
// Guild membership
// ---------------------------------------------------------------------------

/**
 * Whether the user is in the guild, asked as the bot.
 *
 * Deliberately not read from the OAuth `guilds` scope: that returns whatever
 * the user's client reports and is a claim by the party being checked. The bot
 * asking Discord directly is the fact. The bot needs no privileged intent for
 * this — the gateway GUILD_MEMBERS intent governs member *events*, not this
 * REST lookup — only membership of the guild itself.
 */
export async function isGuildMember(discordId: string): Promise<boolean> {
  const { guildId } = config.waitlist.discord;
  const member = await request<{ user?: { id: string } }>(
    `/guilds/${guildId}/members/${discordId}`,
    { auth: botAuth(), nullOn: [404] },
  );
  return member !== null;
}

/**
 * Adds the user to the guild with their `guilds.join` grant.
 *
 * Returns true when they are in the guild afterwards, whether this call put
 * them there (201) or they already were (204). Requires the bot to hold
 * CREATE_INSTANT_INVITE in the guild.
 */
export async function addGuildMember(discordId: string, accessToken: string): Promise<boolean> {
  const { guildId } = config.waitlist.discord;
  try {
    await request(`/guilds/${guildId}/members/${discordId}`, {
      method: 'PUT',
      auth: botAuth(),
      body: { access_token: accessToken },
    });
    return true;
  } catch (error) {
    if (error instanceof DiscordApiError) {
      // Not fatal to the signup: they can still join by invite, and the next
      // status refresh picks it up. Worth logging loudly because it almost
      // always means a missing bot permission rather than a user problem.
      log.warn('guild join failed', { discordId, status: error.status, message: error.message });
      return false;
    }
    throw error;
  }
}

/**
 * Grants the waitlist role. Best-effort by design.
 *
 * The most common failure is role hierarchy: a bot can only assign roles below
 * its own highest role, and the error Discord returns for that ("Missing
 * Permissions") is identical to the one for a missing Manage Roles permission.
 * Neither is a reason to fail a signup that is otherwise complete — the row is
 * already written, the role can be granted later, so this returns a boolean
 * instead of throwing.
 */
export async function grantWaitlistRole(discordId: string): Promise<boolean> {
  const { guildId, waitlistRoleId } = config.waitlist.discord;
  if (!waitlistRoleId) return false;

  try {
    await request(`/guilds/${guildId}/members/${discordId}/roles/${waitlistRoleId}`, {
      method: 'PUT',
      auth: botAuth(),
    });
    return true;
  } catch (error) {
    if (error instanceof DiscordApiError) {
      log.warn('role grant failed', {
        discordId,
        status: error.status,
        message: error.message,
        hint:
          error.status === 403
            ? 'the bot needs Manage Roles, and its own role must sit above the waitlist role'
            : undefined,
      });
      return false;
    }
    throw error;
  }
}

/**
 * Posts a signup notification, if a webhook is configured.
 *
 * Never throws and never blocks the response: a notification is a nicety, and
 * a failed webhook must not turn a completed signup into an error the user
 * sees. The address is truncated — the full one is in the database, and a
 * public channel does not need it.
 */
export function notifySignup(entry: { address: string; username: string; total: number }): void {
  const { webhookUrl } = config.waitlist.discord;
  if (!webhookUrl) return;

  const short = `${entry.address.slice(0, 6)}…${entry.address.slice(-4)}`;

  void fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'Arc Names',
      embeds: [
        {
          title: 'New mainnet waitlist signup',
          description: `**${entry.username}** joined with \`${short}\``,
          color: 0x6366f1,
          footer: { text: `${entry.total} verified` },
        },
      ],
      // Belt and braces: nothing here interpolates user input into a mention,
      // but a Discord username can contain anything and this guarantees a
      // crafted one cannot ping the server.
      allowed_mentions: { parse: [] },
    }),
  }).catch((error) => log.debug('webhook post failed', { error }));
}
