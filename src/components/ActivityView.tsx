import { ArrowLeftRight, ExternalLink, RefreshCw, Sparkles, Store, Tag, X } from 'lucide-react';
import { explorerTxUrl } from '../config/chain';
import { formatNative, formatRelative, shortenAddress } from '../lib/format';
import { useActivity } from '../hooks/useRenewal';
import { useStats } from '../hooks/useStats';
import type { IndexerActivityItem } from '../lib/indexer';
import { Card, EmptyState, ErrorState, Skeleton } from './ui';

const KIND_META: Record<
  IndexerActivityItem['kind'],
  { icon: typeof Sparkles; label: string; tone: string }
> = {
  registration: { icon: Sparkles, label: 'Registered', tone: 'text-positive' },
  renewal: { icon: RefreshCw, label: 'Renewed', tone: 'text-accent' },
  transfer: { icon: ArrowLeftRight, label: 'Transferred', tone: 'text-ink-muted' },
  listing: { icon: Tag, label: 'Listed', tone: 'text-warning' },
  sale: { icon: Store, label: 'Sold', tone: 'text-positive' },
  unlisting: { icon: X, label: 'Unlisted', tone: 'text-ink-muted' },
};

export function ActivityView() {
  const { data, isLoading, isError, error, refetch } = useActivity();

  return (
    <div className="space-y-6">
      <StatsRow />

      <Card>
        <h2 className="border-b border-border px-5 py-3.5 text-sm font-semibold text-ink">Recent activity</h2>

        {isLoading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3, 4].map((index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            title="Activity is unavailable"
            detail={error instanceof Error ? error.message : undefined}
            onRetry={() => refetch()}
          />
        ) : !data || data.length === 0 ? (
          <EmptyState title="No activity yet" description="Registrations and sales will appear here." />
        ) : (
          <ul className="divide-y divide-border">
            {data.map((item) => {
              const meta = KIND_META[item.kind];
              const Icon = meta.icon;
              return (
                <li key={`${item.txHash}-${item.kind}-${item.tokenId ?? ''}`} className="flex items-center gap-3 px-5 py-3">
                  <Icon className={`size-4 shrink-0 ${meta.tone}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">
                      <span className="text-ink-muted">{meta.label}</span>{' '}
                      <span className="font-medium">{item.name ?? '—'}</span>
                      {item.actor ? (
                        <span className="text-ink-muted"> by {shortenAddress(item.actor)}</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-ink-subtle">{formatRelative(new Date(item.at).getTime() / 1000)}</p>
                  </div>
                  {item.amountWei ? (
                    <span className="shrink-0 font-mono text-sm text-ink">
                      {formatNative(item.amountWei)} USDC
                    </span>
                  ) : null}
                  <a
                    href={explorerTxUrl(item.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded p-1 text-ink-subtle transition-colors hover:text-ink"
                    aria-label="View transaction"
                  >
                    <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function StatsRow() {
  const { data, isLoading, unavailable } = useStats();

  const items = [
    { label: 'Names registered', value: data ? data.namesRegistered.toLocaleString() : null },
    { label: 'Currently active', value: data ? data.namesActive.toLocaleString() : null },
    { label: 'Listed for sale', value: data ? data.activeListings.toLocaleString() : null },
    {
      label: 'Volume',
      value: data ? `${formatNative(data.totalRevenueWei, { maxFractionDigits: 0 })} USDC` : null,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label} className="p-4">
          <p className="text-xs uppercase tracking-wide text-ink-subtle">{item.label}</p>
          {isLoading ? (
            <Skeleton className="mt-2 h-6 w-20" />
          ) : (
            // An em dash when the indexer is down. The previous build fell back
            // to the length of a hardcoded name list here, so it displayed a
            // confident number that had never come from the chain.
            <p className="mt-1 font-mono text-xl text-ink">{unavailable || !item.value ? '—' : item.value}</p>
          )}
        </Card>
      ))}
    </div>
  );
}
