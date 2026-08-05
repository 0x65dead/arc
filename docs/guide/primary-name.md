# Your primary name

A primary name is what apps display **instead of your address**. Setting it turns
`0x3dC38247c4f9672B2C98aCfdc5C1302f8d897E9C` into `alice.arc` everywhere your wallet appears.

## Forward and reverse are separate

Registering `alice.arc` makes the name point at your address. It does **not** make your address
point back at the name. Those are two different records in two different places:

```
  forward:  alice.arc  ──►  0x3dC3…7E9C     set at registration
  reverse:  0x3dC3…7E9C ──►  alice.arc      you must set this
```

The forward record is the one that matters for receiving funds. The reverse record is purely
cosmetic — it controls how you are *displayed*. Everything keeps working without it.

This separation is deliberate. One address may be the target of many names, but it can only have
one display name, and only the address's owner should get to choose which.

## Setting it

**My names → the name → Records → Use as primary name.** One transaction.

Under the hood this writes a `name` text record on your address's reverse node, via the reverse
registrar. The button is disabled once the name is already your primary.

You can only set a primary name to a name that resolves to you — otherwise the verification below
fails and apps will ignore it.

## Verification, and why it matters

Anyone can write anything into their own reverse record. Nothing stops an attacker from setting
theirs to `vitalik.arc`. A reverse record on its own is a **claim**, not proof.

Proof is the round-trip:

```
  0xATTACKER ──reverse──► "vitalik.arc" ──forward──► 0xVITALIK
                                                         │
                                        0xVITALIK ≠ 0xATTACKER  →  unverified
```

The UniversalResolver does this check for you and returns the result alongside the name:

```solidity
(string memory name, bool verified) = universalResolver.reverse(addr);
```

::: danger Integrators: never display an unverified name
If `verified` is false, show the raw address. A reverse name that doesn't round-trip is an
impersonation vector, and displaying it is how users get phished.

The Arc Names app only renders a primary name when `verified` is true.
:::

## When your primary name stops verifying

The round-trip breaks if the forward record changes. Common causes:

| What happened | Fix |
| --- | --- |
| You changed the name's `addr` record to a different wallet | Point it back, or set a different primary name. |
| You transferred the name away | Set a primary name you still own. |
| The name expired | [Renew it](/guide/renewals). Expired names don't resolve. |
| You moved wallets | Set the reverse record from the new wallet, and point the name at it. |

When this happens apps fall back to showing your address. Nothing is lost, and nothing is at risk
— the display just reverts.

## Changing or clearing it

Setting a different name overwrites the record — there's no need to clear the old one first. To
remove the primary name entirely, set the reverse record to an empty string.

## One name, many wallets

A single name can be the primary name of only one address at a time, because the record lives on
the address, not the name. If you want `alice.arc` to display for two wallets, only one of them
can round-trip successfully, since `addr` holds a single address.

For multiple wallets, register a name each — or point subdomain-style names at each wallet.

## Reading it programmatically

```ts
const [name, verified] = await client.readContract({
  address: UNIVERSAL_RESOLVER,
  abi: UNIVERSAL_RESOLVER_ABI,
  functionName: 'reverse',
  args: [userAddress],
});

const display = verified ? name : shortenAddress(userAddress);
```

The manual path — deriving the reverse node yourself and verifying by hand — is documented in
[Resolving .arc](/protocol/resolving#reverse-resolution).

## Next

- [Records & profile](/guide/records) — the rest of your profile.
- [Resolving .arc](/protocol/resolving) — the resolution algorithm in full.
- [Safety](/safety#look-alike-names) — impersonation and how to spot it.
