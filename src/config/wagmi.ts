import { QueryClient } from '@tanstack/react-query';
import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
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

const rawProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();

/*
 * `.env.example` ships the key with a `YOUR_PROJECT_ID_HERE` placeholder, in
 * keeping with how the RPC key is documented there. Copying that file verbatim
 * is the expected first step, so a bare truthiness check would take the
 * placeholder for a real ID and offer four relay-backed wallets that all fail
 * at connect time — the precise failure the fallback below exists to avoid.
 * Real IDs are 32-character hex strings, so anything containing the template's
 * uppercase-underscore shape is treated as unset.
 */
const projectId =
  rawProjectId && !/^YOUR_.*_HERE$/i.test(rawProjectId) ? rawProjectId : undefined;

/**
 * The wallet list degrades honestly without a WalletConnect project ID.
 *
 * Every wallet here except the injected entry reaches the user through the
 * WalletConnect relay, which refuses connections without a project ID. Listing
 * them regardless would show five wallets, four of which fail at connect time
 * with an opaque relay error. Offering only the injected wallet is exactly the
 * behaviour this app had before RainbowKit, so a checkout with no `.env` still
 * works — it just can't reach phones.
 */
const connectors = projectId
  ? connectorsForWallets(
      [
        {
          groupName: 'Recommended',
          wallets: [
            injectedWallet,
            metaMaskWallet,
            rainbowWallet,
            coinbaseWallet,
            walletConnectWallet,
          ],
        },
      ],
      { appName: APP_NAME, projectId },
    )
  : connectorsForWallets([{ groupName: 'Installed', wallets: [injectedWallet] }], {
      appName: APP_NAME,
      // Unused — no wallet in the list above talks to the relay. A placeholder
      // satisfies the signature without implying a real ID exists.
      projectId: 'missing-project-id',
    });

export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  connectors,
  // RainbowKit's `injectedWallet` already enumerates EIP-6963 providers, so
  // leaving wagmi's own discovery on registers each installed extension a
  // second time and the modal lists every wallet twice.
  multiInjectedProviderDiscovery: false,
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
