# Architecture

Arc Names is five contracts with clearly separated jobs, plus an indexer that turns their events
into a queryable API. This page explains what each piece does and why the split exists.

## The contracts

```
                    ┌──────────────────────────────────────────┐
                    │              Registry (ENS)              │
                    │  node → owner, node → resolver           │
                    └───────────┬──────────────────┬───────────┘
                                │                  │
                  setSubnodeOwner│                  │resolver lookup
                                │                  │
                    ┌───────────▼──────┐   ┌───────▼──────────┐
                    │    Registrar     │   │     Resolver     │
                    │  ERC-721 + expiry│   │ addr/text/content│
                    └───────▲──────────┘   └──────────────────┘
                            │
              register/renew│ (onlyController)
                            │
       ┌────────────────────┴─────────┐        ┌──────────────────┐
       │         Controller           │        │      Market      │
       │ pricing, commit-reveal, pay  │        │  listings, sales │
       └──────────────────────────────┘        └──────────────────┘

       ┌──────────────────────────────┐        ┌──────────────────┐
       │      UniversalResolver       │        │ ReverseRegistrar │
       │ forward + verified reverse   │        │  address → node  │
       └──────────────────────────────┘        └──────────────────┘
```

### Registry

The root of the system. It stores two mappings per node: who owns it, and which resolver answers
for it. It knows nothing about prices, expiry, or NFTs.

Every resolution starts here. Every record write is authorised against the ownership recorded
here — which is why [reclaim](/guide/ownership#reclaiming-after-a-transfer) matters after a
transfer.

### Registrar

Owns the `.arc` node in the registry, and issues names beneath it. It is the ERC-721 contract: it
holds the token, the expiry, and the label for each name.

Two access-control notes:

- `register` and `renew` are `onlyController` — no user calls them directly. Ordinary users reach
  them through the controller, which handles payment.
- A `live` modifier requires that the registrar still owns the `.arc` node in the registry. If
  that ever stops being true, registration and renewal halt with `!live` rather than silently
  writing to a node the registrar no longer controls.

`GRACE` is a hard constant here — 90 days, not configurable.

### Controller

The public entry point for getting a name. It owns:

- **Pricing** — the four length tiers and the per-second proration.
- **Commit-reveal** — `commit`, `minCommitAge`/`maxCommitAge`, and the anti-front-running logic.
- **Payment** — native and ERC-20 USDC paths, refunds, referral discounts and rewards.
- **Validation** — `valid()`, `minLen`, the 2-character tier switch.

It is a registrar controller, meaning it is on the registrar's allowlist. This is the piece most
likely to be replaced over time: pricing models and payment methods change, and swapping the
controller doesn't touch names, records or ownership.

### Resolver

Stores the actual records — address, text, contenthash, and the reverse `name` — keyed by node.
Writes are gated by `auth`, which checks registry ownership.

Resolvers are pluggable: the registry points each name at one, so a name can move to a custom
resolver with different behaviour. Records do not follow — they live in whichever resolver holds
them, which is why [writing to an unbound resolver](/guide/records#binding-a-resolver) is a silent
mistake.

### Market

Escrow-free listings. The seller approves the market and lists; the market transfers on sale using
that approval. The name never leaves the seller's wallet until it sells.

It has its own fee (`feeBps`) and its own referral system, both independent of the controller's.

### UniversalResolver and ReverseRegistrar

Convenience contracts for resolution. The reverse registrar derives the reverse node for an
address; the universal resolver does the full forward lookup and the **verified** reverse lookup in
one call. See [Resolving .arc](/protocol/resolving).

## Why the split

It would be simpler to put all of this in one contract. The separation buys three things:

**Upgradeability without migration.** Pricing lives in the controller. Change pricing and no name,
record or ownership entry moves. Swap the controller entirely and existing names are untouched.

**Independent record storage.** Because records live in a pluggable resolver rather than beside
ownership, a name can point at a resolver with entirely different behaviour without the registry
knowing or caring.

**Minimal trusted core.** The registry is small and rarely changes. The contracts that do change —
controller, market — hold no user data. A bug in the market cannot affect who owns a name.

## Proxies and upgradeability

Every contract is deployed behind an **ERC-1967 proxy** using the UUPS pattern. The addresses in
[Contract addresses](/protocol/contracts) are all proxies.

::: warning Call the proxy, never the implementation
All state lives in the proxy. Calling an implementation address directly reads uninitialised
storage and returns nonsense — it will not revert, it will return zeros. Always use the proxy
addresses.
:::

Upgrades are authorised by the contract owner via `_authorizeUpgrade`. Ownership uses a two-step
transfer (`transferOwnership` → `acceptOwnership`), which prevents handing ownership to an address
that can't accept it.

::: danger This is a trust assumption
The contract owner can upgrade any contract, change prices, adjust `minLen` and commit ages, alter
fees, and enable or disable referrals. An upgrade could change any behaviour described in these
docs.

That is normal for a young protocol and is what allows fixing bugs, but it is a real trust
assumption you should weigh. See [Safety](/safety#trust-assumptions).
:::

## Owner-controlled parameters

None of these are constants. All are live on-chain values, readable from the contracts:

| Parameter | Contract | Controls |
| --- | --- | --- |
| `price2`, `price3`, `price4`, `price5plus` | Controller | Per-year rates by length |
| `minLen` | Controller | Shortest registerable name (never below 2) |
| `minCommitAge`, `maxCommitAge` | Controller | The commit-reveal window |
| `refDiscountBps`, `refRewardBps` | Controller | Registration referrals (each ≤ 2000) |
| `feeBps`, `feeRecipient` | Market | Marketplace fee |
| `refDiscountBps`, `refRewardBps` | Market | Sale referrals (sum ≤ `feeBps`) |
| `usdc` | Both | ERC-20 USDC address; zero disables that path |

What **is** fixed in code:

| Constant | Value |
| --- | --- |
| `GRACE` | 90 days |
| `MIN_DURATION` | 28 days |
| `MAX_DURATION` | 36,500 days (100 years) |
| Pricing denominator | 365 days |

## The indexer

The contracts are the source of truth, but they can't answer "every name owned by this address" or
"the last 25 sales" — that requires scanning logs.

The indexer subscribes to events from the registrar, controller and market, writes them to a
database, and serves [a REST API](/api/endpoints). It tracks each contract as a separate **stream**
with its own checkpoint, and reports the *minimum* across streams as its indexed block — so it
never claims to be fresher than its slowest stream.

::: info The API is a convenience, not an authority
The indexer lags the chain and can fall behind or fail. For display, that's fine. For anything that
moves value, read the contracts. Check `GET /api/v1/sync-status` to know how far behind it is.
:::

## Transaction flows end to end

**Registration:** `commit` → wait `minCommitAge` → `register` → controller validates, prices, and
calls registrar `register` → binds resolver, sets `addr`, `reclaim`, transfers token to you.

**Renewal:** `renew` → controller prices → registrar extends the expiry. One transaction, no
commit needed.

**Sale:** seller `approve` + `list` → buyer `buy` → market checks price and ownership, transfers
token, pays the seller minus fee.

**Record write:** `setAddr`/`setText` on the resolver → `auth` checks registry ownership → stores
and emits.

## Next

- [Contract addresses](/protocol/contracts) — the deployed addresses.
- [Resolving .arc](/protocol/resolving) — the resolution algorithm.
- [Fees](/protocol/fees) — where money goes.
