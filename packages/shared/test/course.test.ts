import { describe, expect, it } from "vitest";
import {
  courseManifestSchema,
  examBlueprintSchema,
  jobPayloadSchemas,
  jobResultSchemas,
  lessonFrontmatterSchema,
  quizSchema,
} from "../src/index.js";

describe("course.yaml", () => {
  const base = {
    schemaVersion: 1,
    id: "typescript-fundamentals",
    title: "TypeScript Fundamentals",
    short_intro: "One-line pitch.",
    level: "Beginner",
    chapters: [{ dir: "01-basics", title: "Types You Actually Use" }],
    exams: [{ id: "mid", file: "exams/mid.yaml", after: "01-basics" }, { id: "final", file: "exams/final.yaml" }],
  };

  it("accepts the plan.md example and applies defaults", () => {
    const m = courseManifestSchema.parse(base);
    expect(m.tags).toEqual([]);
    expect(m.description).toBe("");
  });

  it("rejects unknown schemaVersion", () => {
    expect(courseManifestSchema.safeParse({ ...base, schemaVersion: 2 }).success).toBe(false);
  });

  it("rejects bad ids and empty chapters", () => {
    expect(courseManifestSchema.safeParse({ ...base, id: "Not A Slug" }).success).toBe(false);
    expect(courseManifestSchema.safeParse({ ...base, chapters: [] }).success).toBe(false);
  });
});

describe("lesson frontmatter", () => {
  it("accepts numeric sources or `none`", () => {
    expect(lessonFrontmatterSchema.safeParse({ id: "l01", title: "T", sources: [3, 7] }).success).toBe(true);
    expect(lessonFrontmatterSchema.safeParse({ id: "l01", title: "T", sources: "none" }).success).toBe(true);
  });
  it("requires sources", () => {
    expect(lessonFrontmatterSchema.safeParse({ id: "l01", title: "T" }).success).toBe(false);
    expect(lessonFrontmatterSchema.safeParse({ id: "l01", title: "T", sources: [] }).success).toBe(false);
  });
});

describe("quiz", () => {
  const quiz = {
    id: "q01",
    title: "Check",
    questions: [
      {
        id: "q01-1",
        type: "mcq",
        text: "Which line is a type error?",
        options: [
          { text: "const n = 5;", correct: false, explanation: "fine" },
          { text: "n = 6;", correct: true, explanation: "const can't be reassigned" },
        ],
      },
      { id: "q01-2", type: "short", text: "Inferred type?", answers: ["string"] },
      { id: "q01-3", type: "open", text: "Explain.", rubric: "Must mention shapes." },
    ],
  };

  it("accepts all three question types with defaults", () => {
    const q = quizSchema.parse(quiz);
    expect(q.passing_percentage).toBe(70);
    expect(q.max_attempts).toBe(0);
  });

  it("rejects an mcq with no correct option", () => {
    const bad = structuredClone(quiz);
    (bad.questions[0] as { options: { correct: boolean }[] }).options.forEach((o) => (o.correct = false));
    expect(quizSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an open question without a rubric and unknown types", () => {
    expect(quizSchema.safeParse({ ...quiz, questions: [{ id: "x", type: "open", text: "t" }] }).success).toBe(false);
    expect(quizSchema.safeParse({ ...quiz, questions: [{ id: "x", type: "essay", text: "t" }] }).success).toBe(false);
  });
});

describe("exam blueprint", () => {
  it("parses domains and weights", () => {
    const b = examBlueprintSchema.parse({
      id: "mid",
      title: "Midterm",
      duration_minutes: 45,
      limit_questions: 20,
      domains: [
        { id: "types", title: "Types", weight: 2 },
        { id: "generics", title: "Generics", weight: 1, chapters: ["03-generics"] },
      ],
    });
    expect(b.shuffle).toBe(true);
    expect(b.max_attempts).toBe(0);
    expect(b.domains[0]?.chapters).toEqual([]);
  });
});

describe("job schemas", () => {
  it("has a payload and result schema for every kind", () => {
    for (const k of ["grade", "chat", "generate", "verify", "outline"] as const) {
      expect(jobPayloadSchemas[k]).toBeDefined();
      expect(jobResultSchemas[k]).toBeDefined();
    }
  });

  it("validates a grade result", () => {
    expect(jobResultSchemas.grade.safeParse({ score: 0.5, correct: false, feedback: "half" }).success).toBe(true);
    expect(jobResultSchemas.grade.safeParse({ score: 2, correct: false, feedback: "x" }).success).toBe(false);
  });

  it("requires valid citations shape in chat results", () => {
    const ok = { covered: true, answer: "a", citations: [{ kind: "source", ref: "3" }] };
    expect(jobResultSchemas.chat.safeParse(ok).success).toBe(true);
    expect(jobResultSchemas.chat.safeParse({ ...ok, citations: [{ kind: "web", ref: "x" }] }).success).toBe(false);
  });
});
