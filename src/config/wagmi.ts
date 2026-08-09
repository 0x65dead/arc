import { QueryClient } from '@tanstack/react-query';
import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import type { WalletList } from '@rainbow-me/rainbowkit';
import {
  base,
  bitgetWallet,
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  okxWallet,
  rabbyWallet,
  rainbowWallet,
  safeWallet,
  trustWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { createConfig, http } from 'wagmi';
import { arcTestnet, rpcUrl } from './chain';

/**
 * wagmi + RainbowKit + react-query setup.
 *
 * The chain object is imported from `./chain` rather than redeclared here. The
 * old `main.tsx` declared its own copy pointing at `rpc.testnet.arc.io` while
 * every direct provider in `App.tsx` used `rpc.testnet.arc.network` — so wallet
 * writes and UI reads were talking to two different endpoints. `useChainGuard`
 * depends on Arc Testnet appearing in `chains` below; because both come from
 * the same definition, they cannot drift apart again.
 */

const APP_NAME = 'Arc Names';
const APP_ICON =
  typeof window !== 'undefined' ? `${window.location.origin}/logo.png` : undefined;

const rawProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();

/*
 * `.env.example` ships the key with a `YOUR_PROJECT_ID_HERE` placeholder, in
 * keeping with how the RPC key is documented there. Copying that file verbatim
 * is the expected first step, so a bare truthiness check would take the
 * placeholder for a real ID and offer relay-backed wallets that all fail at
 * connect time — the precise failure the fallback below exists to avoid.
 * Real IDs are 32-character hex strings, so anything containing the template's
 * uppercase-underscore shape is treated as unset.
 */
export const walletConnectProjectId =
  rawProjectId && !/^YOUR_.*_HERE$/i.test(rawProjectId) ? rawProjectId : undefined;

/**
 * Popular wallets, shown first in the connect modal.
 *
 * This is RainbowKit's own default group — `safeWallet, rainbowWallet, base,
 * metaMaskWallet, walletConnectWallet` — kept in that order deliberately. Safe
 * reports `installed: false` unless the app is running inside a Safe's iframe,
 * so it costs a slot only in the one case where it is the only wallet that can
 * work. The rest are what the connect modal should lead with.
 */
const POPULAR_WALLETS: WalletList[number]['wallets'] = [
  safeWallet,
  rainbowWallet,
  base,
  metaMaskWallet,
  walletConnectWallet,
];

/**
 * `injectedWallet`, hidden when there is nothing for it to connect to.
 *
 * RainbowKit's own entry is always `ready` — it declares no `installed` field,
 * and `ready` defaults to true — so on a browser with no wallet at all it still
 * offers "Browser Wallet", which then fails. `hidden` is RainbowKit's sanctioned
 * hook for this (`connectorsForWallets` skips any wallet whose `hidden()`
 * returns true), and the test is the honest one: is there a provider on
 * `window` for it to talk to.
 *
 * It cannot simply be dropped on desktop, tempting as that is — it carries no
 * `rdns`, so unlike every other wallet here it is never deduped against the
 * EIP-6963 "Installed" group and does look redundant beside it. But it is the
 * only entry that can reach an extension which does not announce itself over
 * EIP-6963, and on mobile it is the only route to an in-app browser's provider,
 * because RainbowKit drops every EIP-6963 connector from the mobile list.
 */
// `injectedWallet` takes no options — it has nothing to configure.
const browserWallet: WalletList[number]['wallets'][number] = () => ({
  ...injectedWallet(),
  hidden: () =>
    typeof window === 'undefined' ||
    (window as { ethereum?: unknown }).ethereum === undefined,
});

/**
 * Everything else worth naming, plus the generic fallback.
 *
 * `walletConnectWallet` in the Popular group is what covers "other
 * WalletConnect-compatible wallets" — it registers a second connector with
 * `showQrModal: true`, so picking it hands off to WalletConnect's own wallet
 * browser rather than showing a bare QR code.
 */
const MORE_WALLETS: WalletList[number]['wallets'] = [
  coinbaseWallet,
  rabbyWallet,
  okxWallet,
  bitgetWallet,
  trustWallet,
  browserWallet,
];

/**
 * Drops the wallets that cannot be constructed without a WalletConnect project
 * ID, instead of dropping every wallet but one.
 *
 * `getWalletConnectConnector` throws synchronously when `projectId` is empty,
 * and it is called while `connectorsForWallets` is building the list — so a
 * single relay-backed wallet in the list takes the whole module down with it at
 * import time. The previous fallback avoided that by offering nothing but
 * `injectedWallet`, which is why the modal read "Browser Wallet" and nothing
 * else. But several wallets never touch the relay: Coinbase and Base ship their
 * own SDKs, Rabby is injected-only, Safe talks to its iframe host, and MetaMask
 * uses the MetaMask SDK whenever it is injected or the browser is mobile.
 *
 * Rather than hardcode that list — which would silently rot the next time
 * RainbowKit changes a connector's strategy — each factory is invoked once and
 * kept only if it survives. The factories are pure: they read `window.ethereum`
 * and return an object literal whose `createConnector` and `iconUrl` are both
 * lazy, so probing them has no side effects and creates no connectors.
 *
 * This is detection, not spoofing: a wallet is dropped only when it has
 * genuinely refused to build, and nothing is ever reported as installed on the
 * strength of it.
 */
function relayFreeWallets(wallets: WalletList[number]['wallets']) {
  return wallets.filter((createWallet) => {
    try {
      createWallet({
        projectId: '',
        appName: APP_NAME,
        appIcon: APP_ICON,
        options: { metadata: { name: APP_NAME, description: APP_NAME, url: '', icons: [] } },
        walletConnectParameters: {
          metadata: { name: APP_NAME, description: APP_NAME, url: '', icons: [] },
        },
      });
      return true;
    } catch {
      return false;
    }
  });
}

function buildWalletList(): WalletList {
  if (walletConnectProjectId) {
    return [
      { groupName: 'Popular', wallets: POPULAR_WALLETS },
      { groupName: 'More', wallets: MORE_WALLETS },
    ];
  }

  const popular = relayFreeWallets(POPULAR_WALLETS);
  const more = relayFreeWallets(MORE_WALLETS);

  console.warn(
    '[arc] VITE_WALLETCONNECT_PROJECT_ID is not set. WalletConnect, Rainbow, ' +
      'OKX, Bitget and Trust need the WalletConnect relay and have been hidden — ' +
      'there is no way to reach a phone wallet from a desktop browser without ' +
      'them. Get a free project ID from https://cloud.reown.com and copy ' +
      '.env.example to .env.',
  );

  // `connectorsForWallets` rejects an empty group, and a group can empty out —
  // on a desktop with no extension at all, every Popular wallet needs the relay.
  return [
    { groupName: 'Popular', wallets: popular },
    { groupName: 'More', wallets: more },
  ].filter((group) => group.wallets.length > 0);
}

const connectors = connectorsForWallets(buildWalletList(), {
  appName: APP_NAME,
  appDescription: 'Your identity on Arc',
  appIcon: APP_ICON,
  // Only ever read by the relay-backed connectors, which are excluded from the
  // list above whenever this is undefined.
  projectId: walletConnectProjectId ?? '',
});

export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  connectors,
  /*
   * EIP-6963 discovery stays on — this is wagmi's default and RainbowKit
   * depends on it for the "Installed" group.
   *
   * It was previously disabled on the theory that `injectedWallet` already
   * enumerates EIP-6963 providers. It does not: `injectedWallet` is a single
   * generic entry hardcoded to the name "Browser Wallet", whose connector
   * resolves `window.ethereum.providers[0] ?? window.ethereum`. RainbowKit
   * reads wagmi's announced providers separately (`useWalletConnectors`), lists
   * each under "Installed" with the extension's real name and icon, and drops
   * the matching entry from our list by `rdns` — so turning discovery on adds
   * detection without duplicating anything.
   */
  multiInjectedProviderDiscovery: true,
  transports: {
    [arcTestnet.id]: http(rpcUrl, {
      // Arc's public RPC rate-limits bursts; batching collapses the reads a
      // single view fires (price + availability + owner + expiry) into one
      // request instead of four.
      batch: { wait: 16 },
      retryCount: 2,
      retryDelay: 300,
    }),
  },
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Chain data is only as fresh as the next block; refetching on every
      // window focus produced a burst of RPC traffic for no new information.
      refetchOnWindowFocus: false,
      staleTime: 15_000,
      gcTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
