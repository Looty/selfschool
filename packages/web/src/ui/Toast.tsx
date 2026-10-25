import { useEffect, useRef, useState } from "react";

type Listener = (message: string) => void;
const listeners = new Set<Listener>();

/** Shows the bottom-right "Saved" toast. Call it after a preference is stored; there is no Save button anywhere. */
export function notifySaved(message = "Saved") {
  listeners.forEach((l) => l(message));
}

const SHOW_MS = 2000;

/** Mount once (in the app shell). Renders the latest message for two seconds, announced politely to screen readers. */
export function SavedToaster() {
  const [state, setState] = useState<{ message: string; n: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const onSaved: Listener = (message) => {
      setState((s) => ({ message, n: (s?.n ?? 0) + 1 }));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState(null), SHOW_MS);
    };
    listeners.add(onSaved);
    return () => {
      listeners.delete(onSaved);
      clearTimeout(timer.current);
    };
  }, []);

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-5 right-5 z-50">
      {state ? (
        <div
          key={state.n}
          className="toast-in flex items-center gap-2.5 rounded-card border border-border2 bg-bg py-2.5 pl-3 pr-4 text-[13px] font-medium text-text shadow-[0_4px_16px_rgba(0,0,0,0.18)]"
        >
          <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-ok-bg text-ok">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2.5 6.5l2.3 2.3 4.7-5" />
            </svg>
          </span>
          {state.message}
        </div>
      ) : null}
    </div>
  );
}
