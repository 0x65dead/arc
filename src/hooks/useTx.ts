import { useCallback } from 'react';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import type { Abi, Address, Hash } from 'viem';
import { explorerTxUrl } from '../config/chain';
import { TxRevertedError, describeError, isUserRejection } from '../lib/errors';
import { useChainGuard } from './useChainGuard';
import { useToasts } from './useToasts';

export interface WriteRequest {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  gas?: bigint;
}

export interface RunTxOptions {
  /** Shown while the wallet prompt is open and the tx is confirming. */
  pending: string;
  /** Shown once the receipt comes back with status "success". */
  success: string;
  request: WriteRequest;
  /**
   * Dry-run against the node before asking the wallet to sign.
   *
   * On by default: it turns "user signs, pays gas, tx reverts" into a plain
   * error message with no gas spent, and it's how conditions like `!approved`
   * or `price moved` get caught while they're still fixable. Disable only for
   * calls whose success depends on state that changes between simulation and
   * inclusion.
   */
  simulate?: boolean;
}

/**
 * Runs a contract write end to end: chain guard → simulate → sign → wait →
 * verify receipt status, with a single toast tracking all of it.
 *
 * The receipt check is the load-bearing part. `waitForTransactionReceipt`
 * resolves for reverted transactions as well as successful ones, so treating
 * its resolution as success is what let a reverted registration fire confetti
 * and then show the name as still available.
 */
export function useTx() {
  const publicClient = usePublicClient();
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { ensureCorrectChain } = useChainGuard();
  const toasts = useToasts();

  const runTx = useCallback(
    async ({ pending, success, request, simulate = true }: RunTxOptions): Promise<Hash | null> => {
      const toastId = toasts.push('pending', pending);

      try {
        await ensureCorrectChain();

        if (simulate && publicClient && address) {
          toasts.update(toastId, 'pending', `${pending} — checking…`);
          await publicClient.simulateContract({
            account: address,
            address: request.address,
            abi: request.abi,
            functionName: request.functionName,
            args: request.args as never,
            value: request.value,
          });
        }

        toasts.update(toastId, 'pending', `${pending} — confirm in your wallet`);
        const hash = await writeContractAsync({
          address: request.address,
          abi: request.abi,
          functionName: request.functionName,
          args: request.args as never,
          value: request.value,
          gas: request.gas,
        } as never);

        toasts.update(toastId, 'pending', `${pending} — waiting for confirmation`, {
          href: explorerTxUrl(hash),
        });

        if (publicClient) {
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          if (receipt.status !== 'success') {
            throw new TxRevertedError(hash, receipt);
          }
        }

        toasts.update(toastId, 'success', success, { href: explorerTxUrl(hash) });
        return hash;
      } catch (error) {
        if (isUserRejection(error)) {
          // Cancelling is a decision, not a failure — drop the toast silently.
          toasts.dismiss(toastId);
          return null;
        }
        toasts.update(toastId, 'error', describeError(error));
        throw error;
      }
    },
    [address, ensureCorrectChain, publicClient, toasts, writeContractAsync],
  );

  return { runTx };
}
