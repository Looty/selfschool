import { useEffect, useState } from "react";

/** Reading progress 0..100: 0 at the top of the page, 100 once the end of the article reaches the viewport bottom. */
export function readingProgress(scrollY: number, articleDocTop: number, articleHeight: number, viewportHeight: number): number {
  const range = articleDocTop + articleHeight - viewportHeight;
  if (articleHeight <= 0 || range <= 0) return 0;
  return Math.round(Math.min(1, Math.max(0, scrollY / range)) * 1000) / 10;
}

/**
 * Thin green bar: how far through this lesson you have read. It sits directly under the course band and,
 * once the band scrolls away, sticks to the top of the viewport (render it right after the band).
 */
export function ReadingProgress({ resetKey }: { resetKey: string }) {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const article = document.querySelector<HTMLElement>(".lesson-article");
      if (!article) return setPct(0);
      const r = article.getBoundingClientRect();
      setPct(readingProgress(window.scrollY, r.top + window.scrollY, r.height, window.innerHeight));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();
    // Code blocks change height once highlighted; measure again after the first paint settles.
    const settle = window.setTimeout(schedule, 600);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [resetKey]);

  return (
    <div
      role="progressbar"
      aria-label="Reading progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className="pointer-events-none sticky top-0 z-40 h-[3px] bg-border"
    >
      <div className="h-full bg-ok" style={{ width: `${pct}%` }} />
    </div>
  );
}
