# .arc name service — fixes + indexer

Two deliverables here:

```
frontend/
  src/App.tsx                 patched — drop-in replacement for your existing App.tsx
  src/lib/api.ts               new — client for the indexer's HTTP API
  src/hooks/useChainGuard.ts   new — the chain-guard hook, used at 7 call sites in App.tsx

indexer/                       new — standalone Node/TS service
  schema.sql
  package.json / tsconfig.json / .env.example
  src/abis.ts       shared event ABIs + labelToId()
  src/db.ts         Postgres reads/writes
  src/backfill.ts   one-time + periodic catch-up scan (retries, resumable)
  src/listener.ts   live WebSocket subscription
  src/api.ts        Express routes: /api/stats /api/domains /api/marketplace /api/sync-status
  src/index.ts       entrypoint — runs backfill, then listener + API together
```

## What each bug fix maps to

| Bug (from earlier diagnosis) | Where it's fixed |
|---|---|
| "13 registered names" was `DEFAULT_TRACKED_DOMAINS.length`, not chain data | `App.tsx` — the stats fallback in `fetchDomainsAndListingsFromChain` never falls back to that array anymore; on genuine failure it shows `—`, not a fabricated number. Root fix: `getStats()` in the indexer only ever counts real `registrations` rows. |
| Log scans silently truncating (`break` on first `getLogs` failure) | `App.tsx`'s `fetchLogsWithChunking` now retries once and reports `{ logs, failed }` explicitly instead of swallowing the error. `indexer/src/backfill.ts` retries with exponential backoff and never gives up silently. |
| Register succeeded (confetti) but domain "available again" / My Domains empty | This was actually a receipt-status bug, not just a scan bug — see `waitForTx` below. Once that's fixed, the indexer's `registrations`/`transfers` tables are the source of truth and can't drift from chain state the way client-side re-scanning could. |
| Wallet signed on "Network: Ethereum" instead of Arc Testnet | `useChainGuard.ts` — `ensureCorrectChain()` is called as the first line of all 7 write flows: `triggerCommit`, `triggerRegister`, `triggerRenew`, `updateRecords`, `submitListing`, `cancelListing`, `purchaseListing`. |
| `waitForTransactionReceipt` resolves on revert too, not just success | `App.tsx`'s `waitForTx` now checks `receipt.status` and throws `TxRevertedError` if it isn't `'success'` — every `catch` block downstream already calls `showError(parseRevertReason(err))`, so this alone makes a reverted tx show an error instead of a success toast. |

## Setup order

1. **Database.** Provision Postgres (Supabase/Neon/RDS/local — anything). Run:
   ```
   cd indexer
   cp .env.example .env   # fill in DATABASE_URL, ALCHEMY_HTTP_URL, ALCHEMY_WSS_URL
   npm install
   npm run migrate        # applies schema.sql
   ```
2. **Run the indexer.** `npm run dev` (or `npm run build && npm start` in production). On first run it walks `DEPLOY_BLOCK → chain head` once (this is the one-time backfill you already have — everything after that is live via the WebSocket listener, plus a 5-minute reconciliation pass as a safety net). Watch the logs; you should see `[backfill] caught up to chain head` followed by `[listener] subscribed to ...`.
3. **Point the frontend at it.** In your frontend's `.env`:
   ```
   VITE_INDEXER_API_URL=https://your-indexer-host.example.com
   ```
   If frontend and indexer share a domain behind a reverse proxy, `/api` (the default) works as-is.
4. **Drop in the patched files** (`App.tsx`, `lib/api.ts`, `hooks/useChainGuard.ts`).
5. **One thing to check yourself:** `useChainGuard` calls wagmi's `useSwitchChain`, which only works if Arc Testnet (chain ID `5042002`) is actually declared in your `createConfig({ chains: [...] })` — usually in `wagmi.ts` or `config.ts`. If it's missing there, `switchChainAsync` will throw immediately and every write will show "Please switch your wallet to Arc Testnet" even when the user's already on it. This was the file the earlier investigation asked for and never got — worth confirming now.

## Behavior while the indexer is down or mid-deploy

`fetchDomainsAndListings` in `App.tsx` tries the indexer first (`Promise.allSettled` across stats/domains/marketplace). If any of those three reject — indexer not deployed yet, cold start, network blip — it falls back to the same direct-chain-scan approach you had before, just fixed: retried chunks, honest `—` instead of `13`, and a visible amber banner ("Live indexer unavailable — showing a direct chain scan...") so degraded data is never silently indistinguishable from good data. That banner is also shown, with specifics, if the chain-scan fallback itself partially fails.

## Diagnosing further RPC issues

Every scan failure — from either path — logs to console with the prefix `[ARC][scan-failure]`, including the exact block range and the underlying error object. If you ever see the banner again, that's the first thing to check (remote debug via `chrome://inspect` from a desktop Chrome plugged into the Android device, same as before).
