# Deploying Arc Names

Three pieces have to line up: **Vercel** serves one bundle to two domains, the
**indexer** answers `/api/*` behind a Vercel rewrite, and **Discord** has to
recognise the callback URL. This walks through all three in the order that
avoids dead ends.

Where a step can be checked, the check is included. Do them in order — several
later steps fail confusingly if an earlier one was skipped.

---

## ⚠️ Read this first: one port number breaks every API call

`vercel.json` rewrites `/api/*` and `/health` to
`https://vmi3483659.contaboserver.net`. That hostname is **correct** — it is the
Contabo VPS itself (`hostname -f` on the box returns exactly that), and Caddy
there terminates TLS for the indexer. Nothing about the Vercel config needs to
change.

What is broken is one port. `/etc/caddy/Caddyfile` proxies to `127.0.0.1:8787`,
but **8787 is held by an unrelated `workerd` process from `/root/arproxy`**,
which starts on boot and wins the race. The indexer cannot bind it and ends up
elsewhere. Caddy does not know that, so it forwards the public `/api/*` to
whatever *did* win — an OpenAI-compatible LLM proxy:

```
GET /health                  401  {"error":"Missing API key authorization."}
GET /api/v1/stats            401  {"error":"Missing API key authorization."}
GET /api/v1/waitlist/config  401  {"error":"Missing API key authorization."}
with x-api-key: test      →  {"id":"chatcmpl-err","object":"chat.completion",...}
```

Our indexer answers `{"error":{"code","message"}}` (nested); a flat
`{"error":"..."}` is always someone else's. The `404 "Arc Names indexer. Read
API is at /api/v1."` on `/` *is* ours — it is the `handle` fallback in the
Caddyfile, which is why the endpoint looks alive while every real route 401s.

**Consequence if you deploy without fixing it:** green build, site loads, every
API call 401s. Search empty, portfolio empty, market and activity blank,
waitlist CTAs hidden — and nothing in the Vercel logs, because the rewrite did
exactly what it was told.

**The fix, on the VPS.** `indexer/.env` is already set to `PORT=8799`. Make the
Caddyfile agree:

```sh
sudo sed -i 's/127\.0\.0\.1:8787/127.0.0.1:8799/g' /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile   # parse check before reloading
sudo systemctl reload caddy                          # reload, not restart: no dropped connections
```

Then confirm you are talking to the indexer and not the proxy:

```sh
curl -s https://vmi3483659.contaboserver.net/health
# want: {"status":"ok","database":true,...}   not: {"error":"Missing API key authorization."}
```

Keep `PORT` in `indexer/.env` and `reverse_proxy` in the Caddyfile in step —
they are two halves of one setting on two sides of a trust boundary, and when
they disagree the symptom appears on a *different* service's behalf.

**Worth doing while you are here:** make the indexer a systemd unit so it comes
back on reboot, the way Caddy already does (`systemctl is-enabled caddy` →
`enabled`). Right now it runs under `npm run dev` in a terminal, so the next
reboot brings up Caddy and `arproxy` but not the indexer — and the site fails
in precisely the way above, with no one having changed anything.

---

## 0. The shape of it

```
              ┌──────────────────────────────────────────────┐
              │  Vercel — one deployment, one bundle          │
              │                                               │
  arcnaming   │   /            → App shell (search, market)   │
  .xyz     ───┤   /docs/*      → VitePress static build       │
              │   /api/:path*  ─┐                             │
              │   /health      ─┤ rewrite (same-origin proxy) │
  join.       │                 │                             │
  arcnaming───┤   /            → Waitlist shell               │
  .xyz        │   /api/:path*  ─┤                             │
              └─────────────────┼─────────────────────────────┘
                                │
                                ▼
                   ┌────────────────────────────┐
                   │  Indexer (your own server)  │
                   │  Express + Postgres         │
                   │  /api/v1/*  /api/waitlist/* │
                   └────────────────────────────┘
```

Both domains point at the **same** Vercel deployment. `src/lib/site.ts` picks
the shell from `window.location.hostname` at module load: a `join.` label gets
the waitlist, anything else gets the app. One build, one set of rewrites, one
cache policy — nothing to keep in step.

The browser never calls the indexer's hostname directly. It calls
`/api/v1/...` on whichever domain it is already on, and Vercel proxies that to
the indexer. This is deliberate:

