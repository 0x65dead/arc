# Records & profile

Records are the data attached to your name — the address it points at, your avatar, your website,
your social handles. They live on the **resolver** contract and anyone can read them without
permission.

## Where records live

Records are stored per **node** (the namehash of your name) on a resolver contract, and the
registry records which resolver answers for your name. Reading a record is therefore always two
steps: find the resolver, then ask it. See [Resolving .arc](/protocol/resolving).

## Who is allowed to write

This is the part that surprises people. The resolver authorises writes against the **registry
owner** of the node, not the holder of the NFT:

```solidity
modifier auth(bytes32 node) {
    address o = ens.owner(node);
    require(o == msg.sender || ens.isApprovedForAll(o, msg.sender), "!auth");
    _;
}
```

For a name you registered yourself these are the same address, because the controller calls
`reclaim` for you at mint time.

::: warning After a transfer, records are locked until you reclaim
Receiving the NFT does **not** make you the registry owner. Until the new holder calls
`registrar.reclaim(tokenId, newOwner)`, record writes revert with `!auth` — and the *previous*
owner can still change them.

Always reclaim immediately after receiving a name. See
[Ownership & transfers](/guide/ownership#reclaiming-after-a-transfer).
:::

## The record types

### Address

The address the name resolves to. This is what a wallet uses when someone sends to `alice.arc`.

```solidity
setAddr(bytes32 node, address a)
addr(bytes32 node) → address
```

Set for you at registration, pointing at the registrant. Change it whenever you like — that
indirection is the main reason to have a name at all.

An unset address record reads as the zero address. Never send to it.

There is also a multi-coin form, `setAddr(node, coinType, bytes)`, for pointing a name at
addresses on other chains. The app doesn't expose it; integrators can use it directly.

### Text records

Free-form key/value strings. The app surfaces six:

| Key | Shown as | Notes |
| --- | --- | --- |
| `description` | Description | Short bio. |
| `url` | Website | Include the scheme: `https://…`. |
| `avatar` | Avatar URL | An image URL. |
| `com.twitter` | X / Twitter | Handle, without the `@`. |
| `com.github` | GitHub | Username. |
| `email` | Email | Public — expect scraping. |

```solidity
setText(bytes32 node, string key, string value)
text(bytes32 node, string key) → string
```

The keys are a convention, not a restriction — the resolver accepts any key, so an integration can
define its own namespaced keys. Reading an unset key returns an empty string.

### Contenthash

For pointing a name at content on a distributed store such as IPFS.

```solidity
setContenthash(bytes32 node, bytes hash)
contenthash(bytes32 node) → bytes
```

Not exposed in the app; available on the contract.

### Name (the reverse record)

`setName` is used on the *reverse* node, not on your name's node, and is how a primary name is
set. See [Your primary name](/guide/primary-name).

## Editing records in the app

**My names → the name → Records.**

Each field has its own **Save** button and each save is a separate transaction — changing your
avatar and your website means two transactions and two gas fees. The Save button stays disabled
until you actually change the value, so you can't accidentally pay to write the same string back.

Failures surface as a toast. If the whole dialog shows an error instead of the fields, the read
failed — that's a network problem, not a problem with your name. Press **Try again**.

## Binding a resolver

If the dialog says *"This name has no resolver, so it can't store records yet"*, the registry has
no resolver recorded for your name and there is nowhere for records to go. Press **Set a
resolver** to bind the default one.

Names registered through the app always have a resolver bound at mint time, so you'll only see
this on a name whose resolver was removed, or one registered outside the app.

::: danger Don't write to an unbound resolver
Writing records directly to a resolver that isn't bound in the registry appears to succeed — the
transaction confirms and the resolver stores the data. But nobody resolving your name will ever
look at that contract, so the records are invisible. Bind the resolver first, then write.
:::

## Reading records

```ts
const node = namehash('alice.arc');
const resolver = await registry.read.resolver([node]);
const avatar = await resolver.read.text([node, 'avatar']);
```

Every write emits an event, so records can also be indexed from logs:

| Event | Emitted by |
| --- | --- |
| `AddrChanged(node, a)` | `setAddr` (address form) |
| `AddressChanged(node, coinType, newAddress)` | both `setAddr` forms |
| `TextChanged(node, key, value)` | `setText` — `key` is indexed |
| `ContenthashChanged(node, hash)` | `setContenthash` |
| `NameChanged(node, name)` | `setName` |

## Records are public and unverified

Two things to internalise before you fill in a profile.

**Everything is public and permanent.** Records are plaintext on a public chain. There is no
access control on reading, and overwriting a record does not erase the old value — the previous
value stays in the transaction history forever. Don't put anything in a record you wouldn't
publish.

**Nothing is verified.** The resolver stores whatever string the owner writes. A `com.twitter`
record claiming a handle is a *claim*, not proof — the protocol never checks it against X.
Treat records shown next to a name the same way you'd treat a self-reported bio.

The one exception is the reverse record, where the `verified` flag from the UniversalResolver
does prove a round-trip. See [Resolving .arc](/protocol/resolving#reverse-resolution).

## Revert reference

| Revert | Cause |
| --- | --- |
| `!auth` | You are not the registry owner of the node. If you just received the name, call `reclaim` first. |

## Next

- [Your primary name](/guide/primary-name) — making apps display your name.
- [Ownership & transfers](/guide/ownership) — reclaim, and why it matters.
- [Resolving .arc](/protocol/resolving) — reading records programmatically.
