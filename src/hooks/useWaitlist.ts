import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, useSignMessage } from 'wagmi';
import { queryKeys } from '../lib/queryKeys';
import {
  WaitlistError,
  waitlistApi,
  type WaitlistConfig,
  type WaitlistEntry,
  type WaitlistStatus,
} from '../lib/waitlist';
import {
  clearSession,
  deriveStep,
  readSession,
  writeSession,
  type WaitlistStep,
} from '../lib/waitlistSession';

/**
 * Whether this deployment has a waitlist at all.
 *
 * Asked separately from status, and cached for the session: it is the answer
 * to "should this tab exist", so it must resolve before the address is known
 * and must not refetch on every focus.
 */
export function useWaitlistConfig() {
  return useQuery<WaitlistConfig>({
    queryKey: queryKeys.waitlistConfig,
    queryFn: () => waitlistApi.config(),
    staleTime: 5 * 60_000,
    // A 503 here means the server has no Discord credentials — retrying will
    // not conjure them, and each retry delays hiding the tab.
    retry: false,
  });
}

export interface WaitlistState {
  step: WaitlistStep;
  entry: WaitlistEntry | null;
  verifiedCount: number;
  inviteUrl: string | null;
  autoJoin: boolean;
  enabled: boolean;
  isLoading: boolean;
  /** Set when the last action failed, in words meant for a user. */
  error: string | null;
  isSigning: boolean;
  isRechecking: boolean;
  signIn: () => void;
  connectDiscord: () => void;
  recheck: () => void;
  reset: () => void;
}

export function useWaitlist(): WaitlistState {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const queryClient = useQueryClient();
  const config = useWaitlistConfig();

  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState(() => readSession(address));

  // The stored session is keyed to one address; re-read it whenever the
  // connected account changes so switching wallets in the extension shows the
  // new wallet's state rather than the old wallet's session.
  useEffect(() => {
    setSession(readSession(address));
    setError(null);
  }, [address]);

  const status = useQuery<WaitlistStatus>({
    queryKey: queryKeys.waitlistStatus(address),
    queryFn: () => waitlistApi.status(address as string),
    enabled: Boolean(address) && config.data?.enabled === true,
    staleTime: 15_000,
  });

  const entry = status.data?.entry ?? null;

  const signIn = useMutation({
    mutationFn: async () => {
      if (!address) throw new WaitlistError('bad_request', 'Connect your wallet first.');

      const challenge = await waitlistApi.nonce(address);

      // The message is signed exactly as the server issued it. Rebuilding it
      // here — even from the same template — risks a whitespace or timestamp
      // difference that makes every signature fail verification.
      const signature = await signMessageAsync({ message: challenge.message });

      const result = await waitlistApi.verify(address, challenge.nonce, signature);
      writeSession({ address, token: result.token, expiresAt: Date.parse(result.expiresAt) });
      return result;
    },
    onSuccess: (result) => {
      setSession(readSession(address));
      setError(null);
      queryClient.setQueryData<WaitlistStatus>(queryKeys.waitlistStatus(address), (current) => ({
        entry: result.entry,
        verifiedCount: current?.verifiedCount ?? 0,
      }));
      void queryClient.invalidateQueries({ queryKey: queryKeys.waitlistStatus(address) });
    },
    onError: (cause) => setError(describe(cause)),
  });

  const recheck = useMutation({
    mutationFn: async () => {
      if (!session) throw new WaitlistError('unauthorized', 'Sign with your wallet again.');
      return waitlistApi.recheck(session.token);
    },
    onSuccess: (result) => {
      setError(
        result.entry?.guildMember
          ? null
          : "We still can't see you in the Discord server. Join it, then check again.",
      );
      queryClient.setQueryData(queryKeys.waitlistStatus(address), result);
    },
    onError: (cause) => {
      if (cause instanceof WaitlistError && cause.code === 'unauthorized') {
        clearSession();
        setSession(null);
      }
      setError(describe(cause));
    },
  });

  const connectDiscord = useCallback(() => {
    if (!session) {
      setError('Sign with your wallet first.');
      return;
    }
    // A full navigation, not a popup: Discord's consent screen sets its own
    // frame-ancestors and a popup blocked by the browser fails silently.
    window.location.assign(waitlistApi.discordUrl(session.token));
  }, [session]);

  const reset = useCallback(() => {
    clearSession();
    setSession(null);
    setError(null);
  }, []);

  return {
    step: deriveStep({ isConnected, hasSession: Boolean(session), entry }),
    entry,
    verifiedCount: status.data?.verifiedCount ?? config.data?.verifiedCount ?? 0,
    inviteUrl: config.data?.inviteUrl ?? null,
    autoJoin: config.data?.autoJoin ?? false,
    enabled: config.data?.enabled ?? false,
    isLoading: config.isLoading || (Boolean(address) && status.isLoading),
    error,
    isSigning: signIn.isPending,
    isRechecking: recheck.isPending,
    signIn: () => signIn.mutate(),
    connectDiscord,
    recheck: () => recheck.mutate(),
    reset,
  };
}

