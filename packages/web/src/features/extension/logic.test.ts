import { describe, expect, it } from "vitest";
import type { OutlineResult } from "@selfschool/shared";
import { canApprove, includedCount, toDraft, toOutline } from "./logic";

const outline: OutlineResult = {
  title: "Level 2",
  rationale: "why",
  unverified: true,
  chapters: [
    { title: "A", why: "", lessons: [{ title: "a1", objective: "o", why: "" }, { title: "a2", objective: "o", why: "" }] },
    { title: "B", why: "", lessons: [{ title: "b1", objective: "o", why: "" }] },
  ],
};

describe("outline draft", () => {
  it("starts with everything included and round-trips unchanged", () => {
    const d = toDraft(outline);
    expect(includedCount(d)).toBe(3);
    expect(canApprove(d)).toBe(true);
    expect(toOutline(d)).toEqual(outline);
  });

  it("leaving lessons out drops them, and chapters with none left", () => {
    const d = toDraft(outline);
    d.chapters[0]!.lessons[1]!.included = false;
    d.chapters[1]!.lessons[0]!.included = false;
    expect(toOutline(d).chapters).toEqual([{ title: "A", why: "", lessons: [{ title: "a1", objective: "o", why: "" }] }]);
  });

  it("cannot approve an empty selection or a blank title that would be saved", () => {
    const none = toDraft(outline);
    none.chapters.forEach((c) => c.lessons.forEach((l) => (l.included = false)));
    expect(canApprove(none)).toBe(false);

    const blankLesson = toDraft(outline);
    blankLesson.chapters[0]!.lessons[0]!.title = "  ";
    expect(canApprove(blankLesson)).toBe(false);
    blankLesson.chapters[0]!.lessons[0]!.included = false; // a blank title on a dropped lesson is fine
    expect(canApprove(blankLesson)).toBe(true);

    const blankChapter = toDraft(outline);
    blankChapter.chapters[1]!.title = "";
    expect(canApprove(blankChapter)).toBe(false);
  });

  it("trims saved titles", () => {
    const d = toDraft(outline);
    d.title = "  Level 2  ";
    d.chapters[0]!.title = " A ";
    expect(toOutline(d).title).toBe("Level 2");
    expect(toOutline(d).chapters[0]!.title).toBe("A");
  });
});
