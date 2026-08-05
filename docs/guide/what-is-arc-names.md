# What is Arc Names

Arc Names is a naming service for the Arc network. It maps a human-readable name —
`alice.arc` — to the things a wallet address can't express on its own: where to send funds, what
avatar to show, which website belongs to whom.

If you have used ENS on Ethereum, Arc Names will be immediately familiar. It follows the same
registry → resolver architecture, the same namehash algorithm, and the same reverse-record
convention for primary names.

## The problem it solves

A raw address is 42 characters of hexadecimal. It is unreadable, unmemorable, and impossible to
verify by eye — `0xCA78…8978` and `0xCA78…8979` look identical at a glance, and one of them loses
your funds.

A `.arc` name replaces it:

| Without a name | With a name |
| --- | --- |
| `0x3dC38247c4f9672B2C98aCfdc5C1302f8d897E9C` | `alice.arc` |
| Copy-paste only, verify character by character | Type it, read it, say it out loud |
| Changing wallets means telling everyone a new address | Point the name at the new wallet; nothing else changes |

That last row matters more than it looks. A name is a layer of indirection you control. The name
is the stable identifier your contacts and apps hold onto — the address behind it is yours to
change whenever you like.

## What a name actually is

Three things at once, and it helps to keep them separate:

1. **An ERC-721 token.** Registering mints an NFT to your wallet. The token ID is derived from
   the name itself. Owning that token *is* owning the name — you can transfer it, sell it, or
   hold it. See [Ownership & transfers](/guide/ownership).
2. **A registry entry.** The registry records which resolver contract answers questions about
   your name. See [Resolving .arc](/protocol/resolving).
3. **A set of records.** Address, avatar, website, social handles, stored on the resolver and
   readable by any app. See [Records & profile](/guide/records).

Registering gets you the token. The registry entry and the records are set up afterwards, and
the app walks you through both.

## What you can do with one

- **Receive payments.** Anyone can send to `alice.arc` in a wallet that supports Arc Names.
- **Be identified.** Set it as your [primary name](/guide/primary-name) and apps will display
  `alice.arc` instead of `0x3dC3…7E9C` wherever your address appears.
- **Publish a profile.** Avatar, description, website, X, GitHub, email — all optional, all
  on-chain, all readable without permission. See [Records & profile](/guide/records).
- **Trade it.** List it on the [marketplace](/guide/marketplace) or transfer it directly.

## What it is not

- **It is not a domain name.** `alice.arc` will not resolve in a browser address bar. It is an
  on-chain identifier resolved by wallets and apps that support it.
- **It is not permanent by default.** Names are registered for a duration and must be
  [renewed](/guide/renewals). Let one lapse and — after a grace period — someone else can take it.
- **It is not a trademark claim.** Registering a name grants no rights to it off-chain. See
  [Safety](/safety).
- **It is not censorship-proof against yourself.** If you lose the wallet holding the token, you
  lose the name. There is no recovery, no support desk, and no reset. See
  [Safety](/safety#there-is-no-recovery).

## How it fits together

```
                  ┌─────────────┐
   alice.arc ───► │  Registry   │ ── which resolver answers for this name?
                  └──────┬──────┘
                         │
                  ┌──────▼──────┐
                  │  Resolver   │ ── addr? avatar? website?
                  └─────────────┘

   Registrar  ── owns the ERC-721 token + expiry for each name
   Controller ── takes payment, enforces commit-reveal, mints via the registrar
   Market     ── escrow-free listings for names already registered
```

Each of those is a separate contract with a separate job. The full picture, including why the
split exists, is in [Architecture](/protocol/architecture). The addresses are in
[Contract addresses](/protocol/contracts).

## Next

- [Quick start](/guide/quick-start) — get a name in about five minutes.
- [Connecting a wallet](/guide/connecting-a-wallet) — network setup and test funds.
- [Pricing & rarity](/guide/pricing) — what a name costs and why length matters.
