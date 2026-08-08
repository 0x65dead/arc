import { useEffect } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { ConnectButton } from './ConnectButton';
import { ToastViewport } from './ToastViewport';
import { WaitlistView } from './WaitlistView';
import { XIcon } from './XIcon';
import { X_HANDLE, X_PROFILE_URL } from '../lib/social';

/**
 * The standalone shell for `join.<domain>`.
 *
 * Deliberately not the app shell with the tabs hidden. Someone arriving here
 * came for one thing, and the signup is a five-step flow that leaves the page
 * in the middle — every extra nav target is a chance to lose the thread and
 * come back to a half-finished session. So: a logo, a connect button, the
 * flow, and one way back to the main site.
 *
 * `NetworkBanner` is also absent, and that is a correctness point rather than a
 * cosmetic one. It warns when the wallet is on the wrong chain, which matters
 * everywhere else in this app because every other view makes contract calls.
 * The waitlist signs an off-chain message — `personal_sign` is valid whatever
 * chain the wallet has selected — so the banner would tell users to fix
 * something that is not blocking them, right as they are being asked to sign.
 */
export function WaitlistPage() {
  // Both hosts serve the same index.html, whose title is the main site's. On
  // this one that title is wrong in the place it is most visible: a pinned tab,
  // and the bookmark a user makes while waiting for mainnet.
  useEffect(() => {
    document.title = 'Join the Arc Names Mainnet Waitlist';
  }, []);

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:text-accent-ink"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-border bg-canvas/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between gap-4 px-4">
          <a href={mainSiteUrl()} className="flex items-center gap-2.5">
            <img src="/logo.png" alt="Arc Names" className="size-9" />
            <span className="font-display text-lg font-bold text-ink">arc names</span>
          </a>
          <ConnectButton />
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 pb-10 pt-6">
        <WaitlistView />
      </main>

      <footer className="border-t border-border bg-surface-raised/20">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-sm text-xs leading-relaxed text-ink-subtle">
            Joining the waitlist is free and off-chain. Signing costs no gas and cannot move
            your funds or your names.
          </p>
          {/* Two off-site links in a shell whose whole point is not having nav.
              Both are footer-only and neither costs the flow: X opens in a new
              tab, so a half-signed-up user keeps their tab, and mainnet gets
              announced there — this is where someone waiting will look. */}
          <div className="flex shrink-0 items-center gap-4">
            <a
              href={X_PROFILE_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
            >
              <XIcon className="size-3" />@{X_HANDLE}
            </a>
            <a
              href={mainSiteUrl()}
              className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
            >
              Go to arc names
              <ArrowUpRight className="size-3.5" aria-hidden />
            </a>
          </div>
        </div>
      </footer>

      <ToastViewport />
    </div>
  );
}

/**
 * The main site, derived by dropping the `join.` label rather than hardcoded.
 *
 * Keeps this file correct through a domain rename, and on a preview deployment
 * (where `VITE_SITE_MODE` forces waitlist mode on a host that has no `join.`
 * prefix) it resolves to the origin already being served instead of a link into
 * a domain that may not exist yet.
 */
function mainSiteUrl(): string {
  const { protocol, hostname, port } = window.location;
  if (!hostname.toLowerCase().startsWith('join.')) return '/';
  return `${protocol}//${hostname.slice('join.'.length)}${port ? `:${port}` : ''}/`;
}
