import { describe, expect, it } from "vitest";
import { shortAnswerMatches } from "../src/util.js";
import { passQuiz1, setup } from "./helpers.js";

const start = async (h: ReturnType<typeof setup>) => {
  const { json } = await h.post("/courses/mini/quizzes/qz1/attempts");
  return json.attemptId as string;
};
const qids = ["mini:a-mcq", "mini:a-short", "mini:a-open"];

describe("quiz payload", () => {
  it("never contains answer keys", async () => {
    const h = setup();
    const { json } = await h.get("/courses/mini/quizzes/qz1");
    expect(json.attemptNumber).toBe(1);
    expect(json.quiz).toEqual({ id: "qz1", title: "Check: shapes", passingPercentage: 70, maxAttempts: 0, showAnswers: true });
    expect(json.questions.map((q: any) => q.id)).toEqual(qids);
    const raw = JSON.stringify(json);
    for (const leak of ["correct", "explanation", "rubric", "answers", "Structural typing."]) expect(raw).not.toContain(leak);
    expect(json.questions[0].options).toEqual([{ text: "Names decide" }, { text: "Shapes decide" }, { text: "Neither" }]);
  });
});

describe("answers", () => {
  it("scores mcq all-or-nothing and reveals options with explanations after submit", async () => {
    const h = setup();
    const id = await start(h);
    const wrong = await h.post(`/attempts/${id}/answers/mini:a-mcq`, { type: "mcq", selected: [0] });
    expect(wrong.json).toMatchObject({ state: "scored", correct: false, marks: { got: 0, max: 1 } });
    expect(wrong.json.options).toEqual([
      { text: "Names decide", correct: false, selected: true, explanation: "That is nominal typing." },
      { text: "Shapes decide", correct: true, selected: false, explanation: "Structural typing." },
      { text: "Neither", correct: false, selected: false, explanation: "One of them is right." },
    ]);
    // no second go at the same question
    expect((await h.post(`/attempts/${id}/answers/mini:a-mcq`, { type: "mcq", selected: [1] })).status).toBe(409);
  });

  it("validates input", async () => {
    const h = setup();
    const id = await start(h);
    expect((await h.post(`/attempts/${id}/answers/mini:a-mcq`, { type: "mcq", selected: [7] })).status).toBe(400);
    expect((await h.post(`/attempts/${id}/answers/mini:a-mcq`, { type: "short", text: "x" })).status).toBe(400);
    expect((await h.post(`/attempts/${id}/answers/mini:a-mcq`, { type: "mcq", selected: [] })).status).toBe(400);
    expect((await h.post(`/attempts/${id}/answers/mini:nope`, { type: "short", text: "x" })).status).toBe(404);
    expect((await h.post(`/attempts/missing/answers/mini:a-mcq`, { type: "mcq", selected: [0] })).status).toBe(404);
  });

  it("matches short answers fuzzily and reveals accepted answers", async () => {
    const h = setup();
    const id = await start(h);
    const r = await h.post(`/attempts/${id}/answers/mini:a-short`, { type: "short", text: "  \"Object\" " });
    expect(r.json).toMatchObject({ state: "scored", correct: true, accepted: ["object"] });
    expect(shortAnswerMatches("objekt", ["object"])).toBe(false); // 5/6 chars right but below the 85 cutoff
    expect(shortAnswerMatches("objects", ["object"])).toBe(true);
    expect(shortAnswerMatches("a", ["b"])).toBe(false);
    expect(shortAnswerMatches("", ["b"])).toBe(false);
  });

  it("queues open answers as grade jobs and applies the graded result", async () => {
    const h = setup();
    const id = await start(h);
    const sub = await h.post(`/attempts/${id}/answers/mini:a-open`, { type: "open", text: "Shape-based." });
    expect(sub.json).toMatchObject({ state: "grading", correct: null, marks: null, answerText: "Shape-based.", feedback: null });
    expect(sub.json.jobId).toBeTruthy();

    const mid = (await h.get(`/attempts/${id}`)).json;
    expect(mid.score).toMatchObject({ pendingCount: 1, percent: null });
    expect(mid.provisional).toBe(true);

    const ran = await h.runner((job) => {
      expect(job.kind).toBe("grade");
      expect(job.payload.question).toMatchObject({ id: "mini:a-open", rubric: expect.stringContaining("Mentions shape") });
      expect(job.payload.answer).toBe("Shape-based.");
      expect(job.payload.context).toContain("Types are compared by their shape");
      return { score: 0.5, correct: false, feedback: "Half right." };
    });
    expect(ran?.outcome.status).toBe("done");

    const after = (await h.get(`/attempts/${id}`)).json;
    expect(after.answers[0]).toMatchObject({ state: "graded", marks: { got: 0.5, max: 1 }, correct: false });
    expect(after.answers[0].feedback).toEqual({ marks: { got: 0.5, max: 1 }, points: [{ ok: false, text: "Half right." }] });
    expect(after.score.pendingCount).toBe(0);
  });

  it("lets the learner self-mark a pending open answer against the rubric, and an AI grade replaces it", async () => {
    const h = setup();
    const id = await start(h);
    await h.post(`/attempts/${id}/answers/mini:a-mcq`, { type: "mcq", selected: [1] });
    await h.post(`/attempts/${id}/answers/mini:a-short`, { type: "short", text: "object" });
    const sub = await h.post(`/attempts/${id}/answers/mini:a-open`, { type: "open", text: "Shape-based." });
    expect(sub.json).toMatchObject({ state: "grading", rubric: expect.stringContaining("Mentions shape") });

    const self = await h.post(`/attempts/${id}/answers/mini:a-open/self-mark`, { mark: "partly" });
    expect(self.status).toBe(200);
    expect(self.json).toMatchObject({ state: "self", selfMark: "partly", marks: { got: 0.5, max: 1 }, correct: false, rubric: expect.any(String) });
    // the mark can be changed while it is still the learner's own
    expect((await h.post(`/attempts/${id}/answers/mini:a-open/self-mark`, { mark: "got" })).json).toMatchObject({ state: "self", selfMark: "got" });

    // nothing pending: the quiz is scored and passed now, and clears the lesson
    const fin = (await h.post(`/attempts/${id}/finish`)).json;
    expect(fin).toMatchObject({ provisional: false, passed: true, score: { percent: 100, pendingCount: 0 } });
    expect((await h.get("/courses/mini/lessons/a1")).json.completed).toBe(true);

    // the grade job is still queued; the AI grade replaces the self-mark and the score follows it
    const ran = await h.runner(() => ({ score: 0, correct: false, feedback: "Misses the point." }));
    expect(ran?.outcome.status).toBe("done");
    const after = (await h.get(`/attempts/${id}`)).json;
    expect(after.answers[2]).toMatchObject({ state: "graded", marks: { got: 0, max: 1 } });
    expect(after.answers[2].rubric).toBeUndefined();
    expect(after.score.percent).toBe(66.7);
    // once AI-graded it is no longer the learner's to mark
    expect((await h.post(`/attempts/${id}/answers/mini:a-open/self-mark`, { mark: "got" })).status).toBe(409);
  });

  it("refuses self-marks for other question types and before the answer is in", async () => {
    const h = setup();
    const id = await start(h);
    expect((await h.post(`/attempts/${id}/answers/mini:a-open/self-mark`, { mark: "got" })).status).toBe(409);
    await h.post(`/attempts/${id}/answers/mini:a-mcq`, { type: "mcq", selected: [0] });
    expect((await h.post(`/attempts/${id}/answers/mini:a-mcq/self-mark`, { mark: "got" })).status).toBe(400);
    expect((await h.post(`/attempts/${id}/answers/mini:a-open/self-mark`, { mark: "maybe" })).status).toBe(400);
  });

  it("gives no XP for a self-mark, so the AI grade can still award it", async () => {
    const h = setup();
    const id = await start(h);
    await h.post(`/attempts/${id}/answers/mini:a-open`, { type: "open", text: "x" });
    await h.post(`/attempts/${id}/answers/mini:a-open/self-mark`, { mark: "got" });
    const xp = () => (h.db.$client.prepare("SELECT reason FROM xp_event WHERE ref = ?").all(`${id}:mini:a-open`) as unknown[]).length;
    expect(xp()).toBe(0);
    await h.runner(() => ({ score: 1, correct: true, feedback: "Good." }));
    expect(xp()).toBe(1);
  });

  it("lets a failed grade be re-submitted", async () => {
    const h = setup();
    const id = await start(h);
    await h.post(`/attempts/${id}/answers/mini:a-open`, { type: "open", text: "first" });
    await h.runner(() => new Error("cli crashed"));
    const failed = (await h.get(`/attempts/${id}`)).json.answers[0];
    expect(failed.state).toBe("failed");
    const again = await h.post(`/attempts/${id}/answers/mini:a-open`, { type: "open", text: "second" });
    expect(again.status).toBe(200);
    expect(again.json.state).toBe("grading");
  });
});

