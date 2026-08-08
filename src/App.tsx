import { useEffect, useState } from 'react';
import { Activity, BookOpen, MessageCircle, Sparkles, Store, Search, Wallet } from 'lucide-react';
import { ConnectButton } from './components/ConnectButton';
import { NetworkBanner } from './components/NetworkBanner';
import { ToastViewport } from './components/ToastViewport';
import { SearchView } from './components/SearchView';
import { PortfolioView } from './components/PortfolioView';
import { MarketplaceView } from './components/MarketplaceView';
import { ActivityView } from './components/ActivityView';
import { useWaitlistConfig } from './hooks/useWaitlist';
import { DISCORD_INVITE_URL } from './lib/discord';
import { waitlistSiteUrl } from './lib/site';
import { cx } from './components/ui';

const TABS = [
  { id: 'search', label: 'Search', icon: Search },
  { id: 'names', label: 'My names', icon: Wallet },
  { id: 'market', label: 'Market', icon: Store },
  { id: 'activity', label: 'Activity', icon: Activity },
] as const;

/**
 * Docs live at /docs/ — a separate VitePress site built into `dist/docs` by
 * `npm run build:all`, and proxied to the VitePress dev server in development.
 *
 * The `.html` suffixes are deliberate: the docs set `cleanUrls: false` so the
 * links resolve on a plain static host without rewrite rules.
 */
const DOCS_URL = '/docs/';

const FOOTER_LINKS = [
  {
    heading: 'Get started',
    links: [
      { label: 'Quick start', href: '/docs/guide/quick-start.html' },
      { label: 'Connecting a wallet', href: '/docs/guide/connecting-a-wallet.html' },
      { label: 'Registering a name', href: '/docs/guide/registering.html' },
    ],
  },
  {
    heading: 'Using names',
    links: [
      { label: 'Pricing & rarity', href: '/docs/guide/pricing.html' },
      { label: 'Renewals & expiry', href: '/docs/guide/renewals.html' },
      { label: 'Marketplace', href: '/docs/guide/marketplace.html' },
    ],
  },
  {
    heading: 'Reference',
    links: [
      { label: 'Contract addresses', href: '/docs/protocol/contracts.html' },
      { label: 'API endpoints', href: '/docs/api/endpoints.html' },
      { label: 'Safety', href: '/docs/safety.html' },
    ],
  },
] as const;

type TabId = (typeof TABS)[number]['id'];

function tabFromHash(): TabId {
  const hash = window.location.hash.replace('#', '');
  return TABS.some((tab) => tab.id === hash) ? (hash as TabId) : 'search';
}

/**
 * App shell.
 *
 * This replaces a single 2,249-line component that held every view, every
 * contract call and all of its own state. Routing is the URL hash rather than
 * component state, so a tab is linkable and survives a reload, and each view
 * owns its own data through hooks — switching tabs no longer re-runs every
 * network request in the app.
 */
