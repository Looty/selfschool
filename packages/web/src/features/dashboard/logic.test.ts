import { describe, expect, it } from "vitest";
import { activeDays, barHeights, continueLabel, courseCaption, formatMinutes, heatColor, heatmapWeeks, ringDash, weakSpotTone } from "./logic";

const cells = Array.from({ length: 112 }, (_, i) => ({ date: `d${i}`, level: i % 5 }));

describe("heatmap mapping", () => {
  it("splits 112 cells into 16 week columns of 7, oldest first", () => {
    const weeks = heatmapWeeks(cells);
    expect(weeks).toHaveLength(16);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0]![0]!.date).toBe("d0");
    expect(weeks[15]![6]!.date).toBe("d111");
  });
  it("maps levels to a ramp: surface2 at 0, full hue at 4, clamped outside", () => {
    expect(heatColor(0)).toBe("var(--surface2)");
    expect(heatColor(4)).toContain("var(--hue) 100%");
    expect(heatColor(9)).toBe(heatColor(4));
    expect(heatColor(-1)).toBe(heatColor(0));
  });
  it("counts active days", () => {
    expect(activeDays(cells)).toBe(112 - 23);
  });
});

describe("week bars", () => {
  it("scales to the busiest day and keeps a stub for idle days", () => {
    expect(barHeights([{ minutes: 60 }, { minutes: 30 }, { minutes: 0 }])).toEqual([100, 50, 6]);
  });
  it("handles an empty week", () => {
    expect(barHeights([{ minutes: 0 }, { minutes: 0 }])).toEqual([6, 6]);
  });
});

describe("formatting", () => {
  it("formats minutes", () => {
    expect(formatMinutes(220)).toBe("3h 40m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(0)).toBe("0m");
  });
  it("ring dash is proportional and clamped", () => {
    expect(ringDash(42)).toBe("110.8 263.9");
    expect(ringDash(150)).toBe("263.9 263.9");
  });
  it("weak spot tone flips at 50%", () => {
    expect(weakSpotTone(48)).toBe("bad");
    expect(weakSpotTone(50)).toBe("warn");
  });
  it("labels", () => {
    expect(continueLabel("TS", 6)).toBe("Continue · TS · Lesson 06");
    expect(courseCaption({ started: false, percent: 0 })).toBe("Not started");
    expect(courseCaption({ started: true, percent: 41.6 })).toBe("42% complete");
    expect(courseCaption({ started: false, percent: 0, time: { remainingMinutes: 75 } })).toBe("Not started");
    expect(courseCaption({ started: true, percent: 41.6, time: { remainingMinutes: 130 } })).toBe("42% complete · 2 h 10 min left");
    // 100% of lessons with only the exam outstanding is still "complete": no contradicting "30 min left"
    expect(courseCaption({ started: true, percent: 100, time: { remainingMinutes: 30 } })).toBe("100% complete");
  });
});
