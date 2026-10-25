import { describe, expect, it } from "vitest";
import { buildBrief, planChapters, type BriefInput } from "../src/brief.js";

const input: BriefInput = {
  course: { id: "ts", title: "TypeScript", description: "d" },
  chapters: [
    { dir: "01-basics", title: "Basics", level: 1, lessons: [{ id: "l01", title: "A" }, { id: "l02", title: "B" }] },
    { dir: "02-narrowing", title: "Narrowing", level: 1, lessons: [{ id: "l03", title: "C" }] },
  ],
  quizIds: ["q01", "q03"],
  lastSourceNumber: 100,
  weakSpots: [{ concept: "generics", percent: 40, lesson: "C" }],
  outline: {
    title: "Level 2 · Deep dive",
    rationale: "You missed generics.",
    unverified: false,
    chapters: [
      { title: "Generics, properly", why: "weak spot", lessons: [{ title: "Constraints", objective: "Write a constrained generic.", why: "missed" }, { title: "Inference", objective: "Predict inferred types.", why: "" }] },
      { title: "Mapped types", why: "", lessons: [{ title: "Keys", objective: "Map over keys.", why: "" }] },
    ],
  },
  budgetMinutes: 60,
  seed: { topic: "generics" },
};

describe("planChapters", () => {
  it("starts a fresh extension namespace: x-prefixed dirs and ids, per-chapter file names, level 2", () => {
    const plan = planChapters(input);
    expect(plan.level).toBe(2);
    expect(plan.chapters.map((c) => c.dir)).toEqual(["x01-generics-properly", "x02-mapped-types"]);
    expect(plan.chapters.flatMap((c) => c.lessons.map((l) => [l.id, l.quizId, l.file, l.quizFile]))).toEqual([
      ["x01", "xq01", "lesson-01.md", "quiz-01.yaml"],
      ["x02", "xq02", "lesson-02.md", "quiz-02.yaml"],
      ["x03", "xq03", "lesson-01.md", "quiz-01.yaml"],
    ]);
  });

  it("shortens long chapter titles to a folder name that does not end in a dash", () => {
    const long = { ...input, outline: { ...input.outline, chapters: [{ title: "Type guards and discriminated unions in practice", why: "", lessons: [{ title: "A", objective: "o", why: "" }] }] } };
    const dir = planChapters(long).chapters[0]!.dir;
    expect(dir).toBe("x01-type-guards-and-discriminated-unions-in");
    expect(dir.endsWith("-")).toBe(false);
  });

  it("continues after an earlier extension: next ids, next level", () => {
    const earlier = { dir: "x01-first", title: "First", level: 2, lessons: [{ id: "x01", title: "D" }, { id: "x02", title: "E" }] };
    const plan = planChapters({ ...input, chapters: [...input.chapters, earlier], quizIds: ["q01", "xq01", "xq02"] });
    expect(plan.level).toBe(3);
    expect(plan.chapters[0]!.dir).toBe("x02-generics-properly");
    expect(plan.chapters[0]!.lessons[0]).toMatchObject({ id: "x03", quizId: "xq03" });
  });
});

describe("buildBrief", () => {
  const md = buildBrief(input);

  it("carries the approved outline with assigned ids and the course manifest entries to append", () => {
    expect(md).toContain("`x01-generics-properly/lesson-01.md` (id `x01`)");
    expect(md).toContain("Write a constrained generic.");
    expect(md).toContain("  - dir: x02-mapped-types\n    title: Mapped types\n    level: 2\n    origin: researched");
  });

  it("points at the extensions folder, never the package, and keeps lessons learner-neutral", () => {
    expect(md).toContain("`extensions/ts/extension.yaml`");
    expect(md).toContain("Do not touch anything under `courses/`");
    expect(md).toContain("never mention the learner's scores");
    expect(md).toContain("`school validate extensions/ts`");
  });

  it("states what exists, the next source number, the depth and the weak spots", () => {
    expect(md).toContain("02-narrowing");
    expect(md).toContain("number yours from 101 (101, 102");
    expect(md).toContain("about 1 hour");
    expect(md).toContain("generics: 40%");
  });

  it("is self-contained: format rules and all three templates are embedded", () => {
    for (const needle of [":::low-confidence", "EVERY option", "type: open", "reliability: high"]) expect(md).toContain(needle);
  });
});
