import type { AbiEvent, Address, GetLogsReturnType, PublicClient } from 'viem';

/**
 * Chunked `eth_getLogs` with adaptive range shrinking.
 *
 * This exists only for the degraded path — when the indexer is unreachable and
 * the alternative is showing the user nothing. The previous frontend ran six of
 * these scans over full chain history on every tab switch, which is what made
 * the app slow and unreliable on a phone. Here it is used for exactly one
 * indexed, tightly-filtered stream at a time.
 *
 * Two properties the old version lacked:
 *
 *  1. A failed chunk is retried with backoff, then *recorded as a gap* and the
 *     scan continues — rather than `break`ing out and returning a truncated
 *     array indistinguishable from "there was nothing there".
 *  2. When a provider rejects a range outright, the chunk size shrinks for the
 *     remainder of the scan instead of failing every subsequent chunk the same
 *     way.
 */

export interface ScanResult<T> {
  logs: T[];
  /** Ranges that could not be read. Non-empty means the result is incomplete. */
  gaps: Array<{ from: bigint; to: bigint }>;
}

export interface ScanOptions {
  initialChunkSize?: bigint;
  maxRetriesPerChunk?: number;
  /** Called after each chunk so callers can show progress on long scans. */
  onProgress?: (scannedTo: bigint, target: bigint) => void;
}

/** Providers advertise their cap in the error text; honour it when they do. */
function suggestedRange(error: unknown): bigint | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/up to an?\s*(\d+)\s*block range/i) ?? message.match(/range is too large.*?(\d{2,})/i);
  if (!match) return null;
  const value = BigInt(match[1]);
  return value > 0n ? value : null;
}

export async function scanLogs<TEvent extends AbiEvent>(
  client: PublicClient,
  params: {
    address: Address;
    event: TEvent;
    args?: Record<string, unknown>;
    fromBlock: bigint;
    toBlock: bigint;
  },
  options: ScanOptions = {},
): Promise<ScanResult<GetLogsReturnType<TEvent>[number]>> {
  const maxRetries = options.maxRetriesPerChunk ?? 2;
  let chunkSize = options.initialChunkSize ?? 10_000n;

  const logs: GetLogsReturnType<TEvent>[number][] = [];
  const gaps: Array<{ from: bigint; to: bigint }> = [];

  let cursor = params.fromBlock;

  while (cursor <= params.toBlock) {
    let chunkEnd = cursor + chunkSize - 1n;
    if (chunkEnd > params.toBlock) chunkEnd = params.toBlock;

    let attempt = 0;
    let done = false;

    while (!done) {
      try {
        const chunk = await client.getLogs({
          address: params.address,
          event: params.event,
          args: params.args as never,
          fromBlock: cursor,
          toBlock: chunkEnd,
        });
        logs.push(...(chunk as GetLogsReturnType<TEvent>));
        done = true;
      } catch (error) {
        const cap = suggestedRange(error);
        if (cap && cap < chunkSize) {
          chunkSize = cap;
          chunkEnd = cursor + chunkSize - 1n > params.toBlock ? params.toBlock : cursor + chunkSize - 1n;
          continue; // retry the same start with a smaller window, no attempt spent
        }

        attempt += 1;
        if (attempt > maxRetries) {
          console.warn(`[arc] log scan gap at blocks ${cursor}-${chunkEnd}`, error);
          gaps.push({ from: cursor, to: chunkEnd });
          done = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 400));
      }
    }

    cursor = chunkEnd + 1n;
    options.onProgress?.(cursor, params.toBlock);
  }

  return { logs, gaps };
}