export default function App() {
  const [tab, setTab] = useState<TabId>(tabFromHash);

  /*
   * Whether to offer the waitlist at all, asked of the server rather than
   * assumed. The flow needs Discord credentials the indexer may not have, and
   * `/config` is the only thing that knows — so an unconfigured deployment
   * shows no call to action instead of a button that leads to a 503. It needs
   * no wallet, is cached for the session and does not retry, so a missing
   * indexer costs one failed request and hides the link.
   */
  const waitlistOpen = useWaitlistConfig().data?.enabled === true;

  useEffect(() => {
    const onHashChange = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const select = (id: TabId) => {
    window.location.hash = id;
    setTab(id);
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:text-accent-ink"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-border bg-canvas/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4">
          <button
            type="button"
            onClick={() => select('search')}
            className="flex items-center gap-2.5"
          >
            <img src="/logo.png" alt="Arc Names" className="size-9" />
            <span className="font-display text-lg font-bold text-ink">arc names</span>
          </button>

          <nav className="hidden items-center gap-1 sm:flex" aria-label="Primary">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => select(id)}
                aria-current={tab === id ? 'page' : undefined}
                className={cx(
                  'rounded-lg px-3 py-1.5 text-sm transition-colors',
                  tab === id ? 'bg-surface-raised text-ink' : 'text-ink-muted hover:text-ink',
                )}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Also not a tab: the waitlist is a different host. Hidden below
                `sm` because the docs link already collapses to an icon to fit
                beside the connect button — a third item does not. The footer
                and the search hero carry it on a phone instead. */}
            {waitlistOpen ? (
              <a
                href={waitlistSiteUrl()}
                className="hidden items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover sm:inline-flex"
              >
                <Sparkles className="size-4" aria-hidden />
                Join waitlist
              </a>
            ) : null}

            {/* Not a tab — this leaves the SPA for the docs site, so it is an
                anchor rather than a hash-routed button. Icon-only on phones,
                where the header has no room beside the connect button. */}
            <a
              href={DOCS_URL}
              aria-label="Documentation"
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink sm:px-3"
            >
              <BookOpen className="size-4" aria-hidden />
              <span className="hidden sm:inline">Docs</span>
            </a>
            <ConnectButton />
          </div>
        </div>
      </header>

      <NetworkBanner />

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-10 pt-6">
        {tab === 'search' ? (
          <SearchView />
        ) : (
          <>
            <h1 className="mb-5 font-display text-2xl font-bold text-ink">
              {TABS.find((entry) => entry.id === tab)?.label}
            </h1>
            {tab === 'names' ? <PortfolioView /> : null}
            {tab === 'market' ? <MarketplaceView /> : null}
            {tab === 'activity' ? <ActivityView /> : null}
          </>
        )}
      </main>

      {/* The footer carries the bottom padding that clears the fixed mobile
          nav bar, which is why `main` above no longer needs it. */}
      <footer className="border-t border-border bg-surface-raised/20">
        <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-10 sm:pb-10">
          <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <img src="/logo.png" alt="" aria-hidden className="size-7" />
                <span className="font-display text-base font-bold text-ink">arc names</span>
              </div>
              <p className="mt-2.5 max-w-xs text-xs leading-relaxed text-ink-subtle">
                Your identity on Arc. Running on Arc Testnet — names carry no mainnet
                guarantee.
              </p>
              <div className="mt-3 flex flex-col items-start gap-2">
                <a
                  href={DOCS_URL}
                  className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
                >
                  <BookOpen className="size-3.5" aria-hidden />
                  Read the docs
                </a>
                {/* Off-site and third-party, so `noreferrer` rather than just
                    `noopener`. Not gated on the waitlist config: the server is
                    worth joining whether or not mainnet signups are open. */}
                <a
                  href={DISCORD_INVITE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
                >
                  <MessageCircle className="size-3.5" aria-hidden />
                  Join our Discord
                </a>
              </div>
            </div>

            <nav
              aria-label="Documentation"
              className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 sm:gap-x-12"
            >
              {FOOTER_LINKS.map(({ heading, links }) => (
                <div key={heading}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                    {heading}
                  </p>
                  <ul className="mt-2.5 space-y-2">
                    {links.map(({ label, href }) => (
                      <li key={href}>
                        <a
                          href={href}
                          className="text-sm text-ink-muted transition-colors hover:text-ink"
                        >
                          {label}
                        </a>
                      </li>
                    ))}
                    {/* Appended at render rather than added to FOOTER_LINKS:
                        that const is static, and this entry depends on a query
                        that has not resolved on first paint. */}
                    {heading === 'Get started' && waitlistOpen ? (
                      <li>
                        <a
                          href={waitlistSiteUrl()}
                          className="text-sm text-accent transition-colors hover:underline"
                        >
                          Join the waitlist
                        </a>
                      </li>
                    ) : null}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
        </div>
      </footer>

      {/* Bottom bar on small screens — the old header nav overflowed off-screen
          on a phone, leaving the marketplace and activity tabs unreachable. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-canvas/95 backdrop-blur-md sm:hidden"
        aria-label="Primary"
      >
        <div className="flex">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => select(id)}
              aria-current={tab === id ? 'page' : undefined}
              className={cx(
                'flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] transition-colors',
                tab === id ? 'text-accent' : 'text-ink-subtle',
              )}
            >
              <Icon className="size-5" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </nav>

      <ToastViewport />
    </div>
  );
}
