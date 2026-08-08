import { AlertCircle, CheckCircle2, ExternalLink, Info, Loader2, X } from 'lucide-react';
import { useToasts, type ToastKind } from '../hooks/useToasts';
import { cx } from './ui';

const ICONS: Record<ToastKind, typeof Info> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  pending: Loader2,
};

const TONE: Record<ToastKind, string> = {
  success: 'border-positive/30 text-positive',
  error: 'border-negative/30 text-negative',
  info: 'border-border-strong text-ink-muted',
  pending: 'border-accent/30 text-accent',
};

/**
 * Toast stack.
 *
 * `aria-live="polite"` so screen readers announce transaction progress — the
 * old implementation rendered status purely visually, which left the entire
 * commit/reveal flow silent for anyone not watching the corner of the screen.
 */
export function ToastViewport() {
  const { toasts, dismiss } = useToasts();

  return (
    <div
      /*
       * One above RainbowKit's 2147483646. Transaction status has to stay
       * visible while a RainbowKit modal is open — at z-50 a toast fired by a
       * network switch rendered behind the modal, so the flow looked stalled.
       * The container is pointer-events-none, so it never blocks the modal.
       */
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[2147483647] flex flex-col items-center gap-2 p-4 sm:items-end"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => {
        const Icon = ICONS[toast.kind];
        return (
          <div
            key={toast.id}
            className={cx(
              'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-surface-raised/95 p-3 shadow-xl backdrop-blur',
              TONE[toast.kind],
            )}
          >
            <Icon className={cx('mt-0.5 size-4 shrink-0', toast.kind === 'pending' && 'animate-spin')} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink">{toast.message}</p>
              {toast.href ? (
                <a
                  href={toast.href}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                >
                  View on ArcScan
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="rounded p-1 text-ink-subtle transition-colors hover:text-ink"
              aria-label="Dismiss notification"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
