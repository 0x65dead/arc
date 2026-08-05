# Ownership & transfers

Every `.arc` name is an ERC-721 token. Owning the token is owning the name. This page covers moving
one to another wallet — and the reclaim step that trips almost everyone up the first time.

## What you own

Registering mints a token whose ID is derived from the name itself:

```solidity
tokenId = uint256(keccak256(bytes("alice")))
```

The ID is deterministic — the same name always maps to the same token ID, on any deployment. It is
derived from the **label** (`alice`), not the full name (`alice.arc`).

The token lives in the registrar contract, which also stores the expiry. Standard ERC-721
interfaces apply: `ownerOf`, `transferFrom`, `safeTransferFrom`, `approve`, `setApprovalForAll`,
plus `tokenURI` for metadata.

## Two kinds of ownership

The thing to understand before transferring anything: a name has **two** owners recorded in two
contracts, and they do different jobs.

| | Where | Grants | Set by |
| --- | --- | --- | --- |
| **Token owner** | Registrar (ERC-721) | The right to transfer, sell, and renew the name | `transferFrom` |
| **Registry owner** | Registry (the node) | The right to **write records** | `reclaim` |

`transferFrom` moves the token. It does **not** move the registry ownership.

At registration the controller sets both for you, so they start out identical and you never notice
the distinction. A transfer breaks that alignment.

## Reclaiming after a transfer

::: danger Reclaim immediately after receiving a name
Until the new token owner calls `reclaim`, the **previous owner remains the registry owner** and
can still change the name's records — including the address it resolves to. The new owner's own
writes revert with `!auth`.

```solidity
registrar.reclaim(tokenId, newOwner)
```

Anyone who is the token owner (or approved for it) can call this. Do it in the same session you
receive the name.
:::

This is not a bug — the two-layer design is inherited from ENS and lets a name be held by a
contract while a different address manages its records. But for an ordinary transfer between two
wallets, reclaim is a required second step.

The order that is safe:

1. Sender: `transferFrom(sender, recipient, tokenId)`
2. Recipient: `reclaim(tokenId, recipient)`
3. Recipient: verify with `registry.owner(node) == recipient`
4. Recipient: update records — in particular `setAddr`, which still points at the sender

Step 4 matters. A transferred name keeps resolving to the *old* owner's address until the new owner
overwrites it. Funds sent to the name in the meantime go to the previous owner.

## Transferring in a wallet

Any ERC-721-capable wallet can transfer a name. You'll need the registrar address and the token
ID — the app shows both. Send to the recipient's address as you would any NFT.

::: warning A transfer is irreversible
There is no undo, no clawback and no support desk. Sending to a wrong address loses the name
permanently. Sending to a contract that can't handle ERC-721 tokens loses it just as permanently —
prefer `safeTransferFrom`, which reverts rather than stranding the token.

Verify the recipient address character by character, or send to a `.arc` name you have resolved
and confirmed.
:::

## Approvals

To let another address or contract move your name:

```solidity
approve(address to, uint256 tokenId)          // one name
setApprovalForAll(address operator, bool ok)  // every name you hold
```

Listing on the [marketplace](/guide/marketplace) requires an approval, because the market
transfers the token on your behalf when a sale settles.

::: warning setApprovalForAll is broad and lasting
It authorises the operator over **every name you currently hold and every name you register in
future**, until you revoke it. Only grant it to contracts you have reason to trust, and revoke it
when you're done. Prefer per-token `approve` where you can.
:::

Approvals are cleared automatically on transfer, so a sale doesn't leave a stale approval behind.

## Expiry interacts with ownership

`registrar.ownerOf(id)` **reverts with `expired`** once the expiry has passed — including during
the 90-day grace period. It does not return the previous owner.

Two consequences:

- **Don't use `ownerOf` as a liveness check** unless you're catching the revert. Use
  `nameExpires(id)` and compare against the current block timestamp.
- **A name in grace cannot be transferred or sold**, because every operation that calls `ownerOf`
  reverts. [Renew it first](/guide/renewals), then transfer.

The token itself is never burned on expiry — the internal owner mapping survives, which is what
lets a renewal during grace restore full function.

## Transfers and your primary name

If you transfer away the name you use as your [primary name](/guide/primary-name), the round-trip
verification breaks and apps fall back to displaying your address. Set a different primary name
you still own.

## Watching transfers

Transfers emit the standard ERC-721 event:

```solidity
event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
```

A mint is a `Transfer` from the zero address. The indexer tracks these and exposes them as
`kind: "transfer"` activity items — see [API endpoints](/api/endpoints#activity).

## Revert reference

| Revert | Cause |
| --- | --- |
| `!auth` | Writing records without being the registry owner. Call `reclaim`. |
| `expired` | `ownerOf` on a name past its expiry, including during grace. |
| `none` | `ownerOf` on a token that was never minted. |
| `!live` | The registrar no longer controls the `.arc` node. Protocol-level fault. |

## Next

- [Marketplace](/guide/marketplace) — selling instead of transferring.
- [Records & profile](/guide/records) — updating records after a transfer.
- [Safety](/safety) — before you move a name that matters.
