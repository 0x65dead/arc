# Resolving .arc

This is the integrator's page. It covers how a `.arc` name becomes an address, how an address
becomes a name, and the exact contract calls involved in each direction.

If you have implemented ENS resolution before, the algorithm is identical.

## The two directions

**Forward resolution** answers *"what address is `alice.arc`?"* — the common case, used whenever
someone types a name into a send field.

**Reverse resolution** answers *"what name belongs to `0x3dC3…`?"* — used to display a name where
an address would otherwise appear. See [Your primary name](/guide/primary-name).

They are separate systems with separate storage. A name resolving to an address does **not** imply
the address resolves back to that name.

## Namehash

Every name is identified on-chain by a `bytes32` **node**, computed recursively from the labels.
The empty root is 32 zero bytes; each label is hashed onto its parent:

```
namehash("")         = 0x0000…0000
namehash("arc")      = keccak256(namehash("") ++ keccak256("arc"))
namehash("alice.arc")= keccak256(namehash("arc") ++ keccak256("alice"))
```

Since every name here is a direct child of `.arc`, the practical form is:

```solidity
bytes32 label = keccak256(bytes("alice"));
bytes32 node  = keccak256(abi.encodePacked(baseNode, label));
```

where `baseNode` is `namehash("arc")`.

::: tip Three different hashes, easily confused
- **labelhash** — `keccak256(bytes("alice"))`. Just the label.
- **namehash / node** — the recursive hash above. Identifies the name in the registry and resolver.
- **token ID** — `uint256(labelhash)`. The ERC-721 ID in the registrar.

The registry and resolver speak *node*. The registrar and marketplace speak *token ID*. Passing
one where the other is expected fails silently by reading empty storage, not with a revert.
:::

In viem:

```ts
import { keccak256, toHex, encodePacked, namehash, labelhash } from 'viem';

const node    = namehash('alice.arc');
const label   = labelhash('alice');
const tokenId = BigInt(label);
```

## Forward resolution

Two calls. The registry tells you *who answers*; the resolver gives you *the answer*.

```
alice.arc
   │  namehash
   ▼
 node ──► Registry.resolver(node) ──► resolver address
                                          │
                                          ▼
                              Resolver.addr(node) ──► 0x…
```

### Step 1 — find the resolver

```solidity
address resolver = registry.resolver(node);
```

If this returns the zero address the name has **no resolver bound** and resolution stops. This is
not the same as "the name is unregistered" and not the same as "the name has no address" — it
means nothing is configured to answer questions about it. Treat it as unresolvable, and do not
fall back to a default resolver: records written to a resolver that isn't bound are invisible to
everyone else.

Names registered through the Arc Names controller always have a resolver bound at mint time, so in
practice you'll only hit the zero address on names whose resolver was later removed.

### Step 2 — read the record

```solidity
address a = IResolver(resolver).addr(node);
string memory v = IResolver(resolver).text(node, "avatar");
bytes memory h = IResolver(resolver).contenthash(node);
```

A resolver that returns the zero address for `addr` means the record is unset. Do not send funds
to it.

### Complete example (viem)

```ts
import { createPublicClient, http, namehash, zeroAddress } from 'viem';
import { arcTestnet } from './chain';

const client = createPublicClient({ chain: arcTestnet, transport: http(RPC_URL) });

const REGISTRY_ABI = [
  { name: 'resolver', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }] },
] as const;

const RESOLVER_ABI = [
  { name: 'addr', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }] },
  { name: 'text', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'key', type: 'string' }],
    outputs: [{ type: 'string' }] },
] as const;

export async function resolveArc(name: string) {
  const node = namehash(name);

  const resolver = await client.readContract({
    address: REGISTRY, abi: REGISTRY_ABI, functionName: 'resolver', args: [node],
  });
  if (resolver === zeroAddress) return null;      // no resolver bound

  const address = await client.readContract({
    address: resolver, abi: RESOLVER_ABI, functionName: 'addr', args: [node],
  });
  return address === zeroAddress ? null : address; // record unset
}
```

::: warning Check expiry before you trust a resolution
Resolution does not check whether the name is still registered. A resolver keeps returning the old
address after the name expires, until the record is overwritten by whoever registers it next.

Before acting on a resolution for anything consequential, confirm the name is live:
`registrar.nameExpires(tokenId) > block.timestamp`. Note that `registrar.ownerOf(id)` reverts with
`expired` past the expiry, so it cannot be used as a liveness probe without a try/catch.
:::

## Reverse resolution

The reverse direction maps an address to a name. Two ways to do it.

### The easy way — UniversalResolver

```solidity
(string memory name, bool verified) = universalResolver.reverse(addr);
```

This returns both the claimed name and a **`verified`** flag. The flag is the important part: it
is true only when the name resolves *forward* back to the same address.

::: danger Never display an unverified reverse name
Anyone can set their reverse record to any string. `attacker.arc` can claim to be `vitalik.arc`.
Only the round-trip proves it:

```
address ──reverse──► name ──forward──► address'
                                          │
                            verified ⟺ address' == address
```

If `verified` is false, display the raw address. The Arc Names app enforces this — it only shows a
primary name when the round-trip succeeds.
:::

### The manual way

The reverse registrar derives a node from the address, under which the name is stored as a text
record:

```solidity
bytes32 rnode = reverseRegistrar.node(addr);
address rres  = registry.resolver(rnode);
string memory claimed = IResolver(rres).name(rnode);
```

Then verify it yourself by forward-resolving `claimed` and comparing.

## Availability

"Available" is not "unowned". Three states:

| State | Condition |
| --- | --- |
| **Registered** | `expiries[id] > now` |
| **In grace** | `expiries[id] <= now` and `expiries[id] + 90 days >= now` |
| **Available** | `expiries[id] + 90 days < now` |

The on-chain source of truth is one call:

```solidity
registrar.available(uint256(labelhash))
  // == expiries[id] + GRACE < block.timestamp
```

`GRACE` is a hard constant of **90 days** in the registrar. A name that has passed its expiry is
*not* registerable for those 90 days — its previous owner can still renew it. Any availability
check that only compares against the expiry reports expired names as free three months early.

The controller wraps this with the validity check:

```solidity
controller.available(name)  // valid(name) && registrar.available(id)
```

Use the controller's version when the answer feeds a "can I register this?" decision, since it also
rejects names that are unregisterable for being invalid.

## Caching

Resolution results change whenever the owner writes a record — there is no TTL to obey and no
invalidation signal. If you cache, keep it short and re-read before anything irreversible. For a
payment flow, always re-resolve immediately before constructing the transaction.

## Doing it without a node

If you'd rather not run resolution yourself, the indexer exposes the same information over HTTP:

- `GET /api/v1/availability?name=alice` — the three-state answer above.
- `GET /api/v1/domains/alice` — owner, expiry, token ID, listing.

See [API endpoints](/api/endpoints). The API is a convenience layer over the chain, not an
authority — for anything that moves value, read the contracts.

## Next

- [Architecture](/protocol/architecture) — what each contract is responsible for.
- [Contract addresses](/protocol/contracts) — deployed addresses and ABIs.
- [Your primary name](/guide/primary-name) — the user-facing side of reverse records.