describe("attempt lifecycle", () => {
  it("finishes with pass/fail, byDomain empty, history and missed list", async () => {
    const h = setup();
    const id = await start(h);
    await h.post(`/attempts/${id}/answers/mini:a-mcq`, { type: "mcq", selected: [0] });
    await h.post(`/attempts/${id}/answers/mini:a-short`, { type: "short", text: "object" });
    const fin = await h.post(`/attempts/${id}/finish`);
    expect(fin.json).toMatchObject({
      kind: "quiz", targetId: "qz1", number: 1, passed: false, provisional: false,
      score: { got: 1, max: 3, percent: 33.3, scoredCount: 3, totalCount: 3, pendingCount: 0 },
    });
    expect(fin.json.finishedAt).toBeTypeOf("number");
    expect(fin.json.missed.map((m: any) => m.questionId)).toEqual(["mini:a-mcq", "mini:a-open"]);
    expect(fin.json.missed[0]).toMatchObject({ number: 1, lesson: { id: "a1", title: "First lesson" }, pending: false });
    expect((await h.post(`/attempts/${id}/answers/mini:a-open`, { type: "open", text: "late" })).status).toBe(409);

    const second = await start(h);
    const hist = (await h.get(`/attempts/${second}`)).json;
    expect(hist.number).toBe(2);
    expect(hist.history.map((x: any) => [x.number, x.status])).toEqual([[1, "failed"], [2, "in_progress"]]);
  });

  it("a provisional pass becomes final once the open answer is graded", async () => {
    const h = setup();
    const id = await passQuiz1(h).catch((e) => { throw e; });
    const res = (await h.get(`/attempts/${id}`)).json;
    expect(res).toMatchObject({ passed: true, provisional: false, score: { percent: 100, pendingCount: 0 } });

    // fresh attempt, finish while grading is still pending
    const second = await start(h);
    await h.post(`/attempts/${second}/answers/mini:a-mcq`, { type: "mcq", selected: [1] });
    await h.post(`/attempts/${second}/answers/mini:a-short`, { type: "short", text: "object" });
    await h.post(`/attempts/${second}/answers/mini:a-open`, { type: "open", text: "x" });
    const fin = (await h.post(`/attempts/${second}/finish`)).json;
    expect(fin).toMatchObject({ provisional: true, passed: null, score: { pendingCount: 1, got: 2, max: 2, percent: 100 } });
    expect(fin.score.maxSwingPoints).toBeCloseTo(33.3, 1);
    expect(fin.missed).toEqual([expect.objectContaining({ questionId: "mini:a-open", pending: true })]);
  });

  it("enforces max_attempts and hides nothing it should show", async () => {
    const h = setup();
    expect((await h.post("/courses/mini/quizzes/none/attempts")).status).toBe(404);
  });

  it("records XP once per achievement (append-only ledger)", async () => {
    const h = setup();
    await passQuiz1(h);
    await h.post("/courses/mini/lessons/a1/complete");
    await h.post("/courses/mini/lessons/a1/complete");
    const rows = h.db.$client.prepare("SELECT reason, ref, amount FROM xp_event ORDER BY id").all() as any[];
    const reasons = rows.map((r) => r.reason);
    expect(reasons.filter((r) => r === "lesson_complete")).toHaveLength(1);
    expect(reasons.filter((r) => r === "quiz_pass")).toHaveLength(1);
    expect(reasons.filter((r) => r === "answer_correct").length).toBe(3);
  });
});

