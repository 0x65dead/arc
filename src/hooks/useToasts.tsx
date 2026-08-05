import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastKind = 'success' | 'error' | 'info' | 'pending';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  /** Optional explorer link, shown as "View on ArcScan". */
  href?: string;
}

interface ToastApi {
  toasts: Toast[];
  /** Shows a toast and returns its id so it can be updated or dismissed. */
  push: (kind: ToastKind, message: string, options?: { href?: string; durationMs?: number }) => string;
  /** Replaces an existing toast in place — used to walk a tx through its stages. */
  update: (id: string, kind: ToastKind, message: string, options?: { href?: string; durationMs?: number }) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** `pending` toasts stay until explicitly replaced; the rest auto-dismiss. */
const DEFAULT_DURATIONS: Record<ToastKind, number | null> = {
  success: 5000,
  error: 8000,
  info: 4000,
  pending: null,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const counter = useRef(0);

  const clearTimer = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      clearTimer(id);
      setToasts((current) => current.filter((toast) => toast.id !== id));
    },
    [clearTimer],
  );

  const scheduleDismiss = useCallback(
    (id: string, kind: ToastKind, durationMs?: number) => {
      clearTimer(id);
      const duration = durationMs ?? DEFAULT_DURATIONS[kind];
      if (duration === null || duration === undefined) return;
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration),
      );
    },
    [clearTimer, dismiss],
  );

  const push = useCallback<ToastApi['push']>(
    (kind, message, options) => {
      counter.current += 1;
      const id = `toast-${counter.current}`;
      setToasts((current) => [...current, { id, kind, message, href: options?.href }]);
      scheduleDismiss(id, kind, options?.durationMs);
      return id;
    },
    [scheduleDismiss],
  );

  const update = useCallback<ToastApi['update']>(
    (id, kind, message, options) => {
      setToasts((current) => {
        const exists = current.some((toast) => toast.id === id);
        if (!exists) return current;
        return current.map((toast) =>
          toast.id === id ? { ...toast, kind, message, href: options?.href ?? toast.href } : toast,
        );
      });
      scheduleDismiss(id, kind, options?.durationMs);
    },
    [scheduleDismiss],
  );

  const value = useMemo<ToastApi>(() => ({ toasts, push, update, dismiss }), [toasts, push, update, dismiss]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToasts(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToasts must be used inside <ToastProvider>');
  return context;
}
