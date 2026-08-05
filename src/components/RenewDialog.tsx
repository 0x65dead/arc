import { useEffect, useState } from 'react';
import { formatDate, formatNative } from '../lib/format';
import { YEAR_SECONDS } from '../config/contracts';
import { useRenewal } from '../hooks/useRenewal';
import type { PortfolioName } from '../hooks/usePortfolio';
import { Button, Input } from './ui';
import { Modal } from './ui/Modal';

export function RenewDialog({ name, onClose }: { name: PortfolioName | null; onClose: () => void }) {
  const [years, setYears] = useState(1);
  const [price, setPrice] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const { renew, quote } = useRenewal();

  useEffect(() => {
    if (!name?.label) return;
    let cancelled = false;
    setPrice(null);
    quote(name.label, years).then((value) => {
      if (!cancelled) setPrice(value);
    });
    return () => {
      cancelled = true;
    };
  }, [name?.label, years, quote]);

  if (!name) return null;

  // Renewal extends from the current expiry, not from now — including for a
  // name in grace, which is why the projected date is computed off `expiresAt`
  // rather than the wall clock.
  const newExpiry = name.expiresAt + years * YEAR_SECONDS;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Renew ${name.name}`}
      description={
        name.status === 'grace'
          ? 'This name has expired. Renewing now recovers it before it is released.'
          : undefined
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!name.label}
            onClick={async () => {
              setBusy(true);
              try {
                await renew(name.label, years);
                onClose();
              } catch {
                /* surfaced by useTx */
              } finally {
                setBusy(false);
              }
            }}
          >
            Renew for {years} {years === 1 ? 'year' : 'years'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="renew-years" className="mb-1.5 block text-sm text-ink-muted">
            Years
          </label>
          <Input
            id="renew-years"
            type="number"
            min={1}
            max={10}
            value={years}
            onChange={(event) => setYears(Math.max(1, Math.min(10, Number(event.target.value) || 1)))}
          />
        </div>

        <dl className="space-y-2 rounded-lg border border-border bg-surface-raised/40 p-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-muted">New expiry</dt>
            <dd className="text-ink">{formatDate(newExpiry)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-muted">Cost</dt>
            <dd className="font-mono text-ink">{price === null ? '…' : `${formatNative(price)} USDC`}</dd>
          </div>
        </dl>
      </div>
    </Modal>
  );
}
