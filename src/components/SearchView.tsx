import { useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { AlertCircle, Check, Clock, Search as SearchIcon, X } from 'lucide-react';
import { useNameSearch } from '../hooks/useNameSearch';
import { describeError } from '../lib/errors';
import { formatDate, formatNative, shortenAddress } from '../lib/format';
import { fullName } from '../lib/names';
import { Badge, Button, Card, Input, Skeleton } from './ui';
import { RegistrationPanel } from './RegistrationPanel';
import { NameArtwork } from './NameArtwork';

export function SearchView() {
  const [query, setQuery] = useState('');
  const { label, result, isLoading, isStale, error, refetch } = useNameSearch(query);
  const { isConnected } = useAccount();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-16">
      <div className="text-center">
        <img src="/logo.png" alt="" aria-hidden className="mx-auto mb-5 size-16 sm:size-20" />
        <h1 className="text-3xl font-bold text-ink sm:text-5xl">Your name on Arc</h1>
        <p className="mx-auto mt-3 max-w-lg text-sm text-ink-muted sm:text-base">
          Register a <span className="font-mono text-accent">.arc</span> name — one identity for payments,
          profiles and apps across the network.
        </p>
      </div>

      <form
        className="mt-8"
        onSubmit={(event) => event.preventDefault()}
        role="search"
      >
        <label htmlFor="name-search" className="sr-only">
          Search for a name
        </label>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-subtle" aria-hidden />
          <Input
            id="name-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="search for a name"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            suffix=".arc"
            className="h-14 rounded-xl pl-12 text-base"
          />
        </div>
      </form>

      <div className="mt-6" aria-live="polite">
        {!label ? null : isLoading || isStale ? (
          <Card className="p-5">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="mt-3 h-4 w-32" />
          </Card>
        ) : error ? (
          // Every branch below needs `result`, which is undefined when the
          // lookup failed — so without this the component rendered nothing at
          // all and searching looked broken rather than unavailable.
          <Card className="flex items-start gap-3 p-5">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-negative" aria-hidden />
            <div className="flex-1">
              <p className="font-medium text-ink">Couldn't check that name</p>
              <p className="mt-1 text-sm text-ink-muted">{describeError(error)}</p>
              <Button size="sm" variant="secondary" className="mt-3" onClick={() => void refetch()}>
                Try again
              </Button>
            </div>
          </Card>
        ) : result ? (
          <SearchResult result={result} isConnected={isConnected} />
        ) : null}
      </div>
    </div>
  );
}

function SearchResult({
  result,
  isConnected,
}: {
  result: NonNullable<ReturnType<typeof useNameSearch>['result']>;
  isConnected: boolean;
}) {
  const name = useMemo(() => fullName(result.label), [result.label]);

  if (result.status === 'invalid') {
    return (
      <Card className="flex items-start gap-3 p-5">
        <X className="mt-0.5 size-5 shrink-0 text-negative" aria-hidden />
        <div>
          <p className="font-medium text-ink">Not a usable name</p>
          <p className="mt-1 text-sm text-ink-muted">{result.reason}</p>
        </div>
      </Card>
    );
  }

  if (result.status === 'available') {
    return (
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <NameArtwork label={result.label} className="size-16 shrink-0 rounded-xl" />
            <div>
              <p className="font-display text-xl font-semibold text-ink">{name}</p>
              <Badge tone="positive" className="mt-1">
                <Check className="size-3" aria-hidden />
                Available
              </Badge>
            </div>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xs uppercase tracking-wide text-ink-subtle">Price per year</p>
            <p className="font-mono text-lg text-ink">
              {result.priceWei === null ? '—' : `${formatNative(result.priceWei)} USDC`}
            </p>
          </div>
        </div>

        <div className="border-t border-border bg-surface-raised/40 p-5">
          {isConnected ? (
            <RegistrationPanel label={result.label} />
          ) : (
            <p className="text-sm text-ink-muted">Connect a wallet to register this name.</p>
          )}
        </div>
      </Card>
    );
  }

  // Registered, or inside the grace period.
  const inGrace = result.status === 'grace';

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <NameArtwork label={result.label} className="size-16 shrink-0 rounded-xl" />
          <div>
            <p className="font-display text-xl font-semibold text-ink">{name}</p>
            <Badge tone={inGrace ? 'warning' : 'neutral'} className="mt-1">
              {inGrace ? <Clock className="size-3" aria-hidden /> : <AlertCircle className="size-3" aria-hidden />}
              {inGrace ? 'In grace period' : 'Taken'}
            </Badge>
          </div>
        </div>
        <div className="space-y-1 text-sm sm:text-right">
          {result.owner ? (
            <p className="text-ink-muted">
              Owner <span className="font-mono text-ink">{shortenAddress(result.owner)}</span>
            </p>
          ) : null}
          {result.expiresAt ? (
            <p className="text-ink-muted">
              {inGrace ? 'Expired' : 'Expires'} {formatDate(result.expiresAt)}
            </p>
          ) : null}
        </div>
      </div>

      {inGrace && result.releasesAt ? (
        // The 90-day grace window is the single most confusing state in the
        // protocol, and the old UI didn't model it at all — it showed expired
        // names as available and let people burn gas on a guaranteed revert.
        <p className="mt-4 rounded-lg border border-warning/25 bg-warning/10 p-3 text-sm text-warning">
          This name has expired but is still locked to its owner, who can renew it at any time. If they don't, it
          becomes available to register on {formatDate(result.releasesAt)}.
        </p>
      ) : null}
    </Card>
  );
}