- no CORS preflight on any request, and no `CORS_ORIGINS` to maintain
- no mixed-content problem if the indexer is ever plain HTTP
- the Discord callback lands on `join.arcnaming.xyz`, which is what makes a
  cookie-free OAuth round trip work and keeps the indexer's hostname out of
  the address bar

**Do not set `VITE_INDEXER_API_URL` in Vercel.** Setting it makes the browser
call the indexer's origin directly and bypasses everything above. It is unset
in `.env` for exactly this reason.

---

## 1. Deploy the indexer first

Vercel's rewrite is a proxy, not a fallback — if the indexer is unreachable or
missing the waitlist routes, the app still loads but the waitlist CTAs stay
hidden and the market/activity views stay empty. So the indexer goes first.

On the VPS (`vmi3483659.contaboserver.net`):

```sh
git pull
cd indexer
npm ci                # includes devDependencies — tsc is needed to build
npm run build
# then restart however you supervise it (pm2 / systemd / docker)
```

Migrations run automatically on startup (`src/index.ts` calls `runMigrations()`
before anything else), so `003_waitlist.sql` applies itself on the restart —
the log line to look for is `[migrate] schema up to date applied=3`. To apply
them without starting the service, `npm run migrate:prod` after the build; note
that plain `npm run migrate` goes through `tsx`, which is a devDependency and
will not exist if you installed with `--omit=dev`.

`indexer/.env` on that box needs these five for the waitlist to switch on. Miss
any one and `isWaitlistEnabled()` stays false, every `/api/waitlist/*` route
answers 503, and the frontend hides its own CTAs rather than offering a button
that cannot work:

```ini
DISCORD_CLIENT_ID=1534596015129362482
DISCORD_CLIENT_SECRET=<from the portal — rotate first, see §6>
DISCORD_BOT_TOKEN=<from the portal — rotate first, see §6>
DISCORD_GUILD_ID=1534305810702794902
DISCORD_REDIRECT_URI=https://join.arcnaming.xyz/api/waitlist/discord/callback
```

Plus these, which shape the flow rather than gate it:

```ini
APP_URL=https://join.arcnaming.xyz     # where the OAuth callback redirects back to
DISCORD_INVITE_URL=https://discord.gg/9VGKrvTrUh
DISCORD_WAITLIST_ROLE_ID=              # optional; empty skips the role grant
DISCORD_AUTO_JOIN=false                # true also needs the guilds.join scope
DISCORD_WEBHOOK_URL=                   # optional signup notifications
TRUST_PROXY=1                          # one hop: Vercel's rewrite
```

`APP_URL` must be the **`join.` host**, not the apex. It is both the redirect
target after OAuth and the domain shown in the wallet signing dialog. Pointing
it at the apex sends users to a page with no waitlist on it.

Check the deploy landed:

```sh
curl -s https://vmi3483659.contaboserver.net/health
curl -s https://vmi3483659.contaboserver.net/api/v1/waitlist/config
```

`/health` should report `database: true`. `/config` should report
`"enabled": true`.

Read the failures carefully — they say different things:

| Response | Meaning |
|---|---|
| `{"enabled":true,...}` | correct |
| `{"enabled":false,...}` | one of the five variables above is missing; the 503 body from any *other* waitlist route names which |
| `404` | the waitlist code is not deployed — you are running an older build |
| `401`, or any flat `{"error":"..."}` | **Caddy is proxying to the wrong port** — you are reaching the LLM proxy, not the indexer. See the callout at the top |

---

## 2. Discord portal

Application `1534596015129362482`, at
<https://discord.com/developers/applications>.

**OAuth2 → Redirects.** Add this, character for character — no trailing slash,
`https`, the `join.` host:

```
https://join.arcnaming.xyz/api/waitlist/discord/callback
```

It must equal `DISCORD_REDIRECT_URI` from §1 exactly. Discord compares strings,
and a mismatch is not reported at the consent screen — it fails later at token
exchange, which surfaces as `?waitlist=discord-error` with the real reason only
in the indexer log. This cannot be checked from outside the portal, so it is
worth re-reading once against the value in `.env`.

