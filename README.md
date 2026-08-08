# Arc Names

`.arc` name service for Arc Testnet — an ENS-style registry with a resolver,
a rental-model registrar and an on-chain marketplace, plus the web app, the
indexer that feeds it, and the docs site.

Register `alice.arc`, point it at an address, set text records, list it for
sale. Names are ERC-721 tokens rented by the year, with a 90-day grace period
after expiry during which they can still be renewed but not re-registered. The
gas token on Arc is USDC as a *native* 18-decimal coin rather than the
6-decimal ERC-20, which is why every price here is formatted as USDC and why
the decimals matter.

Four things live here:

| | |
|---|---|
| **Contracts** (`src/*.sol`, `script/`, `test/`) | Foundry project. A hand-rolled ENS clone behind ERC1967 proxies. |
| **Web app** (`src/`, minus the `.sol` files) | Vite + React SPA. Two sites from one bundle: the app, and the mainnet waitlist on its own subdomain. |
| **Indexer** (`indexer/`) | Node/Express service. Tails chain events into Postgres and serves them at `/api/v1`. Also hosts the waitlist API. |
| **Docs** (`docs/`) | VitePress site, built into `dist/docs` and served at `/docs/`. |

The app and the contracts share the `src/` directory — Foundry's `src` and
Vite's source root are the same folder. It works, but it means `src/App.tsx`
and `src/ArcRegistrar.sol` are siblings.

## Layout

```
src/
  App.tsx  main.tsx            app shell (hash-routed tabs) and the site branch
  components/                  views: Search, Portfolio, Marketplace, Activity,
                               Waitlist, plus dialogs and shared ui/
  hooks/                       one hook per concern (useRegistration, useRenewal,
                               useMarketplace, usePortfolio, useNameSearch, …)
  config/
    chain.ts                   the single chain definition + RPC resolution
    contracts.ts               compiled-in proxy addresses, env-overridable
    wagmi.ts                   the one transport reads and writes share
    abis.ts
  lib/
    site.ts                    which of the two sites this host serves
    indexer.ts                 read client for the indexer API
    waitlist.ts                POST-capable client for the waitlist API
    names.ts errors.ts format.ts logs.ts artwork.ts queryKeys.ts
  *.sol  interfaces/  libraries/   the contracts

indexer/
  src/
    index.ts                   entrypoint: migrate, serve, then ingest
    config.ts                  every env var, validated once at startup
    api/                       Express server, v1 routes, error envelope
    ingest/                    backfill, live listener, log processor
    chain/                     provider, ABIs, Blockscout log source
    db/                        pool, migration runner, repositories
    waitlist/                  nonce/session/Discord-link routes
    discord/client.ts          Discord REST calls (no discord.js)
  migrations/                  001_baseline, 002_v2, 003_waitlist

docs/                          20 markdown pages + VitePress config
script/  test/  broadcast/     Foundry deploy scripts, tests, run records
```

## Prerequisites

- **Node 20+** and npm. The indexer targets ES2022 / NodeNext.
- **Postgres** for the indexer. On Postgres 15+ the role needs `CREATE` on
  its schema explicitly — `CREATE` on `public` was revoked from `PUBLIC`, so a
  fresh role hits `permission denied for schema public` on the first migration.
  See `indexer/.env.example` for the two grants that fix it.
