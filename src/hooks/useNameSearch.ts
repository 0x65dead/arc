import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { usePublicClient } from 'wagmi';
import { controllerAbi, registrarAbi, registryAbi } from '../config/abis';
import { contracts, YEAR_SECONDS } from '../config/contracts';
import { expiryInfo, labelToTokenId, nodeForLabel, normalizeLabel, validateLabel } from '../lib/names';
import { queryKeys } from '../lib/queryKeys';
import { useProtocolParams } from './useProtocolParams';

export type SearchStatus = 'invalid' | 'available' | 'registered' | 'grace';

export interface SearchResult {
  label: string;
  status: SearchStatus;
  /** Reason the label is unusable, when status is 'invalid'. */
  reason?: string;
  /** Price for one year, in native wei. Null when the name isn't for sale. */
  priceWei: bigint | null;
  owner?: string;
  resolver?: string;
  expiresAt?: number;
  /** When a name in grace becomes registerable again. */
  releasesAt?: number;
}

/** Debounces the raw input so we don't fire an eth_call per keystroke. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Resolves what a searched name currently is.
 *
 * Availability comes from the chain, not the indexer. The old code asked the
 * indexer first for speed, but its answer was derived from a `registrations`
 * table that modelled expiry without the registrar's 90-day grace period — so
 * a name one day past expiry was advertised as available, and every attempt to
 * register it reverted. `controller.available()` is a single eth_call and is
 * the same predicate the transaction itself enforces.
 */
export function useNameSearch(rawQuery: string) {
  const publicClient = usePublicClient();
  const { data: params } = useProtocolParams();
  const debouncedQuery = useDebounced(rawQuery, 400);

  const label = normalizeLabel(debouncedQuery);
  const validation = validateLabel(label, params?.minLen ?? 2);

  const query = useQuery<SearchResult>({
    queryKey: queryKeys.search(label),
    enabled: Boolean(publicClient) && label.length > 0 && validation.valid,
    staleTime: 15_000,
    retry: 1,
    queryFn: async (): Promise<SearchResult> => {
      if (!publicClient) throw new Error('No RPC client available');

      const duration = BigInt(YEAR_SECONDS);
      const tokenId = BigInt(labelToTokenId(label));

      // `valid` is checked on-chain as well as locally: minLen is settable by
      // the contract owner, and the local pre-filter can only ever be a hint.
      const [isValidOnChain, isAvailable, priceWei] = await Promise.all([
        publicClient.readContract({
          address: contracts.controller,
          abi: controllerAbi,
          functionName: 'valid',
          args: [label],
        }),
        publicClient.readContract({
          address: contracts.controller,
          abi: controllerAbi,
          functionName: 'available',
          args: [label],
        }),
        publicClient
          .readContract({
            address: contracts.controller,
            abi: controllerAbi,
            functionName: 'price',
            args: [label, duration],
          })
          .catch(() => null),
      ]);

      if (!isValidOnChain) {
        return {
          label,
          status: 'invalid',
          reason: 'This registrar will not accept that name.',
          priceWei: null,
        };
      }

      if (isAvailable) {
        return { label, status: 'available', priceWei: priceWei ?? null };
      }

      // Taken — find out by whom, and whether it's actually in grace. A name in
      // grace has `available() === false` but an expiry already in the past.
      const node = nodeForLabel(label);
      const [owner, resolver, expiresAt] = await Promise.all([
        publicClient
          .readContract({ address: contracts.registry, abi: registryAbi, functionName: 'owner', args: [node] })
          .catch(() => undefined),
        publicClient
          .readContract({ address: contracts.registry, abi: registryAbi, functionName: 'resolver', args: [node] })
          .catch(() => undefined),
        publicClient
          .readContract({
            address: contracts.registrar,
            abi: registrarAbi,
            functionName: 'nameExpires',
            args: [tokenId],
          })
          .catch(() => undefined),
      ]);

      const expiry = expiresAt === undefined ? undefined : Number(expiresAt);
      const info = expiry === undefined ? undefined : expiryInfo(expiry);

      return {
        label,
        status: info?.status === 'grace' ? 'grace' : 'registered',
        priceWei: priceWei ?? null,
        owner,
        resolver,
        expiresAt: expiry,
        releasesAt: info?.releasesAt,
      };
    },
  });

  const invalidResult: SearchResult | undefined =
    label.length > 0 && !validation.valid
      ? { label, status: 'invalid', reason: validation.reason, priceWei: null }
      : undefined;

  return {
    /** The label the results describe — may lag `rawQuery` by the debounce. */
    label,
    result: invalidResult ?? query.data,
    isLoading: query.isFetching && !invalidResult,
    error: query.error,
    /** True while the user is still typing and results are for an older query. */
    isStale: normalizeLabel(rawQuery) !== label,
    refetch: query.refetch,
  };
}
