import type { Address } from 'viem';

/**
 * Deployment addresses, verified against
 * `broadcast/DeployArc.s.sol/5042002/run-1784330782333.json`.
 *
 * Every value is the ERC1967 *proxy* where one exists — the implementation
 * addresses in that broadcast file (e.g. ArcControllerU at 0x0c29fd7d…) must
 * never be called directly, since all state lives behind the proxy.
 *
 * Overridable via env so a fresh deployment doesn't require a code change.
 * No contracts are deployed by this app; these are read-only pointers.
 */
function envAddress(value: string | undefined, fallback: Address): Address {
  if (!value) return fallback;
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    console.warn(`[arc] ignoring malformed address override "${value}"`);
    return fallback;
  }
  return value as Address;
}

export const contracts = {
  registry: envAddress(
    import.meta.env.VITE_REGISTRY_ADDRESS,
    '0xCA78696791670CbC14eE802e6DcDfD661a458978',
  ),
  registrar: envAddress(
    import.meta.env.VITE_REGISTRAR_ADDRESS,
    '0x3dC38247c4f9672B2C98aCfdc5C1302f8d897E9C',
  ),
  resolver: envAddress(
    import.meta.env.VITE_RESOLVER_ADDRESS,
    '0x027d6dCc8F1235dfdd47E532e77909363C701E54',
  ),
  controller: envAddress(
    import.meta.env.VITE_CONTROLLER_ADDRESS,
    '0x2FE2560B2FE6D54e50806F531223247CcfEd739B',
  ),
  market: envAddress(
    import.meta.env.VITE_MARKET_ADDRESS,
    '0xC94Ff1964840BdF8E6952455a2342Ffc6B0bA299',
  ),
  universalResolver: envAddress(
    import.meta.env.VITE_UNIVERSAL_RESOLVER_ADDRESS,
    '0xA3F364a558eb712AFbB4929df49e538A800438BC',
  ),
  reverseRegistrar: envAddress(
    import.meta.env.VITE_REVERSE_REGISTRAR_ADDRESS,
    '0x97cdcf037c1A8475eF5C9504A18C10b41f7DfDfB',
  ),
} as const;

/** Block the controller proxy was deployed at — the floor for any log scan. */
export const DEPLOY_BLOCK = 52346600n;

/** The parent node every `.arc` name hangs off. */
export const TLD = 'arc';

/**
 * `ArcRegistrarU.GRACE` — 90 days. A name stays un-registerable for this long
 * after expiry (`available(id)` is `expiries[id] + GRACE < block.timestamp`),
 * and `renew` is still permitted during it. The old indexer's availability
 * check ignored this entirely and reported an expired name as free the second
 * its expiry passed, which is 90 days early.
 */
export const GRACE_PERIOD_SECONDS = 90 * 24 * 60 * 60;

/** `ArcController.MIN_DURATION` / `MAX_DURATION`. */
export const MIN_DURATION_SECONDS = 28 * 24 * 60 * 60;
export const MAX_DURATION_SECONDS = 36500 * 24 * 60 * 60;

/** One year, matching the contract's `365 days` pricing denominator exactly. */
export const YEAR_SECONDS = 365 * 24 * 60 * 60;
