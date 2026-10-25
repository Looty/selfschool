import { cx } from "./cx";

type Tone = "hue" | "bad" | "warn" | "ok";
const FILL: Record<Tone, string> = { hue: "bg-hue", bad: "bg-bad", warn: "bg-warn", ok: "bg-ok" };

/** 4px bar, 2px radius. Needs a [data-hue] ancestor for tone="hue". `rail` = 3px band-edge variant. */
export function ProgressBar({
  value,
  tone = "hue",
  rail = false,
  label,
  className,
}: {
  value: number;
  tone?: Tone;
  rail?: boolean;
  /** Accessible name; the visible number should sit next to the bar. */
  label?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
      className={cx("overflow-hidden rounded-[2px]", rail ? "h-[3px] bg-border" : "h-1 bg-surface2", className)}
    >
      <div className={cx("h-full rounded-[2px]", FILL[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}
