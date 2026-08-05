import { useState } from 'react';
import { parseUnits } from 'viem';
import { NATIVE_DECIMALS } from '../config/chain';
import { useMarketActions } from '../hooks/useMarketplace';
import type { PortfolioName } from '../hooks/usePortfolio';
import { Button, Input } from './ui';
import { Modal } from './ui/Modal';

export function ListDialog({ name, onClose }: { name: PortfolioName | null; onClose: () => void }) {
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const { list } = useMarketActions();

  if (!name) return null;

  const parsed = (() => {
    if (!price.trim()) return null;
    try {
      const value = parseUnits(price.trim(), NATIVE_DECIMALS);
      return value > 0n ? value : null;
    } catch {
      return null;
    }
  })();

  return (
    <Modal
      open
      onClose={onClose}
      title={`Sell ${name.name}`}
      description="Listing requires a one-time marketplace approval, then the listing itself."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={parsed === null}
            onClick={async () => {
              if (parsed === null) return;
              setBusy(true);
              try {
                await list(name.tokenId, parsed, name.name);
                onClose();
              } catch {
                /* surfaced by useTx */
              } finally {
                setBusy(false);
              }
            }}
          >
            List for sale
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label htmlFor="list-price" className="mb-1.5 block text-sm text-ink-muted">
            Price
          </label>
          <Input
            id="list-price"
            inputMode="decimal"
            placeholder="0.00"
            suffix="USDC"
            value={price}
            invalid={price.trim().length > 0 && parsed === null}
            onChange={(event) => setPrice(event.target.value)}
          />
          {price.trim().length > 0 && parsed === null ? (
            <p className="mt-1.5 text-xs text-negative">Enter a price greater than zero.</p>
          ) : null}
        </div>

        <p className="text-xs text-ink-subtle">
          You keep ownership until someone buys. You can change the price or unlist at any time, and the name
          stays renewable while it's listed.
        </p>
      </div>
    </Modal>
  );
}
