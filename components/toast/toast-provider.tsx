'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

// Global feedback surface for Server Action results. Before this, every
// useActionState-backed form in the app (new-contractor-form.tsx,
// new-project-form.tsx, onboarding-form.tsx, the billing checkout/portal
// buttons, the admin client-portal issue/revoke forms, and this segment's
// own new client/edit-client forms) rendered its error inline as a
// `<p role="alert">` and nothing else -- functional, but easy to miss if the
// form is off-screen (e.g. a revoke button at the bottom of a long token
// table) and with zero equivalent for a *success* signal. This adds a
// transient, app-wide toast on top of (not instead of -- the inline text
// stays, since it's more durable and already screen-reader-friendly via
// role="alert") those existing messages.
//
// Deliberately hand-rolled rather than a new dependency (sonner/react-hot-toast)
// -- same "no charting library exists, build the small thing" call as
// components/dashboard-panel.tsx's own header comment makes for the
// dashboard, and this is an even smaller surface (a positioned list of
// dismissible cards).
export type ToastVariant = 'success' | 'error';

interface Toast {
  id: number;
  variant: ToastVariant;
  message: string;
}

interface ToastContextValue {
  showToast: (variant: ToastVariant, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 6000;

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  success: 'border-green-200 bg-green-50 text-green-800',
  error: 'border-red-200 bg-red-50 text-red-800',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Monotonic counter, not Date.now()/crypto.randomUUID() -- two toasts
  // fired within the same millisecond (unlikely but not impossible for two
  // Server Actions resolving back-to-back) would otherwise collide on
  // React's key.
  const nextId = useRef(0);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (variant: ToastVariant, message: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, variant, message }]);
      setTimeout(() => dismissToast(id), AUTO_DISMISS_MS);
    },
    [dismissToast]
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Fixed, not a portal -- app/layout.tsx's <body> is already the
          effective root for every route in this app (no nested modal/iframe
          contexts to escape), so a portal would add complexity with no
          behavioral difference here. */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2 sm:bottom-6 sm:right-6">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="alert"
            className={`pointer-events-auto flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm shadow-md ${VARIANT_CLASSES[toast.variant]}`}
          >
            <p className="min-w-0 break-words">{toast.message}</p>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss"
              className="flex-shrink-0 text-current opacity-60 hover:opacity-100"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast() must be called within a ToastProvider (mounted in app/layout.tsx).');
  }
  return context;
}
