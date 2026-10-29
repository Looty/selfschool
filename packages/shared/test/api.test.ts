import { describe, expect, it } from "vitest";
import {
  answerInputSchema,
  buildPath,
  dashboardSchema,
  learnerQuestionSchema,
  routeDef,
  routeNames,
  routes,
} from "../src/index.js";

describe("route table", () => {
  it("has unique method+path pairs", () => {
    const keys = routeNames().map((n) => `${routes[n].method} ${routes[n].path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("declares a params schema covering every :param in the path", () => {
    for (const name of routeNames()) {
      const def = routeDef(name);
      const wanted = [...def.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]!);
      const declared = def.params ? Object.keys((def.params as unknown as { shape: object }).shape) : [];
      expect(declared.sort(), name).toEqual(wanted.sort());
    }
  });

  it("only GET routes lack a body; POST/PUT bodies are optional only when none is declared", () => {
    for (const name of routeNames()) {
      const def = routeDef(name);
      if (def.method === "PUT") expect(def.body, name).toBeDefined();
      if (def.method === "GET") expect(def.body, name).toBeUndefined();
    }
  });

  it("covers every screen's data needs", () => {
    expect(routeNames()).toEqual(
      expect.arrayContaining([
        "dashboard", "courses", "course", "lesson", "completeLesson", "quiz", "startQuizAttempt",
        "submitAnswer", "selfMarkAnswer", "finishAttempt", "attempt", "exam", "startExam", "regenerateExam",
        "examInstance", "reportQuestion", "chat", "ask", "job", "settings", "updateSettings", "packages",
      ]),
    );
  });
});

describe("buildPath", () => {
  it("fills and encodes params", () => {
    expect(buildPath("/courses/:courseId/lessons/:lessonId", { courseId: "ts", lessonId: "a b" })).toBe(
      "/courses/ts/lessons/a%20b",
    );
  });
  it("throws on a missing param", () => {
    expect(() => buildPath("/courses/:courseId", {})).toThrow(/courseId/);
  });
});

describe("schemas", () => {
  it("answer inputs are discriminated by type", () => {
    expect(answerInputSchema.safeParse({ type: "mcq", selected: [1] }).success).toBe(true);
    expect(answerInputSchema.safeParse({ type: "mcq", selected: [] }).success).toBe(false);
    expect(answerInputSchema.safeParse({ type: "open", text: "" }).success).toBe(false);
  });

  it("dashboard requires a 16x7 activity grid and 7 week bars", () => {
    expect(dashboardSchema.safeParse({ continue: null }).success).toBe(false);
  });

  it("learner question schema strips answer keys", () => {
    const q = learnerQuestionSchema.parse({
      id: "q1", type: "mcq", text: "t",
      options: [{ text: "a", correct: true, explanation: "x" }, { text: "b" }],
    });
    expect(JSON.stringify(q)).not.toMatch(/correct|explanation/);
  });
});
