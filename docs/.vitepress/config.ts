import { defineConfig } from 'vitepress';

/**
 * Docs config.
 *
 * The sidebar is grouped by audience, not by file layout: `/guide/` is the
 * user path (register, renew, records), `/protocol/` and `/api/` are the
 * integrator path. Both are surfaced from the landing page so neither audience
 * has to guess which half of the tree is theirs.
 */
export default defineConfig({
  title: 'Arc Names',
  description:
    'Register a .arc name — one identity for payments, profiles and apps across the Arc network.',
  lang: 'en-US',
  /*
   * Extensionless URLs require the host to rewrite /docs/guide/x to x.html.
   * A plain static server (including `vite preview`) doesn't, so the links
   * would 404 wherever this is deployed. `.html` suffixes work everywhere.
   */
  cleanUrls: false,
  lastUpdated: true,

  /*
   * The docs ship inside the app's own deployment rather than on a separate
   * host, so they are reachable at /docs/ from the same origin the app is
   * served from. `outDir` writes into the app's dist/, which means
   * `npm run build:all` must build the app first — `vite build` empties dist/
   * and would delete the docs if the order were reversed.
   */
  base: '/docs/',
  outDir: '../dist/docs',

  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/docs/logo.png' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Arc Names Documentation' }],
    [
      'meta',
      {
        property: 'og:description',
        content: 'Guides, protocol reference and API docs for the .arc name service.',
      },
    ],
  ],
  themeConfig: {
    logo: '/logo.png',
    siteTitle: 'Arc Names',

    nav: [
      { text: 'Guide', link: '/guide/what-is-arc-names', activeMatch: '/guide/' },
      { text: 'Protocol', link: '/protocol/resolving', activeMatch: '/protocol/' },
      { text: 'API', link: '/api/endpoints', activeMatch: '/api/' },
      { text: 'Safety', link: '/safety' },
      // The "← App" link is NOT here: VitePress prefixes every internal nav
      // link with `base`, so `/` compiles to `/docs/` and points back at these
      // docs. It is injected as a raw anchor via the theme's
      // `nav-bar-content-after` slot instead — see theme/index.ts.
    ],

    sidebar: [
      {
        text: 'Introduction',
        collapsed: false,
        items: [
          { text: 'What is Arc Names', link: '/guide/what-is-arc-names' },
          { text: 'Quick start', link: '/guide/quick-start' },
          { text: 'Connecting a wallet', link: '/guide/connecting-a-wallet' },
        ],
      },
      {
        text: 'Using Arc Names',
        collapsed: false,
        items: [
          { text: 'Registering a name', link: '/guide/registering' },
          { text: 'Claiming a name', link: '/guide/claiming' },
          { text: 'Pricing & rarity', link: '/guide/pricing' },
          { text: 'Renewals & expiry', link: '/guide/renewals' },
          { text: 'Your primary name', link: '/guide/primary-name' },
          { text: 'Records & profile', link: '/guide/records' },
          { text: 'Ownership & transfers', link: '/guide/ownership' },
          { text: 'Marketplace', link: '/guide/marketplace' },
        ],
      },
      {
        text: 'How it works',
        collapsed: false,
        items: [
          { text: 'Resolving .arc', link: '/protocol/resolving' },
          { text: 'Architecture', link: '/protocol/architecture' },
          { text: 'Fees', link: '/protocol/fees' },
          { text: 'Contract addresses', link: '/protocol/contracts' },
        ],
      },
      {
        text: 'Reference',
        collapsed: false,
        items: [
          { text: 'API endpoints', link: '/api/endpoints' },
          { text: 'Glossary', link: '/reference/glossary' },
          { text: 'FAQ', link: '/reference/faq' },
        ],
      },
      {
        text: 'Safety',
        collapsed: false,
        items: [{ text: 'Safety & cautions', link: '/safety' }],
      },
    ],

    search: { provider: 'local' },

    // The X entry passes an inline `svg` rather than the `icon: 'x'` shorthand.
    // The shorthand resolves through api.iconify.design at runtime whenever the
    // build has not inlined the mask, which puts a docs-site nav icon behind a
    // third-party request; the path is small enough to just carry. Same mark as
    // `src/components/XIcon.tsx` — keep the two in step.
    socialLinks: [
      { icon: 'github', link: 'https://github.com/arcnames' },
      {
        icon: {
          svg: '<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>X</title><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
        },
        link: 'https://x.com/arcnaming',
        ariaLabel: 'Arc Names on X',
      },
    ],

    footer: {
      message: 'Arc Names runs on Arc Testnet. Names carry no mainnet guarantee.',
      copyright: 'Arc Names',
    },

    editLink: {
      pattern: 'https://github.com/arcnames/arc/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    outline: { level: [2, 3] },
  },
});
