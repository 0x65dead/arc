# FAQ

## General

### What is a .arc name?

A human-readable identifier on the Arc network that maps to an address, a profile and other
records. `alice.arc` instead of `0x3dC38247c4f9672B2C98aCfdc5C1302f8d897E9C`. See
[What is Arc Names](/guide/what-is-arc-names).

### Will it work in a browser address bar?

No. A `.arc` name is an on-chain identifier resolved by wallets and apps that support it, not a DNS
domain.

### Is this the same as ENS?

Not the same deployment, but the same architecture — registry → resolver, the same namehash
algorithm, the same reverse-record convention. If you've integrated ENS, resolution here will look
familiar.

### Do I get a mainnet name for registering on testnet?

No. Nothing about a testnet registration reserves or grants a mainnet name. Anyone telling you
otherwise is making it up. See [Safety](/safety#testnet-reality-check).

### Is there a token?

No. There is no Arc Names token, no airdrop, and no points programme. Treat any claim otherwise as
a scam.

## Registering

### Why does registration take two transactions?

To stop front-running. A single transaction would broadcast the name you want into a public mempool
where anyone could outbid your gas and take it. The commitment goes first and reveals nothing. See
[Registering a name](/guide/registering#why-two-transactions).

### How long do I wait between them?

As long as the contract's `minCommitAge`, which the owner can change. The app shows a live
countdown. There's also a maximum — wait too long and the commitment expires and you start over.

### What happens if I close the tab mid-registration?

The secret lives in your browser under `arc:pending-commitments:v2`. If it survives, you can
finish. If you cleared site data or switched browsers, the commitment is unusable — you lose the
commit gas and start again. The name isn't reserved for you meanwhile.

### What characters can a name contain?

The app allows lowercase letters, digits and hyphens, no leading or trailing hyphen, up to 63
characters. The **contract** is looser — it only enforces length and rejects uppercase ASCII. So
names in the wild may contain characters the app would never let you type. See
[Safety → look-alike names](/safety#look-alike-names).

### Can I register several names at once?

Yes — `registerMany` handles 1 to 20 names under one commitment. One invalid or unavailable name
reverts the whole batch.

### Can I register a two-character name?

Only if the contract's 2-character price is non-zero. When it's zero the entire tier is disabled and
such names fail validation. See [Pricing](/guide/pricing#two-character-names-can-be-switched-off).

### Does my name resolve immediately after registering?

Yes. The controller binds a resolver and sets the address record to you in the same transaction.
What is *not* automatic is the reverse record — see
[Your primary name](/guide/primary-name).

## Pricing

### How much does a name cost?

It depends on length — there are four tiers (2, 3, 4, 5+ characters), each an owner-configurable
per-year rate. The app shows the live price before you confirm. These docs deliberately don't print
numbers that would go stale. See [Pricing & rarity](/guide/pricing).

### Is a shorter name always more expensive?

Not necessarily. The tiers are independent values, not a curve — the owner sets each separately.
Read the actual rate rather than inferring it from length.

### What if I send too much?

The contract refunds the difference in the same transaction. The app deliberately quotes a small
buffer so a price change doesn't fail your transaction; you're never charged it.

### Why is the price in USDC with 18 decimals?

Arc's native gas token is USDC, and as a native token it uses 18 decimals rather than the 6 of the
ERC-20. Pricing is scaled so 1 USD = 1e18 wei, which means `price()` returns the USD figure
directly. See [Fees](/protocol/fees#two-kinds-of-usdc).

## Renewals and expiry

### What happens when my name expires?

It stops working immediately — `ownerOf` reverts and apps stop resolving it. But it stays locked to
you for **90 days**, during which you can renew and restore it. After that, anyone can register it.
See [Renewals & expiry](/guide/renewals).

### Can someone take my name the moment it expires?

No. The 90-day grace period blocks everyone else. Registration attempts revert with `taken`.

### Can someone else renew my name for me?

Yes, and it's safe — renewal only extends the expiry, never changes ownership or records. This is
useful: a name in cold storage can be renewed from a hot wallet without exposing the hardware key.

### Does renewing early waste the time I have left?

No. The new expiry is the old expiry plus your duration. It stacks.

### Is there an auction when a name is released?

No. No premium decay, no auction, no priority for the previous owner. The price drops to the normal
tier rate immediately and the first valid commit-reveal wins.

## Records and profile

### Why can't I edit my records?

Most likely you received the name by transfer and haven't reclaimed it. Resolver writes are
authorised against **registry** ownership, not token ownership. Call
`registrar.reclaim(tokenId, you)` first. See
[Ownership](/guide/ownership#reclaiming-after-a-transfer).

### Why does each record cost a separate transaction?

Each write is a separate contract call. Changing your avatar and website is two transactions.

### Are my records private?

No. Everything is plaintext on a public chain, readable by anyone, permanently — overwriting
doesn't erase history. An `email` record will be scraped.

### Is a social handle in a record verified?

No. The resolver stores whatever the owner writes. A `com.twitter` record is a self-reported claim
the protocol never checks.

## Primary names

### Why doesn't my name show up in other apps?

Registering sets the forward record (name → address). Displaying your name requires the **reverse**
record (address → name), which you set separately. See
[Your primary name](/guide/primary-name).

### Why did my primary name stop displaying?

The round-trip verification broke — usually because the name's address record changed, the name was
transferred away, or it expired. Apps fall back to your address. Nothing is at risk.

### Can two wallets share a primary name?

Not really. The reverse record lives on the address, and the name's `addr` holds a single address,
so only one wallet can round-trip successfully.

## Ownership and transfers

### Is a .arc name an NFT?

Yes, ERC-721. The token ID is `uint256(keccak256(bytes(label)))`.

### I transferred a name and the recipient can't edit records.

Expected. They need to call `reclaim`. Until then you remain the registry owner and can still change
the records.

### I bought a name and it still resolves to the seller.

Also expected. The address record isn't cleared on transfer — the new owner must call `setAddr`.
Anyone paying the name before then pays the seller. Do this immediately.

### Can I transfer a name in its grace period?

No. Every operation that calls `ownerOf` reverts once past expiry.
[Renew it first](/guide/renewals).

### Can I get a name back after sending it to the wrong address?

No. Transfers are irreversible and there is no admin who can undo one.

## Marketplace

### Does the marketplace hold my name?

No. It's escrow-free — the name stays in your wallet and the market holds only an approval, which it
uses to transfer at the moment of sale.

### What fee does the marketplace take?

`feeBps`, deducted from the seller's proceeds. It initialises to **zero**, so unless the owner has
changed it the seller gets the full price. Read `feeBps()` for the live value.

### Can a seller raise the price as I buy?

Only if you let them. Use `buy(id, maxPrice)` with an explicit maximum and the transaction reverts
with `price moved` instead. The one-argument `buy(id)` sets the maximum to whatever you sent — don't
use it. See [Marketplace](/guide/marketplace#maxprice-protects-you).

### Can I buy a name that isn't listed?

Not through the marketplace. Contact the owner — the app and the API both show their address, and
many owners set contact records. Never pay outside an atomic transaction. See
[Safety](/safety#buying-a-name-safely).

### Why can't I buy this listing?

If it reverts with `usdc listing`, it settles in ERC-20 USDC and the app only handles native. Filter
for `currency: 0` in API results.

## Integrating

### How do I resolve a name in my app?

Two calls: `registry.resolver(node)` then `resolver.addr(node)`. Full code in
[Resolving .arc](/protocol/resolving#forward-resolution).

### How do I display someone's name?

`universalResolver.reverse(address)`, and **only** display the result when the `verified` flag is
true. Otherwise show the address.

### Should I read the contracts or the API?

The API for display and history — portfolios, activity feeds, listings. The contracts for anything
that moves value. The indexer lags the chain and can fail; check
`GET /api/v1/sync-status`.

### Why does /domains/:name return 404?

The name has never been registered. That's a normal response, not an error. Use
`/availability?name=` for the three-state answer.

### Does resolution check whether the name is still valid?

No. A resolver keeps returning the old address after expiry until it's overwritten. Check
`nameExpires(tokenId) > now` before acting on a resolution. Note `ownerOf` reverts past expiry, so
it can't be used as a liveness probe without a try/catch.

### Is there an API key or rate limit?

No key. No limits enforced by the indexer itself, though a proxy or CDN in front may apply its own.

## Transaction errors

Every revert string you're likely to see, and what to do.

### Registration and renewal

| Revert | Meaning | Fix |
| --- | --- | --- |
| `early` | Registered before `minCommitAge` elapsed | Wait for the countdown |
| `commit expired` | More than `maxCommitAge` since the commit | Start over |
| `committed` | Same commitment hash submitted while one is live | Wait, or use a new secret |
| `invalid` | Name fails `valid()` — too short, uppercase, or a disabled 2-char name | Pick a valid name |
| `duration` | Outside 28 days – 100 years | Choose a duration in range |
| `underpaid` | `msg.value` below the quote | Send at least `price()` |
| `owner` | Owner is the zero address | Pass a real address |
| `taken` | Registered, or expired but in grace | Wait for the release date |
| `short` | Priced a name shorter than `minLen` | — |
| `2char` | Two-char name while `price2` is zero | Tier is disabled |
| `count` | `registerMany` with 0 or >20 names | Batch up to 20 |
| `expired` (on `renew`) | Past expiry + 90 days | The name is released; register it normally |

### Records

| Revert | Meaning | Fix |
| --- | --- | --- |
| `!auth` | Not the registry owner of the node | Call `reclaim` first |

### Ownership

| Revert | Meaning | Fix |
| --- | --- | --- |
| `expired` (on `ownerOf`) | Past expiry, including grace | Use `nameExpires` instead |
| `none` | Token was never minted | — |

### Marketplace

| Revert | Meaning | Fix |
| --- | --- | --- |
| `price` | Listing price is zero | Use `unlist` to withdraw instead |
| `!owner` | You don't own the token | — |
| `!approved` | Market not approved for the token | `approve` first |
| `!seller` | You didn't create this listing | Only the lister can change it |
| `!listed` | Not listed, or already sold | — |
| `price moved` | Listing costs more than your `maxPrice` | Re-quote and retry |
| `seller changed` | Seller transferred the name after listing | Stale listing |
| `usdc listing` | Listing settles in ERC-20 USDC | Use the USDC path |
| `exceeds fee` | Referral rates exceed `feeBps` | Owner-side config |

### Protocol-level

| Revert | Meaning |
| --- | --- |
| `!live` | The registrar no longer controls the `.arc` node. Nothing you can fix. |
| `!controller` | Called a controller-only function directly. Go through the controller. |
| `usdc off` | ERC-20 USDC path not configured. |
| `usdc pull` | ERC-20 `transferFrom` failed. Check your allowance. |
| `reentrant` | Reentrancy guard tripped. |

## Troubleshooting

### "Can't reach the Arc network right now."

The app can't talk to its RPC endpoint. Press **Try again**. If it persists, the endpoint is down or
misconfigured — most often CORS. See
[Connecting a wallet](/guide/connecting-a-wallet#rpc-endpoints).

### Search shows nothing at all.

Same cause. A failed lookup shows an error card with a retry button.

### "Data may be out of date."

The indexer is behind the chain. On-chain reads are still correct; listings and activity may lag.

### Every balance looks wrong by a huge factor.

Currency decimals. The native token has **18**, not 6. Check your wallet's network configuration.

### My wallet is on the wrong network.

Use the switch button in the app's banner. Arc Testnet is chain ID `5042002`.

## Still stuck?

Check [Safety](/safety) if you think something malicious happened, and
[Contract addresses](/protocol/contracts) to verify you're interacting with the real contracts.

Nobody legitimate will ever ask for your seed phrase.
