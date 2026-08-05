import { useCallback } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { ARC_CHAIN_ID } from '../config/chain';
import { WrongChainError } from '../lib/errors';

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
    } catch {
      // The wallet refused, or doesn't support programmatic switching (common
      // in mobile in-app browsers). Raise a typed error so callers can show
      // one clear instruction instead of a decoded RPC failure.
      throw new WrongChainError(chainId);
    }
  }, [chainId, switchChainAsync]);

  return { ensureCorrectChain, isOnCorrectChain, chainId };
}
