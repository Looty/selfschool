import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * Publishes the bottom stack's height as `--lab-bottom` on the page root (the editor drawer ends above it).
 * `focusInside` says whether focus is in the stack; by default it is read from the page.
 */
export function publishBottom(focusInside?: boolean) {
  const el = document.querySelector<HTMLElement>("[data-bottom-stack]");
  const root = document.documentElement;
  if (el) {
    root.style.setProperty("--lab-bottom", `${el.offsetHeight}px`);
    // a focused link or a find-in-page hit scrolls into view above the stack, not behind it. Not while focus is in
    // the stack itself: it is sticky, so the browser would scroll the page on every key trying to lift the caret
    // above the stack's own height
    const inside = typeof focusInside === "boolean" ? focusInside : el.contains(document.activeElement);
    root.style.scrollPaddingBottom = inside ? "" : `${el.offsetHeight}px`;
  } else {
    root.style.removeProperty("--lab-bottom");
    root.style.removeProperty("scroll-padding-bottom");
  }
}

/**
 * The lesson's sticky bottom stack: the lab's terminal above the ask box, pinned together. Its height is kept in
 * `--lab-bottom`: by a ResizeObserver (the ask box growing, the window resizing) and by the terminal itself after
 * every render (a ResizeObserver only reports when the page draws frames).
 */
export function BottomStack({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    publishBottom();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => publishBottom());
    ro?.observe(el);
    // entering the stack drops the scroll padding, leaving it brings it back
    const focusIn = () => publishBottom(true);
    const focusOut = (e: FocusEvent) => publishBottom(el.contains(e.relatedTarget as Node | null));
    el.addEventListener("focusin", focusIn);
    el.addEventListener("focusout", focusOut);
    return () => {
      ro?.disconnect();
      el.removeEventListener("focusin", focusIn);
      el.removeEventListener("focusout", focusOut);
      document.documentElement.style.removeProperty("--lab-bottom");
      document.documentElement.style.removeProperty("scroll-padding-bottom");
    };
  }, []);
  return (
    <div ref={ref} data-bottom-stack="" className="sticky bottom-0 z-20 flex flex-col">
      {children}
    </div>
  );
}
