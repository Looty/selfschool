import { describe, expect, it } from "vitest";
import { setup, type Harness } from "./helpers.js";

/** Claims the next job the way the runner does, without answering it. */
const claim = async (h: Harness) => (await (await h.app.request("/jobs/next")).json()) as { id: string; kind: string };
const partial = (h: Harness, jobId: string, body: unknown) => h.post(`/jobs/${jobId}/partial`, body);

describe("streamed progress", () => {
  it("shows a running chat answer as it is written, and drops it when the result arrives", async () => {
    const h = setup();
    await h.post("/courses/mini/lessons/a1/chat", { question: "Why shapes?" });
    const pending = (await h.get("/courses/mini/lessons/a1/chat")).json.messages[1];
    expect(pending).toMatchObject({ status: "pending" });
    expect(pending.partial).toBeUndefined();

    const job = await claim(h);
    expect(job.kind).toBe("chat");
    expect((await partial(h, job.id, { text: "Because the compiler" })).status).toBe(204);
    expect((await h.get("/courses/mini/lessons/a1/chat")).json.messages[1]).toMatchObject({ status: "pending", partial: "Because the compiler" });
    await partial(h, job.id, { text: "Because the compiler compares shapes." });
    expect((await h.get("/courses/mini/lessons/a1/chat")).json.messages[1].partial).toBe("Because the compiler compares shapes.");

    const done = await h.post(`/jobs/${job.id}/result`, {
      ok: true,
      result: { covered: true, answer: "Final answer. [1]", citations: [{ kind: "source", ref: "1" }] },
    });
    expect(done.json.status).toBe("done");
    const final = (await h.get("/courses/mini/lessons/a1/chat")).json.messages[1];
    expect(final).toMatchObject({ status: "done", content: "Final answer. [1]" });
    expect(final.partial).toBeUndefined();
  });

  it("ignores progress for a grade job: grading shows no partial text", async () => {
    const h = setup();
    const { json } = await h.post("/courses/mini/quizzes/qz1/attempts");
    await h.post(`/attempts/${json.attemptId}/answers/mini:a-open`, { type: "open", text: "Shape-based." });
    const job = await claim(h);
    expect(job.kind).toBe("grade");
    expect((await partial(h, job.id, { text: "You named the shape idea but" })).status).toBe(204);

    const answer = (await h.get(`/attempts/${json.attemptId}`)).json.answers.find((a: any) => a.questionId === "mini:a-open");
    expect(answer).toMatchObject({ state: "grading", correct: null, marks: null });
    expect(answer.partial).toBeUndefined();
  });

  it("ignores progress for jobs that are not running, are not chat, or do not exist, and rejects a bad body", async () => {
    const h = setup();
    await h.post("/courses/mini/lessons/a1/chat", { question: "Why?" });
    const queued = (await h.get("/courses/mini/lessons/a1/chat")).json.messages[1].jobId;
    await partial(h, queued, { text: "too early" }); // still pending: not running yet
    await partial(h, "no-such-job", { text: "x" });
    expect((await h.get("/courses/mini/lessons/a1/chat")).json.messages[1].partial).toBeUndefined();

    const job = await claim(h);
    expect((await partial(h, job.id, { text: 5 })).status).toBe(400);
    expect((await partial(h, job.id, { text: "x".repeat(20_001) })).status).toBe(400);

    const outline = (await h.post("/courses/mini/extensions", { topic: "x" })).json;
    const o = await claim(h);
    expect(o.kind).toBe("outline");
    expect((await partial(h, o.id, { text: "not streamed" })).status).toBe(204);
    expect((await h.get(`/extensions/${outline.extensionId}`)).json.outline).toBeNull();
  });
});
