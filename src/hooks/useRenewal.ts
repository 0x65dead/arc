import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { controllerAbi, registrarAbi } from '../config/abis';
import { MAX_DURATION_SECONDS, MIN_DURATION_SECONDS, contracts } from '../config/contracts';
import { indexerApi, type IndexerActivityItem } from '../lib/indexer';
import { imageFromTokenUri, nameSvgDataUri } from '../lib/artwork';
import { fullName, yearsToSeconds } from '../lib/names';
import { queryKeys } from '../lib/queryKeys';
import { useToasts } from './useToasts';
import { useTx } from './useTx';

/**
 * Renewal.
 *
 * Renewal stays available throughout the 90-day grace period — that is the
 * whole point of grace, and the old UI hid the button the moment a name
 * expired, so an owner inside the window had no way to recover the name from
 * this app at all.
 */
export function useRenewal() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();
  const { runTx } = useTx();
  const toasts = useToasts();

  const quote = useCallback(
    async (label: string, years: number): Promise<bigint | null> => {
      if (!publicClient) return null;
      return publicClient
        .readContract({
          address: contracts.controller,
          abi: controllerAbi,
          functionName: 'price',
          args: [label, yearsToSeconds(years)],
        })
        .catch(() => null);
    },
    [publicClient],
  );

  const renew = useCallback(
    async (label: string, years: number) => {
      if (!publicClient) return;

      const duration = yearsToSeconds(years);
      if (duration < BigInt(MIN_DURATION_SECONDS) || duration > BigInt(MAX_DURATION_SECONDS)) {
        toasts.push('error', 'That renewal length is outside the range this registrar accepts.');
        return;
      }

      const price = await quote(label, years);
      if (price === null) {
        toasts.push('error', 'Could not read the renewal price. Try again in a moment.');
        return;
      }

      await runTx({
        pending: `Renewing ${fullName(label)}`,
        success: `${fullName(label)} renewed for ${years} year${years === 1 ? '' : 's'}`,
        request: {
          address: contracts.controller,
          abi: controllerAbi,
          functionName: 'renew',
          args: [label, duration],
          value: price,
        },
      });

      queryClient.invalidateQueries({ queryKey: queryKeys.portfolio(address) });
      queryClient.invalidateQueries({ queryKey: queryKeys.search(label) });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats });
      queryClient.invalidateQueries({ queryKey: queryKeys.activity() });
    },
    [address, publicClient, queryClient, quote, runTx, toasts],
  );

  return { renew, quote };
}

/** Recent protocol activity. Indexer-only; there is no honest chain fallback. */
export function useActivity(name?: string) {
  return useQuery<IndexerActivityItem[]>({
    queryKey: queryKeys.activity(name),
    staleTime: 20_000,
    retry: 1,
    queryFn: async () => {
      const { items } = await indexerApi.activity({ limit: 25, name });
      return items;
    },
  });
}

/**
 * The name's artwork.
 *
 * Prefers the contract's own `tokenURI` so what's displayed is what the token
 * actually is. Falls back to rendering the SVG locally — `renderNameSvg` is a
 * literal transcription of `ArcRegistrar.renderSVG`, including the length-based
 * font sizing the old local copy got wrong by hardcoding 84.
 */
export function useDomainArtwork(tokenId: string | null, label: string) {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: queryKeys.domainArtwork(tokenId ?? label),
    enabled: Boolean(label),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    queryFn: async (): Promise<string> => {
      if (publicClient && tokenId) {
        const uri = await publicClient
          .readContract({
            address: contracts.registrar,
            abi: registrarAbi,
            functionName: 'tokenURI',
            args: [BigInt(tokenId)],
          })
          .catch(() => null);
        const image = uri ? imageFromTokenUri(uri) : null;
        if (image) return image;
      }
      return nameSvgDataUri(label);
    },
  });
}
