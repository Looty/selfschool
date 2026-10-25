import { describe, expect, it } from "vitest";
import type { ChapterOutline } from "@selfschool/shared";
import { chapterState, defaultOpen, examPill, heroMeta, lessonIcon, sourceLine, splitLevels, timeLeftLabel, updatedLabel, waitingProposal } from "./logic";

describe("waitingProposal", () => {
  const ext = (id: string, status: string, generation: unknown = null) => ({ id, status, generation }) as Parameters<typeof waitingProposal>[0][number];
  const gen = (state: "running" | "failed" | "done", done = 1, total = 4) => ({ state, done, total, current: null, error: null });

  it("points back to an approved outline that has nothing written, only while the course has no extension chapters", () => {
    expect(waitingProposal([ext("a", "approved")], false)).toMatchObject({ id: "a", action: "Get them written" });
    expect(waitingProposal([ext("a", "approved")], true)).toBeNull();
  });

  it("shows writing progress and a stopped run, wherever the course stands", () => {
    expect(waitingProposal([ext("a", "approved", gen("running", 2, 5))], true)).toMatchObject({ label: "Writing lessons · 2 of 5", action: "View progress" });
    expect(waitingProposal([ext("a", "approved", gen("failed", 2, 5))], true)).toMatchObject({ label: "Stopped after 2 of 5 lessons", action: "Continue" });
  });

  it("ignores finished, rejected and unapproved proposals, and picks the newest waiting one", () => {
    expect(waitingProposal([ext("a", "approved", gen("done", 4, 4)), ext("b", "rejected"), ext("c", "ready"), ext("d", "drafting")], false)).toBeNull();
    expect(waitingProposal([ext("new", "approved", gen("running")), ext("old", "approved")], false)?.id).toBe("new");
  });
});

describe("outline status", () => {
  it("classifies chapters", () => {
    expect(chapterState({ done: 3, total: 3 })).toBe("complete");
    expect(chapterState({ done: 2, total: 4 })).toBe("partial");
    expect(chapterState({ done: 0, total: 5 })).toBe("untouched");
    expect(chapterState({ done: 0, total: 0 })).toBe("untouched");
  });
  it("collapses only complete chapters by default", () => {
    expect(defaultOpen({ done: 3, total: 3 })).toBe(false);
    expect(defaultOpen({ done: 2, total: 4 })).toBe(true);
  });
  it("maps lesson status to icon", () => {
    expect(lessonIcon({ status: "done" })).toBe("check");
    expect(lessonIcon({ status: "current" })).toBe("current");
    expect(lessonIcon({ status: "todo" })).toBe("todo");
  });
  it("labels revised lessons", () => {
    expect(updatedLabel({ updated: true, revision: 2 })).toBe("Updated · rev 2");
    expect(updatedLabel({ updated: false, revision: 3 })).toBeNull();
  });
});

describe("levels", () => {
  const ch = (dir: string, level: number, done: number, total: number, minutes: number): ChapterOutline => ({
    dir, title: dir, level, origin: level > 1 ? "quick" : "researched", minutes, done, total, lessons: [],
  });
  it("keeps level 1 as the core and totals each extension level apart", () => {
    const { core, extensions } = splitLevels([ch("a", 1, 3, 3, 30), ch("b", 2, 1, 2, 12), ch("c", 2, 0, 3, 20), ch("d", 3, 0, 1, 5)]);
    expect(core.map((c) => c.dir)).toEqual(["a"]);
    expect(extensions.map((e) => [e.level, e.done, e.total, e.minutes])).toEqual([[2, 1, 5, 32], [3, 0, 1, 5]]);
  });
  it("has no extension groups for a plain course", () => {
    expect(splitLevels([ch("a", 1, 0, 2, 10)]).extensions).toEqual([]);
  });
});

describe("exams", () => {
  it("builds the status pill", () => {
    expect(examPill({ status: "not_started", attemptCount: 0, pendingCount: 0 })).toBeNull();
    expect(examPill({ status: "provisional", attemptCount: 2, pendingCount: 2 })).toEqual({ tone: "warn", text: "Attempt 2 · 2 pending" });
    expect(examPill({ status: "failed", attemptCount: 1, pendingCount: 0 })?.tone).toBe("bad");
    expect(examPill({ status: "passed", attemptCount: 1, pendingCount: 0 })?.tone).toBe("ok");
  });
});

describe("labels", () => {
  it("hero meta and source line", () => {
    const time = { readingMinutes: 0, practiceMinutes: 0, examMinutes: 0, totalMinutes: 137, remainingMinutes: 40 };
    expect(heroMeta({ lessonCount: 12, examCount: 2, level: "Level 1", time })).toBe("12 lessons · 2 exams · 2 h 15 min · Level 1");
    expect(heroMeta({ lessonCount: 1, examCount: 1, level: "L", time: { ...time, totalMinutes: 20 } })).toBe("1 lesson · 1 exam · 20 min · L");
    expect(timeLeftLabel(time)).toBe("40 min left");
    expect(sourceLine({ repo: "github.com/a/b", sha: "abc1234", sourceCount: 24 })).toBe("github.com/a/b @ abc1234 · 24 sources");
  });
});