**Bot → invite it to the server.** Already done — `arcnamesbot` is in
`arcnames` and `/api/v1/waitlist/config` reports the guild. Recorded here
because it is not obvious and it is what breaks if the bot is ever kicked:
`isGuildMember` swallows the resulting 404 into `false`, and because `verified`
is bound to that flag, *nobody* can be verified — including people already in
the server. The symptom is every signup landing on `?waitlist=not-a-member`
and `verifiedCount` stuck at 0.

```
https://discord.com/oauth2/authorize?client_id=1534596015129362482&scope=bot&permissions=268435456
```

**If you set `DISCORD_WAITLIST_ROLE_ID`:** in **Server Settings → Roles**, drag
the bot's own role **above** the waitlist role. Discord refuses to grant a role
at or above the granting bot's highest role, and it 403s regardless of the
Manage Roles permission. Leaving the variable empty skips the grant entirely,
which is a fine way to ship.

---

## 3. Vercel project

**Build settings** — `vercel.json` already carries all of this; only confirm
the dashboard is not overriding it:

| Setting | Value |
|---|---|
| Framework preset | Vite (or Other) |
| Build command | `npm run build:all` |
| Output directory | `dist` |
| Install command | `npm install` |
| Node version | 20.x or 22.x |

`build:all` builds the SPA into `dist/` **and** the VitePress docs into
`dist/docs/`. Plain `npm run build` skips the docs and every footer link 404s —
if the docs are missing from a deploy, this is why.

**Environment variables.** The frontend only ships `VITE_`-prefixed vars, and
it needs exactly one, because the contract addresses are compiled in
(`src/config/contracts.ts`) and the API is same-origin:

| Variable | Value | Why |
|---|---|---|
| `VITE_ALCHEMY_API_KEY` | your Alchemy key | Required. Without it the RPC falls back to `rpc.testnet.arc.network`, which sends no CORS headers — **every on-chain read fails in the browser**: search shows nothing, the portfolio is empty, registration cannot price a name. The app detects this and says so in a banner, but it is not usable. |

⚠️ **This one interacts with the `.env` cleanup in §6.** The key currently
reaches Vercel only because the root `.env` is committed to the repo. The
moment you `git rm --cached .env`, the next build has no key and the site
breaks in exactly the way above — with a green build and no error. **Set
`VITE_ALCHEMY_API_KEY` in Vercel first, then untrack the file.**

Optional: `VITE_ARC_RPC_URL` overrides the RPC endpoint outright (a self-hosted
node or CORS-enabled proxy), and `VITE_{REGISTRY,CONTROLLER,REGISTRAR,RESOLVER,
REVERSE_REGISTRAR,UNIVERSAL_RESOLVER,MARKET}_ADDRESS` override the compiled-in
contract addresses. Leave them unset unless you are pointing at a fresh deploy.

Deliberately **not** set:

- `VITE_INDEXER_API_URL` — see §0. Setting it breaks the rewrite.
- `VITE_SITE_MODE` — this forces *one* shell for the whole deployment. It
  exists for localhost and preview URLs, where the hostname cannot answer the
  question. Set it in Vercel and one of your two domains serves the wrong site.

None of the Discord values belong here. They are all server-side, they live on
the indexer, and `DISCORD_CLIENT_SECRET` or `DISCORD_BOT_TOKEN` in a `VITE_`
var would be readable in the bundle by anyone.

---

## 4. Attach both domains

**Settings → Domains**, on the same project:

1. `arcnaming.xyz` — the app
2. `join.arcnaming.xyz` — the waitlist
3. `www.arcnaming.xyz` — optional, redirect to the apex

Both are *domains on one project*, not two projects. Add `join.` as a plain
domain — do **not** set a redirect on it, or the waitlist becomes unreachable.

DNS, per your registrar:

| Record | Name | Value |
|---|---|---|
| `A` | `@` | `76.76.21.21` |
| `CNAME` | `join` | `cname.vercel-dns.com` |

Vercel shows the exact values for your account under each domain; prefer those
over the table if they differ. Then:

```sh
curl -sI https://arcnaming.xyz | head -1
curl -sI https://join.arcnaming.xyz | head -1
curl -s https://join.arcnaming.xyz/api/v1/waitlist/config
```

The third is the one that matters most: it proves the rewrite works on the
`join.` host, which is the host the OAuth callback comes back to.

---

## 5. Verify the deployment

In order. Each depends on the ones above it.

