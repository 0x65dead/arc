import { useCallback } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';

export const ARC_CHAIN_ID = 5042002;

export class WrongChainError extends Error {
  constructor(public currentChainId: number | undefined) {
    super('Wallet is not on Arc Testnet');
  }
}

/**
 * Returns ensureCorrectChain(), which every write flow in App.tsx calls as
 * its very first line. If the wallet is already on Arc Testnet this is a
 * no-op; otherwise it asks the wallet to switch and only proceeds if that
 * succeeds. This is the fix for the "Confirm Send — Network: Ethereum"
 * screenshots: previously nothing checked the active chain before
 * writeContractAsync fired, so a signature could be requested (and signed)
 * on whatever network the wallet happened to have active.
 */
export function useChainGuard() {
  const { chain } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  const ensureCorrectChain = useCallback(async () => {
    if (chain?.id === ARC_CHAIN_ID) return;

    try {
      await switchChainAsync({ chainId: ARC_CHAIN_ID });
    } catch (err) {
      // Wallet refused or doesn't support programmatic switching (some
      // mobile wallet browsers don't). Surface a clear, typed error instead
      // of letting the caller's writeContractAsync fire on the wrong chain.
      throw new WrongChainError(chain?.id);
    }
  }, [chain?.id, switchChainAsync]);

  return { ensureCorrectChain, isOnCorrectChain: chain?.id === ARC_CHAIN_ID };
}
