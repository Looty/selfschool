import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPath, routeDef, routeNames, routes, type RouteName } from "@selfschool/shared";
import { mockTransport, resetMock } from "./index";

const call = (name: RouteName, input: Record<string, unknown> = {}) => mockTransport(name, input);

/** Valid inputs for every route in the table. */
const INPUTS: Record<RouteName, Record<string, unknown>> = {
  health: {},
  job: { params: { id: "job-1" } },
  dashboard: {},
  courses: {},
  course: { params: { courseId: "typescript-fundamentals" } },
  proposeExtension: { params: { courseId: "typescript-fundamentals" }, body: {} },
  extensions: { params: { courseId: "typescript-fundamentals" } },
  extension: { params: { extensionId: "ext-x" } }, // replaced below once a proposal exists
  redraftExtension: { params: { extensionId: "ext-x" }, body: { budgetMinutes: 15 } },
  decideExtension: { params: { extensionId: "ext-x" }, body: { decision: "reject" } },
  extensionBrief: { params: { extensionId: "ext-x" } }, // approved below
  generateExtension: { params: { extensionId: "ext-x" } }, // approved below
  resumeExtension: { params: { extensionId: "ext-x" } }, // only valid after a failure
  lesson: { params: { courseId: "typescript-fundamentals", lessonId: "l06" } },
  completeLesson: { params: { courseId: "typescript-fundamentals", lessonId: "l06" } },
  chat: { params: { courseId: "typescript-fundamentals", lessonId: "l06" } },
  ask: { params: { courseId: "typescript-fundamentals", lessonId: "l06" }, body: { question: "What is a guard?" } },
  quiz: { params: { courseId: "typescript-fundamentals", quizId: "q06" } },
  startQuizAttempt: { params: { courseId: "typescript-fundamentals", quizId: "q06" } },
  exam: { params: { courseId: "typescript-fundamentals", examId: "mid" } },
  startExam: { params: { courseId: "typescript-fundamentals", examId: "mid" } },
  regenerateExam: { params: { courseId: "typescript-fundamentals", examId: "mid" } },
  examInstance: { params: { instanceId: "inst-x" } }, // replaced below once an instance exists
  attempts: {},
  attempt: { params: { attemptId: "att-mid-2" } },
  deleteAttempt: { params: { attemptId: "att-mid-1" } },
  submitAnswer: { params: { attemptId: "att-mid-2", questionId: "x01" }, body: { type: "mcq", selected: [0] } },
  selfMarkAnswer: { params: { attemptId: "att-mid-2", questionId: "q06-3" }, body: { mark: "partly" } },
  finishAttempt: { params: { attemptId: "att-mid-2" } },
  reportQuestion: { params: { questionId: "x07" }, body: {} },
  settings: {},
  updateSettings: { body: { models: { chat: "sonnet" } } },
  packages: {},
  addPackage: { body: { url: "github.com/a/b" } },
};

beforeEach(() => {
  resetMock();
});
afterEach(() => vi.useRealTimers());

