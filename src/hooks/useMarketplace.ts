import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import type { Address } from 'viem';
import { ListingCurrency, marketAbi, registrarAbi } from '../config/abis';
import { contracts } from '../config/contracts';
import { indexerApi } from '../lib/indexer';
import { fullName } from '../lib/names';
import { queryKeys } from '../lib/queryKeys';
import { useTx } from './useTx';
import { useToasts } from './useToasts';

export interface MarketListing {
  tokenId: string;
  label: string | null;
  name: string;
  seller: Address;
  priceWei: bigint;
  currency: number;
  /**
   * False when the listing exists in the index but the market contract no
   * longer considers it live (name transferred away, approval revoked).
   */
  active: boolean;
  /**
   * The market's `buy()` requires `listingCurrency[id] == 0`. USDC-denominated
   * listings exist on-chain but cannot be settled by this UI, so they are shown
   * as not purchasable instead of offering a button that always reverts.
   */
  purchasable: boolean;
}

export function useMarketplace() {
  const publicClient = usePublicClient();

  return useQuery<MarketListing[]>({
    queryKey: queryKeys.marketplace,
    enabled: Boolean(publicClient),
    staleTime: 20_000,
    retry: 1,
    queryFn: async (): Promise<MarketListing[]> => {
      if (!publicClient) throw new Error('No RPC client available');

      const { items } = await indexerApi.marketplace({ limit: 100 });

      // Every listing is re-validated against `getListing`, which re-checks
      // ownership and approval. Reading the raw `listings` mapping — what the
      // old UI did — happily returns a price for a listing whose seller has
      // since moved the name, and `buy` then reverts with "seller changed".
      return Promise.all(
        items.map(async (item): Promise<MarketListing> => {
          const tokenId = BigInt(item.tokenId);
          let active = true;
          let priceWei = BigInt(item.priceWei);
          let seller = item.seller as Address;

          try {
            const [chainSeller, chainPrice, chainActive] = await publicClient.readContract({
              address: contracts.market,
              abi: marketAbi,
              functionName: 'getListing',
              args: [tokenId],
            });
            active = chainActive;
            priceWei = chainPrice;
            seller = chainSeller;
          } catch {
            active = false;
          }

          let label = item.name?.replace(/\.arc$/, '') ?? null;
          if (!label) {
            label = await publicClient
              .readContract({
                address: contracts.registrar,
                abi: registrarAbi,
                functionName: 'labels',
                args: [tokenId],
              })
              .catch(() => null);
          }

          return {
            tokenId: item.tokenId,
            label,
            name: label ? fullName(label) : `#${item.tokenId.slice(0, 10)}…`,
            seller,
            priceWei,
            currency: item.currency,
            active,
            purchasable: active && item.currency === ListingCurrency.Native,
          };
        }),
      );
    },
  });
}

/** List / reprice / unlist / buy. */
export function useMarketActions() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();
  const { runTx } = useTx();
  const toasts = useToasts();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.marketplace });
    queryClient.invalidateQueries({ queryKey: queryKeys.portfolio(address) });
    queryClient.invalidateQueries({ queryKey: queryKeys.activity() });
  }, [address, queryClient]);

  const list = useCallback(
    async (tokenId: string, priceWei: bigint, name: string) => {
      if (!publicClient || !address) return;

      // `ArcMarket.list` requires an approval; without it the call reverts with
      // "!approved". Checking first lets us prompt for the approval as an
      // explicit step rather than surfacing an opaque revert.
      const [approved, approvedForAll] = await Promise.all([
        publicClient.readContract({
          address: contracts.registrar,
          abi: registrarAbi,
          functionName: 'getApproved',
          args: [BigInt(tokenId)],
        }),
        publicClient.readContract({
          address: contracts.registrar,
          abi: registrarAbi,
          functionName: 'isApprovedForAll',
          args: [address, contracts.market],
        }),
      ]);

      if (!approvedForAll && approved.toLowerCase() !== contracts.market.toLowerCase()) {
        const approvalHash = await runTx({
          pending: 'Approving the marketplace',
          success: 'Marketplace approved',
          request: {
            address: contracts.registrar,
            abi: registrarAbi,
            functionName: 'setApprovalForAll',
            args: [contracts.market, true],
          },
        });
        if (!approvalHash) return;
      }

      await runTx({
        pending: `Listing ${name}`,
        success: `${name} is listed`,
        request: {
          address: contracts.market,
          abi: marketAbi,
          functionName: 'list',
          args: [BigInt(tokenId), priceWei],
        },
      });
      invalidate();
    },
    [address, invalidate, publicClient, runTx],
  );

  const setPrice = useCallback(
    async (tokenId: string, priceWei: bigint, name: string) => {
      await runTx({
        pending: `Updating the price for ${name}`,
        success: `Price updated`,
        request: {
          address: contracts.market,
          abi: marketAbi,
          functionName: 'setPrice',
          args: [BigInt(tokenId), priceWei],
        },
      });
      invalidate();
    },
    [invalidate, runTx],
  );

  const unlist = useCallback(
    async (tokenId: string, name: string) => {
      await runTx({
        pending: `Removing ${name} from the marketplace`,
        success: `${name} is no longer listed`,
        request: {
          address: contracts.market,
          abi: marketAbi,
          functionName: 'unlist',
          args: [BigInt(tokenId)],
        },
      });
      invalidate();
    },
    [invalidate, runTx],
  );

  const buy = useCallback(
    async (listing: MarketListing) => {
      if (!publicClient) return;

      if (listing.currency !== ListingCurrency.Native) {
        toasts.push('error', 'This name is listed in ERC-20 USDC, which this app cannot settle.');
        return;
      }

      // Re-read the price at purchase time and pass it as `maxPrice`. The
      // contract compares `l.price <= maxPrice`, so quoting from a stale index
      // means either overpaying silently or reverting with "price moved".
      const [, currentPrice, active] = await publicClient.readContract({
        address: contracts.market,
        abi: marketAbi,
        functionName: 'getListing',
        args: [BigInt(listing.tokenId)],
      });

      if (!active) {
        toasts.push('error', `${listing.name} is no longer for sale.`);
        invalidate();
        return;
      }

      await runTx({
        pending: `Buying ${listing.name}`,
        success: `${listing.name} is yours`,
        request: {
          address: contracts.market,
          abi: marketAbi,
          functionName: 'buy',
          args: [BigInt(listing.tokenId), currentPrice],
          value: currentPrice,
        },
      });
      invalidate();
    },
    [invalidate, publicClient, runTx, toasts],
  );

  return { list, setPrice, unlist, buy };
}
