import { useQuery } from '@tanstack/react-query';
import { useAccount, usePublicClient } from 'wagmi';
import { parseAbiItem, type Address, type PublicClient } from 'viem';
import { marketAbi, registrarAbi } from '../config/abis';
import { DEPLOY_BLOCK, contracts } from '../config/contracts';
import { expiryInfo, fullName, type ExpiryStatus } from '../lib/names';
import { indexerApi } from '../lib/indexer';
import { scanLogs } from '../lib/logs';
import { queryKeys } from '../lib/queryKeys';

export interface PortfolioName {
  label: string;
  name: string;
  tokenId: string;
  expiresAt: number;
  status: ExpiryStatus;
  releasesAt: number;
  /** Present when this name is currently listed on the marketplace. */
  listing: { priceWei: bigint; currency: number; seller: Address } | null;
}

export interface PortfolioResult {
  names: PortfolioName[];
  /** Which path produced this list — the UI says so when it's the fallback. */
  source: 'indexer' | 'chain';
  /** True when the chain fallback couldn't read part of the log range. */
  incomplete: boolean;
}

const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed id)');

/**
 * Reads the caller's names directly from chain logs.
 *
 * This is the *only* surviving client-side log scan, and it is deliberately
 * narrow: one event, on one contract, filtered server-side by `to = owner`.
 * The previous frontend ran six unfiltered full-history scans on every tab
 * switch — that is what made the app unusable on a phone, and it is not coming
 * back. It stays for this one case because being unable to see (or renew) your
 * own names while the indexer is down is a materially worse failure than a
 * slow load.
 *
 * Candidates from the log scan are then confirmed against `ownerOf`, so names
 * transferred away — or expired past their grace period, where `ownerOf`
 * reverts — drop out.
 */
async function scanOwnedNames(
  client: PublicClient,
  owner: Address,
): Promise<{ names: PortfolioName[]; incomplete: boolean }> {
  const head = await client.getBlockNumber();
  const { logs, gaps } = await scanLogs(
    client,
    {
      address: contracts.registrar,
      event: transferEvent,
      args: { to: owner },
      fromBlock: DEPLOY_BLOCK,
      toBlock: head,
    },
    { initialChunkSize: 10_000n },
  );

  const candidates = [...new Set(logs.map((log) => (log.args as { id?: bigint }).id).filter((id): id is bigint => id !== undefined))];

  const names = await Promise.all(
    candidates.map(async (tokenId): Promise<PortfolioName | null> => {
      try {
        const [currentOwner, expiresAt, label] = await Promise.all([
          client.readContract({
            address: contracts.registrar,
            abi: registrarAbi,
            functionName: 'ownerOf',
            args: [tokenId],
          }),
          client.readContract({
            address: contracts.registrar,
            abi: registrarAbi,
            functionName: 'nameExpires',
            args: [tokenId],
          }),
          client
            .readContract({
              address: contracts.registrar,
              abi: registrarAbi,
              functionName: 'labels',
              args: [tokenId],
            })
            .catch(() => ''),
        ]);

        if (currentOwner.toLowerCase() !== owner.toLowerCase()) return null;

        const info = expiryInfo(Number(expiresAt));
        return {
          // `labels` is only populated for names registered through the
          // controller; an empty string means we know the token but not its
          // text, and the UI shows the id rather than inventing a name.
          label: label || '',
          name: label ? fullName(label) : `#${tokenId.toString().slice(0, 8)}…`,
          tokenId: tokenId.toString(),
          expiresAt: Number(expiresAt),
          status: info.status,
          releasesAt: info.releasesAt,
          listing: null,
        };
      } catch {
        // `ownerOf` reverts with "expired" once a name is past its expiry —
        // that's a normal outcome here, not an error worth surfacing.
        return null;
      }
    }),
  );

  return { names: names.filter((n): n is PortfolioName => n !== null), incomplete: gaps.length > 0 };
}

/** Attaches live listing state to names the indexer told us about. */
async function attachListings(client: PublicClient, names: PortfolioName[]): Promise<PortfolioName[]> {
  return Promise.all(
    names.map(async (entry) => {
      try {
        const [seller, price, active] = await client.readContract({
          address: contracts.market,
          abi: marketAbi,
          functionName: 'getListing',
          args: [BigInt(entry.tokenId)],
        });
        if (!active) return entry;
        const currency = await client.readContract({
          address: contracts.market,
          abi: marketAbi,
          functionName: 'listingCurrency',
          args: [BigInt(entry.tokenId)],
        });
        return { ...entry, listing: { seller, priceWei: price, currency: Number(currency) } };
      } catch {
        return entry;
      }
    }),
  );
}

export function usePortfolio() {
  const { address } = useAccount();
  const publicClient = usePublicClient();

  return useQuery<PortfolioResult>({
    queryKey: queryKeys.portfolio(address),
    enabled: Boolean(address && publicClient),
    staleTime: 30_000,
    // The fallback scan is expensive; don't let a background refetch fire it
    // repeatedly while the indexer is down.
    retry: false,
    queryFn: async (): Promise<PortfolioResult> => {
      if (!address || !publicClient) throw new Error('Wallet not connected');

      try {
        const { items } = await indexerApi.domainsByOwner(address);
        const names: PortfolioName[] = items.map((domain) => {
          const info = expiryInfo(domain.expiresAt);
          return {
            label: domain.name.replace(/\.arc$/, ''),
            name: domain.name,
            tokenId: domain.tokenId,
            expiresAt: domain.expiresAt,
            status: info.status,
            releasesAt: info.releasesAt,
            listing: domain.listing
              ? {
                  seller: domain.listing.seller as Address,
                  priceWei: BigInt(domain.listing.priceWei),
                  currency: domain.listing.currency,
                }
              : null,
          };
        });

        // The indexer can lag; listing state drives a Buy/Unlist button, so
        // it's re-read from the market contract before being shown.
        return { names: await attachListings(publicClient, names), source: 'indexer', incomplete: false };
      } catch {
        const { names, incomplete } = await scanOwnedNames(publicClient, address);
        return { names: await attachListings(publicClient, names), source: 'chain', incomplete };
      }
    },
  });
}
