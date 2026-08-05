import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * Accessible modal.
 *
 * Escape closes it, focus moves inside on open and the backdrop is a real
 * click target. The old dialogs were plain absolutely-positioned divs with no
 * escape handler and no focus management, so a keyboard user could tab out of
 * an open dialog into the page behind it.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);

    // Prevent the page behind from scrolling under the dialog.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    panelRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative w-full max-w-md rounded-t-2xl border border-border bg-surface p-5 shadow-2xl outline-none sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">{title}</h2>
            {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-subtle transition-colors hover:text-ink"
            aria-label="Close dialog"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {children}

        {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}
