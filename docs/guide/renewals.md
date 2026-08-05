# Renewals & expiry

A `.arc` name is a lease, not a freehold. It has an expiry date, and keeping it means renewing
before that date passes — plus a 90-day safety net afterwards.

This page is the one most worth reading carefully. The grace period is the single most
misunderstood part of the protocol.

## The three states

```
   registered          in grace              available
├────────────────────┼──────────────────┼─────────────────────►
                  expiry          expiry + 90 days
```

| State | Condition | Who can register it | Can the owner renew? |
| --- | --- | --- | --- |
| **Registered** | `expiry > now` | Nobody | Yes |
| **In grace** | `now >= expiry` and `now <= expiry + 90 days` | Nobody | **Yes** |
| **Available** | `now > expiry + 90 days` | Anyone | No — it's gone |

The contract expresses availability as a single line:

```solidity
function available(uint256 id) public view returns (bool) {
    return expiries[id] + GRACE < block.timestamp;
}
```

`GRACE` is a hard constant of **90 days** in the registrar. It is not configurable and cannot be
changed by the contract owner.

## What the grace period is for

Missing a renewal by a day should not cost you your identity. The 90-day window means an expired
name is not immediately up for grabs — it stays locked to its previous owner, who can renew it at
any point during those three months and carry on as though nothing happened.

Nobody else can register the name during grace. Attempting to reverts with `taken`.

::: danger An expired name stops working immediately
The grace period protects your *claim* on the name. It does not keep the name functional.

The moment the expiry passes:

- `registrar.ownerOf(id)` **reverts with `expired`** — it does not return the old owner.
- Any integration that reads ownership sees a failure, not a stale value.
- Wallets and apps that check liveness will stop resolving the name.

So a name in grace is a name that is broken but recoverable. Do not treat the 90 days as an
extension of normal service.
:::

## Renewing

Anyone can renew any name — renewal is not restricted to the owner. There is no risk in this: a
renewal only extends the expiry, it never changes ownership or records. If a friend renews your
name for you, you still own it.

```solidity
renew(string nm, uint256 dur) payable
```

The cost uses exactly the same tiered pricing as registration, prorated over the duration. See
[Pricing & rarity](/guide/pricing).

Renewal is a **single transaction** — there is no commit-reveal step, because there is nothing to
front-run. The name is already owned.

Duration bounds are the same as registration: 28 days minimum, 100 years maximum, or the call
reverts with `duration`. Overpayment is refunded in the same transaction.

### In the app

Open **My names**, find the name, press **Renew**, choose a duration, confirm. The new expiry is
the old expiry plus the duration — renewing early does not waste the time you have left, it stacks
on top of it.

### Renewing after expiry

Still allowed, for 90 days:

```solidity
require(expiries[id] + GRACE >= block.timestamp, "expired");
```

Past that, `renew` reverts with `expired` and the name is genuinely gone. Note the asymmetry: the
registrar's `available()` uses `<` and `renew` uses `>=`, so the boundary is handled consistently
— there is no window where a name can be neither renewed nor registered.

## When a name is released

Once `expiry + 90 days` has passed, the name becomes registerable by anyone through the ordinary
[registration flow](/guide/registering). There is no auction, no premium decay, and no priority for
the previous owner. First valid commit-reveal wins.

The app shows the exact release date on any name in grace, so you can see when a name you want
frees up. Nothing reserves it for you at that moment — you have to be there.

## What happens to the records

Registering an expired name mints a fresh token to the new owner, and the controller binds the
resolver and sets the address record to point at *them*.

Text records written by the previous owner are stored per-node and are **not automatically
cleared**. A new owner should overwrite or clear any records they don't want, and integrators
should not assume a record was written by the current owner. See
[Records & profile](/guide/records).

## Not losing a name

The protocol has no notifications, no auto-renew and no recovery. Practical measures:

1. **Register for longer.** Duration costs the same per year whether you buy one year or ten, and
   a 5-year registration is four fewer chances to forget. One transaction either way.
2. **Put the expiry in a calendar,** with a reminder a month ahead — not a day ahead.
3. **Check the app periodically.** **My names** shows every expiry date you hold.
4. **Watch on-chain.** Read `nameExpires(tokenId)` from the registrar, or poll
   `GET /api/v1/domains/:name` and alert on `expiresAt`. See [API endpoints](/api/endpoints).
5. **Renew from a wallet you actually use.** Renewal doesn't require the owning wallet, so a name
   held in cold storage can be renewed from a hot wallet without touching the hardware key.

That last point is worth repeating: **you never need to expose the wallet holding a valuable name
in order to renew it.**

## Revert reference

| Revert | Cause |
| --- | --- |
| `expired` (on `renew`) | Past expiry + 90 days. The name is released; register it normally if it's still free. |
| `expired` (on `ownerOf`) | The name is past its expiry, including during grace. Read `nameExpires` instead. |
| `duration` | Renewal duration outside 28 days – 100 years. |
| `underpaid` | `msg.value` below the quoted renewal price. |
| `taken` | You tried to register a name that is registered or in grace. |

## Next

- [Pricing & rarity](/guide/pricing) — what renewal costs.
- [Claiming a name](/guide/claiming) — registering a name that has just been released.
- [Ownership & transfers](/guide/ownership) — moving a name to another wallet.
