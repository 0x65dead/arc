import React from 'react';
import ReactDOM from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import App from './App';
import { WaitlistPage } from './components/WaitlistPage';
import { isWaitlistSite } from './lib/site';
import { arcTestnet } from './config/chain';
import { queryClient, wagmiConfig } from './config/wagmi';
import { ToastProvider } from './hooks/useToasts';
// RainbowKit's stylesheet ships a reset, so it goes above `./index.css` —
// loaded after, that reset would land on top of the design tokens instead.
import '@rainbow-me/rainbowkit/styles.css';
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

/**
 * RainbowKit's palette mirrors the `@theme` tokens in `index.css` rather than
 * its own defaults, so the modal reads as part of this app. `borderRadius` is
 * `medium` because RainbowKit's `large` is 16px while every button here is
 * `rounded-lg` (8px) — `large` made the modal's controls visibly rounder than
 * the ones behind it.
 */
const rainbowKitTheme = darkTheme({
  accentColor: '#4f8cff', // --color-accent
  accentColorForeground: '#0a1024', // --color-accent-ink
  borderRadius: 'medium',
  overlayBlur: 'small',
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={rainbowKitTheme}
          modalSize="compact"
          initialChain={arcTestnet}
          appInfo={{ appName: 'Arc Names' }}
        >
          <ToastProvider>
            <Root />
          </ToastProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);
