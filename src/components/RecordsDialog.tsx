import { useEffect, useState } from 'react';
import { isAddress, type Address } from 'viem';
import { useAccount } from 'wagmi';
import { Star } from 'lucide-react';
import { TEXT_KEYS, useRecordActions, useRecords, usePrimaryName, useSetPrimaryName } from '../hooks/useRecords';
import type { PortfolioName } from '../hooks/usePortfolio';
import { describeError } from '../lib/errors';
import { Button, Input, Skeleton } from './ui';
import { Modal } from './ui/Modal';

const LABELS: Record<string, string> = {
  description: 'Description',
  url: 'Website',
  avatar: 'Avatar URL',
  'com.twitter': 'X / Twitter',
  'com.github': 'GitHub',
  email: 'Email',
};

export function RecordsDialog({ name, onClose }: { name: PortfolioName | null; onClose: () => void }) {
  const label = name?.label ?? '';
  const { address } = useAccount();
  const { data: records, isLoading, isError, error, refetch } = useRecords(label);
  const { setAddress, setText, bindResolver } = useRecordActions(label);
  const { data: primary } = usePrimaryName(address);
  const setPrimaryName = useSetPrimaryName();

  const [addrValue, setAddrValue] = useState('');
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  /**
   * Every action here goes through `useTx`, which already shows the failure as
   * a toast and then re-throws so callers can stop. Without this catch the
   * rejection escapes the async onClick with nobody left to handle it, which is
   * what produced the `Uncaught (in promise) ContractFunctionExecutionError`
   * flood whenever the RPC was unreachable.
   */
  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusyKey(key);
    try {
      await action();
    } catch {
      /* already surfaced by useTx */
    } finally {
      setBusyKey(null);
    }
  };

  useEffect(() => {
    setAddrValue(records?.addr ?? '');
    setTexts(Object.fromEntries(TEXT_KEYS.map((key) => [key, records?.texts?.[key] ?? ''])));
  }, [records]);

  if (!name) return null;

  const isPrimary = primary?.name === name.name && primary.verified;
  const addrInvalid = addrValue.trim().length > 0 && !isAddress(addrValue.trim());

  return (
    <Modal open onClose={onClose} title={`Records for ${name.name}`}>
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : isError ? (
        // A failed read is not the same as "no records". Rendering the branch
        // below on error told the owner their name had no resolver and offered
        // to set one — a transaction that would have been a no-op at best.
        <div className="space-y-3 rounded-lg border border-negative/25 bg-negative/10 p-3">
          <p className="text-sm text-negative">Couldn't load records for {name.name}.</p>
          <p className="text-xs text-ink-muted">{describeError(error)}</p>
          <Button size="sm" variant="secondary" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          {!records?.resolver ? (
            // Without a resolver bound in the registry there is nowhere to
            // write records to. The old UI wrote to the default resolver
            // regardless, which silently stored data that nothing resolved.
            <div className="space-y-2 rounded-lg border border-warning/25 bg-warning/10 p-3">
              <p className="text-sm text-warning">
                This name has no resolver, so it can't store records yet.
              </p>
              <Button
                size="sm"
                variant="secondary"
                loading={busyKey === 'resolver'}
                onClick={() => run('resolver', bindResolver)}
              >
                Set a resolver
              </Button>
            </div>
          ) : (
            <>
              <div>
                <label htmlFor="record-addr" className="mb-1.5 block text-sm text-ink-muted">
                  Address this name points to
                </label>
                <div className="flex gap-2">
                  <Input
                    id="record-addr"
                    value={addrValue}
                    invalid={addrInvalid}
                    placeholder="0x…"
                    className="font-mono text-xs"
                    onChange={(event) => setAddrValue(event.target.value)}
                  />
                  <Button
                    variant="secondary"
                    loading={busyKey === 'addr'}
                    disabled={addrInvalid || addrValue.trim() === (records?.addr ?? '')}
                    onClick={() => run('addr', () => setAddress(addrValue.trim() as Address))}
                  >
                    Save
                  </Button>
                </div>
                {addrInvalid ? <p className="mt-1.5 text-xs text-negative">That isn't a valid address.</p> : null}
              </div>

              {TEXT_KEYS.map((key) => (
                <div key={key}>
                  <label htmlFor={`record-${key}`} className="mb-1.5 block text-sm text-ink-muted">
                    {LABELS[key] ?? key}
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id={`record-${key}`}
                      value={texts[key] ?? ''}
                      onChange={(event) => setTexts((current) => ({ ...current, [key]: event.target.value }))}
                    />
                    <Button
                      variant="secondary"
                      loading={busyKey === key}
                      disabled={(texts[key] ?? '') === (records?.texts?.[key] ?? '')}
                      onClick={() => run(key, () => setText(key, texts[key] ?? ''))}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ))}
            </>
          )}

          <div className="border-t border-border pt-4">
            <p className="text-sm font-medium text-ink">Primary name</p>
            <p className="mt-1 text-xs text-ink-subtle">
              Sets what apps display for your wallet address.
            </p>
            <Button
              size="sm"
              variant={isPrimary ? 'ghost' : 'secondary'}
              className="mt-2"
              disabled={isPrimary}
              loading={busyKey === 'primary'}
              icon={<Star className={isPrimary ? 'size-3.5 fill-current' : 'size-3.5'} />}
              onClick={() => run('primary', () => setPrimaryName(label))}
            >
              {isPrimary ? 'This is your primary name' : 'Use as primary name'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
