import { formatDuration, type Dashboard, type CourseSummary } from "@selfschool/shared";

export const RING_CIRCUMFERENCE = 263.9;
const DAYS_PER_WEEK = 7;

type Cell = Dashboard["activity"][number];

/** Splits the flat 16x7 activity list (oldest first) into week columns. */
export function heatmapWeeks(activity: readonly Cell[]): Cell[][] {
  const weeks: Cell[][] = [];
  for (let i = 0; i < activity.length; i += DAYS_PER_WEEK) weeks.push(activity.slice(i, i + DAYS_PER_WEEK));
  return weeks;
}

/** Share of the course hue mixed into --bg for ramp levels 1..4 (level 0 is --surface2). Matches the blue ramp in docs/ui.md. */
const MIX = [0, 22, 45, 72, 100] as const;

/** Heatmap / bar colour for a ramp level, derived from the nearest [data-hue] ancestor. */
export function heatColor(level: number): string {
  const l = Math.max(0, Math.min(4, Math.round(level)));
  return l === 0 ? "var(--surface2)" : `color-mix(in srgb, var(--hue) ${MIX[l]}%, var(--bg))`;
}

export function activeDays(activity: readonly Cell[]): number {
  return activity.filter((c) => c.level > 0).length;
}

/** Bar heights as percent of the busiest day; idle days keep a 6% stub so the row reads as a chart. */
export function barHeights(days: readonly { minutes: number }[]): number[] {
  const max = Math.max(0, ...days.map((d) => d.minutes));
  return days.map((d) => (max === 0 || d.minutes === 0 ? 6 : Math.max(10, Math.round((d.minutes / max) * 100))));
}

export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

/** "Tuesday · Oct 20" */
export function dateLabel(d: Date): string {
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const rest = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${weekday} · ${rest}`;
}

export const weakSpotTone = (percent: number): "bad" | "warn" => (percent < 50 ? "bad" : "warn");

export const ringDash = (percent: number): string => `${((Math.max(0, Math.min(100, percent)) / 100) * RING_CIRCUMFERENCE).toFixed(1)} ${RING_CIRCUMFERENCE}`;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One line under the bar: the time left while studying, nothing extra before starting or once done (the total is on the card's top line). */
export function courseCaption(c: Pick<CourseSummary, "started" | "percent"> & { time?: Pick<CourseSummary["time"], "remainingMinutes"> }): string {
  const pct = Math.round(c.percent);
  if (!c.started) return "Not started";
  if (pct >= 100 || !c.time || c.time.remainingMinutes <= 0) return `${pct}% complete`;
  return `${pct}% complete · ${formatDuration(c.time.remainingMinutes)} left`;
}

export const continueLabel = (monogram: string, lessonNumber: number) => `Continue · ${monogram} · Lesson ${String(lessonNumber).padStart(2, "0")}`;
