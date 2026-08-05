# Pricing & rarity

Names are priced by **length**, in tiers, per year. Short names cost more because there are fewer
of them.

## How the price is calculated

Two steps. A yearly rate is chosen from the name's length, then prorated across your duration:

```solidity
usdPerYear(len)          // tier lookup
price(nm, dur) = usdPerYear(bytes(nm).length) * dur / 365 days
```

Proration is exact and to the second — registering for 18 months costs precisely 1.5× the yearly
rate. There is no rounding up to whole years and no minimum beyond 28 days.

Length is measured in **bytes**, not visible characters. For ordinary lowercase names those are
the same thing. For a name containing multi-byte characters they are not — see
[Registering → what makes a name valid](/guide/registering#what-makes-a-name-valid).

## The tiers

| Name length | Rate |
| --- | --- |
| 2 characters | `price2` |
| 3 characters | `price3` |
| 4 characters | `price4` |
| 5 or more | `price5plus` |

::: warning These are live on-chain values, not constants
All four rates are set by the contract owner through `setPrices` and can change at any time. This
page deliberately does not print the current numbers — anything written here would eventually be
wrong.

The app always shows the live price, fetched from the contract, before you confirm. To read them
yourself, call `usdPerYear(len)` on the controller. See
[Contract addresses](/protocol/contracts).
:::

Note that the tiers are independent values, not a curve. There is no guarantee that a 3-character
name is cheaper than a 2-character one, or that 4 is cheaper than 3 — the owner sets each tier
separately. Read the actual rate rather than assuming it follows from length.

## Two-character names can be switched off

A 2-character name is only registerable when `price2` is greater than zero:

```solidity
if (len == 2 && price2 == 0) return false;   // valid()
require(price2 > 0, "2char");                // usdPerYear()
```

Setting `price2` to zero disables the entire 2-character tier. Attempting to register one then
fails validation with `invalid`, and asking for its price reverts with `2char`. The app shows such
names as unusable rather than as available.

## The minimum length

`minLen` is owner-configurable via `setLimits` and can never be set below 2. Any name shorter than
it fails `valid()`, and requesting a price for one reverts with `short`.

Raising `minLen` does not affect names already registered below the new floor — they remain owned,
renewable and tradeable. It only blocks new registrations.

## What you actually pay

```
price(name, duration)          the contract's quote
  − referral discount          if a referrer is supplied and discounts are enabled
  = amount due
  + gas                        network fee, paid to validators, not to Arc Names
```

Overpayment is refunded in the same transaction, so sending a buffer above the quote is safe and
is exactly what the app does to survive a price change between quote and mint. See
[Registering → paying](/guide/registering#paying).

## Reading the price yourself

```ts
const wei = await client.readContract({
  address: CONTROLLER,
  abi: CONTROLLER_ABI,
  functionName: 'price',
  args: ['alice', 365n * 24n * 60n * 60n],
});
```

The result is in **native wei, 18 decimals**, and because 1 USD of price is scaled to exactly
`1e18` native wei, the returned figure is also the USD price. Format it with 18 decimals.

For the 6-decimal ERC-20 path, `priceUSDC(nm, dur)` returns the same amount divided by `1e12`.
See [Fees → two kinds of USDC](/protocol/fees#two-kinds-of-usdc).

## Rarity in practice

Length is the only property the protocol itself prices. Everything else that makes a name
desirable — a real word, a short number, a recognisable handle — is a market judgement, and shows
up in [marketplace](/guide/marketplace) prices rather than in registration prices.

Two consequences worth knowing:

- **Registration price is a floor, not a market price.** A name someone else wants can be resold
  for far more than it cost to register. That is what the marketplace is for.
- **Renewal is priced the same way as registration.** Holding a short name costs the short-name
  rate every year, indefinitely. Factor that in before registering a portfolio of them.

## Next

- [Registering a name](/guide/registering) — the full flow.
- [Renewals & expiry](/guide/renewals) — the ongoing cost.
- [Fees](/protocol/fees) — protocol fees, marketplace fees, and gas.
