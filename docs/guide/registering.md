# Registering a name

Registration is deliberately a two-transaction process. This page explains what each transaction
does, why the wait between them exists, and every way the process can fail.

For the short version, see [Quick start](/guide/quick-start).

## Why two transactions

If registration were a single transaction, it would be trivially front-runnable. Your transaction
sits in the public mempool before it is mined, naming the exact name you want. Anyone watching can
copy it, pay more gas, and have their transaction mined first. You lose the name and still pay
gas.

Arc Names uses **commit-reveal** to close this. The name is split across two transactions, and
the first one gives nothing away.

### Transaction 1 — commit

Your browser generates a random 32-byte secret and hashes it together with the name and the owner
address:

```solidity
makeCommitment(nm, owner, secret)
  = keccak256(abi.encode(keccak256(bytes(nm)), owner, secret))
```

Only that hash goes on-chain, via `commit(bytes32)`. The contract stores the current timestamp
against it. An observer sees a 32-byte hash and cannot invert it — the secret makes brute-forcing
candidate names useless.

### The wait

`register` requires that `minCommitAge` has elapsed since the commit:

```solidity
require(commitments[c] + minCommitAge <= block.timestamp, "early");
require(commitments[c] + maxCommitAge  > block.timestamp, "commit expired");
```

The minimum guarantees your commitment is already settled in a past block before the name becomes
public knowledge. By the time a front-runner learns what you wanted, they'd need a commitment
older than yours, and they don't have one.

The maximum stops commitments accumulating in storage forever, and stops someone from hoarding a
cheap option on a name indefinitely.

Both values are set by the contract owner via `setLimits` and can change. The app reads them live
and shows the actual countdown — don't hardcode them.

### Transaction 2 — register

`register(name, owner, duration, secret)` reveals the name and the secret. The contract
recomputes the commitment hash, checks the timing, validates the name, takes payment, and mints.

