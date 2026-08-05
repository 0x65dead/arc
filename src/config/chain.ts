import { defineChain } from 'viem';

/**
 * Single source of truth for the network.
 *
 * The old code declared the chain twice — once in `main.tsx` (pointing at
 * `rpc.testnet.arc.io`) and once in `types.ts` as `NETWORK_INFO` (which also
 * claimed `currencySymbol: 'ARC'` while the wagmi config said USDC). Every
 * on-chain read then built its own `JsonRpcProvider('https://rpc.testnet.arc.network')`
 * inline, so a third host was in play. All three are unified here.
 *
 * Both hosts answer `eth_chainId` with 0x4cef52, so they're interchangeable.
 * The endpoint is now resolved from the environment (see `resolveRpcUrl`)
 * because the public `.network` host sends no CORS headers and so cannot be
 * used from a browser at all.
 */
export const ARC_CHAIN_ID = 5042002;

/**
 * Arc's own public endpoint. Correct, but unusable from a browser: it answers
 * `eth_chainId` fine over curl while returning no `Access-Control-Allow-Origin`
 * header and a 400 on the CORS preflight. Every read therefore failed with
 * `net::ERR_FAILED` before the request left the tab, which surfaced as search
 * returning nothing, prices rendering as "—" and records claiming a name had no
 * resolver. Kept only as a last-resort fallback so a misconfigured build still
 * has somewhere to point.
 */
const PUBLIC_RPC_URL = 'https://rpc.testnet.arc.network';

const ALCHEMY_BASE_URL = 'https://arc-testnet.g.alchemy.com/v2';

function resolveRpcUrl(): string {
  // An explicit full URL wins — that's the escape hatch for a self-hosted node
  // or a CORS-enabled proxy.
  const explicit = import.meta.env.VITE_ARC_RPC_URL?.trim();
  if (explicit) return explicit;

  const alchemyKey = import.meta.env.VITE_ALCHEMY_API_KEY?.trim();
  if (alchemyKey) return `${ALCHEMY_BASE_URL}/${alchemyKey}`;

  console.warn(
    '[arc] No VITE_ALCHEMY_API_KEY or VITE_ARC_RPC_URL set — falling back to ' +
      `${PUBLIC_RPC_URL}, which does not send CORS headers. Every read will fail ` +
      'in the browser. Copy .env.example to .env and add a key.',
  );
  return PUBLIC_RPC_URL;
}

export const rpcUrl = resolveRpcUrl();

/**
 * True when the app is pointed at the endpoint that cannot answer a browser.
 * The UI uses this to explain the failure instead of showing empty results.
 */
export const rpcLacksCors = rpcUrl === PUBLIC_RPC_URL;

/**
 * Arc Testnet's gas token is USDC, but as a *native* coin with 18 decimals —
 * not the 6-decimal ERC-20. This matters everywhere a price is formatted:
 * `ArcController.price()` returns an 18-decimal value, and `priceUSDC()`
 * divides it by 1e12 to reach the 6-decimal ERC-20 scale. Mixing the two up
 * is a 1e12 error, so `NATIVE_DECIMALS` is referenced explicitly rather than
 * relying on viem's `formatEther` default.
 */
export const NATIVE_DECIMALS = 18;
export const USDC_ERC20_DECIMALS = 6;

export const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { decimals: NATIVE_DECIMALS, name: 'USDC', symbol: 'USDC' },
  rpcUrls: {
    default: { http: [rpcUrl] },
  },
  blockExplorers: {
    default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' },
  },
  testnet: true,
});

export function explorerTxUrl(hash: string): string {
  return `${arcTestnet.blockExplorers.default.url}/tx/${hash}`;
}

export function explorerAddressUrl(address: string): string {
  return `${arcTestnet.blockExplorers.default.url}/address/${address}`;
}

export function explorerTokenUrl(address: string, tokenId: string): string {
  return `${arcTestnet.blockExplorers.default.url}/token/${address}/instance/${tokenId}`;
}
