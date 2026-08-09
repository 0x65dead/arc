import { useCallback } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { ARC_CHAIN_ID } from '../config/chain';
import { WrongChainError, isUserRejection } from '../lib/errors';

/**
 * Guarantees the wallet is on Arc Testnet before a write is signed.
 *
 * Without this, `writeContract` signs against whatever network the wallet
 * currently has selected — producing a "Confirm — Network: Ethereum" prompt
 * for an Arc transaction. Every write path calls `ensureCorrectChain()` first.
 *
 * `switchChainAsync` only works if Arc Testnet is declared in the wagmi
 * config's `chains` array; it is (see `src/config/wagmi.ts`), and both are
 * built from the same `arcTestnet` definition so they cannot drift.
 */
export function useChainGuard() {
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  const isOnCorrectChain = chainId === ARC_CHAIN_ID;

  const ensureCorrectChain = useCallback(async () => {
    if (chainId === ARC_CHAIN_ID) return;
    try {
      await switchChainAsync({ chainId: ARC_CHAIN_ID });
    } catch (error) {
      // Kept for the console; the user gets one of the sentences below.
      console.warn('[arc] Chain switch to Arc Testnet failed', error);

      // Declining the wallet's network prompt is a decision, not a failure.
      // Rethrowing it unchanged lets `useTx` recognise it and stay silent —
      // wrapping it in `WrongChainError` turned a cancelled switch into an
      // error toast.
      if (isUserRejection(error)) throw error;

      // The wallet has no programmatic switching at all — the norm inside a
      // mobile wallet's in-app browser. `describeError` says so specifically,
      // which is more use than the generic instruction below.
      if (error instanceof Error && error.name === 'SwitchChainNotSupportedError') {
        throw error;
      }

      // Anything else: the wallet refused for a reason it did not explain.
      // Raise a typed error so callers can show one clear instruction instead
      // of a decoded RPC failure.
      throw new WrongChainError(chainId);
    }
  }, [chainId, switchChainAsync]);

  return { ensureCorrectChain, isOnCorrectChain, chainId };
}
