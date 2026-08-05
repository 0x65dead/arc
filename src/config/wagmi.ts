import { QueryClient } from '@tanstack/react-query';
import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { arcTestnet, rpcUrl } from './chain';

/**
 * wagmi + react-query setup.
 *
 * The chain object is imported from `./chain` rather than redeclared here. The
 * old `main.tsx` declared its own copy pointing at `rpc.testnet.arc.io` while
 * every direct provider in `App.tsx` used `rpc.testnet.arc.network` — so wallet
 * writes and UI reads were talking to two different endpoints. `useChainGuard`
 * depends on Arc Testnet appearing in `chains` below; because both come from
 * the same definition, they cannot drift apart again.
 */
export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  connectors: [injected()],
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
