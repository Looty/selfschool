import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { selectionToQuote } from "./selection";

interface Picked {
  quote: string;
  text: string;
  top: number;
  left: number;
}

/**
 * Floating "Ask about this / Copy" toolbar above a text selection inside `containerRef`.
 * Buttons keep the selection alive (mousedown is prevented); Escape or scrolling away hides it.
 */
export function SelectionMenu({ containerRef, onAsk }: { containerRef: RefObject<HTMLElement | null>; onAsk: (quote: string) => void }) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [copied, setCopied] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  const read = useCallback(() => {
    const sel = window.getSelection();
    const root = containerRef.current;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !root) return setPicked(null);
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return setPicked(null);
    const quote = selectionToQuote(sel.toString());
    if (!quote) return setPicked(null);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return setPicked(null);
    setPicked({ quote, text: sel.toString(), top: rect.top, left: Math.max(8, Math.min(rect.left, window.innerWidth - 220)) });
    setCopied(false);
  }, [containerRef]);

  useEffect(() => {
    // selectionchange fires for mouse and keyboard (shift+arrows) selections
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(read);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPicked(null);
    };
    document.addEventListener("selectionchange", schedule);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("selectionchange", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("keydown", onKey);
    };
  }, [read]);

  if (!picked) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(picked.text.trim());
      setCopied(true);
    } catch {
      document.execCommand?.("copy");
    }
  };

  return (
    <div
      ref={menu}
      role="toolbar"
      aria-label="Selected text"
      onMouseDown={(e) => e.preventDefault()}
      style={{ position: "fixed", top: Math.max(8, picked.top - 8), left: picked.left, transform: "translateY(-100%)", boxShadow: "0 8px 24px rgba(11, 18, 32, 0.12)" }}
      className="z-30 flex gap-0.5 whitespace-nowrap rounded-[9px] border border-border2 bg-bg p-[3px] font-sans text-xs leading-none"
    >
      <button
        type="button"
        onClick={() => {
          onAsk(picked.quote);
          window.getSelection()?.removeAllRanges();
          setPicked(null);
        }}
        className="tutor cursor-pointer rounded-md border-0 bg-transparent px-[9px] py-1.5 font-medium text-accent transition-colors hover:bg-accent-soft focus-visible:bg-accent-soft"
      >
        Ask about this
      </button>
      <button
        type="button"
        onClick={copy}
        className="cursor-pointer rounded-md border-0 bg-transparent px-[9px] py-1.5 text-text2 transition-colors hover:bg-surface2 hover:text-text focus-visible:bg-surface2 focus-visible:text-text"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
