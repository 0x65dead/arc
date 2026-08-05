import { createReadStream, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, normalize, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/*
 * The indexer runs as a separate service on its own port, in dev and in
 * production alike. `src/lib/indexer.ts` builds same-origin URLs when
 * VITE_INDEXER_API_URL is unset, so without this proxy every /api/v1/* call
 * hits Vite, 404s, and the marketplace, stats and activity panes render empty —
 * indistinguishable from "nothing has happened yet". Set INDEXER_ORIGIN to
 * point at a non-default host or port.
 */
const indexerProxy = {
  '/api': {
    target: process.env.INDEXER_ORIGIN ?? 'http://localhost:8787',
    changeOrigin: true,
  },
  '/health': {
    target: process.env.INDEXER_ORIGIN ?? 'http://localhost:8787',
    changeOrigin: true,
  },
};

const DOCS_DIST = fileURLToPath(new URL('./dist/docs', import.meta.url));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
};

function fileOrNull(path: string) {
  try {
    const stat = statSync(path);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

/**
 * Serves the built docs at /docs/ during `vite dev`.
 *
 * The docs are a separate VitePress site that builds into dist/docs. Vite's dev
 * server only knows about the app, so /docs used to be proxied to the VitePress
 * dev server on port 3100 — which meant every docs link in the app failed with
 * ECONNREFUSED unless you happened to be running a second process, even
 * immediately after `npm run build:all` had put the real docs on disk.
 *
 * So: serve them off disk. Set DOCS_ORIGIN to proxy to a live VitePress server
 * instead when you are editing docs and want HMR (`npm run docs:dev`, then
 * `DOCS_ORIGIN=http://localhost:3100 npm run dev`) — that path bypasses this
 * middleware entirely, since Vite's proxy runs first.
 */
function serveBuiltDocs(): Plugin {
  return {
    name: 'arc-serve-built-docs',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/docs', (req, res, next) => {
        if (process.env.DOCS_ORIGIN) return next();

        const method = req.method ?? 'GET';
        if (method !== 'GET' && method !== 'HEAD') return next();

        // The middleware is mounted at /docs, so req.url is already relative to
        // it. Drop the query/hash, then normalize and confine to DOCS_DIST so a
        // crafted `..` can't read outside the docs tree.
        const rawPath = decodeURIComponent((req.url ?? '/').split(/[?#]/)[0]);
        const target = normalize(join(DOCS_DIST, rawPath));
        if (target !== DOCS_DIST && !target.startsWith(DOCS_DIST + sep)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }

        const send = (path: string, status: number) => {
          const ext = path.slice(path.lastIndexOf('.'));
          res.statusCode = status;
          res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
          // Always revalidate: these are build artifacts that change under the
          // dev server without any hash in the URL.
          res.setHeader('Cache-Control', 'no-cache');
          if (method === 'HEAD') {
            res.end();
            return;
          }
          createReadStream(path).pipe(res);
        };

        // Directory URLs map to index.html; /docs/guide (no slash) has to
        // redirect first or its relative asset URLs resolve one level too high.
        const asFile = fileOrNull(target);
        if (!asFile && fileOrNull(join(target, 'index.html'))) {
          if (!rawPath.endsWith('/')) {
            res.statusCode = 301;
            res.setHeader('Location', `/docs${rawPath}/`);
            res.end();
            return;
          }
          send(join(target, 'index.html'), 200);
          return;
        }

        if (asFile) {
          send(target, 200);
          return;
        }

        const notFound = join(DOCS_DIST, '404.html');
        if (fileOrNull(notFound)) {
          send(notFound, 404);
          return;
        }

        // Nothing on disk at all — the docs have never been built. Say so,
        // rather than letting this fall through to the app's index.html and
        // render the SPA under a /docs URL.
        res.statusCode = 503;
        res.setHeader('Content-Type', MIME['.html']);
        res.end(
          `<!doctype html><meta charset="utf-8"><title>Docs not built</title>` +
            `<body style="font:16px/1.6 system-ui;max-width:34rem;margin:15vh auto;padding:0 1.5rem">` +
            `<h1 style="font-size:1.3rem">The docs aren't built yet</h1>` +
            `<p>Run <code>npm run docs:build</code> to build them into ` +
            `<code>dist/docs</code>, then reload this page.</p>` +
            `<p>To edit docs with hot reload instead, run <code>npm run docs:dev</code> ` +
            `and start the app with <code>DOCS_ORIGIN=http://localhost:3100 npm run dev</code>.</p>` +
            `<p><a href="/">← Back to the app</a></p></body>`,
        );
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    serveBuiltDocs(),
  ],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: 'all',
    proxy: {
      ...indexerProxy,
      /*
       * Only registered when you opt in — see serveBuiltDocs() above. Vite
       * resolves `proxy` at config time, so this key has to be absent (not
       * merely unmatched) for the disk-serving middleware to see the request.
       */
      ...(process.env.DOCS_ORIGIN
        ? { '/docs': { target: process.env.DOCS_ORIGIN, changeOrigin: true } }
        : {}),
    },
  },

  /*
   * `preview.proxy` defaults to `server.proxy`, which would forward /docs to
   * the VitePress dev server — the one thing preview must NOT do. Preview
   * serves dist/, where `npm run build:all` has already put the real static
   * docs; proxying instead makes every docs URL 500 whenever port 3100 is idle,
   * and silently hides the built output when it isn't. The indexer is still a
   * separate service here, so its proxy stays.
   */
  preview: {
    host: '0.0.0.0',
    port: 3000,
    proxy: indexerProxy,
  },
});
