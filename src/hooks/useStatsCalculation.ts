import { useCallback } from 'react';

const DEFAULT_TRACKED_DOMAINS = [
  'first', 'arc', 'domain', 'test', 'alice', 'bob', 'charlie', 'degen', 'usdc', 'crypto', 'stable', 'finance', 'finality'
];

interface StatsData {
  namesCount: number;
  revenue: string;
  isLoading: boolean;
  hasError: boolean;
  errorMessage?: string;
}

export function useStatsCalculation() {
  /**
   * FIX FOR BUG #1: Never fall back to DEFAULT_TRACKED_DOMAINS for actual stats display.
   * Only use it for search suggestions. Stats must reflect real on-chain data or show as unavailable.
   */
  const calculateStats = useCallback(
    (
      mintsCount: number,
      registeredNamesCount: number,
      totalRevenueWei: bigint,
      hasLoggingErrors: boolean
    ): StatsData => {
      // If both sources failed, we have no data — don't use the hardcoded fallback
      const hasRealData = mintsCount > 0 || registeredNamesCount > 0;

      if (!hasRealData && hasLoggingErrors) {
        return {
          namesCount: 0,
          revenue: '0.00',
          isLoading: false,
          hasError: true,
          errorMessage: 'Unable to load stats. Please try refreshing.',
        };
      }

      // Use mints count if available, otherwise use registeredNamesCount
      const finalNamesCount = mintsCount > 0 ? mintsCount : registeredNamesCount;

      // Format revenue
      const formattedRevenue = (Number(totalRevenueWei) / 1e18).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

      return {
        namesCount: finalNamesCount,
        revenue: formattedRevenue,
        isLoading: false,
        hasError: false,
      };
    },
    []
  );

  /**
   * Helper to get search suggestion pills — this IS where DEFAULT_TRACKED_DOMAINS belongs.
   */
  const getSearchSuggestions = useCallback(() => {
    return DEFAULT_TRACKED_DOMAINS;
  }, []);

  return {
    calculateStats,
    getSearchSuggestions,
    DEFAULT_TRACKED_DOMAINS,
  };
}
