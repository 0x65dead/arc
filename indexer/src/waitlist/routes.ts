import { Router, type Request } from 'express';
import { config, isWaitlistEnabled, missingWaitlistConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { ApiError, asyncHandler, requireAddress } from '../api/errors.js';
import {
  DiscordApiError,
  DiscordUnavailableError,
  addGuildMember,
  authorizeUrl,
  exchangeCode,
  fetchUser,
  grantWaitlistRole,
  isGuildMember,
  notifySignup,
  oauthScopes,
} from '../discord/client.js';
import { buildSignInMessage, verifySignature } from './signature.js';
import {
  DiscordAlreadyLinkedError,
  claimNonce,
  consumeOAuthState,
  countVerified,
  createNonce,
  createSession,
  findSession,
  getEntry,
  issueOAuthState,
  linkDiscord,
  upsertSigned,
} from './repository.js';

const log = createLogger('waitlist');

/**
 * Mainnet waitlist routes.
 *
 * The flow, and where each step's trust comes from:
 *
 *   POST /nonce      -> server-issued challenge, single-use
 *   POST /verify     -> signature proves the wallet; returns a session token
 *   GET  /discord    -> redirects to Discord with a state bound to the session
 *   GET  /callback   -> Discord returns here; the code is exchanged
 *                       server-side, membership is checked by the bot, the
 *                       role is granted, and the row is written
 *   GET  /status     -> what the frontend polls to render the stepper
 *   GET  /config     -> the public half of the settings (invite URL, counts)
 *
 * The wallet and the Discord account are each proven independently, and the
 * session token is what ties the two halves of the flow to the same person.
 */
export function createWaitlistRouter(): Router {
  const router = Router();

  // -------------------------------------------------------------------------
  // Availability
  //
  // Ahead of every route, because a half-configured deployment answering 500s
  // from inside the Discord client is far harder to diagnose than one saying
  // plainly which variables are unset. `/config` is exempt so the frontend can
  // ask whether the feature exists and hide the tab rather than offering a
  // button that cannot work.
  // -------------------------------------------------------------------------
  router.use((req, _res, next) => {
    if (req.path === '/config' || isWaitlistEnabled()) return next();
    next(
      new ApiError(
        503,
        'unavailable',
        `The waitlist is not configured on this deployment (missing: ${missingWaitlistConfig().join(', ')})`,
      ),
    );
  });

  router.get(
    '/config',
    asyncHandler(async (_req, res) => {
      res.json({
        enabled: isWaitlistEnabled(),
        inviteUrl: config.waitlist.discord.inviteUrl,
        // Lets the UI say "you'll be added automatically" or "join first",
        // truthfully, instead of hardcoding one of the two.
        autoJoin: config.waitlist.discord.autoJoin,
        verifiedCount: isWaitlistEnabled() ? await countVerified() : 0,
      });
    }),
  );

  // -------------------------------------------------------------------------
  // Step 1-2: prove the wallet
  // -------------------------------------------------------------------------

  router.post(
    '/nonce',
    rateLimit({ max: 10, windowMs: 60_000 }),
    asyncHandler(async (req, res) => {
      const address = requireAddress(req.body?.address, 'address');

      const challenge = await createNonce(address, (nonce, issuedAt, expiresAt) =>
        buildSignInMessage({
          address,
          nonce,
          domain: siteDomain(),
          issuedAt,
          expiresAt,
        }),
      );

      res.json({
        nonce: challenge.nonce,
        message: challenge.message,
        expiresAt: challenge.expiresAt.toISOString(),
      });
    }),
  );

  router.post(
    '/verify',
    rateLimit({ max: 10, windowMs: 60_000 }),
    asyncHandler(async (req, res) => {
      const address = requireAddress(req.body?.address, 'address');
      const nonce = requireString(req.body?.nonce, 'nonce', 64);
      const signature = requireString(req.body?.signature, 'signature', 4096);

      const claim = await claimNonce(nonce, address);
      if (!claim.ok) {
        // Each reason implies a different fix, so they are not collapsed into
        // one message. "Expired" means sign again; "consumed" means the flow
        // already ran and a stale tab is retrying.
        const detail = {
          unknown: 'That sign-in challenge does not exist. Start again.',
          expired: 'That sign-in challenge expired. Request a new one and sign again.',
          consumed: 'That sign-in challenge was already used. Start again.',
          'address-mismatch': 'That sign-in challenge was issued for a different address.',
        }[claim.reason];
        throw ApiError.badRequest(detail);
      }

      // Verified against the message this server stored, never against one
      // supplied by the client — otherwise the caller chooses what they are
      // signing, and the nonce binding means nothing.
      if (!(await verifySignature(address, claim.message, signature))) {
        throw new ApiError(401, 'unauthorized', 'That signature does not match this address.');
      }

      await upsertSigned(address);
      const session = await createSession(address);

      log.info('wallet verified', { address });

      res.json({
        token: session.token,
        expiresAt: session.expiresAt.toISOString(),
        entry: await getEntry(address),
      });
    }),
  );

  // -------------------------------------------------------------------------
  // Step 3-4: link Discord
  // -------------------------------------------------------------------------

  /**
   * Starts the handshake.
   *
   * A redirect rather than a JSON payload containing the URL, because this is
   * reached by `window.location.assign` — building the authorize URL in the
   * browser would put `client_id`, scopes and the redirect URI in the bundle
   * where any of them could be tampered with before Discord sees them.
   *
   * The session token arrives in the query string because a top-level
   * navigation cannot carry an Authorization header. It is a bearer credential
   * in a URL, which is why it is single-purpose and short-lived: it is
   * exchanged here for an opaque state and is not what the callback trusts.
   */
  router.get(
    '/discord',
    asyncHandler(async (req, res) => {
      const token = typeof req.query.token === 'string' ? req.query.token : '';
      if (!token) throw ApiError.badRequest('Sign with your wallet first.');

      const state = await issueOAuthState(token);
      if (!state) {
        // Redirect rather than JSON: the browser is mid-navigation and a JSON
        // body would render as raw text in the address bar.
        return res.redirect(302, appRedirect({ status: 'session-expired' }));
      }

      res.redirect(302, authorizeUrl(state));
    }),
  );

  /**
   * The Discord redirect URI.
   *
   * Everything here ends in a redirect back into the SPA with a status in the
   * query string, never in a JSON error — the user is looking at a browser tab
   * they were navigated into, and an error envelope would render as bare text
   * on a blank page with no way back.
   */
  router.get(
    '/discord/callback',
    asyncHandler(async (req, res) => {
      // The user pressed Cancel on the consent screen. Not an error.
      if (typeof req.query.error === 'string') {
        log.info('authorization declined', { error: req.query.error });
        return res.redirect(302, appRedirect({ status: 'declined' }));
      }

      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      if (!code || !state) return res.redirect(302, appRedirect({ status: 'invalid' }));

      const session = await consumeOAuthState(state);
      if (!session) return res.redirect(302, appRedirect({ status: 'session-expired' }));

      const { address } = session;

      try {
        const tokens = await exchangeCode(code);
        const user = await fetchUser(tokens.accessToken);

        let member = await isGuildMember(user.id);

        // Only with the scope actually granted. Discord returns the granted
        // scopes on the token response, and a user can strip one on the
        // consent screen — trusting what was *requested* would mean calling an
        // endpoint that is going to 403.
        if (!member && config.waitlist.discord.autoJoin && tokens.scopes.includes('guilds.join')) {
          member = await addGuildMember(user.id, tokens.accessToken);
        }

        // Gated on membership: the role is the reward for being in the server,
        // and granting it to a non-member would silently do nothing anyway.
        const roleGranted = member ? await grantWaitlistRole(user.id) : false;

        const entry = await linkDiscord({
          address,
          discordId: user.id,
          username: user.globalName ?? user.username,
          avatarUrl: user.avatarUrl,
          guildMember: member,
          roleGranted,
        });

        log.info('discord linked', { address, discordId: user.id, member, roleGranted });

        if (entry.verified) {
          notifySignup({
            address,
            username: entry.discordUsername ?? user.username,
            total: await countVerified(),
          });
        }

        return res.redirect(
          302,
          appRedirect({ status: member ? 'ok' : 'not-a-member' }),
        );
      } catch (error) {
        if (error instanceof DiscordAlreadyLinkedError) {
          return res.redirect(302, appRedirect({ status: 'already-linked' }));
        }
        if (error instanceof DiscordUnavailableError) {
          log.error('discord unreachable during callback', { address, error });
          return res.redirect(302, appRedirect({ status: 'discord-down' }));
        }
        if (error instanceof DiscordApiError) {
          log.error('discord rejected callback', {
            address,
            status: error.status,
            message: error.message,
          });
          return res.redirect(302, appRedirect({ status: 'discord-error' }));
        }
        throw error;
      }
    }),
  );

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  /**
   * The state of one wallet's signup.
   *
   * Readable by address without a session, because everything it returns is
   * already public or self-evident to whoever holds the address, and requiring
   * a token would mean a user who finished the flow in one tab cannot see the
   * result in another. The Discord *ID* is deliberately not included — the
   * display name is enough to confirm the right account was linked.
   */
  router.get(
    '/status',
    asyncHandler(async (req, res) => {
      const address = requireAddress(req.query.address, 'address');
      const entry = await getEntry(address);

      res.json({
        entry: entry
          ? {
              address: entry.address,
              discordUsername: entry.discordUsername,
              discordAvatar: entry.discordAvatar,
              discordLinked: entry.discordId !== null,
              guildMember: entry.guildMember,
              roleGranted: entry.roleGranted,
              verified: entry.verified,
              position: entry.position,
              createdAt: entry.createdAt,
            }
          : null,
        verifiedCount: await countVerified(),
      });
    }),
  );

  /**
   * Re-checks guild membership for someone who joined after linking.
   *
   * The common case this exists for: a user links Discord before clicking the
   * invite, so the callback records `guildMember: false`. Without a way to
   * re-check, they are stuck at a step they have already completed and the
   * only remedy is to re-run the whole OAuth flow. Session-gated, because
   * unlike `/status` this spends a Discord API call.
   */
  router.post(
    '/recheck',
    rateLimit({ max: 6, windowMs: 60_000 }),
    asyncHandler(async (req, res) => {
      const address = await requireSession(req);
      const entry = await getEntry(address);

      if (!entry?.discordId) {
        throw ApiError.badRequest('Connect your Discord account first.');
      }

      const member = await isGuildMember(entry.discordId);
      const roleGranted = member
        ? entry.roleGranted || (await grantWaitlistRole(entry.discordId))
        : false;

      const updated = await linkDiscord({
        address,
        discordId: entry.discordId,
        username: entry.discordUsername ?? '',
        avatarUrl: entry.discordAvatar,
        guildMember: member,
        roleGranted,
      });

      if (updated.verified && !entry.verified) {
        notifySignup({
          address,
          username: updated.discordUsername ?? 'someone',
          total: await countVerified(),
        });
      }

      res.json({ entry: updated, verifiedCount: await countVerified() });
    }),
  );

  return router;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw ApiError.badRequest(`"${field}" is required`);
  }
  if (value.length > maxLength) {
    throw ApiError.badRequest(`"${field}" is too long`);
  }
  return value.trim();
}

