# Claiming a name

"Claiming" covers the cases where the name you want isn't simply free: it's expired, it's in its
grace period, or it's listed for sale. Each needs a different move.

## Which situation are you in?

Search for the name in the app and it tells you which of four states applies:

| What you see | What it means | What to do |
| --- | --- | --- |
| **Available** | Nobody holds it | [Register it](/guide/registering) |
| **In grace period** | Expired, still locked to its old owner for 90 days | Wait for the release date shown |
| **Taken** | Actively registered | [Buy it](#buying-a-name-someone-else-owns), or wait |
| **Not a usable name** | Fails validation | Pick another — see [validity rules](/guide/registering#what-makes-a-name-valid) |

## Claiming a name in its grace period

An expired name is **not** available. It stays reserved for its previous owner for 90 days after
expiry, during which they can renew and keep it. Registration attempts revert with `taken`.

The app shows the exact date the name is released. To get it:

1. Note the release date — `expiry + 90 days`.
2. Be ready at that moment. There is no queue, no auction, and no priority for anyone.
3. Run the ordinary [commit-reveal registration](/guide/registering). First valid reveal wins.

::: warning Grace-period names are frequently renewed
Most names in grace get renewed by their owners — that is exactly what the grace period is for.
Don't count on one being released. Have a second choice.
:::

There is also no premium-decay auction on release, unlike some naming services. The price drops to
the normal tier rate the instant the name frees up, which means popular releases are competitive.

## Buying a name someone else owns

A registered name can only be obtained from its owner. Two routes.

### It's listed on the marketplace

If the owner has listed it, the app shows a price and a **Buy** button. Settlement is atomic — the
token moves to you and payment moves to the seller in one transaction. See
[Marketplace](/guide/marketplace).

### It isn't listed

Then you need the owner to agree. You can find them:

- In the app — the search result shows the current owner's address.
- Via the API — `GET /api/v1/domains/:name` returns `owner`.

Reach them through their [records](/guide/records) — many owners set an `email`, `com.twitter` or
`url` record. Then either ask them to list it at an agreed price, or agree a direct transfer.

::: danger Never pay for a name outside an atomic transaction
If you send funds first and trust the owner to transfer afterwards, you have no recourse when they
don't. There is no escrow, no dispute process and no reversal.

Use a marketplace listing, where payment and transfer happen in the same transaction. If you must
deal off-market, use a contract that swaps both sides atomically. "Send me the money and I'll
transfer it" is how people get robbed. See [Safety](/safety#buying-a-name-safely).
:::

## After you claim a name

Whether you registered it fresh or bought it, do these in order.

**If you registered it**, the controller has already bound a resolver and pointed the name at you.
Nothing is required.

**If you bought or received it**, two steps are mandatory and both are easy to forget:

1. **Reclaim it** — `registrar.reclaim(tokenId, yourAddress)`. Until you do, the previous owner is
   still the registry owner and can change your records, while your own writes revert with
   `!auth`. See [Ownership & transfers](/guide/ownership#reclaiming-after-a-transfer).
2. **Update the address record** — a bought name still resolves to the **seller's** address until
   you call `setAddr`. Anyone paying the name in the meantime pays them, not you.

Then, optionally: set your [records](/guide/records) and make it your
[primary name](/guide/primary-name).

## Check the expiry before you pay

A name's price should account for how long it's registered. Buying a name with two weeks left means
paying to [renew](/guide/renewals) almost immediately.

`GET /api/v1/domains/:name` returns `expiresAt`, and the app shows it on every listing. Check it
before you buy, not after.

## Names that were never registered

`GET /api/v1/domains/:name` returns **404** for a name that has never been registered — the
indexer has no record to return. That's a normal response, not an error. Use
`GET /api/v1/availability?name=…` when you want the three-state answer instead.

## Next

- [Registering a name](/guide/registering) — the full flow.
- [Marketplace](/guide/marketplace) — buying and selling.
- [Renewals & expiry](/guide/renewals) — the grace period in detail.
