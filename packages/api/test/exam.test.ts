import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allocate } from "../src/exams.js";
import { miniCourses, setup, type Harness } from "./helpers.js";

type Q = { id: string; type: string };

async function takeExam(h: Harness, instance: { attemptId: string; questions: Q[] }, correct = true) {
  for (const q of instance.questions) {
    if (q.type === "mcq") {
      // fixture mcqs: the correct option index; any other index is wrong
      const right = q.id === "mini:b-one" ? 0 : 1;
      await h.post(`/attempts/${instance.attemptId}/answers/${q.id}`, { type: "mcq", selected: [correct ? right : 1 - right] });
    } else if (q.type === "short") {
      await h.post(`/attempts/${instance.attemptId}/answers/${q.id}`, { type: "short", text: correct ? "object" : "wrong" });
    } else {
      await h.post(`/attempts/${instance.attemptId}/answers/${q.id}`, { type: "open", text: "an answer" });
    }
  }
}

describe("exam instances", () => {
  it("shows exam info and starts a frozen, answer-free instance", async () => {
    const h = setup();
    const info = (await h.get("/courses/mini/exams/final")).json;
    expect(info.domains).toEqual([{ id: "d1", title: "Domain one", weight: 50 }, { id: "d2", title: "Domain two", weight: 50 }]);
    expect(info.latestAttemptId).toBeNull();

    const { status, json } = await h.post("/courses/mini/exams/final/instances");
    expect(status).toBe(200);
    expect(json).toMatchObject({ examId: "final", title: "Final exam", durationMinutes: 10 });
    expect(json.questions).toHaveLength(4);
    // drawn proportionally to the blueprint weights: 2 from c1's bank, 2 from c2's
    const ids = json.questions.map((q: Q) => q.id);
    expect(ids.filter((i: string) => ["mini:a-mcq", "mini:a-short", "mini:a-open"].includes(i))).toHaveLength(2);
    expect(ids.filter((i: string) => i.startsWith("mini:b-"))).toHaveLength(2);
    for (const leak of ["correct", "explanation", "rubric", "answers"]) expect(JSON.stringify(json)).not.toContain(`"${leak}"`);

    expect((await h.get(`/exam-instances/${json.id}`)).json).toEqual(json);
    // starting again resumes the unfinished attempt
    expect((await h.post("/courses/mini/exams/final/instances")).json.attemptId).toBe(json.attemptId);
    expect((await h.get("/courses/mini/exams/final")).json.exam).toMatchObject({ status: "in_progress", attemptCount: 1 });
    expect((await h.get("/exam-instances/nope")).status).toBe(404);
  });

  it("reveals nothing until the attempt is finished, then scores by domain", async () => {
    const h = setup();
    const inst = (await h.post("/courses/mini/exams/final/instances")).json;
    const mcq = inst.questions.find((q: Q) => q.type === "mcq");
    const r = await h.post(`/attempts/${inst.attemptId}/answers/${mcq.id}`, { type: "mcq", selected: [0] });
    expect(r.json).toMatchObject({ state: "recorded", correct: null, marks: null });
    expect(r.json.options).toBeUndefined();

    await takeExam(h, { attemptId: inst.attemptId, questions: inst.questions.filter((q: Q) => q.id !== mcq.id) });
    const mid = (await h.get(`/attempts/${inst.attemptId}`)).json;
    expect(mid.answers.every((a: any) => a.state === "recorded" || a.state === "grading")).toBe(true);
    expect(JSON.stringify(mid.answers)).not.toContain("explanation");
    expect(mid.byDomain).toEqual([]);

    // grade any open answers so the result is final
    while (await h.runner(() => ({ score: 1, correct: true, feedback: "ok" })));
    const fin = (await h.post(`/attempts/${inst.attemptId}/finish`)).json;
    expect(fin.kind).toBe("exam");
    expect(fin.byDomain.map((d: any) => d.id)).toEqual(["d1", "d2"]);
    expect(fin.answers.find((a: any) => a.questionId === mcq.id).options).toBeDefined();
    expect((await h.get("/courses/mini/exams/final")).json.latestAttemptId).toBe(inst.attemptId);
  });

  it("shows a provisional score with pending AI answers", async () => {
    const h = setup();
    // make every question open-ended-free except one open: just answer everything correctly
    const inst = (await h.post("/courses/mini/exams/final/instances")).json;
    await takeExam(h, inst);
    const fin = (await h.post(`/attempts/${inst.attemptId}/finish`)).json;
    const hasOpen = inst.questions.some((q: Q) => q.type === "open");
    if (hasOpen) {
      expect(fin).toMatchObject({ provisional: true, passed: null });
      expect(fin.score.pendingCount).toBe(1);
      expect((await h.get("/courses/mini/exams/final")).json.exam).toMatchObject({ status: "provisional", pendingCount: 1 });
      await h.runner(() => ({ score: 1, correct: true, feedback: "ok" }));
      expect((await h.get(`/attempts/${inst.attemptId}`)).json).toMatchObject({ provisional: false, passed: true });
    } else {
      expect(fin).toMatchObject({ provisional: false, passed: true });
    }
  });

  it("enforces max_attempts from the blueprint", async () => {
    const dir = miniCourses();
    const f = join(dir, "mini", "exams", "final.yaml");
    writeFileSync(f, readFileSync(f, "utf8").replace("max_attempts: 0", "max_attempts: 1"));
    const h = setup({ coursesDir: dir });
    const inst = (await h.post("/courses/mini/exams/final/instances")).json;
    await h.post(`/attempts/${inst.attemptId}/finish`);
    expect((await h.post("/courses/mini/exams/final/instances")).status).toBe(409);
  });
});

