import { describe, expect, it } from "vitest";
import { backupNudgeDue, describeLastBackup } from "./backup";

const DAY = 86_400_000;
const now = 100 * DAY;
const base = { now, lastBackup: null, snoozedUntil: null, hasProgress: true };

describe("backup nudge", () => {
  it("stays quiet until there is progress to lose", () => {
    expect(backupNudgeDue({ ...base, hasProgress: false })).toBe(false);
  });
  it("asks when there was never a backup, or the last one is older than two weeks", () => {
    expect(backupNudgeDue(base)).toBe(true);
    expect(backupNudgeDue({ ...base, lastBackup: now - 15 * DAY })).toBe(true);
    expect(backupNudgeDue({ ...base, lastBackup: now - 13 * DAY })).toBe(false);
  });
  it("respects a snooze, then asks again once it has passed", () => {
    expect(backupNudgeDue({ ...base, snoozedUntil: now + DAY })).toBe(false);
    expect(backupNudgeDue({ ...base, snoozedUntil: now - 1 })).toBe(true);
  });
  it("says when the last backup was", () => {
    expect(describeLastBackup(now, null)).toBe("No backup yet");
    expect(describeLastBackup(now, now - 1000)).toBe("Last backup: today");
    expect(describeLastBackup(now, now - DAY)).toBe("Last backup: yesterday");
    expect(describeLastBackup(now, now - 9 * DAY)).toBe("Last backup: 9 days ago");
  });
});
