import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Shared primitives.
 *
 * These exist so that a button looks the same everywhere. The previous single
 * file had 40-odd bespoke `<button className="...">` variations, several of
 * which had no disabled state and no focus ring at all.
 */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent-hover shadow-lg shadow-accent/20',
  secondary: 'bg-surface-raised text-ink hover:bg-border border border-border-strong',
  ghost: 'text-ink-muted hover:text-ink hover:bg-surface-raised',
  danger: 'bg-negative/10 text-negative hover:bg-negative/20 border border-negative/30',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      // A loading button must also be inert, or a double-click sends two
      // transactions — the old Register button did exactly that.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        'rounded-2xl border border-border bg-surface/80 backdrop-blur-sm',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

type BadgeTone = 'neutral' | 'positive' | 'warning' | 'negative' | 'accent';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-raised text-ink-muted border-border-strong',
  positive: 'bg-positive/10 text-positive border-positive/25',
  warning: 'bg-warning/10 text-warning border-warning/25',
  negative: 'bg-negative/10 text-negative border-negative/25',
  accent: 'bg-accent/10 text-accent border-accent/25',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  suffix?: ReactNode;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { suffix, invalid, className, ...rest },
  ref,
) {
  return (
    <div className="relative flex items-center">
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cx(
          'w-full rounded-lg border bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle',
          'transition-colors focus:border-accent focus:outline-none',
          invalid ? 'border-negative' : 'border-border-strong',
          suffix ? 'pr-16' : '',
          className,
        )}
        {...rest}
      />
      {suffix ? <span className="absolute right-3 text-sm text-ink-subtle">{suffix}</span> : null}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Skeleton / empty / error states
// ---------------------------------------------------------------------------

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton rounded-lg', className)} aria-hidden />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      {icon ? <div className="text-ink-subtle">{icon}</div> : null}
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {description ? <p className="max-w-sm text-sm text-ink-muted">{description}</p> : null}
      {action}
    </div>
  );
}

/**
 * Shown when data genuinely could not be loaded.
 *
 * Separate from EmptyState on purpose: "no listings yet" and "we couldn't
 * reach the indexer" are different facts, and the old UI rendered both as an
 * empty grid.
 */
export function ErrorState({
  title = 'Could not load this',
  detail,
  onRetry,
}: {
  title?: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {detail ? <p className="max-w-md text-sm text-ink-muted">{detail}</p> : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export { cx };
