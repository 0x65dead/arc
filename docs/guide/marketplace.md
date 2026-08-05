# Marketplace

The marketplace lets an owner list a `.arc` name for sale and a buyer purchase it in a single
atomic transaction. There is no escrow — the name stays in the seller's wallet until it sells.

## How it works

```
  Seller                                Market                        Buyer
    │                                     │                             │
    │ 1. approve(market, tokenId)         │                             │
    ├────────────────────────────────────►│                             │
    │ 2. list(tokenId, price)             │                             │
    ├────────────────────────────────────►│                             │
    │                                     │◄──── 3. buy(id, maxPrice) ──┤
    │◄──── price − fee ───────────────────┤                             │
    │                                     ├──── token ─────────────────►│
```

The name never leaves the seller's custody. The market holds an **approval**, not the token, and
uses it to transfer at the moment of sale. If the seller revokes the approval or transfers the name
away, the listing simply stops being fillable.

## Listing a name

Two transactions, because the approval must come first.

```solidity
approve(market, tokenId)      // on the registrar
list(tokenId, price)          // on the market
```

The market checks both when you list:

```solidity
require(price > 0, "price");
require(registrar.ownerOf(id) == msg.sender, "!owner");
require(_approved(id, msg.sender), "!approved");
```

In the app: **My names → the name → List for sale**. It handles the approval step for you and
disables the button until the approval confirms.

A price of zero is rejected — use `unlist` to withdraw a listing instead.

::: warning You cannot list a name that has expired
`ownerOf` reverts with `expired` past the expiry, including during the grace period, so listing
fails. [Renew first](/guide/renewals), then list.
:::

### Changing the price

```solidity
setPrice(tokenId, newPrice)
```

Only the original lister can call it — the market checks `l.seller == msg.sender` and reverts with
`!seller` otherwise. One transaction, no re-approval needed.

### Removing a listing

```solidity
unlist(tokenId)
```

Same restriction — the seller only. Revoking the ERC-721 approval also makes a listing unfillable,
but it leaves the listing visible in the UI, so `unlist` is the clean way to withdraw.

## Buying a name

```solidity
buy(uint256 id, uint256 maxPrice) payable
buy(uint256 id) payable                            // maxPrice = msg.value
buy(uint256 id, uint256 maxPrice, address referrer) payable
```

Settlement is atomic: the token transfers to you and the proceeds go to the seller in the same
transaction. Either both happen or neither does.

### maxPrice protects you

`buy` takes a `maxPrice` and reverts with `price moved` if the listing costs more:

```solidity
require(l.price <= maxPrice, "price moved");
```

This is your defence against a seller front-running your purchase with a `setPrice` that raises
the price just as you buy. The app sets `maxPrice` to the price you were shown.

::: danger The one-argument buy() has no price protection
`buy(id)` sets `maxPrice` to `msg.value` — whatever you sent. If the seller raises the price to
just under your balance between your quote and your transaction, you pay it.

Always use `buy(id, maxPrice)` with an explicit maximum. This is the form the app uses.
:::

### Other checks at purchase time

| Check | Revert | Meaning |
| --- | --- | --- |
| Listing exists | `!listed` | Not listed, or already sold/unlisted. |
| Native currency | `usdc listing` | The listing settles in ERC-20 USDC; use the USDC purchase path. |
| Seller still owns it | `seller changed` | The seller transferred the name after listing. The listing is stale. |
| Enough sent | `underpaid` | `msg.value` below the amount due. |

Overpayment is refunded in the same transaction.

## What the sale does to the name

On settlement the market transfers the token **and** fixes up the registry side, so a bought name
isn't left in the half-transferred state a raw `transferFrom` produces. Even so, after buying you
should:

1. Verify `registry.owner(node)` is you — and call `reclaim` if it isn't.
2. **Update the address record.** The name may still resolve to the seller until you call
   `setAddr`. Anyone paying the name before you do pays them.

See [Claiming a name → after you claim](/guide/claiming#after-you-claim-a-name).

## Fees

The market takes a fee in basis points, deducted from the seller's proceeds:

```
buyer pays   price
seller gets  price − (price × feeBps / 10000)
```

`feeBps` is set by the contract owner and **initialises to zero**, so unless it has been changed
the seller receives the full price. It is a live on-chain value — read `feeBps()` rather than
trusting a number written in docs. See [Fees](/protocol/fees#marketplace-fees).

If paying the seller fails, the amount is credited to a pending balance they can withdraw later
rather than reverting the sale.

## Referrals

The marketplace has its own referral system, independent of the one in the controller. Supplying a
referrer to `buy` can grant the buyer a discount and pay the referrer a reward, both in basis
points, both defaulting to zero.

The two rates together can never exceed the market fee:

```solidity
require(discountBps + rewardBps <= feeBps, "exceeds fee");
```

So referrals are funded out of the protocol's own fee, never out of the seller's proceeds. With
`feeBps` at zero, market referrals are necessarily inert.

Sales emit `ReferralPaid(id, referrer, referee, reward)`.

::: info Not yet wired into the app
The referral parameter exists in the deployed market but the app calls `buy` without it.
Integrators can use it today.
:::

## Currencies

Listings carry a currency flag: `0` for the native token, `1` for ERC-20 USDC. The two are not
interchangeable — calling native `buy` on a USDC listing reverts with `usdc listing`.

The app currently lists and buys in the **native** token only. USDC listings appear in API results
with `currency: 1`; filter them out if your integration only handles native settlement. See
[Fees → two kinds of USDC](/protocol/fees#two-kinds-of-usdc).

## Browsing listings

In the app: the **Marketplace** tab, showing active listings with prices and expiry dates.

Over the API, cursor-paginated:

```http
GET /api/v1/marketplace?limit=50
GET /api/v1/marketplace?limit=50&cursor=<nextCursor>
```

Default `limit` is 50, maximum 200. See [API endpoints](/api/endpoints#marketplace).

## Events

| Event | Meaning |
| --- | --- |
| `Listed(id, seller, price)` | New listing. |
| `PriceChanged(id, seller, price)` | Price updated. |
| `Unlisted(id, seller)` | Listing withdrawn. |
| `Sold(id, seller, buyer, price, fee)` | Sale settled. |
| `ReferralPaid(id, referrer, referee, reward)` | Referral reward paid. |

## Before you buy

- **Check the expiry.** A cheap name with two weeks left needs renewing immediately.
- **Check the name's characters.** Listings can contain names the app would never let you type,
  including look-alikes for well-known names. See [Safety](/safety#look-alike-names).
- **Use an explicit `maxPrice`.**
- **Never pay outside an atomic transaction.** See [Safety](/safety#buying-a-name-safely).

## Next

- [Ownership & transfers](/guide/ownership) — approvals and reclaim.
- [Fees](/protocol/fees) — the full fee picture.
- [Safety](/safety) — marketplace-specific risks.
