/**
 * Mainnet waitlist client.
 *
 * Matches the backend's response shapes in `indexer/src/waitlist/routes.ts`.
 */

const BASE_URL = (import.meta.env.VITE_INDEXER_API_URL ?? '').replace(/\/$/, '');
const API_PREFIX = '/api/v1/waitlist';
const TIMEOUT_MS = 12_000;

class WaitlistError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WaitlistError';
  }
}

async function request<T>(
  path: string,
  options?: { method?: string; body?: unknown; token?: string },
): Promise<T> {
  const url = new URL(`${BASE_URL}${API_PREFIX}${path}`, window.location.origin);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: options?.method ?? 'GET',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(options?.body ? { 'content-type': 'application/json' } : {}),
        ...(options?.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      let code = 'unknown';
      let detail = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        if (body?.error?.code) code = body.error.code;
        if (body?.error?.message) detail = body.error.message;
      } catch {
        /* non-JSON */
      }
      throw new WaitlistError(code, detail);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof WaitlistError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new WaitlistError('timeout', `Waitlist timed out after ${TIMEOUT_MS}ms`);
    }
    throw new WaitlistError(
      'unavailable',
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface WaitlistConfig {
  enabled: boolean;
  inviteUrl: string | null;
  autoJoin: boolean;
  verifiedCount: number;
}

export interface WaitlistEntry {
  address: string;
  discordUsername: string | null;
  discordAvatar: string | null;
  discordLinked: boolean;
  guildMember: boolean;
  roleGranted: boolean;
  verified: boolean;
  position: number | null;
  createdAt: string;
}

export interface WaitlistStatus {
  entry: WaitlistEntry | null;
  verifiedCount: number;
}

interface NonceResponse {
  nonce: string;
  message: string;
  expiresAt: string;
}

interface VerifyResponse {
  token: string;
  expiresAt: string;
  entry: WaitlistEntry | null;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export const waitlistApi = {
  config: () => request<WaitlistConfig>('/config'),

  nonce: (address: string) => request<NonceResponse>('/nonce', {
    method: 'POST',
    body: { address },
  }),

  verify: (address: string, nonce: string, signature: string) =>
    request<VerifyResponse>('/verify', {
      method: 'POST',
      body: { address, nonce, signature },
    }),

  /** Builds the Discord authorization URL. */
  discordUrl: (token: string) => {
    const url = new URL(`${BASE_URL}${API_PREFIX}/discord`, window.location.origin);
    url.searchParams.set('token', token);
    return url.toString();
  },

  status: (address: string) =>
    request<WaitlistStatus>(`/status?address=${encodeURIComponent(address)}`),

  recheck: (token: string) =>
    request<WaitlistStatus>('/recheck', { method: 'POST', token }),
};

export { WaitlistError };
