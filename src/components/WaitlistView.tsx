import { useEffect, useRef, type ReactNode } from 'react';
import { useAccount } from 'wagmi';
import confetti from 'canvas-confetti';
import {
  ArrowUpRight,
  Check,
  MessageCircle,
  PenLine,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { shortenAddress } from '../lib/format';
import { useWaitlist, useWaitlistCallback, type WaitlistState } from '../hooks/useWaitlist';
import { useToasts } from '../hooks/useToasts';
import type { WaitlistStep } from '../lib/waitlistSession';
import { ConnectButton } from './ConnectButton';
import { Badge, Button, Card, EmptyState, Skeleton, cx } from './ui';

const STEPS = [
  { id: 'connect', label: 'Connect wallet', icon: Wallet },
  { id: 'sign', label: 'Sign message', icon: PenLine },
  { id: 'join', label: 'Join Discord', icon: MessageCircle },
  { id: 'link', label: 'Connect Discord', icon: MessageCircle },
  { id: 'verify', label: 'Verify', icon: ShieldCheck },
] as const;

/**
 * Mainnet waitlist signup.
 *
 * Five steps, each one either proven by the server or observable in the
 * browser — nothing here is tracked as local progress state. The reason is
 * step 4: connecting Discord leaves the page entirely and comes back as a
 * fresh load, so any in-memory notion of "how far along am I" would be gone
 * exactly when it was needed. Everything is re-derived from `/status`.
 */
export function WaitlistView() {
  const { address, isConnected } = useAccount();
  const waitlist = useWaitlist();
  const { push } = useToasts();

  // The OAuth callback redirects back with `?waitlist=<status>`; this reads it
  // once, surfaces it as a toast and strips it from the URL.
  useWaitlistCallback((result) => push(result.kind, result.message));

  if (waitlist.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!waitlist.enabled) {
    return (
      <EmptyState
        icon={<MessageCircle className="size-8" />}
        title="The waitlist isn't open yet"
        description="Mainnet signups aren't accepting entries on this deployment. Check back shortly."
      />
    );
  }

  if (waitlist.step === 'done' && waitlist.entry) {
    return <Confirmation entry={waitlist.entry} verifiedCount={waitlist.verifiedCount} />;
  }

  return (
    <div className="space-y-5">
      <Intro verifiedCount={waitlist.verifiedCount} />

      <Card className="overflow-hidden">
        <Stepper current={waitlist.step} state={waitlist} isConnected={isConnected} />

        <div className="border-t border-border p-5">
          <ActiveStep waitlist={waitlist} isConnected={isConnected} address={address} />

          {waitlist.error ? (
            <p role="alert" className="mt-4 text-sm text-negative">
              {waitlist.error}
            </p>
          ) : null}
        </div>
      </Card>

      <p className="text-center text-xs text-ink-subtle">
        Signing is free, costs no gas, and cannot move your funds or your names.
      </p>
    </div>
  );
}

function Intro({ verifiedCount }: { verifiedCount: number }) {
  return (
    <div className="text-center">
      <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">
        Arc Names Mainnet Waitlist
      </h1>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-ink-muted">
        Connect your wallet, link Discord, and reserve your place for mainnet. Verified
        wallets get first access when registration opens.
      </p>
      {verifiedCount > 0 ? (
        <p className="mt-3 text-sm text-ink-subtle">
          <span className="font-semibold text-accent">{verifiedCount.toLocaleString()}</span>{' '}
          {verifiedCount === 1 ? 'wallet has' : 'wallets have'} joined so far
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stepper
// ---------------------------------------------------------------------------

/**
 * Whether a step is finished.
 *
 * Each answered independently rather than by position in the list, because
 * these do not complete in order. A user who connects Discord before clicking
 * the invite finishes step 4 with step 3 still outstanding — numbering that
 * off a single "current index" would then show them a completed step they
 * still have to do.
 */
function isStepDone(id: WaitlistStep, state: WaitlistState, isConnected: boolean): boolean {
  switch (id) {
    case 'connect':
      return isConnected;
    // The row exists only after a signature has been verified server-side.
    case 'sign':
      return state.entry !== null;
    case 'join':
      return state.entry?.guildMember === true;
    case 'link':
      return state.entry?.discordLinked === true;
    case 'verify':
      return state.entry?.verified === true;
    default:
      return false;
  }
}

function Stepper({
  current,
  state,
  isConnected,
}: {
  current: WaitlistStep;
  state: WaitlistState;
  isConnected: boolean;
}) {
  return (
    <ol className="flex overflow-x-auto px-2 py-3 sm:px-3">
      {STEPS.map((step, index) => {
        const done = isStepDone(step.id, state, isConnected);
        const active = current === step.id;

        return (
          <li key={step.id} className="flex min-w-0 flex-1 items-center gap-2 px-1.5 sm:px-2">
            <span
              aria-hidden
              className={cx(
                'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                done
                  ? 'border-positive/30 bg-positive/15 text-positive'
                  : active
                    ? 'border-accent bg-accent text-accent-ink'
                    : 'border-border-strong bg-surface-raised text-ink-subtle',
              )}
            >
              {done ? <Check className="size-4" /> : index + 1}
            </span>
            <span
              className={cx(
                'truncate text-xs sm:text-sm',
                active ? 'font-medium text-ink' : done ? 'text-ink-muted' : 'text-ink-subtle',
              )}
            >
              {step.label}
              {/* The screen reader gets the state the colour is carrying. */}
              <span className="sr-only">{done ? ' — done' : active ? ' — current step' : ''}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// The one action available right now
// ---------------------------------------------------------------------------

function ActiveStep({
  waitlist,
  isConnected,
  address,
}: {
  waitlist: WaitlistState;
  isConnected: boolean;
  address: string | undefined;
}) {
  if (!isConnected) {
    return (
      <Body
        title="Connect your wallet"
        description="Your place on the waitlist is tied to this address, so connect the wallet you want your mainnet names on."
      >
        <ConnectButton />
      </Body>
    );
  }

  if (waitlist.step === 'sign') {
    return (
      <Body
        title="Sign to prove the wallet is yours"
        description="A plain text message, signed in your wallet. It is not a transaction: no gas, no approval, and it cannot move anything you hold."
      >
        <Button loading={waitlist.isSigning} icon={<PenLine className="size-4" />} onClick={waitlist.signIn}>
          Sign message
        </Button>
        {address ? (
          <p className="text-xs text-ink-subtle">
            Signing as <span className="font-mono">{shortenAddress(address, 6)}</span>
          </p>
        ) : null}
      </Body>
    );
  }

  if (waitlist.step === 'link') {
    return (
      <Body
        title="Connect your Discord account"
        description={
          waitlist.autoJoin
            ? "You'll be added to the Arc Names server automatically once you authorize."
            : 'We only ask for your username and avatar — nothing is posted on your behalf.'
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button icon={<MessageCircle className="size-4" />} onClick={waitlist.connectDiscord}>
            Connect Discord
          </Button>
          {waitlist.inviteUrl && !waitlist.autoJoin ? (
            <Button
              variant="secondary"
              icon={<ArrowUpRight className="size-4" />}
              onClick={() => window.open(waitlist.inviteUrl as string, '_blank', 'noreferrer')}
            >
              Join the server first
            </Button>
          ) : null}
        </div>
      </Body>
    );
  }

  // Linked, but the bot cannot see them in the server. The invite is the
  // outstanding step even though it is numbered before the one they finished.
  if (waitlist.step === 'join') {
    return (
      <Body
        title="Join the Arc Names Discord"
        description={`We linked ${waitlist.entry?.discordUsername ?? 'your Discord account'}, but you're not in the server yet. Join, then check again — it takes a second.`}
      >
        <div className="flex flex-wrap items-center gap-2">
          {waitlist.inviteUrl ? (
            <Button
              icon={<MessageCircle className="size-4" />}
              onClick={() => window.open(waitlist.inviteUrl as string, '_blank', 'noreferrer')}
            >
              Open Discord invite
            </Button>
          ) : null}
          <Button
            variant="secondary"
            loading={waitlist.isRechecking}
            icon={<RefreshCw className="size-4" />}
            onClick={waitlist.recheck}
          >
            I've joined — check again
          </Button>
        </div>
      </Body>
    );
  }

  return (
    <Body
      title="Finishing up"
      description="Confirming your Discord membership with the Arc Names server."
    >
      <Button
        variant="secondary"
        loading={waitlist.isRechecking}
        icon={<RefreshCw className="size-4" />}
        onClick={waitlist.recheck}
      >
        Check again
      </Button>
    </Body>
  );
}

function Body({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <p className="mt-1 max-w-lg text-sm leading-relaxed text-ink-muted">{description}</p>
      </div>
      <div className="flex flex-col items-start gap-2 pt-1">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------

function Confirmation({
  entry,
  verifiedCount,
}: {
  entry: NonNullable<WaitlistState['entry']>;
  verifiedCount: number;
}) {
  const celebrated = useRef(false);

  useEffect(() => {
    // Once per mount, and never for someone who has asked for reduced motion.
    // This screen is also what a returning visitor lands on, so firing on
    // every render would confetti them each time they open the tab.
    if (celebrated.current) return;
    celebrated.current = true;
    confetti({ particleCount: 90, spread: 70, origin: { y: 0.7 }, disableForReducedMotion: true });
  }, []);

  return (
    <div className="mx-auto max-w-lg text-center">
      <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-positive/15 text-positive">
        <Check className="size-7" aria-hidden />
      </span>

      <h1 className="mt-4 font-display text-2xl font-bold text-ink sm:text-3xl">
        You're on the Arc Names Mainnet Waitlist 🎉
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        Your wallet and Discord account are verified. We'll announce mainnet registration in
        the server — keep an eye on it.
      </p>

      <Card className="mt-6 divide-y divide-border text-left">
        <Row label="Wallet">
          <span className="font-mono text-sm text-ink">{shortenAddress(entry.address, 6)}</span>
        </Row>

        <Row label="Discord">
          <span className="flex items-center gap-2">
            {entry.discordAvatar ? (
              <img
                src={entry.discordAvatar}
                alt=""
                aria-hidden
                className="size-5 rounded-full"
                loading="lazy"
              />
            ) : null}
            <span className="truncate text-sm text-ink">{entry.discordUsername ?? 'Linked'}</span>
          </span>
        </Row>

        {entry.position !== null ? (
          <Row label="Position">
            <Badge tone="accent">
              #{entry.position.toLocaleString()}
              {verifiedCount > 0 ? ` of ${verifiedCount.toLocaleString()}` : ''}
            </Badge>
          </Row>
        ) : null}

        <Row label="Status">
          {/* Role grants are best-effort — the bot can be missing the
              permission or sit below the role in the hierarchy. Saying so
              beats implying the role is there when it isn't. */}
          <Badge tone={entry.roleGranted ? 'positive' : 'neutral'}>
            {entry.roleGranted ? 'Waitlist role granted' : 'Verified'}
          </Badge>
        </Row>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-sm text-ink-muted">{label}</span>
      {children}
    </div>
  );
}
