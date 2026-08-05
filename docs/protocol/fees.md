# Fees

Three separate costs appear when using Arc Names, and they go to three different places. Keeping
them distinct avoids a lot of confusion.

| Cost | Paid to | When |
| --- | --- | --- |
| **Registration / renewal price** | The protocol (controller) | Registering or renewing a name |
| **Marketplace fee** | The protocol (market) | A name sells on the marketplace |
| **Gas** | Network validators | Every transaction |

Arc Names takes no cut of a direct transfer between wallets, and no fee for setting records beyond
the gas.

## Registration and renewal

Priced by name length, per year, prorated to the second:

```solidity
price(nm, dur) = usdPerYear(bytes(nm).length) * dur / 365 days
```

Renewal uses the same tiers as registration — there is no discount and no penalty for renewing.
The rates are owner-configurable and this page deliberately doesn't print them; see
[Pricing & rarity](/guide/pricing) for how to read the live values.

Proceeds accumulate in the controller and are withdrawn by the contract owner via `withdraw`.

### Overpayment is refunded

Both `register` and `renew` refund the excess in the same transaction:

```solidity
if (msg.value > due) { (bool ok,) = msg.sender.call{value: msg.value - due}(""); require(ok); }
```

Sending a buffer above the quote is therefore safe, and is what the app does so a price change
between quote and mint doesn't revert your transaction. You are never charged the buffer.

## Marketplace fees

Deducted from the **seller's** proceeds, not added to the buyer's price:

```
buyer pays   price
seller gets  price − (price × feeBps / 10000)
protocol     price × feeBps / 10000
```

`feeBps` initialises to **zero**, so unless the owner has changed it the seller receives the full
sale price. It is a live value — read `feeBps()` from the market rather than trusting a number
here.

The fee goes to `feeRecipient`. If paying the seller fails, their proceeds are credited to a
pending balance they can withdraw later, rather than reverting the sale.

## Referral economics

Two independent referral systems, both denominated in basis points, both defaulting to zero.

### Controller referrals

```
due    = base − (base × refDiscountBps / 10000)     // buyer's discount
reward = base × refRewardBps / 10000                // referrer's payment
```

Each rate is capped at 2000 bps (20%). Note that the discount and the reward are **separate** —
the reward is not taken out of the discounted price, it is paid on top from protocol revenue. Both
come out of what the protocol would otherwise keep.

A referrer is ignored if it is the zero address, the caller, or the name's owner — no self-referral.

### Market referrals

Constrained so referrals can never eat into seller proceeds:

```solidity
require(discountBps + rewardBps <= feeBps, "exceeds fee");
```

Referrals are funded entirely from the protocol's own fee. With `feeBps` at zero, market referrals
are necessarily inert.

### Withdrawal fallback

If paying a referrer fails, the amount is credited to `pendingWithdrawals[referrer]` and claimable
with `withdrawPending()`. The registration still succeeds — a referrer that can't receive funds
never blocks a user's transaction.

## Two kinds of USDC

This is the single most error-prone detail in the protocol.

| | Native USDC | ERC-20 USDC |
| --- | --- | --- |
| What it is | Arc's gas token | A token contract |
| Decimals | **18** | **6** |
| Used for | Gas, and the default payment path | The alternative payment path |
| In the API | `priceWei`, `amountWei`, `totalRevenueWei` | `currency: 1` listings |

The pricing is scaled so **1 USD = 1e18 native wei**, which means `price()` returns the USD price
directly, in wei. The ERC-20 equivalent is the same amount divided by `1e12`:

```solidity
priceUSDC(nm, dur) = price(nm, dur) / 1e12
```

::: danger Getting the decimals wrong is a factor of a trillion
Formatting an 18-decimal value as 6 decimals — or configuring a wallet's currency decimals as 6 —
makes every price and balance wrong by 1,000,000,000,000×.

Always format native amounts with 18 decimals. Every `*Wei` field in the API is 18-decimal native
wei, including in listings whose `currency` is 1.
:::

### Paying with ERC-20 USDC

The controller offers `registerManyUSDC` and `renewUSDC`; the market offers `listUSDC`. These
require the `usdc` address to be configured — if it's zero, those calls revert with `usdc off`.

ERC-20 payment pulls tokens via `transferFrom`, so it needs an allowance first, and reverts with
`usdc pull` if the pull fails.

Listings carry a currency flag: `0` native, `1` ERC-20. They are not interchangeable — calling
native `buy` on a USDC listing reverts with `usdc listing`. The app handles native only.

## Gas

Paid to validators, not to Arc Names, and not something the protocol controls.

Rough transaction counts, since gas scales with how many transactions a flow needs:

| Action | Transactions |
| --- | --- |
| Register a name | 2 (commit + register) |
| Renew | 1 |
| Set one record | 1 per record |
| Set primary name | 1 |
| Transfer | 1, plus 1 for the recipient's reclaim |
| List for sale | 2 (approve + list), or 1 if already approved |
| Change listing price | 1 |
| Buy | 1 |

Two ways to spend less gas overall:

- **Register for longer.** A 5-year registration costs the same per year as a 1-year one but needs
  one transaction instead of five renewals.
- **Batch registrations.** `registerMany` handles up to 20 names under one commitment.

## What has no fee

- Transferring a name directly between wallets (gas only).
- Setting or changing records (gas only).
- Setting a primary name (gas only).
- Reading anything — resolution, availability, the API. All free.
- Renewing someone else's name. Anyone can renew any name, and it costs only the renewal price.

## Where the money goes

Registration and renewal revenue accumulates in the controller; marketplace fees go to
`feeRecipient`. Both are withdrawn by the contract owner. There is currently no on-chain treasury,
no fee-sharing, and no token.

## Next

- [Pricing & rarity](/guide/pricing) — how the tiers work.
- [Marketplace](/guide/marketplace) — the seller's side of the fee.
- [Architecture](/protocol/architecture) — which contract holds which parameter.