**Rewrite reaches the indexer** — on *both* domains:

```sh
curl -s https://arcnaming.xyz/api/v1/waitlist/config
curl -s https://join.arcnaming.xyz/api/v1/waitlist/config
curl -s https://arcnaming.xyz/health
```

`{"enabled":true,"inviteUrl":"https://discord.gg/9VGKrvTrUh","autoJoin":false,"verifiedCount":0}`.
If these 404 but the site loads, the rewrite is fine and §1 was skipped.

**Shell selection** — `arcnaming.xyz` shows the search box and tab bar;
`join.arcnaming.xyz` shows the waitlist stepper. If both show the app, check
`VITE_SITE_MODE` is not set in Vercel (§3).

**The four entry points on the app**, all four gated on `enabled: true` except
Discord:

- header, left of Docs — `Join waitlist` pill (≥640px only, by design)
- under the search box — *Mainnet is coming — join the waitlist*
- footer brand column — `Join our Discord` → `discord.gg/9VGKrvTrUh`
- footer "Get started" — `Join the waitlist`

The three waitlist links should all resolve to `https://join.arcnaming.xyz/`.
On a phone the header pill is intentionally absent — the hero line and the
footer carry it there.

**Docs** — `/docs/`, and a deep link like
`/docs/guide/quick-start.html`. The `.html` suffix is deliberate; the docs set
`cleanUrls: false` so they resolve on a static host with no rewrite rules.

**The full waitlist round trip**, with a real wallet, on
`https://join.arcnaming.xyz`:

1. Connect → **Sign** — a gasless signature, domain in the dialog reads
   `join.arcnaming.xyz`
2. **Connect Discord** → consent screen → back to
   `join.arcnaming.xyz/?waitlist=ok`
3. The stepper shows verified, and `verifiedCount` increments

If step 2 returns `?waitlist=discord-error`, the redirect URI in §2 does not
match. `?waitlist=not-a-member` means the bot cannot see the guild. Every
status is redirected as a query param rather than a JSON error precisely so
this is diagnosable from the address bar.

---

## 6. Rotate the credentials

The bot token and client secret were sent over a chat channel in plaintext, so
treat them as public:

- **Bot → Reset Token**
- **OAuth2 → Reset Secret**

Then update both on the indexer and restart. Nothing in the frontend or in git
holds either value, so this is a one-place change.

Two more, unrelated to Discord:

- The root **`.env` is git-tracked** despite the ignore rule — the rule was
  added after the file. It holds an Alchemy key. Rotate the key (it is in the
  history either way), then untrack it — **but set `VITE_ALCHEMY_API_KEY` in
  Vercel first**, per §3, or the next build ships a site that cannot read the
  chain:

  ```sh
  # 1. Vercel dashboard → Settings → Environment Variables → add the new key
  # 2. then, and only then:
  git rm --cached .env && git commit -m "chore: untrack .env"
  ```
- The indexer's `CORS_ORIGINS` is `*`. Now that the browser goes same-origin
  through the rewrite, nothing needs it — narrow it to
  `https://arcnaming.xyz,https://join.arcnaming.xyz` or drop it.

---

## Appendix — running it locally

Two hostnames, because the cross-host links cannot be exercised on
`localhost` alone. Add to `/etc/hosts`:

```
127.0.0.1  arc.local join.arc.local
```

Then, in two terminals:

```sh
cd indexer && npm run dev                    # :8787
npm run dev                                  # :3000, proxies /api → :8787
```

If something else already holds 8787, run the indexer elsewhere and tell Vite
where it went — the proxy target is configurable for exactly this:

```sh
cd indexer && PORT=8799 npm run dev
INDEXER_ORIGIN=http://localhost:8799 npm run dev
```

- `http://arc.local:3000` — the app
- `http://join.arc.local:3000` — the waitlist

Both are served by the same dev server, picked by hostname, exactly as in
production. For the OAuth leg locally, point `DISCORD_REDIRECT_URI` and
`APP_URL` at `http://join.arc.local:3000` and register that redirect in the
portal alongside the production one — Discord allows several.

Plain `localhost:3000` also works for everything except the cross-host links,
which fall back to a same-origin `/?waitlist`. Pair that with
`VITE_SITE_MODE=waitlist` to reach the waitlist shell without the hosts entry.
