import React from 'react';
import ReactDOM from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { queryClient, wagmiConfig } from './config/wagmi';
import { ToastProvider } from './hooks/useToasts';
import './index.css';

// The chain and query client are defined in `config/wagmi.ts`, not here. This
// file previously declared its own copy of the chain pointing at a different
// RPC host from the one every read path used.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);
