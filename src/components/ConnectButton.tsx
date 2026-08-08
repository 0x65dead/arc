import { ConnectButton as RainbowConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { AlertTriangle, ChevronDown, Wallet } from 'lucide-react';
import { shortenAddress } from '../lib/format';
import { usePrimaryName } from '../hooks/useRecords';
import { Button } from './ui';

/**
 * Wallet connect / account button.
 *
 * The wallet picker, the account panel and the disconnect action are
 * RainbowKit's — the hand-rolled dropdown this replaced had no backdrop, no
 * outside-click close, no Escape handler and no wallet icons, and because the
 * only connector was `injected()` a phone browser had no way to connect at all.
 *
 * What is *not* RainbowKit's is the label. Its built-in account button resolves
 * ENS against mainnet and knows nothing about `.arc`, so the name still comes
 * from `usePrimaryName` here and is passed into `ConnectButton.Custom`.
 */
export function ConnectButton() {
  const { address } = useAccount();
  const { data: primary } = usePrimaryName(address);

  // A reverse record that doesn't forward-resolve back is a claim, not a fact,
  // so an unverified name never becomes the label — the address stays. The
  // claim is still surfaced, because silently ignoring it looks like the name
  // was never set.
  const verifiedName = primary?.verified && primary.name ? primary.name : null;
  const unverifiedName = primary?.name && !primary.verified ? primary.name : null;

  return (
    <RainbowConnectButton.Custom>
      {({ account, chain, openConnectModal, openAccountModal, openChainModal, mounted }) => {
        const connected = mounted && account && chain;

        return (
          <div
            // Hidden rather than unmounted until mounted, so the button does not
            // flash the disconnected state on first paint or shift the header.
            {...(!mounted && {
              'aria-hidden': true,
              style: { opacity: 0, pointerEvents: 'none', userSelect: 'none' },
            })}
          >
            {!connected ? (
              <Button icon={<Wallet className="size-4" />} onClick={openConnectModal}>
                Connect
              </Button>
            ) : chain.unsupported ? (
              <Button
                variant="danger"
                icon={<AlertTriangle className="size-4" aria-hidden />}
                onClick={openChainModal}
              >
                Wrong network
              </Button>
            ) : (
              <Button variant="secondary" onClick={openAccountModal}>
                <span className="size-2 rounded-full bg-positive" aria-hidden />
                <span className="max-w-[10rem] truncate">
                  {verifiedName ?? shortenAddress(account.address)}
                </span>
                {unverifiedName ? (
                  <span
                    role="img"
                    aria-label={`${unverifiedName} is claimed by this address but unverified, so it is not shown as your name`}
                    title={`${unverifiedName} is claimed but unverified`}
                    className="inline-flex shrink-0"
                  >
                    <AlertTriangle className="size-3.5 text-warning" aria-hidden />
                  </span>
                ) : null}
                <ChevronDown className="size-3.5" aria-hidden />
              </Button>
            )}
          </div>
        );
      }}
    </RainbowConnectButton.Custom>
  );
}