There is also a five-argument overload that takes a referrer — see [Referrals](#referrals).

## What registration actually does

The mint is not just an NFT. `_doRegister` → `_mint` performs, in one transaction:

1. `registrar.register(id, controller, duration)` — mints the ERC-721 and sets the expiry.
2. `ens.setResolver(node, resolver)` — binds the default resolver to your name.
3. `resolver.setAddr(node, owner)` — points the name at the owner's address.
4. `registrar.reclaim(id, owner)` — writes you as the registry owner of the node.
5. `registrar.transferFrom(controller, owner, id)` — transfers the token to you.

So a freshly registered name **already resolves to your address**. You do not need to set a
resolver or an address record afterwards. What is *not* set automatically is the reverse record —
see [Your primary name](/guide/primary-name).

It emits `NameRegistered(name, label, owner, cost, expiry)`.

## What makes a name valid

There are two different sets of rules, and the difference matters.

### On-chain rules

`ArcController.valid()` enforces only:

- Length is at least `minLen` (owner-configurable, and never below 2).
- If the name is exactly 2 characters, a 2-character price must be configured.
- **No uppercase ASCII** (bytes `0x41`–`0x5A`).

That is the entire on-chain check. It does not restrict the character set beyond rejecting
uppercase — which means names containing Unicode, emoji, whitespace or invisible characters are
registerable by anyone calling the contract directly.

### App rules

The Arc Names app applies a stricter filter before it will let you register: lowercase letters,
digits and hyphens only, no leading or trailing hyphen, maximum 63 characters.

::: danger Names in the wild may not follow the app's rules
Because the on-chain check is looser, a name you see in the marketplace or in an activity feed may
contain characters the app would never let you type — including ones that render identically to
ASCII. Never judge a name by how it looks. See
[Safety → look-alike names](/safety#look-alike-names).
:::

## Duration

You pay per year, prorated to the second:

```solidity
price(nm, dur) = usdPerYear(length) * dur / 365 days
```

| Bound | Value |
| --- | --- |
| Minimum | 28 days |
| Maximum | 36,500 days (100 years) |

Anything outside that range reverts with `duration`. Registering for longer costs proportionally
more but is still a single transaction, so a long registration saves gas and saves you from
[forgetting to renew](/guide/renewals).

## Paying

The native gas token is USDC with 18 decimals, and the pricing is scaled so that **1 USD of price
is exactly 1e18 native wei**. The number the contract returns from `price()` is the USD price
directly, in wei.

Send at least `price()`. Sending less reverts with `underpaid`. Sending more is fine — the
contract refunds the difference to `msg.sender` in the same transaction:

```solidity
if (msg.value > due) { (bool ok,) = msg.sender.call{value: msg.value - due}(""); require(ok); }
```

The app deliberately quotes a small buffer over the exact price so that a price change between
quote and mint doesn't fail your transaction. You are never charged the buffer.

There is also `registerManyUSDC` for paying with the 6-decimal ERC-20 USDC instead. See
[Fees → two kinds of USDC](/protocol/fees#two-kinds-of-usdc).

## Registering several names at once

`registerMany(names[], owner, duration)` registers between **1 and 20** names in one transaction,
under a single commitment. More than 20 reverts with `count`. Every name must be valid and every
name must be available — one bad name reverts the whole batch.

## Referrals

The controller supports referral attribution natively. The five-argument overload:

```solidity
register(nm, owner, duration, secret, referrer)
```

When a referrer is supplied, the contract applies two independent basis-point rates:

| Rate | Who benefits | Effect |
| --- | --- | --- |
| `refDiscountBps` | The registrant | `due = base - base * refDiscountBps / 10000` |
| `refRewardBps` | The referrer | Paid `base * refRewardBps / 10000` |

Each is capped at 2000 bps (20%) and both default to zero, so referrals are inert until the owner
enables them via `setReferral`.

The referrer is ignored — and full price charged — if it is the zero address, the caller, or the
name's owner. This stops self-referral.

If paying the referrer fails (a contract that rejects transfers, say), the reward is credited to
`pendingWithdrawals[referrer]` and can be pulled later with `withdrawPending()`. Either way a
`ReferralPaid(referrer, buyer, amount)` event is emitted, which makes an on-chain referral
leaderboard straightforward to build.

::: info Not yet wired into the app
The referral overload exists in the deployed controller but the Arc Names frontend currently calls
the four-argument `register`. Integrators calling the contract directly can use it today.
:::

## Keeping your secret safe

The secret lives in your browser's local storage under `arc:pending-commitments:v2` between the
two transactions.

If you lose it — clearing site data, switching browsers, using a private window that closes — the
commitment cannot be revealed. It isn't a loss of funds beyond the commit gas, but you must start
over and wait out `minCommitAge` again. The name is not reserved for you in the meantime.

## Registration states

The app models the flow as an explicit state machine, which is what the progress indicator
reflects:

| State | Meaning |
| --- | --- |
| `idle` | Nothing in progress. |
| `committing` | Commit transaction sent, waiting for confirmation. |
| `waiting` | Commit confirmed, `minCommitAge` countdown running. |
| `ready` | Countdown finished; register is now callable. |
| `registering` | Register transaction sent. |
| `complete` | Name minted. |
| `expired` | `maxCommitAge` passed before you registered. Start over. |

## Revert reference

| Revert | Cause |
| --- | --- |
| `early` | You called `register` before `minCommitAge` elapsed. Wait for the countdown. |
| `commit expired` | More than `maxCommitAge` passed since the commit. Start over. |
| `committed` | You committed the same hash again while a live commitment exists. |
| `invalid` | The name fails `valid()` — too short, uppercase, or a 2-char name with no price set. |
| `duration` | Duration outside 28 days – 100 years. |
| `underpaid` | `msg.value` below the quoted price. |
| `owner` | Owner address is the zero address. |
| `taken` | The name is registered, or expired but still in its 90-day grace period. |
| `short` | Requested price for a name shorter than `minLen`. |
| `2char` | Two-character name while `price2` is zero — 2-char names are disabled. |
| `count` | `registerMany` called with 0 names, or more than 20. |
| `!live` | The registrar no longer controls the `.arc` node. A protocol-level fault; nothing you can fix. |

## Next

- [Pricing & rarity](/guide/pricing) — how length determines cost.
- [Renewals & expiry](/guide/renewals) — keeping the name.
- [Records & profile](/guide/records) — filling in the profile.
