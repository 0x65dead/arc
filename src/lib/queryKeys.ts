/**
 * Centralised react-query keys.
 *
 * Keeping them here (rather than inline string arrays scattered across hooks)
 * means an invalidation after a write can target exactly the right subtree —
 * the old code just refetched everything on every state change, which is why
 * a single tab switch triggered a full re-scan of chain history.
 */
export const queryKeys = {
  protocol: ['protocol'] as const,

  stats: ['stats'] as const,
  syncStatus: ['sync-status'] as const,

  search: (label: string) => ['search', label] as const,

  portfolio: (owner: string | undefined) => ['portfolio', owner?.toLowerCase() ?? null] as const,
  domainArtwork: (tokenId: string) => ['artwork', tokenId] as const,

  marketplace: ['marketplace'] as const,
  activity: (name?: string) => ['activity', name ?? 'all'] as const,

  records: (label: string) => ['records', label] as const,
  primaryName: (address: string | undefined) => ['primary-name', address?.toLowerCase() ?? null] as const,
} as const;
