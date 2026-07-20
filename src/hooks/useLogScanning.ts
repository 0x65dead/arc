import { ethers } from 'ethers';
import { useCallback } from 'react';

const DEPLOY_BLOCK = 52346600;

/**
 * Enhanced log scanning with better retry and error handling.
 * Logs warnings but allows partial results to propagate.
 */
export async function fetchLogsWithChunkingEnhanced(
  provider: ethers.JsonRpcProvider,
  filter: { address: string; topics: any[] },
  startBlock: number,
  endBlock: number,
  chunkSize: number = 5000 // Reduced from 10000 for more reliable RPC calls
): Promise<ethers.Log[]> {
  let currentBlock = startBlock;
  let allLogs: ethers.Log[] = [];
  let failedRanges: Array<{ from: number; to: number }> = [];

  while (currentBlock <= endBlock) {
    const chunkEndBlock = Math.min(currentBlock + chunkSize - 1, endBlock);
    let retries = 0;
    const maxRetries = 2;
    let success = false;

    while (retries < maxRetries && !success) {
      try {
        const logs = await provider.getLogs({
          ...filter,
          fromBlock: currentBlock,
          toBlock: chunkEndBlock,
        });
        allLogs = allLogs.concat(logs);
        success = true;
      } catch (err: any) {
        retries++;
        if (retries < maxRetries) {
          // Exponential backoff: 1s, then 2s
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, retries - 1) * 1000));
        } else {
          console.warn(
            `Failed to fetch logs for blocks ${currentBlock}-${chunkEndBlock} after ${maxRetries} retries:`,
            err
          );
          failedRanges.push({ from: currentBlock, to: chunkEndBlock });
          // Continue to next chunk instead of breaking entirely
        }
      }
    }

    currentBlock = chunkEndBlock + 1;
  }

  if (failedRanges.length > 0) {
    console.warn(
      `⚠️ Log scanning completed with gaps. Failed ranges:`,
      failedRanges
    );
  }

  return allLogs;
}

export function useLogScanning() {
  const fetchLogs = useCallback(
    async (
      provider: ethers.JsonRpcProvider,
      filter: { address: string; topics: any[] },
      startBlock: number,
      endBlock: number
    ) => {
      return fetchLogsWithChunkingEnhanced(provider, filter, startBlock, endBlock);
    },
    []
  );

  return { fetchLogs, DEPLOY_BLOCK };
}
