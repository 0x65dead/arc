import { BaseError, ContractFunctionRevertedError, HttpRequestError, UserRejectedRequestError } from 'viem';

/** The wallet is not on Arc Testnet and would not switch. */
export class WrongChainError extends Error {
  constructor(public currentChainId?: number) {
    super('Wallet is not on Arc Testnet');
    this.name = 'WrongChainError';
  }
}

/**
 * A transaction that was mined but reverted.
 *
 * `waitForTransactionReceipt` resolves for reverted transactions too — it only
 * rejects if the receipt never arrives. Without an explicit `status` check,
 * every write path treats "mined" as "succeeded", which is what produced
 * success toasts and confetti for registrations that never happened.
 */
export class TxRevertedError extends Error {
  constructor(
    public hash: string,
    public receipt?: unknown,
  ) {
    super('Transaction reverted on-chain');
    this.name = 'TxRevertedError';
  }
}

/** The indexer API was unreachable or returned a non-2xx. */
export class IndexerUnavailableError extends Error {
  constructor(
    public path: string,
    message: string,
  ) {
    super(message);
    this.name = 'IndexerUnavailableError';
  }
}

/**
 * True when the RPC endpoint could not be reached at all.
 *
 * A browser cannot distinguish "DNS failed", "server down" and "blocked by
 * CORS" — the fetch just rejects with an opaque TypeError. All three mean the
 * same thing to a user, and none of them mean the name they searched for
 * doesn't exist, which is what an uncaught version of this looked like.
 */
export function isRpcUnreachable(error: unknown): boolean {
  if (error instanceof BaseError && error.walk((e) => e instanceof HttpRequestError)) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /failed to fetch|networkerror|load failed|err_failed|cors|fetch failed/i.test(message);
}

/**
 * Revert-string → human message.
 *
 * Every key here is a literal `require` string collected from `src/*.sol`, so
 * this table can be checked against the contracts rather than trusted. Keys
 * are matched exactly against viem's decoded reason where possible, and only
 * fall back to substring matching on the raw message.
 */
const REVERT_MESSAGES: Record<string, string> = {
  // ArcController — registration lifecycle
  early: 'Your commitment is still maturing. Wait for the countdown to finish, then register.',
  'commit expired': 'This commitment has expired. Start the registration again to get a new one.',
  committed: 'A commitment for this name is already pending. Wait for it to expire before recommitting.',
  invalid: 'That name is not valid on this registrar.',
  duration: 'Registration length must be between 28 days and 100 years.',
  underpaid: 'The amount sent was less than the price. This usually means the price changed — retry to requote.',
  owner: 'The owner address cannot be empty.',
  taken: 'That name is already registered.',
  short: 'That name is shorter than the registrar allows.',
  '2char': 'Two-character names are not currently for sale.',
  minLen: 'That name is shorter than the registrar allows.',

  // ArcRegistrar
  expired: 'That name has passed its 90-day grace period and can no longer be renewed.',
  '!minted': 'That name has not been registered yet.',
  none: 'That token does not exist.',
  '!controller': 'This action must go through the controller contract.',
  '!live': 'The registrar is not currently authoritative for .arc — registrations are paused.',
  badlabel: 'That label contains characters the registrar will not record.',

  // ArcMarket
  '!listed': 'That name is no longer listed for sale.',
  '!seller': 'Only the seller can change this listing.',
  '!owner': 'You are not the owner of this name.',
  '!approved': 'The marketplace is not approved to transfer this name. Approve it and try again.',
  'price moved': 'The asking price changed while you were buying. Refresh and try again.',
  'seller changed': 'This name changed hands while you were buying. Refresh and try again.',
  'usdc listing': 'This listing is priced in ERC-20 USDC, which this app cannot settle yet.',
  price: 'The price must be greater than zero.',

  // Shared / access control
  '!auth': 'You are not authorised to change this record.',
  'ENS:!auth': 'You are not authorised to change this record.',
  '!pending': 'Only the pending owner can accept this transfer.',
  'usdc off': 'ERC-20 USDC payments are not enabled on this deployment.',
  'usdc pull': 'The USDC transfer failed. Check your balance and allowance.',
  reentrant: 'That call was rejected as reentrant.',
  self: 'You cannot use your own address here.',
};

function messageForReason(reason: string): string | undefined {
  const exact = REVERT_MESSAGES[reason];
  if (exact) return exact;

  // Some providers wrap the reason in extra prose; fall back to the longest
  // matching key so "!approved" doesn't get shadowed by a shorter key that
  // happens to be a substring of the same message.
  const keys = Object.keys(REVERT_MESSAGES)
    .filter((key) => reason.includes(key))
    .sort((a, b) => b.length - a.length);
  return keys.length > 0 ? REVERT_MESSAGES[keys[0]] : undefined;
}

/**
 * Turns anything thrown by a write path into a sentence worth showing a user.
 *
 * Order matters: the typed errors this app raises itself are checked before
 * viem's, and a user rejection is separated out because it is not a failure —
 * showing "transaction failed" when someone simply hit Cancel is misleading.
 */
export function describeError(error: unknown): string {
  if (!error) return 'Something went wrong.';

  if (error instanceof WrongChainError) {
    return 'Switch your wallet to Arc Testnet to continue.';
  }
  if (error instanceof TxRevertedError) {
    return 'The transaction was mined but reverted, so nothing changed (gas was still spent). Check it on ArcScan for the reason.';
  }
  if (error instanceof IndexerUnavailableError) {
    return `Live data is unavailable (${error.message}).`;
  }

  // Checked before the viem branch below: a network failure arrives wrapped in
  // a ContractFunctionExecutionError, whose shortMessage talks about the
  // contract call and reads as though the contract rejected something. It
  // didn't — the request never arrived.
  if (isRpcUnreachable(error)) {
    return "Can't reach the Arc network right now. Check your connection and try again.";
  }

  if (error instanceof BaseError) {
    const rejection = error.walk((e) => e instanceof UserRejectedRequestError);
    if (rejection) return 'You rejected the request in your wallet.';

    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const reason = reverted.data?.errorName ?? reverted.reason;
      if (reason) {
        const mapped = messageForReason(reason);
        if (mapped) return mapped;
        return `The contract rejected this: ${reason}`;
      }
    }

    const mapped = messageForReason(error.shortMessage ?? error.message ?? '');
    if (mapped) return mapped;
    return error.shortMessage || truncate(error.message);
  }

  if (error instanceof Error) {
    const mapped = messageForReason(error.message);
    if (mapped) return mapped;
    return truncate(error.message);
  }

  return truncate(String(error));
}

/** True when the user simply cancelled — callers usually stay silent for these. */
export function isUserRejection(error: unknown): boolean {
  if (error instanceof BaseError) {
    return Boolean(error.walk((e) => e instanceof UserRejectedRequestError));
  }
  return false;
}

function truncate(message: string, max = 160): string {
  const clean = message.split('\n')[0].trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