const CALLBACK_MESSAGES: Record<string, { kind: 'success' | 'error' | 'info'; message: string }> = {
  ok: { kind: 'success', message: "Discord connected — you're on the waitlist." },
  'not-a-member': {
    kind: 'info',
    message: "Discord connected, but you're not in the server yet. Join it, then check again.",
  },
  declined: { kind: 'info', message: 'Discord authorization cancelled.' },
  invalid: { kind: 'error', message: 'That Discord link was incomplete. Try connecting again.' },
  'session-expired': {
    kind: 'error',
    message: 'Your session expired before Discord answered. Sign with your wallet again.',
  },
  'already-linked': {
    kind: 'error',
    message: 'That Discord account is already linked to a different wallet.',
  },
  'discord-down': {
    kind: 'error',
    message: "Discord didn't respond. Nothing was lost — try connecting again in a moment.",
  },
  'discord-error': {
    kind: 'error',
    message: 'Discord rejected the request. Try connecting again.',
  },
};

/**
 * Reads the result the OAuth callback redirected back with.
 *
 * The backend cannot return JSON to a top-level navigation, so it puts the
 * outcome in `?waitlist=` and sends the browser here. The parameter is
 * consumed once and stripped with `replaceState`: leaving it in place means a
 * reload — or a bookmark — replays a stale "you're on the waitlist" banner
 * long after it stopped being true.
 */
export function useWaitlistCallback(
  onResult?: (result: { kind: 'success' | 'error' | 'info'; message: string }) => void,
): void {
  const queryClient = useQueryClient();
  const { address } = useAccount();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('waitlist');
    if (!status) return;

    params.delete('waitlist');
    const search = params.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`,
    );

    const result = CALLBACK_MESSAGES[status] ?? {
      kind: 'error' as const,
      message: 'Discord connection did not complete. Try again.',
    };
    onResult?.(result);

    if (status === 'ok' || status === 'not-a-member') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.waitlistStatus(address) });
    }
    // Runs once per page load — the parameter is gone after the first pass, so
    // re-running on an `address` change would find nothing to do anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Turns a failure into something worth showing a user.
 *
 * The wallet rejection case matters most: a user who clicks Cancel in
 * MetaMask has not hit an error, and showing them viem's multi-paragraph
 * `UserRejectedRequestError` reads as though the site broke.
 */
function describe(cause: unknown): string {
  if (cause instanceof WaitlistError) {
    switch (cause.code) {
      case 'conflict':
        return 'That Discord account is already linked to a different wallet.';
      case 'rate_limited':
        return 'Too many attempts. Wait a minute and try again.';
      case 'unavailable':
      case 'timeout':
        return 'Could not reach the waitlist service. Try again shortly.';
      default:
        return cause.message;
    }
  }

  const message = cause instanceof Error ? cause.message : String(cause);
  if (/user rejected|denied|rejected the request/i.test(message)) {
    return 'Signature cancelled.';
  }
  return message;
}
