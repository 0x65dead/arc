/**
 * The project's X (formerly Twitter) account.
 *
 * Hardcoded for the same reason as `DISCORD_INVITE_URL` in `./discord`: a
 * social link should render on first paint and survive the indexer being
 * unreachable. Unlike the Discord invite it has no second copy in the
 * indexer's env — nothing server-side follows this link — so this file is the
 * only place to change it.
 *
 * `X_HANDLE` is the same account without the `@`; the two are kept together so
 * a rename cannot leave the label pointing at a different profile than the
 * href. It also feeds `twitter:site` in `index.html`, which is the one copy
 * outside this module — update both if the handle changes.
 */
export const X_HANDLE = 'arcnaming';

export const X_PROFILE_URL = `https://x.com/${X_HANDLE}`;
