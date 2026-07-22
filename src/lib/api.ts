// Base origin of the indexer service (see /indexer in this same delivery).
// Set VITE_INDEXER_API_URL to the indexer's host, e.g. http://10.x.x.x:8787
// or https://api.yourapp.com — with NO /api suffix. Every call below already
// includes /api/... in its own path (matching the indexer's actual Express
// routes, which are mounted at /api/*), so the base here should be just the
// origin. Leave unset for a same-origin deployment, where paths resolve
// relative to this app's own domain (e.g. behind a reverse proxy that routes
// /api/* to the indexer).
const INDEXER_API_URL = import.meta.env.VITE_INDEXER_API_URL ?? '';

const FETCH_TIMEOUT_MS = 6000;

async function fetchJson<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${INDEXER_API_URL}${path}`, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Indexer API ${path} returned ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export interface IndexerStats {
  totalRevenueWei: string;
  namesClaimed: number;
}

export interface IndexerDomain {
  name: string;
  token_id: string;
  owner: string;
  expires_at: number;
  block_number: number;
  tx_hash: string;
}

export interface IndexerListing {
  token_id: string;
  name: string | null;
  seller: string;
  price_wei: string;
  updated_at: string;
}

export interface IndexerAvailability {
  taken: boolean;
  owner?: string;
  expiresAt?: number;
}

export function fetchIndexerAvailability(name: string): Promise<IndexerAvailability> {
  return fetchJson<IndexerAvailability>(`/api/availability?name=${encodeURIComponent(name)}`);
}

export interface SyncStreamStatus {
  stream: string;
  last_block: number;
  updated_at: string;
}

// Every function here throws on failure (network error, timeout, non-2xx) —
// callers are expected to catch and fall back to direct RPC reads. That's a
// deliberate choice: silently returning an empty array here would reproduce
// exactly the "confidently wrong zero" bug this API was built to avoid.

export function fetchIndexerStats(): Promise<IndexerStats> {
  return fetchJson<IndexerStats>('/api/stats');
}

export async function fetchIndexerDomains(owner: string): Promise<IndexerDomain[]> {
  const data = await fetchJson<{ domains: IndexerDomain[] }>(`/api/domains?owner=${owner}`);
  return data.domains;
}

export async function fetchIndexerMarketplace(): Promise<IndexerListing[]> {
  const data = await fetchJson<{ listings: IndexerListing[] }>('/api/marketplace');
  return data.listings;
}

export async function fetchIndexerSyncStatus(): Promise<SyncStreamStatus[]> {
  const data = await fetchJson<{ streams: SyncStreamStatus[] }>('/api/sync-status');
  return data.streams;
}
