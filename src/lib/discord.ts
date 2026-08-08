/**
 * The Discord invite.
 *
 * Hardcoded rather than read from the indexer's `/waitlist/config`, which also
 * carries an `inviteUrl`. Two reasons: a community link should render on first
 * paint instead of appearing once a query resolves, and it should survive the
 * indexer being unreachable — an outage that hides the read-only views has no
 * business also hiding the social link.
 *
 * The cost is two places to change. The other is `DISCORD_INVITE_URL` in
 * `indexer/.env`, which is what the waitlist flow itself uses; keep them in
 * step. Use an invite set to never expire — the default 7-day one turns the
 * footer into a dead link with no warning.
 */
export const DISCORD_INVITE_URL = 'https://discord.gg/9VGKrvTrUh';
