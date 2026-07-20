import { useAccount, useSwitchChain } from 'wagmi';
import { useCallback } from 'react';

const ARC_TESTNET_ID = 5042002;

export function useChainGuard() {
  const { chainId, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();

  const ensureArcTestnet = useCallback(async () => {
    if (!isConnected) {
      throw new Error('Wallet not connected. Please connect your wallet first.');
    }

    if (chainId !== ARC_TESTNET_ID) {
      try {
        await switchChain({ chainId: ARC_TESTNET_ID });
      } catch (e: any) {
        // Handle user rejection or other errors
        if (e.message?.includes('rejected')) {
          throw new Error('You rejected the network switch request.');
        }
        throw new Error(
          `Please switch to Arc Testnet (Chain ID: ${ARC_TESTNET_ID}). Currently on chain ${chainId}. Some wallets require manual switching in settings.`
        );
      }
    }
  }, [isConnected, chainId, switchChain]);

  const isOnCorrectChain = useCallback(() => {
    return isConnected && chainId === ARC_TESTNET_ID;
  }, [isConnected, chainId]);

  return {
    ensureArcTestnet,
    isOnCorrectChain,
    currentChainId: chainId,
    arcTestnetId: ARC_TESTNET_ID,
  };
}
