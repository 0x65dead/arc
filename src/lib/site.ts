/**
 * Which site this bundle is currently serving.
 *
 * One build, two hosts. The waitlist lives on its own subdomain
 * (`join.<domain>`) but is not a separate project: a second Vercel domain
 * pointed at this same deployment means the OAuth callback path, the `/api/*`
 * rewrite and the asset cache headers are all inherited rather than
 * reimplemented, and there is no second bundle to keep in step.
 *
 * Detection is by subdomain rather than a hardcoded hostname so that preview
 * deployments, a domain rename, and a future `join.` on a different apex all
 * keep working without a code change.
 */

export type SiteMode = 'app' | 'waitlist';

/**
 * Explicit override, for two cases the hostname cannot answer:
 *
 *   - local development, where everything is `localhost`
 *   - a Vercel preview URL, which is `*.vercel.app` with no `join.` label
 *
 * Set `VITE_SITE_MODE=waitlist` to force the standalone waitlist.
 */
const OVERRIDE = import.meta.env.VITE_SITE_MODE as SiteMode | undefined;

function detect(): SiteMode {
  if (OVERRIDE === 'waitlist' || OVERRIDE === 'app') return OVERRIDE;

  // `hostname`, not `host` — the latter carries the port in development and
  // would never match a prefix test cleanly.
  const host = window.location.hostname.toLowerCase();
  return host === 'join' || host.startsWith('join.') ? 'waitlist' : 'app';
}

/**
 * Resolved once at module load.
 *
 * The host cannot change without a full navigation, so re-deriving this per
 * render would be work that can never produce a different answer — and a
 * constant lets the shell branch before any view mounts, instead of flashing
 * the app chrome and then replacing it.
 */
export const siteMode: SiteMode = detect();

export const isWaitlistSite = siteMode === 'waitlist';

/**
 * The waitlist site, derived by adding the `join.` label rather than hardcoded.
 *
 * The mirror of the same trick in `WaitlistPage`, which strips the label to get
 * back here, and for the same reason: a domain rename needs no code change.
 *
 * Two hosts cannot be turned into a `join.` URL, and both fall back to a
 * same-origin link rather than one into a domain that may not exist — a bare
 * host with no dot (`localhost`), and a preview deployment on `*.vercel.app`,
 * where prefixing would invent a subdomain nobody has pointed at this project.
 * The `?waitlist` query is what makes that fallback useful in development:
 * paired with `VITE_SITE_MODE=waitlist` it is a link you can actually follow.
 */
export function waitlistSiteUrl(): string {
  const { protocol, hostname, port } = window.location;
  const host = hostname.toLowerCase();

  if (host === 'join' || host.startsWith('join.')) return '/';
  if (!host.includes('.') || host.endsWith('.vercel.app')) return '/?waitlist';

  // `www.` is a label on the same site, not a different one — prefixing it
  // would point at `join.www.<domain>`, which nobody registers.
  const apex = host.startsWith('www.') ? host.slice('www.'.length) : host;

  return `${protocol}//join.${apex}${port ? `:${port}` : ''}/`;
}
