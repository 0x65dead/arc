# Quick start

Five steps, about five minutes, most of which is waiting for a timer between two transactions.

::: tip Before you start
You need a wallet that can add a custom network, and some testnet gas. Both are covered in
[Connecting a wallet](/guide/connecting-a-wallet) — do that first if you haven't.
:::

## 1. Open the app and connect

Open the Arc Names app and press **Connect**. Approve the connection in your wallet.

If your wallet is on the wrong network, a banner appears at the top of the app with a button to
switch. Arc Names only works on Arc Testnet — chain ID `5042002`.

## 2. Search for a name

Type into the search box. You don't type the `.arc` — the app appends it.

The result tells you one of four things:

| Result | Meaning |
| --- | --- |
| **Available** | Free to register, with the yearly price shown. |
| **Taken** | Registered to someone else, with the owner and expiry date. |
| **In grace period** | Expired, but still locked to its previous owner for 90 days. You cannot register it yet — the page shows the date it frees up. |
| **Not a usable name** | The name breaks a rule. See [what makes a name valid](/guide/registering#what-makes-a-name-valid). |

Names are lowercase, and may contain letters, digits and hyphens. Length changes the price —
see [Pricing & rarity](/guide/pricing).

## 3. Commit

Press **Register** on an available name and the app sends a **commitment** — a hash of the name,
your address, and a random secret. It reveals nothing about which name you want.

This is the front-running defence. Without it, anyone watching the mempool could see your
registration, pay more gas, and take the name out from under you. The commitment goes first,
alone, and is meaningless to an observer.

::: danger Don't clear browser storage mid-registration
The secret is stored in your browser. Lose it and the commitment is unusable — you'll have to
start again and pay the commit gas twice. Don't clear site data, and don't switch browsers
between step 3 and step 5.
:::

## 4. Wait out the timer

A countdown appears. The contract requires a minimum wait between commit and register, so that
the commitment is already buried in a past block before the name becomes public.

There is also a maximum. If you wait too long the commitment expires and you start over — the app
shows this as an expired state with a button to restart. Don't walk away for an hour.

## 5. Register

When the countdown hits zero, press **Register**. This second transaction reveals the name, pays
for the duration you chose, and mints the name to your wallet as an NFT.

Pick your duration before confirming. You pay per year, and registering for longer costs
proportionally more but only ever costs one transaction. Minimum is 28 days, maximum is 100 years.

Any overpayment is refunded by the contract in the same transaction — the app quotes a small
buffer over the exact price so the transaction doesn't fail if the price moves between the quote
and the mint.

## You have a name. Now what?

Registration does more than mint the token. In the same transaction the controller also binds the
default resolver to your name and sets its address record to point at you — so `alice.arc` already
resolves to your wallet the moment it's minted. Nothing further is required to receive payments.

Two optional steps remain, one transaction each:

1. **[Set it as your primary name](/guide/primary-name)** — so apps show `alice.arc` instead of
   your address. This is the *reverse* direction and is **not** set automatically. Open
   **My names → Records → Use as primary name**.
2. **[Fill in your profile](/guide/records)** — avatar, website, description, social handles. Same
   dialog. Each record is its own transaction.

## Then keep it

Names expire. Put the expiry date in your calendar and read
[Renewals & expiry](/guide/renewals) — particularly the part about the 90-day grace period, which
is the thing people misunderstand most often.

## Troubleshooting

**"Can't reach the Arc network right now."**
The app can't talk to the RPC endpoint. Check your connection and press *Try again*. If it
persists, the RPC endpoint is down or misconfigured — see [Safety](/safety#when-the-app-cant-reach-the-network).

**The search box shows nothing at all.**
Same cause as above. A failed lookup shows an error card with a *Try again* button.

**"This name has no resolver."**
Unusual for a name registered through the app, since the controller binds one during
registration. You'll see this on a name whose resolver was later unset, or one registered by
other means. Press **Set a resolver** and you can then write records. See
[Records & profile](/guide/records#binding-a-resolver).

**My transaction reverted.**
Every revert reason is listed with its cause in the [FAQ](/reference/faq#transaction-errors).
