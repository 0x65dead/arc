import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient } from 'wagmi';
import type { Address, Hash, Hex } from 'viem';
import { controllerAbi } from '../config/abis';
import { MAX_DURATION_SECONDS, MIN_DURATION_SECONDS, contracts } from '../config/contracts';
import { ARC_CHAIN_ID } from '../config/chain';
import { normalizeLabel, yearsToSeconds } from '../lib/names';
import { queryKeys } from '../lib/queryKeys';
import { useProtocolParams } from './useProtocolParams';
import { useTx } from './useTx';
import { useToasts } from './useToasts';

/**
 * The commit → wait → reveal registration flow.
 *
 * The hard requirement here is that the secret survives everything: a page
 * reload, a closed tab, a browser restart. `commit()` costs real gas and burns
 * a `minCommitAge` wait; if the secret is lost the commitment is unusable and
 * the user has to pay to start over. The old implementation held it in React
 * state only, so a refresh during the (60-second, on this deployment) wait
 * destroyed it silently.
 *
 * The pending commitment is therefore persisted, keyed by chain + owner + label
 * + duration — every input to `makeCommitment`, so a stored entry can never be
 * replayed against a different registration than the one it was made for.
 */

const STORAGE_KEY = 'arc:pending-commitments:v2';

export type RegistrationStep =
  | 'idle'
  | 'committing'
  | 'waiting'
  | 'ready'
  | 'registering'
  | 'complete'
  | 'expired';

interface StoredCommitment {
  chainId: number;
  label: string;
  owner: Address;
  durationSeconds: string;
  secret: Hex;
  commitment: Hex;
  /** Chain timestamp recorded in `commitments[c]`, in seconds. */
  committedAt: number;
  commitTxHash: Hash;
}

function storageKeyFor(chainId: number, owner: string, label: string, duration: bigint): string {
  return `${chainId}:${owner.toLowerCase()}:${label}:${duration}`;
}

function readStore(): Record<string, StoredCommitment> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, StoredCommitment>) : {};
  } catch {
    // Corrupt or unavailable storage (private mode, quota) is not fatal — the
    // flow still works, it just can't survive a reload.
    return {};
  }
}

function writeStore(store: Record<string, StoredCommitment>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* nothing useful to do; the commit still happened on-chain */
  }
}

