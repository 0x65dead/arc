import React from 'react';
import ReactDOM from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { WaitlistPage } from './components/WaitlistPage';
import { isWaitlistSite } from './lib/site';
import { queryClient, wagmiConfig } from './config/wagmi';
import { ToastProvider } from './hooks/useToasts';
import './index.css';

// The chain and query client are defined in `config/wagmi.ts`, not here. This
// file previously declared its own copy of the chain pointing at a different
// RPC host from the one every read path used.

/**
 * Which of the two sites to mount.
 *
 * The split is here rather than inside `App` so that neither shell's hooks are
 * conditional — an early return in `App` would sit above its `useEffect` and
 * break rules-of-hooks even though the host cannot change mid-session. The
 * providers are shared because both shells need a wallet and a query client.
 */
const Root = isWaitlistSite ? WaitlistPage : App;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <Root />
        </ToastProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);
