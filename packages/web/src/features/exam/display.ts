import type { AttemptResult } from "@selfschool/shared";
import type { BadgeTone } from "../../ui";

export const plural = (n: number, one: string, many = one + "s") => (n === 1 ? one : many);

export const percentText = (p: number | null) => (p === null ? "—" : `${Math.round(p)}%`);

export type AttemptStatus = "in_progress" | "provisional" | "passed" | "failed";

export const STATUS_LABEL: Record<AttemptStatus, string> = {
  in_progress: "In progress",
  provisional: "Provisional",
  passed: "Passed",
  failed: "Failed",
};

export const STATUS_TONE: Record<AttemptStatus, BadgeTone> = {
  in_progress: "neutral",
  provisional: "warn",
  passed: "ok",
  failed: "bad",
};

export function attemptStatus(a: Pick<AttemptResult, "finishedAt" | "provisional" | "passed">): AttemptStatus {
  if (a.finishedAt === null) return "in_progress";
  if (a.provisional) return "provisional";
  return a.passed ? "passed" : "failed";
}

export interface ScoreSummary {
  percent: string;
  status: AttemptStatus;
  line: string;
  /** Provisional note under the score, or null once everything is graded. */
  note: string | null;
}

/** All wording of the big score card in one place, so it is unit-testable. */
export function scoreSummary(a: AttemptResult): ScoreSummary {
  const { score } = a;
  const n = score.pendingCount;
  const swing = Math.round(score.maxSwingPoints);
  let note: string | null = null;
  if (n > 0) {
    note = a.ai.available
      ? `${n} pending AI-graded ${plural(n, "answer")} ${n === 1 ? "is" : "are"} waiting for the runner. The score can change by up to ${swing} ${plural(swing, "point")}.`
      : `${n} pending AI-graded ${plural(n, "answer")} will be graded later: AI is paused until you start the runner with \`school up\`. The score can change by up to ${swing} ${plural(swing, "point")}.`;
  }
  return {
    percent: percentText(score.percent),
    status: attemptStatus(a),
    line: `${score.scoredCount} of ${score.totalCount} scored · passing is ${a.passingPercentage}%`,
    note,
  };
}

/** A domain below the pass mark is flagged with the bad tone (and its percent, never colour alone). */
export const isWeakDomain = (percent: number, passing: number) => percent < passing;

// ---------- time ----------

export const remainingMs = (startedAt: number, durationMinutes: number, now: number) => Math.max(0, startedAt + durationMinutes * 60_000 - now);

/** 38:12, or 1:05:09 from one hour up. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Spoken form for the live region, e.g. "5 minutes remaining". */
export function spokenRemaining(ms: number): string {
  const min = Math.ceil(ms / 60_000);
  if (ms <= 0) return "Time is up";
  return min <= 1 ? "Less than 1 minute remaining" : `${min} ${plural(min, "minute")} remaining`;
}

/** Warn thresholds announced to screen readers (once each). */
export const WARN_AT_MIN = [10, 5, 1];

export function crossedWarning(prevMs: number, nowMs: number): number | null {
  for (const m of WARN_AT_MIN) {
    if (prevMs > m * 60_000 && nowMs <= m * 60_000) return m;
  }
  return null;
}

export function formatWhen(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(now);
  if (d.toDateString() === n.toDateString()) return "today";
  const y = new Date(now - 86_400_000);
  if (d.toDateString() === y.toDateString()) return "yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.getFullYear() !== n.getFullYear() ? { year: "numeric" } : {}) });
}
