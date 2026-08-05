import { useState } from 'react';
import { useAccount } from 'wagmi';
import { AlertTriangle, Clock, ExternalLink, Settings2, Store, Tag, Wallet } from 'lucide-react';
import { explorerTokenUrl } from '../config/chain';
import { contracts } from '../config/contracts';
import { formatDate, formatNative } from '../lib/format';
import { usePortfolio, type PortfolioName } from '../hooks/usePortfolio';
import { useMarketActions } from '../hooks/useMarketplace';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from './ui';
import { NameArtwork } from './NameArtwork';
import { RenewDialog } from './RenewDialog';
import { ListDialog } from './ListDialog';
import { RecordsDialog } from './RecordsDialog';

export function PortfolioView() {
  const { isConnected } = useAccount();
  const { data, isLoading, isError, error, refetch } = usePortfolio();
  const [renewing, setRenewing] = useState<PortfolioName | null>(null);
  const [listing, setListing] = useState<PortfolioName | null>(null);
  const [editing, setEditing] = useState<PortfolioName | null>(null);

  if (!isConnected) {
    return (
      <EmptyState
        icon={<Wallet className="size-8" />}
        title="Connect your wallet"
        description="Your .arc names will appear here once you're connected."
      />
    );
  }

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <Card key={index} className="p-4">
            <Skeleton className="aspect-square w-full rounded-xl" />
            <Skeleton className="mt-3 h-5 w-32" />
            <Skeleton className="mt-2 h-4 w-24" />
          </Card>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        title="Could not load your names"
        detail={error instanceof Error ? error.message : undefined}
        onRetry={() => refetch()}
      />
    );
  }

  if (!data || data.names.length === 0) {
    return (
      <EmptyState
        icon={<Tag className="size-8" />}
        title="No names yet"
        description="Search for a name to register your first one."
      />
    );
  }

  return (
    <div className="space-y-4">
      {data.source === 'chain' ? (
        // Being explicit about the degraded path: this list came from a direct
        // log scan because the indexer was unreachable, so it may be missing
        // names and definitely has no listing history.
        <p className="rounded-lg border border-border bg-surface-raised/50 p-3 text-xs text-ink-muted">
          Loaded directly from the chain because the indexer is unavailable.
          {data.incomplete ? ' Some blocks could not be read, so this list may be incomplete.' : ''}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.names.map((name) => (
          <NameCard
            key={name.tokenId}
            name={name}
            onRenew={() => setRenewing(name)}
            onList={() => setListing(name)}
            onEdit={() => setEditing(name)}
          />
        ))}
      </div>

      <RenewDialog name={renewing} onClose={() => setRenewing(null)} />
      <ListDialog name={listing} onClose={() => setListing(null)} />
      <RecordsDialog name={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function NameCard({
  name,
  onRenew,
  onList,
  onEdit,
}: {
  name: PortfolioName;
  onRenew: () => void;
  onList: () => void;
  onEdit: () => void;
}) {
  const { unlist } = useMarketActions();
  const expiringSoon = name.status === 'active' && name.expiresAt - Date.now() / 1000 < 30 * 24 * 60 * 60;

  return (
    <Card className="flex flex-col overflow-hidden">
      <NameArtwork label={name.label} className="aspect-square w-full border-0 border-b" />

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-semibold text-ink">{name.name}</p>
            <p className="text-xs text-ink-subtle">
              {name.status === 'grace' ? 'Expired' : 'Expires'} {formatDate(name.expiresAt)}
            </p>
          </div>
          <a
            href={explorerTokenUrl(contracts.registrar, name.tokenId)}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded p-1 text-ink-subtle transition-colors hover:text-ink"
            aria-label={`View ${name.name} on the explorer`}
          >
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {name.status === 'grace' ? (
            <Badge tone="negative">
              <AlertTriangle className="size-3" aria-hidden />
              In grace — renew now
            </Badge>
          ) : expiringSoon ? (
            <Badge tone="warning">
              <Clock className="size-3" aria-hidden />
              Expiring soon
            </Badge>
          ) : (
            <Badge tone="positive">Active</Badge>
          )}
          {name.listing ? (
            <Badge tone="accent">
              <Store className="size-3" aria-hidden />
              Listed for {formatNative(name.listing.priceWei)} USDC
            </Badge>
          ) : null}
        </div>

        {name.status === 'grace' ? (
          <p className="rounded-lg border border-negative/25 bg-negative/10 p-2 text-xs text-negative">
            Renew before {formatDate(name.releasesAt)} or anyone will be able to register it.
          </p>
        ) : null}

        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={onRenew}>
            Renew
          </Button>
          {name.listing ? (
            <Button size="sm" variant="secondary" onClick={() => unlist(name.tokenId, name.name)}>
              Unlist
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={onList} disabled={name.status !== 'active'}>
              Sell
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={onEdit}
            disabled={!name.label}
            icon={<Settings2 className="size-3.5" />}
          >
            Records
          </Button>
        </div>
      </div>
    </Card>
  );
}
