import { describe, expect, it } from "vitest";
import type { AttemptResult } from "@selfschool/shared";
import { attemptStatus, crossedWarning, formatClock, formatWhen, isWeakDomain, percentText, plural, remainingMs, scoreSummary, spokenRemaining } from "./display";

const attempt = (over: Partial<AttemptResult> = {}, score: Partial<AttemptResult["score"]> = {}): AttemptResult => ({
  id: "a1", kind: "exam", course: { id: "c", title: "C", monogram: "C", hue: "blue" }, targetId: "mid", title: "Mid", number: 2,
  startedAt: 0, finishedAt: 1, passingPercentage: 70,
  score: { percent: 74, got: 26, max: 30, scoredCount: 28, totalCount: 30, pendingCount: 2, maxSwingPoints: 7, ...score },
  provisional: true, passed: null, byDomain: [], answers: [], missed: [], history: [], ai: { available: true }, ...over,
});

describe("score summary", () => {
  it("provisional: pill, line and pending note", () => {
    const s = scoreSummary(attempt());
    expect(s.percent).toBe("74%");
    expect(s.status).toBe("provisional");
    expect(s.line).toBe("28 of 30 scored · passing is 70%");
    expect(s.note).toBe("2 pending AI-graded answers are waiting for the runner. The score can change by up to 7 points.");
  });

  it("singular wording", () => {
    expect(scoreSummary(attempt({}, { pendingCount: 1, maxSwingPoints: 1 })).note).toBe("1 pending AI-graded answer is waiting for the runner. The score can change by up to 1 point.");
  });

  it("explains that grading happens later when the runner is paused", () => {
    expect(scoreSummary(attempt({ ai: { available: false } })).note).toMatch(/paused.*school up/);
  });

  it("final: no note, passed or failed", () => {
    const done = { provisional: false };
    expect(scoreSummary(attempt({ ...done, passed: true }, { pendingCount: 0 }))).toMatchObject({ status: "passed", note: null });
    expect(scoreSummary(attempt({ ...done, passed: false }, { pendingCount: 0 })).status).toBe("failed");
  });

  it("nothing scored yet shows a dash, unfinished shows in progress", () => {
    expect(percentText(null)).toBe("—");
    expect(attemptStatus({ finishedAt: null, provisional: false, passed: null })).toBe("in_progress");
  });

  it("flags domains below the pass mark", () => {
    expect(isWeakDomain(62, 70)).toBe(true);
    expect(isWeakDomain(70, 70)).toBe(false);
  });

  it("plural", () => {
    expect(plural(1, "answer")).toBe("answer");
    expect(plural(2, "answer")).toBe("answers");
  });
});

describe("exam timer", () => {
  it("remaining time never goes negative", () => {
    expect(remainingMs(1_000, 45, 1_000)).toBe(45 * 60_000);
    expect(remainingMs(1_000, 45, 1_000 + 44 * 60_000)).toBe(60_000);
    expect(remainingMs(1_000, 45, 1_000 + 50 * 60_000)).toBe(0);
  });

  it("formats m:ss and h:mm:ss, rounding partial seconds up", () => {
    expect(formatClock(38 * 60_000 + 12_000)).toBe("38:12");
    expect(formatClock(59_001)).toBe("1:00");
    expect(formatClock(5_000)).toBe("0:05");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(-5)).toBe("0:00");
    expect(formatClock(3_600_000 + 5 * 60_000 + 9_000)).toBe("1:05:09");
  });

  it("announces each threshold once when crossed", () => {
    expect(crossedWarning(11 * 60_000, 10 * 60_000 - 1)).toBe(10);
    expect(crossedWarning(10 * 60_000 - 1, 10 * 60_000 - 2000)).toBeNull();
    expect(crossedWarning(5 * 60_000 + 1000, 5 * 60_000)).toBe(5);
    expect(crossedWarning(61_000, 59_000)).toBe(1);
  });

  it("spoken remaining", () => {
    expect(spokenRemaining(5 * 60_000)).toBe("5 minutes remaining");
    expect(spokenRemaining(30_000)).toBe("Less than 1 minute remaining");
    expect(spokenRemaining(0)).toBe("Time is up");
  });
});

describe("dates", () => {
  const now = new Date(2026, 9, 20, 12).getTime();
  it("today, yesterday, then a short date", () => {
    expect(formatWhen(now - 3600_000, now)).toBe("today");
    expect(formatWhen(now - 86_400_000, now)).toBe("yesterday");
    expect(formatWhen(new Date(2026, 9, 14, 9).getTime(), now)).toBe("Oct 14");
  });
});
