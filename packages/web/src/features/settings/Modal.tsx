import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A centred dialog over a dimmed page: focus moves in and is given back, Escape and a click outside close it
 * unless `busy` (a request is running). The header and footer are the caller's.
 */
export function Modal({ labelId, busy, onClose, children }: { labelId: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => previous?.focus?.();
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(11,18,32,0.5)] p-4 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        tabIndex={-1}
        onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
        className="flex max-h-[calc(100vh-32px)] w-full max-w-[640px] flex-col rounded-card border border-border2 bg-bg text-text outline-none"
        style={{ boxShadow: "0 24px 64px rgba(11, 18, 32, 0.28)" }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