async function requireSession(req: Request): Promise<string> {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new ApiError(401, 'unauthorized', 'Sign with your wallet first.');

  const session = await findSession(token);
  if (!session) {
    throw new ApiError(401, 'unauthorized', 'Your session expired. Sign with your wallet again.');
  }
  return session.address;
}

/**
 * The domain shown in the signing dialog.
 *
 * Derived from APP_URL rather than from the request's Host header: the header
 * is attacker-controlled, and this string is the one thing in the message a
 * user checks to decide whether the request came from the site they are
 * actually looking at.
 */
function siteDomain(): string {
  const appUrl = config.waitlist.appUrl;
  if (!appUrl) return 'Arc Names';
  try {
    return new URL(appUrl).host;
  } catch {
    return 'Arc Names';
  }
}

/**
 * Where the callback sends the browser.
 *
 * Built from APP_URL only — never from a `returnTo` parameter. Reflecting a
 * caller-supplied URL here would make this an open redirect, and one attached
 * to an OAuth callback is the useful kind: it would let a crafted link carry a
 * user through a genuine Discord consent screen and land them somewhere else.
 *
 * APP_URL points at the waitlist's own host (`join.<domain>`), so the target is
 * that site's root. No fragment is added: the waitlist is the whole page there
 * rather than one tab among several, and a leftover `#waitlist` would only be
 * an anchor to an element that does not exist.
 */
