import { useState } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { ChevronDown, LogOut, Wallet } from 'lucide-react';
import { shortenAddress } from '../lib/format';
import { usePrimaryName } from '../hooks/useRecords';
import { Button, Card } from './ui';

/**
 * Wallet connect / account menu.
 *
 * Every injected connector is offered rather than assuming a single
 * `window.ethereum`. With two extensions installed the old single-button
 * version silently connected to whichever one won the race for the injection.
 */
export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: primary } = usePrimaryName(address);
  const [open, setOpen] = useState(false);

  if (!isConnected || !address) {
    // wagmi's `injected()` connector reports itself once per discovered
    // provider (EIP-6963), so this is the real list of wallets present.
    const available = [...connectors];

    if (available.length === 0) {
      return (
        <Button
          variant="secondary"
          icon={<Wallet className="size-4" />}
          onClick={() => window.open('https://metamask.io/download/', '_blank', 'noreferrer')}
        >
          Install a wallet
        </Button>
      );
    }

    if (available.length === 1) {
      return (
        <Button loading={isPending} icon={<Wallet className="size-4" />} onClick={() => connect({ connector: available[0] })}>
          Connect
        </Button>
      );
    }

    return (
      <div className="relative">
        <Button loading={isPending} icon={<Wallet className="size-4" />} onClick={() => setOpen((v) => !v)}>
          Connect
          <ChevronDown className="size-3.5" aria-hidden />
        </Button>
        {open ? (
          <Card className="absolute right-0 z-30 mt-2 w-52 overflow-hidden p-1">
            {available.map((connector) => (
              <button
                key={connector.uid}
                type="button"
                onClick={() => {
                  connect({ connector });
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-raised"
              >
                {connector.name}
              </button>
            ))}
          </Card>
        ) : null}
      </div>
    );
  }

  const label = primary?.verified && primary.name ? primary.name : shortenAddress(address);

  return (
    <div className="relative">
      <Button variant="secondary" onClick={() => setOpen((v) => !v)}>
        <span className="size-2 rounded-full bg-positive" aria-hidden />
        <span className="max-w-[10rem] truncate">{label}</span>
        <ChevronDown className="size-3.5" aria-hidden />
      </Button>

      {open ? (
        <Card className="absolute right-0 z-30 mt-2 w-64 overflow-hidden p-1">
          <div className="border-b border-border px-3 py-2.5">
            <p className="text-xs text-ink-subtle">Connected as</p>
            <p className="font-mono text-sm text-ink">{shortenAddress(address, 6)}</p>
            {primary?.name && !primary.verified ? (
              // A reverse record that doesn't forward-resolve back is a claim,
              // not a fact. Saying so beats displaying it as if it were.
              <p className="mt-1 text-xs text-warning">
                {primary.name} is claimed but unverified
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => {
              disconnect();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink"
          >
            <LogOut className="size-4" aria-hidden />
            Disconnect
          </button>
        </Card>
      ) : null}
    </div>
  );
}
