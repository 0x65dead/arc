import type { WaitlistEntry } from './waitlist';

/**
 * Where the waitlist session token lives.
 *
 * localStorage rather than a cookie, because `VITE_INDEXER_API_URL` points at
 * a different origin from the site: a cookie set by the indexer would be a
 * third-party cookie, which Safari blocks outright and Firefox partitions. A
 * bearer token in localStorage is the only thing that works in every browser
 * here. It is scoped to one wallet address, expires server-side regardless of
 * what is stored here, and grants nothing beyond reading and advancing that
 * address's own waitlist row.
 */

const STORAGE_KEY = 'arc:waitlist:session';

export interface StoredSession {
  address: string;
  token: string;
  /** Epoch ms. Mirrors the server's expiry so a dead token is never sent. */
  expiresAt: number;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Safari private mode and embedded webviews can throw on access alone.
    return null;
  }
}

export function readSession(address: string | undefined): StoredSession | null {
  if (!address) return null;
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.token !== 'string' || typeof parsed.address !== 'string') return null;
    if (typeof parsed.expiresAt !== 'number' || parsed.expiresAt <= Date.now()) return null;
    // A session belongs to the wallet it was signed by. Switching accounts in
    // the extension must not carry the previous account's token forward —
    // that would show one wallet the other's queue position.
    if (parsed.address.toLowerCase() !== address.toLowerCase()) return null;
    return parsed as StoredSession;
  } catch {
    return null;
  }
}

export function writeSession(session: StoredSession): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Full or disabled storage is not fatal: the flow still completes in this
    // tab, the user just has to sign again after a reload.
  }
}

export function clearSession(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Step derivation
// ---------------------------------------------------------------------------

export type WaitlistStep = 'connect' | 'sign' | 'join' | 'link' | 'verify' | 'done';

/**
 * Which step the stepper should highlight.
 *
 * Derived from server state plus the local session rather than tracked as its
 * own piece of React state. State that duplicates what the API already knows
 * is state that can disagree with it — and the one place this flow can be
 * re-entered from (the Discord callback) is a full page load, where any
 * in-memory step counter would have been lost anyway.
 */
export function deriveStep(input: {
  isConnected: boolean;
  hasSession: boolean;
  entry: WaitlistEntry | null;
}): WaitlistStep {
  if (!input.isConnected) return 'connect';
  if (!input.hasSession && !input.entry?.verified) return 'sign';
  if (input.entry?.verified) return 'done';
  if (!input.entry?.discordLinked) return 'link';
  // Linked but not in the server: the invite step is the one that is actually
  // outstanding, even though it comes earlier in the numbered list.
  if (!input.entry.guildMember) return 'join';
  return 'verify';
}
