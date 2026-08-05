# Contract addresses

All addresses below are on **Arc Testnet** (chain ID `5042002`).

::: danger Every address here is a proxy
All contracts are deployed behind ERC-1967 proxies. State lives in the proxy, not the
implementation.

Calling an implementation address directly does **not** revert — it reads uninitialised storage and
returns zeros. That failure mode is silent and looks like "the name doesn't exist". Always use the
addresses on this page.
:::

## Deployment

| Field | Value |
| --- | --- |
| Network | Arc Testnet |
| Chain ID | `5042002` (`0x4cef52`) |
| TLD | `.arc` |
| Deploy block | `52346600` |
| Explorer | [testnet.arcscan.app](https://testnet.arcscan.app) |

`52346600` is the block the controller proxy was deployed at — use it as the floor for any log
scan. Scanning from genesis wastes time on blocks that cannot contain Arc Names events.

## Addresses

| Contract | Address | Role |
| --- | --- | --- |
| **Registry** | [`0xCA78696791670CbC14eE802e6DcDfD661a458978`](https://testnet.arcscan.app/address/0xCA78696791670CbC14eE802e6DcDfD661a458978) | node → owner, node → resolver |
| **Registrar** | [`0x3dC38247c4f9672B2C98aCfdc5C1302f8d897E9C`](https://testnet.arcscan.app/address/0x3dC38247c4f9672B2C98aCfdc5C1302f8d897E9C) | ERC-721 tokens and expiry |
| **Resolver** | [`0x027d6dCc8F1235dfdd47E532e77909363C701E54`](https://testnet.arcscan.app/address/0x027d6dCc8F1235dfdd47E532e77909363C701E54) | addr, text, contenthash records |
| **Controller** | [`0x2FE2560B2FE6D54e50806F531223247CcfEd739B`](https://testnet.arcscan.app/address/0x2FE2560B2FE6D54e50806F531223247CcfEd739B) | Registration, renewal, pricing |
| **Market** | [`0xC94Ff1964840BdF8E6952455a2342Ffc6B0bA299`](https://testnet.arcscan.app/address/0xC94Ff1964840BdF8E6952455a2342Ffc6B0bA299) | Listings and sales |
| **UniversalResolver** | [`0xA3F364a558eb712AFbB4929df49e538A800438BC`](https://testnet.arcscan.app/address/0xA3F364a558eb712AFbB4929df49e538A800438BC) | Forward + verified reverse lookup |
| **ReverseRegistrar** | [`0x97cdcf037c1A8475eF5C9504A18C10b41f7DfDfB`](https://testnet.arcscan.app/address/0x97cdcf037c1A8475eF5C9504A18C10b41f7DfDfB) | address → reverse node |

What each contract is responsible for, and why the split exists, is covered in
[Architecture](/protocol/architecture).

## Which contract do I call?

| I want to… | Contract | Function |
| --- | --- | --- |
| Check if a name is available | Controller | `available(string)` |
| Get a price | Controller | `price(string, uint256)` |
| Register | Controller | `commit(bytes32)` then `register(...)` |
| Renew | Controller | `renew(string, uint256)` |
| Find the resolver for a name | Registry | `resolver(bytes32)` |
| Read an address record | Resolver | `addr(bytes32)` |
| Read a text record | Resolver | `text(bytes32, string)` |
| Write a record | Resolver | `setAddr`, `setText`, … |
| Check an expiry | Registrar | `nameExpires(uint256)` |
| Transfer a name | Registrar | `transferFrom(...)` |
| Fix registry ownership after a transfer | Registrar | `reclaim(uint256, address)` |
| List for sale | Registrar then Market | `approve(...)` then `list(...)` |
| Buy | Market | `buy(uint256, uint256)` |
| Get someone's primary name | UniversalResolver | `reverse(address)` |

## Copy-paste config

```ts
export const contracts = {
  registry:          '0xCA78696791670CbC14eE802e6DcDfD661a458978',
  registrar:         '0x3dC38247c4f9672B2C98aCfdc5C1302f8d897E9C',
  resolver:          '0x027d6dCc8F1235dfdd47E532e77909363C701E54',
  controller:        '0x2FE2560B2FE6D54e50806F531223247CcfEd739B',
  market:            '0xC94Ff1964840BdF8E6952455a2342Ffc6B0bA299',
  universalResolver: '0xA3F364a558eb712AFbB4929df49e538A800438BC',
  reverseRegistrar:  '0x97cdcf037c1A8475eF5C9504A18C10b41f7DfDfB',
} as const;

export const ARC_CHAIN_ID = 5042002;
export const DEPLOY_BLOCK = 52346600n;
export const TLD = 'arc';

/** Native gas token decimals. NOT 6 — see /protocol/fees. */
export const NATIVE_DECIMALS = 18;
/** ERC-20 USDC decimals, for the alternative payment path. */
export const USDC_ERC20_DECIMALS = 6;
```

## Overriding for a different deployment

The Arc Names app reads every address from the environment, falling back to the values above, so a
fresh deployment needs no code change:

```bash
VITE_REGISTRY_ADDRESS=0x…
VITE_REGISTRAR_ADDRESS=0x…
VITE_RESOLVER_ADDRESS=0x…
VITE_CONTROLLER_ADDRESS=0x…
VITE_MARKET_ADDRESS=0x…
VITE_UNIVERSAL_RESOLVER_ADDRESS=0x…
VITE_REVERSE_REGISTRAR_ADDRESS=0x…
```

Malformed overrides are ignored with a console warning rather than crashing the app.

## Constants

Fixed in contract code and not owner-changeable:

| Constant | Value | Contract |
| --- | --- | --- |
| `GRACE` | 90 days | Registrar |
| `MIN_DURATION` | 28 days | Controller |
| `MAX_DURATION` | 36,500 days (100 years) | Controller |
| Pricing denominator | 365 days | Controller |

Everything else — prices, `minLen`, commit ages, fees, referral rates — is owner-configurable. See
[Architecture → owner-controlled parameters](/protocol/architecture#owner-controlled-parameters).

## Verifying an address

Before trusting any address from any source, including this page:

1. Look it up on [testnet.arcscan.app](https://testnet.arcscan.app) and confirm it's a contract
   with the transaction history you'd expect.
2. Cross-check against the app's own config, served from the site you trust.
3. Confirm you're on chain ID `5042002`.

::: danger Never take a contract address from a DM
Fake addresses that mimic these are the most common phishing vector in any naming service. A
contract that looks like the registrar but isn't will happily take your money. See
[Safety](/safety#verifying-contract-addresses).
:::

## Next

- [Architecture](/protocol/architecture) — how the contracts fit together.
- [Resolving .arc](/protocol/resolving) — reading from them.
- [API endpoints](/api/endpoints) — the HTTP alternative.