describe("attempt list and delete", () => {
  it("lists attempts, deletes one with its queued grading, and keeps lesson completion", async () => {
    const h = setup();
    const id = await start(h);
    await h.post(`/attempts/${id}/answers/mini:a-mcq`, { type: "mcq", selected: [1] });
    await h.post(`/attempts/${id}/answers/mini:a-short`, { type: "short", text: "object" });
    await h.post(`/attempts/${id}/answers/mini:a-open`, { type: "open", text: "x" });
    await h.post(`/attempts/${id}/finish`);

    const list = (await h.get("/attempts")).json.attempts;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, kind: "quiz", targetId: "qz1", number: 1, pendingCount: 1 });

    expect((await h.call("DELETE", `/attempts/${id}`)).json).toEqual({ deleted: true });
    expect((await h.get("/attempts")).json.attempts).toEqual([]);
    expect((await h.get(`/attempts/${id}`)).status).toBe(404);
    expect((await h.call("DELETE", `/attempts/${id}`)).status).toBe(404);
    // the queued grade job was cancelled, so the runner has nothing to claim
    expect(await h.runner(() => ({ score: 1, correct: true, feedback: "x" }))).toBeNull();

    // numbering continues from the highest remaining attempt
    expect((await h.get(`/attempts/${await start(h)}`)).json.number).toBe(1);
  });
});
