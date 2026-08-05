import { h } from 'vue';
import DefaultTheme from 'vitepress/theme';
import './custom.css';

/**
 * Default theme plus a "back to app" link in the nav bar.
 *
 * This can't be a `themeConfig.nav` entry. VitePress runs every internal nav
 * link through `withBase()`, and the docs are based at `/docs/`, so a `link: '/'`
 * compiles to `href="/docs/"` — a link from the docs back to the docs, rendered
 * as the active item. A raw `<a>` bypasses that resolution and keeps `/`.
 */
export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'nav-bar-content-after': () =>
        h(
          'a',
          {
            href: '/',
            class: 'back-to-app',
            'aria-label': 'Back to the Arc Names app',
          },
          '← App',
        ),
    });
  },
};
