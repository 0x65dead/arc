import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { controllerAbi } from '../config/abis';
import { contracts } from '../config/contracts';
import { queryKeys } from '../lib/queryKeys';

export interface ProtocolParams {
  /** Seconds a commitment must mature before `register` is accepted. */
  minCommitAge: number;
  /** Seconds after which a commitment can no longer be revealed. */
  maxCommitAge: number;
  /** Shortest registerable label. */
  minLen: number;
  /** Annual price per length tier, in native wei. */
  priceTiers: { two: bigint; three: bigint; four: bigint; fivePlus: bigint };
}

/**
 * Reads the registrar's live parameters instead of hardcoding them.
 *
 * The old UI assumed a fixed 60-second commit delay and a fixed price table
 * (5 / 640 / 160 native). Both are owner-settable on-chain via `setLimits` and
 * `setPrices`, so any change would have silently broken the countdown and made
 * the quoted price wrong. These are cheap view calls and effectively static,
 * so they're cached for the session.
 */
export function useProtocolParams() {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: queryKeys.protocol,
    enabled: Boolean(publicClient),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    queryFn: async (): Promise<ProtocolParams> => {
      if (!publicClient) throw new Error('No RPC client available');

      const base = { address: contracts.controller, abi: controllerAbi } as const;
      const [minCommitAge, maxCommitAge, minLen, price2, price3, price4, price5plus] = await Promise.all([
        publicClient.readContract({ ...base, functionName: 'minCommitAge' }),
        publicClient.readContract({ ...base, functionName: 'maxCommitAge' }),
        publicClient.readContract({ ...base, functionName: 'minLen' }),
        publicClient.readContract({ ...base, functionName: 'price2' }),
        publicClient.readContract({ ...base, functionName: 'price3' }),
        publicClient.readContract({ ...base, functionName: 'price4' }),
        publicClient.readContract({ ...base, functionName: 'price5plus' }),
      ]);

      return {
        minCommitAge: Number(minCommitAge),
        maxCommitAge: Number(maxCommitAge),
        minLen: Number(minLen),
        priceTiers: { two: price2, three: price3, four: price4, fivePlus: price5plus },
      };
    },
  });
}
