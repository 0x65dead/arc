import { IndexerUnavailableError } from './errors';

/**
 * Client for the indexer service (see `/indexer`).
 *
 * Base origin only — no `/api` suffix. Leave `VITE_INDEXER_API_URL` unset for a
 * same-origin deployment behind a reverse proxy.
 *
 * The routes are versioned (`/api/v1/*`) so the frontend and indexer can be
 * deployed independently without a flag day; the old unversioned paths are
 * still served by the indexer for one release.
 */
const BASE_URL = (import.meta.env.VITE_INDEXER_API_URL ?? '').replace(/\/$/, '');
const API_PREFIX = '/api/v1';
const TIMEOUT_MS = 8000;

async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${BASE_URL}${API_PREFIX}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });

    if (!response.ok) {
      // The indexer returns { error: { code, message } }; surface the message
      // when present so a 400 says what was wrong with the request.
      let detail = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        if (body?.error?.message) detail = body.error.message;
      } catch {
        /* non-JSON error body — the status is all we have */
      }
      throw new IndexerUnavailableError(path, detail);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof IndexerUnavailableError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new IndexerUnavailableError(path, `timed out after ${TIMEOUT_MS}ms`);
    }
    throw new IndexerUnavailableError(path, error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Response shapes. These mirror `indexer/src/api/schemas.ts` — keep in sync.
// ---------------------------------------------------------------------------

export interface IndexerStats {
  /** Gross lifetime volume: registrations + renewals, in native wei. */
  totalRevenueWei: string;
  /** Names ever registered. */
  namesRegistered: number;
  /** Names whose expiry is still in the future. */
  namesActive: number;
  /** Names past expiry but inside the 90-day grace window. */
  namesInGrace: number;
  activeListings: number;
  totalSalesVolumeWei: string;
}

export interface IndexerDomain {
  name: string;
  tokenId: string;
  owner: string;
  expiresAt: number;
  registeredAt: number;
  blockNumber: number;
  txHash: string;
  listing: IndexerListing | null;
}

export interface IndexerListing {
  tokenId: string;
  name: string | null;
  seller: string;
  priceWei: string;
  /** 0 = native, 1 = ERC-20 USDC. Native-only is purchasable in this UI. */
  currency: number;
  blockNumber: number;
  updatedAt: string;
}

export interface IndexerAvailability {
  name: string;
  /** True when the name cannot be registered right now (owned, or in grace). */
  taken: boolean;
  status: 'available' | 'registered' | 'grace';
  owner?: string;
  expiresAt?: number;
  releasesAt?: number;
}

export interface IndexerActivityItem {
  kind: 'registration' | 'renewal' | 'transfer' | 'listing' | 'sale' | 'unlisting';
  name: string | null;
  tokenId: string | null;
  actor: string | null;
  counterparty: string | null;
  amountWei: string | null;
  blockNumber: number;
  txHash: string;
  at: string;
}

export interface IndexerSyncStatus {
  /** Highest block the indexer has durably processed across all streams. */
  indexedBlock: number;
  chainHead: number | null;
  /** chainHead - indexedBlock, or null when the head is unknown. */
  blocksBehind: number | null;
  /**
   * Seconds since the indexer last completed a pass. Unlike `blocksBehind`
   * this stays meaningful when the indexer cannot reach the chain at all —
   * which is exactly when it is falling behind.
   */
  checkpointAgeSeconds: number | null;
  /** False when the indexer considers itself too far behind to be trusted. */
  healthy: boolean;
  streams: Array<{ stream: string; lastBlock: number; updatedAt: string }>;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const indexerApi = {
  stats: () => get<IndexerStats>('/stats'),

  availability: (name: string) => get<IndexerAvailability>('/availability', { name }),

  domainsByOwner: (owner: string) => get<{ items: IndexerDomain[] }>('/domains', { owner }),

  domain: (name: string) => get<IndexerDomain>(`/domains/${encodeURIComponent(name)}`),

  marketplace: (params?: { limit?: number; cursor?: string }) =>
    get<Paginated<IndexerListing>>('/marketplace', params),

  activity: (params?: { limit?: number; cursor?: string; name?: string }) =>
    get<Paginated<IndexerActivityItem>>('/activity', params),

  syncStatus: () => get<IndexerSyncStatus>('/sync-status'),
};
