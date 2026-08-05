import { useQuery } from '@tanstack/react-query';
import { indexerApi, type IndexerStats, type IndexerSyncStatus } from '../lib/indexer';
import { queryKeys } from '../lib/queryKeys';

/**
 * Protocol-wide stats, served only by the indexer.
 *
 * There is deliberately no client-side fallback here. Computing these numbers
 * in the browser means scanning every `NameRegistered`/`NameRenewed`/`Transfer`
 * log since the deploy block on every load — the exact behaviour that made the
 * old app unusable on mobile. When the indexer is down the UI shows "—" and
 * says why, which is the honest answer.
 *
 * The specific thing never to reintroduce: the old code fell back to
 * `DEFAULT_TRACKED_DOMAINS.length` for the name count, so a failed scan
 * displayed a confident "13 registered names" that had never come from the
 * chain at all.
 */
export function useStats() {
  const query = useQuery<IndexerStats>({
    queryKey: queryKeys.stats,
    queryFn: indexerApi.stats,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  return {
    ...query,
    /** True when we genuinely don't know — render "—", never a placeholder. */
    unavailable: query.isError,
  };
}

/**
 * How far behind the chain the indexer is.
 *
 * Surfaced in the UI so "no listings" can be distinguished from "the indexer
 * stopped six hours ago and this page is a snapshot of the past".
 */
export function useSyncStatus() {
  return useQuery<IndexerSyncStatus>({
    queryKey: queryKeys.syncStatus,
    queryFn: indexerApi.syncStatus,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}
