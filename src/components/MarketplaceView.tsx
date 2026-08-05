import { useAccount } from 'wagmi';
import { Store } from 'lucide-react';
import { formatNative, sameAddress, shortenAddress } from '../lib/format';
import { useMarketActions, useMarketplace, type MarketListing } from '../hooks/useMarketplace';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from './ui';
import { NameArtwork } from './NameArtwork';

export function MarketplaceView() {
  const { address } = useAccount();
  const { data, isLoading, isError, error, refetch } = useMarketplace();
  const { buy, unlist } = useMarketActions();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <Card key={index} className="p-4">
            <Skeleton className="aspect-square w-full rounded-xl" />
            <Skeleton className="mt-3 h-5 w-32" />
          </Card>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        title="The marketplace is unavailable"
        detail={
          error instanceof Error
            ? `${error.message} Listings are served by the indexer, which is currently unreachable.`
            : undefined
        }
        onRetry={() => refetch()}
      />
    );
  }

  const live = (data ?? []).filter((listing) => listing.active);

  if (live.length === 0) {
    return (
      <EmptyState
        icon={<Store className="size-8" />}
        title="Nothing for sale right now"
        description="Names listed by their owners will show up here."
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {live.map((listing) => (
        <ListingCard
          key={listing.tokenId}
          listing={listing}
          isOwn={sameAddress(listing.seller, address)}
          onBuy={() => buy(listing)}
          onUnlist={() => unlist(listing.tokenId, listing.name)}
        />
      ))}
    </div>
  );
}

function ListingCard({
  listing,
  isOwn,
  onBuy,
  onUnlist,
}: {
  listing: MarketListing;
  isOwn: boolean;
  onBuy: () => void;
  onUnlist: () => void;
}) {
  return (
    <Card className="flex flex-col overflow-hidden">
      <NameArtwork label={listing.label ?? ''} className="aspect-square w-full border-0 border-b" />

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <p className="truncate font-display text-lg font-semibold text-ink">{listing.name}</p>
          <p className="text-xs text-ink-subtle">Seller {shortenAddress(listing.seller)}</p>
        </div>

        <div className="flex items-baseline justify-between">
          <span className="text-xs uppercase tracking-wide text-ink-subtle">Price</span>
          <span className="font-mono text-lg text-ink">{formatNative(listing.priceWei)} USDC</span>
        </div>

        {!listing.purchasable ? (
          // A USDC-denominated listing reverts in `buy()` unless settled in the
          // ERC-20, which this app doesn't do. Better to say so than to offer a
          // button that always fails.
          <Badge tone="warning">Priced in ERC-20 USDC — not purchasable here</Badge>
        ) : null}

        <div className="mt-auto pt-1">
          {isOwn ? (
            <Button size="sm" variant="secondary" className="w-full" onClick={onUnlist}>
              Unlist
            </Button>
          ) : (
            <Button size="sm" className="w-full" disabled={!listing.purchasable} onClick={onBuy}>
              Buy
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
