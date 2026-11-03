import { useEffect, useState } from "react";
import { ArrowUpIcon } from "./icons";

/** Show the button once the reader is more than one screen down the page. */
export function showBackToTop(scrollY: number, viewportHeight: number): boolean {
  return scrollY > viewportHeight;
}

/** Round button in the bottom corner, above the terminal and ask box: jumps back to the top of the lesson. */
export function BackToTop({ hidden = false }: { hidden?: boolean }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      setShown(showBackToTop(window.scrollY, window.innerHeight));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  if (!shown || hidden) return null;
  return (
    <button
      type="button"
      aria-label="Back to top"
      title="Back to top"
      onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}
      className="fixed right-5 bottom-[calc(var(--lab-bottom,0px)+16px)] z-20 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-border bg-bg text-text2 shadow-[0_4px_14px_rgba(11,18,32,0.16)] hover:text-text"
    >
      <ArrowUpIcon />
    </button>
  );
}
