import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import confetti from 'canvas-confetti';
import { Check, Clock, Minus, Plus, RotateCcw } from 'lucide-react';
import { controllerAbi } from '../config/abis';
import { contracts } from '../config/contracts';
import { formatCountdown, formatNative } from '../lib/format';
import { fullName, yearsToSeconds } from '../lib/names';
import { useProtocolParams } from '../hooks/useProtocolParams';
import { useRegistration } from '../hooks/useRegistration';
import { Button } from './ui';

const MAX_YEARS = 10;

/**
 * The commit → wait → register flow, as three visible steps.
 *
 * The waiting step is the part that needs explaining. `commit()` and
 * `register()` are two separate transactions separated by a mandatory delay,
 * and the old UI presented them as one "Register" button that appeared to hang
 * for a minute. Here the wait is a labelled step with a countdown and an
 * explicit expiry — because the commitment does expire, and letting it lapse
 * wastes the gas already spent.
 */
export function RegistrationPanel({ label }: { label: string }) {
  const [years, setYears] = useState(1);
  const publicClient = usePublicClient();
  const { data: params } = useProtocolParams();
  const { step, secondsUntilReady, secondsUntilExpiry, isBusy, commit, register, reset } = useRegistration(
    label,
    years,
  );

  const { data: priceWei } = useQuery({
    queryKey: ['price', label, years],
    enabled: Boolean(publicClient && label),
    staleTime: 60_000,
    queryFn: async () => {
      if (!publicClient) return null;
      return publicClient.readContract({
        address: contracts.controller,
        abi: controllerAbi,
        functionName: 'price',
        args: [label, yearsToSeconds(years)],
      });
    },
  });

  useEffect(() => {
    if (step !== 'complete') return;
    confetti({ particleCount: 90, spread: 70, origin: { y: 0.7 }, disableForReducedMotion: true });
  }, [step]);

  if (step === 'complete') {
    return (
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-full bg-positive/15 text-positive">
          <Check className="size-5" aria-hidden />
        </span>
        <div>
          <p className="font-medium text-ink">{fullName(label)} is registered</p>
          <p className="text-sm text-ink-muted">It's in your names now.</p>
        </div>
      </div>
    );
  }

  const waitSeconds = params?.minCommitAge ?? 60;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink">Registration length</p>
          <p className="text-xs text-ink-subtle">Renewable at any time, including after expiry.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-label="Decrease by one year"
            disabled={years <= 1 || step !== 'idle'}
            onClick={() => setYears((value) => Math.max(1, value - 1))}
          >
            <Minus className="size-3.5" aria-hidden />
          </Button>
          <span className="w-20 text-center font-mono text-sm text-ink">
            {years} {years === 1 ? 'year' : 'years'}
          </span>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Increase by one year"
            disabled={years >= MAX_YEARS || step !== 'idle'}
            onClick={() => setYears((value) => Math.min(MAX_YEARS, value + 1))}
          >
            <Plus className="size-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-3">
        <span className="text-sm text-ink-muted">Total</span>
        <span className="font-mono text-base text-ink">
          {priceWei === null || priceWei === undefined ? '—' : `${formatNative(priceWei)} USDC`}
        </span>
      </div>

      <ol className="space-y-2">
        <Step
          index={1}
          title="Reserve the name"
          detail="A first transaction records a private commitment on-chain."
          state={step === 'idle' || step === 'committing' ? 'active' : 'done'}
        />
        <Step
          index={2}
          title={`Wait ${formatCountdown(waitSeconds)}`}
          detail={
            step === 'waiting'
              ? `Ready in ${formatCountdown(secondsUntilReady)}.`
              : 'The delay stops anyone front-running your registration.'
          }
          state={step === 'waiting' ? 'active' : step === 'ready' || step === 'registering' ? 'done' : 'pending'}
        />
        <Step
          index={3}
          title="Complete registration"
          detail="A second transaction reveals the commitment and mints the name."
          state={step === 'ready' || step === 'registering' ? 'active' : 'pending'}
        />
      </ol>

      {step === 'expired' ? (
        <div className="space-y-3 rounded-lg border border-negative/25 bg-negative/10 p-3">
          <p className="text-sm text-negative">
            Your reservation expired before it was used, so it can no longer be redeemed. Reserving again costs
            another transaction.
          </p>
          <Button variant="secondary" size="sm" icon={<RotateCcw className="size-3.5" />} onClick={reset}>
            Start over
          </Button>
        </div>
      ) : null}

      {step === 'waiting' && secondsUntilExpiry !== null ? (
        <p className="flex items-center gap-1.5 text-xs text-ink-subtle">
          <Clock className="size-3.5" aria-hidden />
          Reservation valid for another {formatCountdown(secondsUntilExpiry)}.
        </p>
      ) : null}

      <div className="flex gap-2">
        {step === 'idle' || step === 'committing' ? (
          <Button size="lg" loading={isBusy} onClick={commit} className="w-full">
            Reserve {fullName(label)}
          </Button>
        ) : step === 'waiting' ? (
          <Button size="lg" disabled className="w-full">
            Ready in {formatCountdown(secondsUntilReady)}
          </Button>
        ) : step === 'ready' || step === 'registering' ? (
          <Button size="lg" loading={isBusy} onClick={register} className="w-full">
            Complete registration
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Step({
  index,
  title,
  detail,
  state,
}: {
  index: number;
  title: string;
  detail: string;
  state: 'pending' | 'active' | 'done';
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={
          state === 'done'
            ? 'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-positive/15 text-positive'
            : state === 'active'
              ? 'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent'
              : 'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-raised text-xs font-semibold text-ink-subtle'
        }
      >
        {state === 'done' ? <Check className="size-3.5" aria-hidden /> : index}
      </span>
      <div>
        <p className={state === 'pending' ? 'text-sm text-ink-subtle' : 'text-sm font-medium text-ink'}>{title}</p>
        <p className="text-xs text-ink-subtle">{detail}</p>
      </div>
    </li>
  );
}
