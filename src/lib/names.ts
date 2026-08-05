import { keccak256, toHex, type Hex } from 'viem';
import { namehash as viemNamehash } from 'viem/ens';
import { GRACE_PERIOD_SECONDS, TLD, YEAR_SECONDS } from '../config/contracts';

/**
 * Name/label helpers.
 *
 * The old code shipped three separate `namehash` implementations (App.tsx,
 * lib/web3.ts, and the indexer) all hand-rolled on top of ethers. They agreed,
 * but only by luck — each was a place the ENS algorithm could drift. viem
 * ships a tested one; the only bespoke piece left is `labelToId`, which must
 * match `ArcController.labelOf` (`keccak256(bytes(nm))`) reinterpreted as a
 * uint256 token id.
 */

export function namehash(name: string): Hex {
  return viemNamehash(name);
}

/** `keccak256(bytes(label))` — the contract's `labelOf`. */
export function labelhash(label: string): Hex {
  return keccak256(toHex(label));
}

/**
 * The ERC-721 token id for a label, as a decimal string.
 *
 * `uint256(labelOf(nm))` in Solidity. Kept as a string rather than a bigint at
 * the boundary because it round-trips through JSON (indexer API) and the DOM
 * without precision loss.
 */
export function labelToTokenId(label: string): string {
  return BigInt(labelhash(label)).toString();
}

export function fullName(label: string): string {
  return `${label}.${TLD}`;
}

/** Node for `<label>.arc`. */
export function nodeForLabel(label: string): Hex {
  return namehash(fullName(label));
}

/**
 * Strips whatever the user typed down to a bare label: trims, lowercases and
 * removes a trailing `.arc`. Does not validate — see `validateLabel`.
 */
export function normalizeLabel(input: string): string {
  const trimmed = input.trim().toLowerCase();
  return trimmed.endsWith(`.${TLD}`) ? trimmed.slice(0, -(TLD.length + 1)) : trimmed;
}

export interface LabelValidation {
  valid: boolean;
  reason?: string;
}

/**
 * Mirrors `ArcController.valid()`:
 *
 *   - length >= minLen (2 on the live deployment) and <= 63
 *   - characters restricted to [a-z0-9-]
 *
 * `minLen` is configurable on-chain, so the contract remains the authority —
 * this is a client-side pre-filter that avoids a pointless RPC round-trip for
 * input that cannot possibly be valid.
 */
export function validateLabel(label: string, minLen = 2): LabelValidation {
  if (!label) return { valid: false, reason: 'Enter a name to search.' };
  if (label.length < minLen) {
    return { valid: false, reason: `Names must be at least ${minLen} characters.` };
  }
  if (label.length > 63) {
    return { valid: false, reason: 'Names must be 63 characters or fewer.' };
  }
  if (!/^[a-z0-9-]+$/.test(label)) {
    return { valid: false, reason: 'Only lowercase letters, numbers and hyphens are allowed.' };
  }
  if (label.startsWith('-') || label.endsWith('-')) {
    return { valid: false, reason: 'Names cannot start or end with a hyphen.' };
  }
  return { valid: true };
}

export type ExpiryStatus = 'active' | 'grace' | 'released';

export interface ExpiryInfo {
  status: ExpiryStatus;
  expiresAt: number;
  /** When the 90-day grace period ends and the name becomes registerable. */
  releasesAt: number;
  secondsRemaining: number;
}

/**
 * Classifies a name by its expiry, including the registrar's 90-day grace
 * window.
 *
 * This is the distinction the old UI never drew: it treated `expiry < now` as
 * "gone", while the contract keeps the name locked (and renewable by the
 * original owner) for a further 90 days. A name in grace is neither safely
 * owned nor available to anyone else, and needs to say so.
 */
export function expiryInfo(expiresAt: number, now = Math.floor(Date.now() / 1000)): ExpiryInfo {
  const releasesAt = expiresAt + GRACE_PERIOD_SECONDS;
  const status: ExpiryStatus = now < expiresAt ? 'active' : now < releasesAt ? 'grace' : 'released';
  return {
    status,
    expiresAt,
    releasesAt,
    secondsRemaining: Math.max(0, (status === 'active' ? expiresAt : releasesAt) - now),
  };
}

/** Duration in seconds for a whole number of years, matching the contract's `365 days`. */
export function yearsToSeconds(years: number): bigint {
  return BigInt(Math.round(years * YEAR_SECONDS));
}