function randomSecret(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}` as Hex;
}

export interface UseRegistrationResult {
  step: RegistrationStep;
  /** Seconds until the commitment matures; 0 once it's revealable. */
  secondsUntilReady: number;
  /** Seconds until the commitment expires and the gas is wasted. */
  secondsUntilExpiry: number | null;
  commitTxHash: Hash | null;
  registerTxHash: Hash | null;
  isBusy: boolean;
  commit: () => Promise<void>;
  register: () => Promise<void>;
  reset: () => void;
}

export function useRegistration(rawLabel: string, years: number): UseRegistrationResult {
  const label = normalizeLabel(rawLabel);
  const durationSeconds = yearsToSeconds(years);

  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();
  const { data: params } = useProtocolParams();
  const { runTx } = useTx();
  const toasts = useToasts();

  const [stored, setStored] = useState<StoredCommitment | null>(null);
  const [registerTxHash, setRegisterTxHash] = useState<Hash | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const key = useMemo(
    () => (address ? storageKeyFor(chainId ?? ARC_CHAIN_ID, address, label, durationSeconds) : null),
    [address, chainId, label, durationSeconds],
  );

  // Rehydrate whenever the identity of the registration changes. Switching
  // accounts mid-flow must not carry the previous account's commitment over:
  // the commitment hash binds the owner, so revealing it from another address
  // would revert with "no commit".
  useEffect(() => {
    if (!key) {
      setStored(null);
      setRegisterTxHash(null);
      return;
    }
    setStored(readStore()[key] ?? null);
    setRegisterTxHash(null);
  }, [key]);

  // Local clock for the countdown. The authoritative timestamps come from the
  // chain (`commitments[c]` and block time), not from Date.now() — a skewed
  // client clock would otherwise let the UI enable "Register" early and the
  // transaction would revert with "early".
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  const persist = useCallback(
    (value: StoredCommitment | null) => {
      if (!key) return;
      const store = readStore();
      if (value) store[key] = value;
      else delete store[key];
      writeStore(store);
      setStored(value);
    },
    [key],
  );

  const minAge = params?.minCommitAge ?? 60;
  const maxAge = params?.maxCommitAge ?? 86_400;

  const readyAt = stored ? stored.committedAt + minAge : null;
  const expiresAt = stored ? stored.committedAt + maxAge : null;

  const secondsUntilReady = readyAt ? Math.max(0, readyAt - now) : 0;
  const secondsUntilExpiry = expiresAt ? Math.max(0, expiresAt - now) : null;

  const step: RegistrationStep = (() => {
    if (registerTxHash) return 'complete';
    if (isBusy && !stored) return 'committing';
    if (!stored) return 'idle';
    if (expiresAt !== null && now >= expiresAt) return 'expired';
    if (isBusy) return 'registering';
    return secondsUntilReady > 0 ? 'waiting' : 'ready';
  })();

  const commit = useCallback(async () => {
    if (!address || !publicClient || !label) return;

    setIsBusy(true);
    try {
      const secret = randomSecret();
      const commitment = await publicClient.readContract({
        address: contracts.controller,
        abi: controllerAbi,
        functionName: 'makeCommitment',
        args: [label, address, secret],
      });

      const hash = await runTx({
        pending: `Reserving ${label}.arc`,
        success: `Reserved ${label}.arc — waiting for the commitment to mature`,
        request: {
          address: contracts.controller,
          abi: controllerAbi,
          functionName: 'commit',
          args: [commitment],
        },
      });

      if (!hash) return; // user rejected

      // Read the timestamp the contract actually recorded rather than trusting
      // the local clock. `commitments[c]` is the exact value `_doRegister`
      // compares against, so the countdown can't drift out of sync with it.
      const recorded = await publicClient.readContract({
        address: contracts.controller,
        abi: controllerAbi,
        functionName: 'commitments',
        args: [commitment],
      });

      persist({
        chainId: chainId ?? ARC_CHAIN_ID,
        label,
        owner: address,
        durationSeconds: durationSeconds.toString(),
        secret,
        commitment,
        committedAt: Number(recorded),
        commitTxHash: hash,
      });
    } catch {
      // useTx has already surfaced the reason in a toast.
    } finally {
      setIsBusy(false);
    }
  }, [address, chainId, durationSeconds, label, persist, publicClient, runTx]);

  const register = useCallback(async () => {
    if (!address || !stored || !publicClient) return;

    if (durationSeconds < BigInt(MIN_DURATION_SECONDS) || durationSeconds > BigInt(MAX_DURATION_SECONDS)) {
      toasts.push('error', 'That registration length is outside the range this registrar accepts.');
      return;
    }

    setIsBusy(true);
    try {
      // Re-quote immediately before paying. The price is a function of length
      // and duration and the tiers are owner-settable; sending a stale quote
      // reverts with "underpaid" after the user has already signed.
      const price = await publicClient.readContract({
        address: contracts.controller,
        abi: controllerAbi,
        functionName: 'price',
        args: [stored.label, durationSeconds],
      });

      const hash = await runTx({
        pending: `Registering ${stored.label}.arc`,
        success: `${stored.label}.arc is yours`,
        request: {
          address: contracts.controller,
          abi: controllerAbi,
          functionName: 'register',
          args: [stored.label, stored.owner, durationSeconds, stored.secret],
          value: price,
        },
      });

      if (!hash) return;

      setRegisterTxHash(hash);
      persist(null); // commitment is spent; keeping it would only mislead

      queryClient.invalidateQueries({ queryKey: queryKeys.search(stored.label) });
      queryClient.invalidateQueries({ queryKey: queryKeys.portfolio(address) });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats });
      queryClient.invalidateQueries({ queryKey: queryKeys.activity() });
    } catch {
      /* reported by useTx */
    } finally {
      setIsBusy(false);
    }
  }, [address, durationSeconds, persist, publicClient, queryClient, runTx, stored, toasts]);

  const reset = useCallback(() => {
    persist(null);
    setRegisterTxHash(null);
  }, [persist]);

  return {
    step,
    secondsUntilReady,
    secondsUntilExpiry,
    commitTxHash: stored?.commitTxHash ?? null,
    registerTxHash,
    isBusy,
    commit,
    register,
    reset,
  };
}