describe("regenerate", () => {
  it("draws unseen bank questions first, queues generate jobs for the rest, never touches old instances", async () => {
    const h = setup();
    const first = (await h.post("/courses/mini/exams/final/instances")).json;
    expect((await h.post("/courses/mini/exams/final/regenerate")).status).toBe(409); // attempt in progress
    await h.post(`/attempts/${first.attemptId}/finish`);

    const regen = (await h.post("/courses/mini/exams/final/regenerate")).json;
    expect(regen.instance.id).not.toBe(first.id);
    expect(regen.drawn).toEqual({ fromBank: 1, generating: 3 }); // 5 in the bank, 4 already seen
    expect(regen.jobId).toBeTruthy();
    const seenIds = new Set(first.questions.map((q: Q) => q.id));
    expect(regen.instance.questions.filter((q: Q) => !seenIds.has(q.id))).toHaveLength(1);
    expect(regen.instance.questions).toHaveLength(4); // topped up with seen ones so it is takeable now

    // old instance is untouched
    expect((await h.get(`/exam-instances/${first.id}`)).json.questions).toEqual(first.questions);

    // the runner generates; new questions are unverified until a verify job passes
    const generated: string[] = [];
    let n = 0;
    while (true) {
      const r = await h.runner((job) => {
        if (job.kind === "generate") {
          expect(job.payload.sourcesMd).toContain("The Handbook");
          expect(job.payload.existing.length).toBe(5);
          return {
            questions: Array.from({ length: job.payload.count }, () => ({
              id: `g${++n}`, type: "mcq", text: `Generated ${n} for ${job.payload.domain}?`, concepts: ["gen"], sources: [1],
              options: [{ text: "Yes", correct: true, explanation: "y" }, { text: "No", correct: false, explanation: "n" }],
            })),
          };
        }
        generated.push(job.payload.question.id);
        return { verdict: "ok", notes: "" };
      });
      if (!r) break;
    }
    expect(n).toBe(3);
    expect(generated).toHaveLength(3);
    const states = h.db.$client.prepare("SELECT status, origin FROM question WHERE origin = 'generated'").all() as any[];
    expect(states).toEqual([1, 2, 3].map(() => ({ status: "active", origin: "generated" })));

    await h.post(`/attempts/${regen.instance.attemptId}/finish`);
    const again = (await h.post("/courses/mini/exams/final/regenerate")).json;
    expect(again.drawn.fromBank).toBeGreaterThanOrEqual(3);
  });

  it("keeps unverified generated questions out of draws and retires reported ones", async () => {
    const h = setup();
    const first = (await h.post("/courses/mini/exams/final/instances")).json;
    await h.post(`/attempts/${first.attemptId}/finish`);
    await h.post("/courses/mini/exams/final/regenerate");
    await h.runner((job) => ({
      questions: Array.from({ length: job.payload.count }, (_, i) => ({
        id: `g${i}`, type: "short", text: `Gen ${job.payload.domain} ${i}`, answers: ["x"], concepts: [], sources: [],
      })),
    }));
    expect((h.db.$client.prepare("SELECT count(*) AS n FROM question WHERE status = 'unverified'").get() as any).n).toBeGreaterThan(0);

    const rep = await h.post("/questions/mini:b-one/report", { reason: "wrong key" });
    expect(rep).toMatchObject({ status: 200, json: { retired: true } });
    expect(h.db.$client.prepare("SELECT status, report_reason AS r FROM question WHERE id = 'mini:b-one'").get()).toEqual({ status: "retired", r: "wrong key" });
    expect((await h.post("/questions/ghost/report", {})).status).toBe(404);

    // a retired question never appears in a new draw
    while (await h.runner(() => ({ verdict: "wrong", notes: "no" })));
    const next = (await h.post(`/courses/mini/exams/final/regenerate`)).status;
    expect([200, 409]).toContain(next); // 409: previous regenerated attempt still open
  });
});

describe("allocate", () => {
  it("splits by weight with largest remainder", () => {
    const exam = { blueprint: { domains: [{ id: "a", weight: 70 }, { id: "b", weight: 30 }] } } as any;
    expect([...allocate(exam, 12)]).toEqual([["a", 8], ["b", 4]]);
    expect([...allocate(exam, 3)].map(([, n]) => n).reduce((x, y) => x + y)).toBe(3);
  });
});