function appRedirect(params: { status: string }): string {
  const base = config.waitlist.appUrl ?? '/';
  const url = new URL(base, 'http://localhost');
  url.searchParams.set('waitlist', params.status);
  return config.waitlist.appUrl ? url.toString() : `${url.pathname}${url.search}`;
}

/**
 * Fixed-window rate limit, per IP, in memory.
 *
 * Deliberately modest in scope. It exists so a single client cannot spend the
 * Discord API budget or fill the nonce table, not to stop a distributed
 * attack — and it is per-process, so it does not survive a restart or apply
 * across replicas. That is an acceptable trade for having no Redis dependency;
 * the durable limits are the single-use nonce and the unique index on
 * `discord_id`, neither of which a burst of requests can get past.
 */
function rateLimit({ max, windowMs }: { max: number; windowMs: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, _res: unknown, next: (error?: unknown) => void): void => {
    const now = Date.now();

    // Opportunistic sweep — without it the map is a slow leak keyed by every
    // IP that has ever called.
    if (hits.size > 10_000) {
      for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
    }

    const key = req.ip ?? 'unknown';
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      return next(
        new ApiError(429, 'rate_limited', 'Too many attempts. Wait a minute and try again.'),
      );
    }
    next();
  };
}

// Re-exported so `index.ts` can log the scope list at startup — the most
// common misconfiguration is a Discord application whose registered scopes do
// not match what the code requests.
export { oauthScopes };
