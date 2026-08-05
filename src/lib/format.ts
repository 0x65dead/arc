import { formatUnits } from 'viem';
import { NATIVE_DECIMALS } from '../config/chain';

/**
 * Formats a native-token amount (18 decimals on Arc, symbol USDC).
 *
 * Deliberately not `formatEther` + `toFixed(2)`: that rounds 0.004 to "0.00",
 * which reads as free. Small non-zero amounts fall back to more precision.
 */
export function formatNative(wei: bigint | string, opts: { maxFractionDigits?: number } = {}): string {
  const value = Number(formatUnits(BigInt(wei), NATIVE_DECIMALS));
  if (value === 0) return '0';

  const maxFractionDigits = opts.maxFractionDigits ?? 2;
  if (value > 0 && value < 0.01) {
    return value.toLocaleString(undefined, { maximumSignificantDigits: 2 });
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: Math.min(2, maxFractionDigits),
    maximumFractionDigits: maxFractionDigits,
  });
}

export function formatCompactNumber(value: number): string {
  return value.toLocaleString(undefined, { notation: value >= 10_000 ? 'compact' : 'standard' });
}

export function shortenAddress(address: string, chars = 4): string {
  if (!address || address.length < 2 + chars * 2) return address;
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

export function shortenHash(hash: string): string {
  return shortenAddress(hash, 6);
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function isZeroAddress(address: string | undefined | null): boolean {
  return !address || address.toLowerCase() === ZERO_ADDRESS;
}

export function sameAddress(a?: string | null, b?: string | null): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

/** "in 3 months" / "2 days ago" without pulling in a date library. */
export function formatRelative(timestampSeconds: number, now = Date.now() / 1000): string {
  const deltaSeconds = timestampSeconds - now;
  const abs = Math.abs(deltaSeconds);

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, seconds] of units) {
    if (abs >= seconds) {
      return formatter.format(Math.round(deltaSeconds / seconds), unit);
    }
  }
  return formatter.format(Math.round(deltaSeconds), 'second');
}

export function formatDate(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** mm:ss, for the commit→reveal countdown. */
export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
