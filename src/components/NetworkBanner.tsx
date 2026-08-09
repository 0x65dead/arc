import { AlertTriangle, CloudOff } from 'lucide-react';
import { useAccount, useSwitchChain } from 'wagmi';
import { ARC_CHAIN_ID, arcTestnet, rpcLacksCors } from '../config/chain';
import type { IndexerSyncStatus } from '../lib/indexer';
import { describeError, isRpcUnreachable, isUserRejection } from '../lib/errors';
import { useProtocolParams } from '../hooks/useProtocolParams';
import { useSyncStatus } from '../hooks/useStats';
import { useToasts } from '../hooks/useToasts';
import { Button } from './ui';

/**
 * Persistent warnings about degraded conditions.
 *
 * Two things the old UI never told anyone:
 *
 *  1. That the wallet was on the wrong network. Writes just failed with a
 *     decoded RPC error deep inside a modal.
 *  2. That the indexer was stale or down. Marketplace and stats simply
 *     rendered empty, which is indistinguishable from "nothing has happened".
 */
export function NetworkBanner() {
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const { data: sync, isError: syncFailed } = useSyncStatus();
  const { isError: rpcFailed, error: rpcError } = useProtocolParams();
  const toasts = useToasts();

  const wrongChain = isConnected && chainId !== ARC_CHAIN_ID;
  const staleIndex = sync ? !sync.healthy : false;

  // `useProtocolParams` is a plain view call issued on every page, so its
  // failure is the earliest reliable signal that the node itself is
  // unreachable. Worth its own banner: without one, an unreachable RPC looks
  // identical to a chain on which nothing has been registered.
  const rpcDown = rpcFailed && isRpcUnreachable(rpcError);

  if (!wrongChain && !syncFailed && !staleIndex && !rpcDown) return null;

  return (
    <div className="border-b border-border">
      {rpcDown ? (
        <div className="flex flex-wrap items-center justify-center gap-2 bg-negative/10 px-4 py-2.5 text-sm text-negative">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span>
            Can't reach the Arc network, so names can't be looked up.{' '}
            {rpcLacksCors
              ? 'This build has no RPC key configured and is falling back to an endpoint browsers cannot call — set VITE_ALCHEMY_API_KEY.'
              : 'Check your connection, then reload.'}
          </span>
        </div>
      ) : null}

      {wrongChain ? (
        <div className="flex flex-wrap items-center justify-center gap-3 bg-warning/10 px-4 py-2.5 text-sm text-warning">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span>Your wallet is on a different network. Transactions will fail until you switch.</span>
          <Button
            size="sm"
            variant="secondary"
            loading={isPending}
            onClick={() =>
              // `switchChain` swallows its own rejection, so without this the
              // button spins, settles, and nothing at all happens when a wallet
              // refuses — which is the normal outcome in a mobile in-app
              // browser, where programmatic switching often isn't supported.
              switchChain(
                { chainId: ARC_CHAIN_ID },
                {
                  onError: (error) => {
                    console.warn('[arc] Chain switch from banner failed', error);
                    if (isUserRejection(error)) return;
                    toasts.push('error', describeError(error));
                  },
                },
              )
            }
          >
            Switch to {arcTestnet.name}
          </Button>
        </div>
      ) : null}

      {syncFailed ? (
        <div className="flex items-center justify-center gap-2 bg-surface-raised px-4 py-2 text-xs text-ink-muted">
          <CloudOff className="size-3.5 shrink-0" aria-hidden />
          <span>
            The indexer is unreachable. Search and your own names still work — they read the chain directly —
            but marketplace, stats and activity are unavailable.
          </span>
        </div>
      ) : staleIndex && sync ? (
        <div className="flex items-center justify-center gap-2 bg-warning/10 px-4 py-2 text-xs text-warning">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          <span>{describeLag(sync)} Marketplace and activity may be out of date.</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The indexer can be unhealthy for two different reasons and they need
 * different words: it may be reading the chain but lagging behind the head, or
 * it may have stopped making progress at all. "N blocks behind" is meaningless
 * in the second case — `blocksBehind` is null precisely when the indexer can't
 * see the head either.
 */
function describeLag(sync: IndexerSyncStatus): string {
  if (sync.blocksBehind !== null) {
    return `The indexer is ${sync.blocksBehind.toLocaleString()} blocks behind.`;
  }
  if (sync.checkpointAgeSeconds !== null) {
    const minutes = Math.round(sync.checkpointAgeSeconds / 60);
    return minutes < 1
      ? 'The indexer has stopped reporting progress.'
      : `The indexer has not made progress in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
  }
  return 'The indexer has not finished its first pass.';
}
