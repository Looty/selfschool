import type { ReactNode } from "react";
import { cx } from "./cx";

export type BadgeTone = "neutral" | "ok" | "bad" | "warn" | "hue" | "accent";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-surface2 text-text2",
  ok: "bg-ok-bg text-ok",
  bad: "bg-bad-bg text-bad",
  warn: "bg-warn-bg text-warn",
  // inside a [data-hue] wrapper; small text uses the -ink token
  hue: "bg-hue-bg text-hue-ink",
  accent: "bg-accent-soft text-accent",
};

/** Fully rounded pill: UPDATED, Provisional, Grading…, 2 / 3 POINTS. Mono uppercase by default. */
export function Badge({ tone = "neutral", mono = true, className, children }: { tone?: BadgeTone; mono?: boolean; className?: string; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-px text-[10px] font-medium leading-[1.6]",
        mono ? "font-mono uppercase tracking-[0.04em]" : "text-xs",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