describe("mock layer", () => {
  it("has an input for every route (keeps this test in step with the table)", () => {
    expect(Object.keys(INPUTS).sort()).toEqual(routeNames().sort());
  });

  // One call per route at ~80ms mock latency: close to the 5s default, and over it when other packages' tests run alongside.
  it("every handler returns data that validates against its shared schema", { timeout: 30_000 }, async () => {
    for (const name of routeNames()) {
      const input = { ...INPUTS[name] };
      if (name === "examInstance") {
        const inst = (await call("startExam", INPUTS.startExam)) as { id: string };
        input.params = { instanceId: inst.id };
      }
      if (name === "extension" || name === "decideExtension" || name === "redraftExtension") {
        const ext = (await call("proposeExtension", { params: INPUTS.proposeExtension.params, body: { topic: "generics" } })) as { extensionId: string };
        input.params = { extensionId: ext.extensionId };
        if (name === "decideExtension" || name === "redraftExtension") vi.useFakeTimers({ now: Date.now() + 10_000, toFake: ["Date"] }); // drafting takes ~4s
      }
      if (name === "resumeExtension") {
        await expect(call(name, input)).rejects.toThrow(/nothing to resume/);
        continue;
      }
      if (name === "extensionBrief" || name === "generateExtension") {
        const ext = (await call("proposeExtension", { params: INPUTS.proposeExtension.params, body: { topic: "generics" } })) as { extensionId: string };
        vi.useFakeTimers({ now: Date.now() + 10_000, toFake: ["Date"] });
        const ready = (await call("extension", { params: { extensionId: ext.extensionId } })) as { outline: unknown };
        await call("decideExtension", { params: { extensionId: ext.extensionId }, body: { decision: "approve", outline: ready.outline } });
        input.params = { extensionId: ext.extensionId };
      }
      if (name === "submitAnswer") {
        // attempt 2 is finished; use a fresh quiz attempt instead
        const a = (await call("startQuizAttempt", INPUTS.startQuizAttempt)) as { attemptId: string };
        input.params = { attemptId: a.attemptId, questionId: "q06-1" };
      }
      if (name === "selfMarkAnswer") {
        // a quiz (answers shown) with an open answer waiting for AI
        const a = (await call("startQuizAttempt", INPUTS.startQuizAttempt)) as { attemptId: string };
        await call("submitAnswer", { params: { attemptId: a.attemptId, questionId: "q06-3" }, body: { type: "open", text: "shapes" } });
        input.params = { attemptId: a.attemptId, questionId: "q06-3" };
      }
      if (name === "finishAttempt") {
        const a = (await call("startQuizAttempt", INPUTS.startQuizAttempt)) as { attemptId: string };
        input.params = { attemptId: a.attemptId };
      }
      const out = await call(name, input);
      vi.useRealTimers();
      const parsed = routeDef(name).res.safeParse(out);
      expect(parsed.success, `${name}: ${parsed.success ? "" : parsed.error.message}`).toBe(true);
    }
  });

  it("route paths build with the sample params", () => {
    for (const name of routeNames()) {
      const params = (INPUTS[name].params ?? {}) as Record<string, string>;
      expect(() => buildPath(routes[name].path, params), name).not.toThrow();
    }
  });

  it("matches the prototype: TS course at 5 / 12 (42%), lesson 06 is current", async () => {
    const d = (await call("dashboard")) as { continue: { lesson: { title: string }; lessonNumber: number; progress: { done: number; percent: number } }; pendingGrading: number };
    expect(d.continue.lesson.title).toBe("Type guards");
    expect(d.continue.lessonNumber).toBe(6);
    expect(d.continue.progress).toMatchObject({ done: 5, percent: 42 });
    expect(d.pendingGrading).toBe(2);
  });

  it("completing a lesson moves the current marker and progress", async () => {
    await call("completeLesson", INPUTS.completeLesson);
    const c = (await call("course", INPUTS.course)) as { progress: { done: number }; resume: { id: string } };
    expect(c.progress.done).toBe(6);
    expect(c.resume.id).toBe("l07");
  });

  it("quiz flow: mcq reveals explanations, open answers queue then grade", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { attemptId } = (await call("startQuizAttempt", INPUTS.startQuizAttempt)) as { attemptId: string };
    const p = (qid: string) => ({ attemptId, questionId: qid });

    const mcq = (await call("submitAnswer", { params: p("q06-1"), body: { type: "mcq", selected: [1] } })) as { state: string; correct: boolean; options: { explanation: string }[] };
    expect(mcq).toMatchObject({ state: "scored", correct: true });
    expect(mcq.options).toHaveLength(4);

    const short = (await call("submitAnswer", { params: p("q06-2"), body: { type: "short", text: '"Object"' } })) as { correct: boolean };
    expect(short.correct).toBe(true);

    const open = (await call("submitAnswer", { params: p("q06-3"), body: { type: "open", text: "shape based" } })) as { state: string };
    expect(open.state).toBe("grading");

    const mid = (await call("attempt", { params: { attemptId } })) as { provisional: boolean; score: { pendingCount: number } };
    expect(mid.provisional).toBe(true);
    expect(mid.score.pendingCount).toBe(1);

    vi.setSystemTime(Date.now() + 5000);
    const later = (await call("attempt", { params: { attemptId } })) as { answers: { questionId: string; state: string; feedback: unknown }[]; score: { pendingCount: number } };
    expect(later.score.pendingCount).toBe(0);
    expect(later.answers.find((a) => a.questionId === "q06-3")).toMatchObject({ state: "graded" });
  });

  it("rejects a wrong answer type and answers after finish", async () => {
    const { attemptId } = (await call("startQuizAttempt", INPUTS.startQuizAttempt)) as { attemptId: string };
    await expect(call("submitAnswer", { params: { attemptId, questionId: "q06-1" }, body: { type: "short", text: "x" } })).rejects.toThrow(/expected a mcq/);
    await call("finishAttempt", { params: { attemptId } });
    await expect(call("submitAnswer", { params: { attemptId, questionId: "q06-1" }, body: { type: "mcq", selected: [0] } })).rejects.toThrow(/finished/);
  });

  it("exams hide answers until the result; regenerate makes a new frozen instance", async () => {
    const inst = (await call("startExam", INPUTS.startExam)) as { attemptId: string; questions: { id: string }[] };
    expect(inst.questions).toHaveLength(30);
    expect(JSON.stringify(inst.questions)).not.toMatch(/correct|explanation/);
    const r = (await call("submitAnswer", { params: { attemptId: inst.attemptId, questionId: "x01" }, body: { type: "mcq", selected: [0] } })) as { state: string; options?: unknown };
    expect(r.state).toBe("recorded");
    expect(r.options).toBeUndefined();

    const regen = (await call("regenerateExam", INPUTS.regenerateExam)) as { instance: { id: string; attemptId: string } };
    expect(regen.instance.id).not.toBe((inst as unknown as { id: string }).id);
    const info = (await call("exam", INPUTS.exam)) as { attempts: { number: number }[] };
    expect(info.attempts.map((a) => a.number)).toEqual([1, 2, 3, 4]);
  });

  it("seeded mid exam: attempt 1 failed, attempt 2 provisional with 2 pending", async () => {
    const info = (await call("exam", INPUTS.exam)) as { attempts: { status: string }[] };
    expect(info.attempts.map((a) => a.status)).toEqual(["failed", "provisional"]);
    const a2 = (await call("attempt", { params: { attemptId: "att-mid-2" } })) as { score: { pendingCount: number; maxSwingPoints: number }; missed: { pending: boolean }[] };
    expect(a2.score.pendingCount).toBe(2);
    expect(a2.score.maxSwingPoints).toBeGreaterThan(0);
    expect(a2.missed.some((m) => m.pending)).toBe(true);
  });

  it("chat answers after the simulated runner delay; not-covered questions offer no citations", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const ask = (await call("ask", { ...INPUTS.ask, body: { question: "How do decorators work?" } })) as { assistant: { status: string } };
    expect(ask.assistant.status).toBe("pending");
    vi.setSystemTime(Date.now() + 2000);
    const t = (await call("chat", INPUTS.chat)) as { messages: { status: string; covered: boolean | null }[] };
    const last = t.messages.at(-1)!;
    expect(last).toMatchObject({ status: "done", covered: false });
  });

  it("unknown courses 404", async () => {
    await expect(call("course", { params: { courseId: "nope" } })).rejects.toThrow(/not found/);
  });
});