- **An Alchemy key for Arc Testnet**, or another CORS-enabled RPC endpoint.
  This is not optional for the browser; see [RPC and CORS](#rpc-and-cors).
- **Foundry**, only if you are touching the contracts. Run
  `git submodule update --init --recursive` first — `lib/forge-std` is declared
  in `.gitmodules` but is not checked out, so `forge build` fails until you do.

## Running it

Two processes. The app runs without the indexer: search, registration and
records are direct `eth_call`s, and the portfolio falls back to scanning the
chain for owned names when the indexer is unreachable — flagged as possibly
incomplete rather than presented as authoritative. Stats, marketplace and
activity are indexer-only and stay empty until it is up.

**Web app**

```sh
cp .env.example .env          # add VITE_ALCHEMY_API_KEY
npm install
npm run dev                   # http://localhost:3000
```

**Indexer**

```sh
cd indexer
cp .env.example .env          # add DATABASE_URL and RPC_HTTP_URL
npm install
npm run migrate               # applies migrations/*.sql in order
npm run dev                   # http://localhost:8787
```

The dev server proxies `/api/*` and `/health` to `http://localhost:8787`, so
with both running the app talks to your local indexer with no extra config.
Point the proxy elsewhere with `INDEXER_ORIGIN`.

**Docs**

```sh
npm run docs:dev              # http://localhost:3100
```

In `npm run dev` the docs are served off `dist/docs` from disk, so run
`npm run docs:build` once if you want `/docs/` to resolve inside the app.

### Scripts

| Root | |
|---|---|
| `npm run dev` | Vite dev server on `:3000`, bound to `0.0.0.0` |
| `npm run build` | `tsc && vite build` — the typecheck is a gate, not an emit |
| `npm run lint` | `tsc --noEmit`. There is no ESLint config in this repo |
| `npm run preview` | serve the built app on `:3000` |
| `npm run docs:dev` / `docs:build` / `docs:preview` | VitePress, port `3100` |
| `npm run build:all` | app then docs — **order matters**, see below |

| `indexer/` | |
|---|---|
| `npm run dev` | `tsx watch src/index.ts` |
| `npm run build` / `npm start` | compile to `dist/`, then run it |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run migrate` / `migrate:prod` | run migrations from source / from `dist` |

`build:all` must build the app before the docs. VitePress writes to
`../dist/docs`, and `vite build` empties `dist/` — reverse the order and the
docs are silently deleted from the output.

## Configuration

### Web app

Everything is `VITE_`-prefixed and therefore **public** — it ships in the
bundle and anyone who loads the app can read it. Lock the Alchemy key down with
a domain allowlist rather than treating it as a secret.

| Variable | Default | |
|---|---|---|
| `VITE_ALCHEMY_API_KEY` | — | RPC access. Effectively required. |
| `VITE_ARC_RPC_URL` | — | Full RPC URL. Overrides the key above. |
| `VITE_INDEXER_API_URL` | same-origin | Indexer base URL. Unset means `/api/v1/*`. |
| `VITE_SITE_MODE` | `app` | `waitlist` forces the waitlist site. |
| `VITE_*_ADDRESS` (×7) | compiled in | Contract overrides. Proxies only. |

### RPC and CORS

Arc's public endpoint, `https://rpc.testnet.arc.network`, answers fine from
curl but sends no `Access-Control-Allow-Origin` header and 400s the OPTIONS
preflight. From a browser every `eth_call` fails with `net::ERR_FAILED` before
it leaves the tab, and the symptom is not an error — it is search returning
nothing, prices rendering as `—`, and records claiming a name has no resolver.

So the app needs an endpoint that echoes the origin back. Alchemy does. The
public host is kept only as a last-resort fallback, and when the app is pointed
at it, `rpcLacksCors` is true and the UI says so instead of showing empty
results.

The indexer has no such problem — it is server-side, where CORS does not apply.

### Indexer

`indexer/src/config.ts` validates every variable once at startup and reports
*all* problems together before exiting, rather than throwing on the first one.
Required: `DATABASE_URL`, `RPC_HTTP_URL`, and the three addresses
`CONTROLLER_ADDRESS`, `REGISTRAR_ADDRESS`, `MARKET_ADDRESS` — proxies only,
never an implementation. `DEPLOY_BLOCK` is where a backfill starts when no
checkpoint exists.

Everything else has a working default: `PORT` 8787, `HOST` 0.0.0.0,
`CONFIRMATIONS` 5, `BACKFILL_CHUNK_SIZE` 10000,
`RECONCILE_INTERVAL_SECONDS` 300, `POLL_INTERVAL_SECONDS` 15,
`ARCSCAN_API_URL` `https://testnet.arcscan.app`, `CORS_ORIGINS` `*`,
`LOG_LEVEL` info, `DB_POOL_MAX` 10. `RPC_WS_URL` is optional — with it, new
logs arrive by subscription; without it the indexer polls. Both are correct;
the websocket is only lower-latency. `indexer/.env.example` documents each one
and why the defaults are what they are.

Two worth calling out. `TRUST_PROXY` should be set to the number of proxy hops
in front of the process (`1` behind the Vercel rewrite) and left unset when it
is exposed directly — off, the waitlist rate limits treat every user as one
bucket; on without a proxy actually there, a client can spoof
`X-Forwarded-For` and pick its own rate-limit key. And `STALE_AFTER_BLOCKS` is
best left unset: it derives from the reconcile interval and Arc's ~0.5s block
time, because a batch indexer is *expected* to sit up to one reconcile interval
behind the head. A hardcoded 200 would report a healthy service as unhealthy,
permanently.

## The indexer API

One process does both jobs — ingest and HTTP. `src/index.ts` runs migrations,
then binds the HTTP port *before* starting any ingestion, so a cold start with a
large backfill gap still answers health checks. Then the live event listener
starts, a backfill kicks off in the background, a reconcile pass runs every
`RECONCILE_INTERVAL_SECONDS`, and expired waitlist rows are pruned hourly.
Shutdown drains the server, stops the listener and closes the pool, with a
forced exit if that stalls.

Chain data, all `GET`, all under `/api/v1`:

| | |
|---|---|
| `/stats` | registered-name counts and totals |
| `/availability` | batch availability check |
| `/domains` | list, filterable by owner |
| `/domains/:name` | one name, with records and listing |
| `/marketplace` | active listings |
| `/activity` | recent registrations, renewals, transfers, sales |
| `/sync-status` | how far behind the head the indexer is |

Plus `/health` at the root. `/api` is mounted as an alias of `/api/v1` for
older clients. Full request and response shapes are in
[`docs/api/endpoints.md`](docs/api/endpoints.md).

Logs come from a Blockscout instance first and fall back to RPC `eth_getLogs`,
because a full-history walk of a busy address is dramatically cheaper there.
After a Blockscout failure that stream is skipped for
`BLOCKSCOUT_COOLDOWN_SECONDS` and goes straight to RPC, so one slow instance
does not stall every pass.

Ranges are only checkpointed once they are `CONFIRMATIONS` blocks behind the
head, so a reorg shallower than that is absorbed by the next reconcile instead
of leaving rows for logs that no longer exist.

## Two sites, one bundle

The app is at the apex; the mainnet waitlist is a standalone site at
`join.<domain>`. Both are the same build and the same Vercel project.

`src/lib/site.ts` resolves the mode once at module load, from the hostname:
anything under `join.` is the waitlist, everything else is the app.
`src/main.tsx` then picks the root component. The branch lives there rather
than inside `App` so neither shell ever runs a hook conditionally, and so the
right shell mounts without flashing the wrong chrome first.

Detection keys off the `join.` prefix rather than a hardcoded domain, so a
rename or a new apex needs no code change. For the two cases a hostname cannot
answer — localhost, and Vercel preview URLs, which are `*.vercel.app` with no
`join.` label — set `VITE_SITE_MODE=waitlist`.

Sharing one deployment is what makes the OAuth callback path, the `/api/*`
rewrite and the asset cache headers inherited rather than reimplemented.

## Mainnet waitlist

Off-chain signup that proves a wallet and a Discord account independently. Five
steps: connect wallet → sign message → join Discord → connect Discord → verify.
The signature is a plain-text challenge in the spirit of EIP-4361 but with no
SIWE dependency — it costs no gas and cannot move funds or names.

`GET`/`POST` under `/api/v1/waitlist` (also mounted at `/api/waitlist`):
`/config`, `/nonce`, `/verify`, `/discord`, `/discord/callback`, `/status`,
`/recheck`.

How the trust chain works: the server issues a single-use nonce and stores the
message verbatim, then verifies the signature against *that* message — never
one supplied by the client, or the caller would choose what they signed.
Verifying returns a bearer token, hashed at rest, held in `localStorage`
because the indexer is a different origin and third-party cookies are blocked
in Safari and Firefox. That token is exchanged for an opaque OAuth `state`, so
the callback never trusts the token in the URL. `APP_URL` is the only source of
the post-OAuth redirect target — a caller-supplied `returnTo` is never
reflected, which is what keeps an OAuth callback from being an open redirect.
Smart-contract wallets are handled through an EIP-1271 fallback.

The feature is **off unless** `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`,
`DISCORD_REDIRECT_URI`, `DISCORD_BOT_TOKEN` and `DISCORD_GUILD_ID` are all set.
Missing any of them, the routes answer 503 naming the gaps and the frontend
hides the flow. That is deliberate: a Discord secret nobody has filled in must
never take down name resolution. `DISCORD_WAITLIST_ROLE_ID`,
`DISCORD_INVITE_URL`, `DISCORD_AUTO_JOIN` and `DISCORD_WEBHOOK_URL` are all
optional — without a role ID the signup still completes and is recorded, just
with no role granted.

Setting it up in Discord:

1. **OAuth2 → Redirects.** Add
   `https://join.<your-domain>/api/waitlist/discord/callback`, character for
   character. Discord rejects the token exchange on any mismatch. Use the same
   host as `APP_URL` — bouncing a user through a different domain mid-flow is
   what a phishing flow looks like.
2. **Scopes.** `identify`, `guilds`, and `guilds.join` only if you want
   `DISCORD_AUTO_JOIN`. The code checks the scopes Discord actually granted
   before using them, since a user can decline one on the consent screen.
3. **Bot.** Invite it to the server with **Manage Roles**. Its own role must sit
   **above** the waitlist role in the hierarchy, or the grant 403s no matter
   what permissions it has.
4. **Migrate.** `003_waitlist.sql` creates `waitlist_nonces`,
   `waitlist_sessions` and `waitlist_entries`. One Discord account maps to one
   wallet via a partial unique index on `discord_id` (`WHERE discord_id IS NOT
   NULL`).

Rate limits are in-memory and per-process, so they do not survive a restart or
apply across replicas. That is an accepted trade for having no Redis
dependency — the durable limits are the single-use nonce and that unique index,
neither of which a burst can get past.

## Contracts

Deployed on Arc Testnet, chain ID `5042002` (`0x4cef52`).

| Contract | Proxy address |
|---|---|
| Registry (`ENSRegistry`) | `0xCA78696791670CbC14eE802e6DcDfD661a458978` |
| Registrar (`ArcRegistrarU`) | `0x3dC38247c4f9672B2C98aCfdc5C1302f8d897E9C` |
| Resolver (`PublicResolverU`) | `0x027d6dCc8F1235dfdd47E532e77909363C701E54` |
| Controller (`ArcControllerU`) | `0x2FE2560B2FE6D54e50806F531223247CcfEd739B` |
| Market (`ArcMarketU`) | `0xC94Ff1964840BdF8E6952455a2342Ffc6B0bA299` |
| UniversalResolver | `0xA3F364a558eb712AFbB4929df49e538A800438BC` |
| ReverseRegistrar | `0x97cdcf037c1A8475eF5C9504A18C10b41f7DfDfB` |

Registrar, resolver, controller and market sit behind ERC1967 proxies. **These
are the proxy addresses** — the implementations that also appear in
`broadcast/` must never be called directly, since all state lives behind the
proxy. `src/config/contracts.ts` is the source of truth and is
env-overridable; `docs/protocol/contracts.md` publishes the same set with
explorer links.

The upgrade machinery is hand-rolled in `src/libraries/UUPS.sol` — about 60
lines, not OpenZeppelin. Each upgradeable contract reserves a storage gap.
`Initializable` is a single `bool`, with no reinitializer versioning, so a
future upgrade has to set new state through owner-gated setters or the `data`
argument to `upgradeToAndCall` rather than a fresh initializer.

Nothing in the repo pins the deployed implementations to the current `src/`.
The contracts are owner-upgradeable, so the bytecode behind those proxies may
have moved on from the recorded broadcast.

`foundry.toml` sets `evm_version = "osaka"` with `via_ir` and 10M optimizer
runs, and pins no solc version — an older Foundry will reject the config
outright, and compilation is slow by design. `forge test` covers one path
(registration, in `test/Arc.t.sol`); the market, reverse registrar, universal
resolver and renewals are untested. `script/RegisterName.s.sol` has its commit
step commented out, so it performs only the reveal and reverts unless a
matching commitment already exists.

## Deployment

Vercel, one project, both domains. `vercel.json` builds with
`npm run build:all` and serves `dist/`, which holds the app at the root and the
docs under `/docs/`. `/api/*` and `/health` are rewritten to the indexer host.

The rewrites carry no host condition, so they apply to **every** domain and
every preview deployment on the project. That is what lets
`join.<domain>/api/waitlist/discord/callback` work with no additional config —
attaching the second domain in the dashboard is the whole change. It also means
every preview deployment proxies API traffic to the same production indexer,
which is worth knowing before testing anything destructive against a preview.

The indexer is a long-running process and is not on Vercel — it needs Postgres
and a persistent websocket. `npm run build && npm run migrate:prod && npm start`
behind a reverse proxy, with `TRUST_PROXY` set to the hop count.

## Rough edges

Known and deliberate, or known and not yet fixed:

- **`dist/` is committed** (89 files) even though Vercel builds it fresh. Builds
  produce noisy diffs. Same for Foundry's `broadcast/` and `cache/` —
  `.gitignore` covers only `.env` files and the VitePress artifacts.
- **`CORS_ORIGINS` defaults to `*`.** Not a credential leak — the API serves
  public chain data and waitlist sessions are bearer tokens, so no ambient
  credentials ride along on a cross-origin request. Still worth narrowing to
  the real hosts now that there are POST routes.
- **`Contracts-logs.md`** is a pasted terminal transcript whose `Contract:`
  labels and address values frequently belong to different transactions. Do not
  read addresses out of it; use `broadcast/DeployArc.s.sol/5042002/` or the
  table above.
- **`glm.py`, `metadata.json`, `arcnames.png`, `task.txt`** are leftovers that
  nothing in the repo references. `glm.py` imports `openai`, which is not a
  dependency here, and calls a third-party relay.
- The main bundle is over 500 kB, so `vite build` warns about chunk size. Not
  yet split.
