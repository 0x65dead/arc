# Glossary

Terms used throughout these docs, in alphabetical order.

### Approval

ERC-721 permission letting another address transfer your token. `approve` grants it for one token;
`setApprovalForAll` grants it for **every** token you hold and will hold, until revoked. Required
to [list a name for sale](/guide/marketplace). See
[Safety → approvals](/safety#approvals).

### Available

A name that can be registered right now. Formally `expiries[id] + 90 days < now`. Distinct from
"unowned" — an expired name is not available until its grace period ends. See
[Renewals & expiry](/guide/renewals).

### Basis point (bps)

One hundredth of a percent. 10000 bps = 100%. Used for fees and referral rates — `feeBps` of 250
is 2.5%.

### Commit-reveal

The two-transaction registration scheme that prevents front-running. A hash is committed first,
then the name is revealed after a minimum delay. See
[Registering a name](/guide/registering#why-two-transactions).

### Commitment

The hash submitted in the first registration transaction:
`keccak256(abi.encode(labelhash, owner, secret))`. Reveals nothing about the name.

### Contenthash

A record pointing a name at content on a distributed store such as IPFS.

### Controller

The contract users call to register and renew. Owns pricing, commit-reveal and payment. On the
registrar's allowlist. See [Architecture](/protocol/architecture#controller).

### Expiry

The timestamp at which a registration lapses. After it, the name stops working immediately but
remains renewable for 90 days. Read with `registrar.nameExpires(tokenId)`.

### Forward resolution

Name → address. The common direction, used when sending to `alice.arc`. See
[Resolving .arc](/protocol/resolving#forward-resolution).

### Grace period

The 90 days after expiry during which only the previous owner can renew, and nobody can register.
A hard constant — not owner-configurable. See [Renewals & expiry](/guide/renewals).

### Indexer

The off-chain service that watches contract events and serves [a REST API](/api/endpoints). A
convenience layer, not an authority — it lags the chain and can fail.

### Label

The part of the name before the TLD. In `alice.arc`, the label is `alice`. Prices, token IDs and
API parameters all use the label, not the full name.

### Labelhash

`keccak256(bytes(label))`. The token ID is this value cast to `uint256`. Distinct from
[namehash](#namehash). See [Resolving .arc](/protocol/resolving#namehash).

### Namehash

The recursive hash identifying a name in the registry and resolver:
`keccak256(namehash(parent) ++ labelhash(label))`. Also called the **node**.

### Node

See [namehash](#namehash). The registry and resolver are keyed by node; the registrar and market
are keyed by token ID. Confusing the two reads empty storage rather than reverting.

### Primary name

The name displayed in place of your address. Set via a reverse record, and only trustworthy when
it round-trips. See [Your primary name](/guide/primary-name).

### Proxy (ERC-1967 / UUPS)

The upgradeable deployment pattern used by every Arc Names contract. State lives in the proxy;
logic lives in a separate implementation. **Always call the proxy** — calling an implementation
returns zeros without reverting.

### Reclaim

`registrar.reclaim(tokenId, owner)`, which syncs registry ownership to match token ownership.
Required after a transfer before the new owner can write records. See
[Ownership & transfers](/guide/ownership#reclaiming-after-a-transfer).

### Referral

Optional attribution on registration or purchase. A referrer can earn a reward and the buyer can
get a discount, both in basis points, both defaulting to zero. See
[Fees → referral economics](/protocol/fees#referral-economics).

### Registrar

The ERC-721 contract holding name tokens, expiries and labels. Owns the `.arc` node in the
registry. Only controllers may call its `register` and `renew`.

### Registry

The root contract mapping each node to its owner and its resolver. Record writes are authorised
against ownership recorded here.

### Registry owner

The address recorded in the registry for a node — this is who may write records. Distinct from the
**token owner**, and they diverge after a transfer until `reclaim` is called.

### Resolver

The contract storing records for a name. Pluggable per name via the registry. Records live in
whichever resolver holds them, so writing to an unbound resolver is invisible to everyone.

### Reverse record

The mapping from an address back to a name, stored on the address's reverse node. A claim, not
proof, until verified. See [Reverse resolution](/protocol/resolving#reverse-resolution).

### Secret

The random 32 bytes used to build a commitment, held in browser storage between the two
registration transactions. Losing it costs the commit gas and forces a restart.

### Token ID

`uint256(labelhash)`. The ERC-721 identifier. Deterministic from the label.

### Token owner

The holder of the ERC-721 token — who may transfer, sell and renew. Distinct from the
[registry owner](#registry-owner).

### TLD

Top-level domain. Here, `arc`.

### USDC (native vs ERC-20)

Arc's gas token is USDC with **18 decimals**. There is also a 6-decimal ERC-20 USDC used as an
alternative payment path. Confusing them is a factor-of-a-trillion error. See
[Fees → two kinds of USDC](/protocol/fees#two-kinds-of-usdc).

### Verified (reverse resolution)

The flag returned by `universalResolver.reverse()` indicating the name forward-resolves back to the
same address. **Never display an unverified reverse name.**

### Wei

The smallest unit of the native token. 1 token = 1e18 wei. Every `*Wei` field in the API is
18-decimal native wei.
