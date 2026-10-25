import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { miniCourses, setup } from "./helpers.js";

const ask = (h: ReturnType<typeof setup>, question = "Why shapes?", selection?: string) =>
  h.post("/courses/mini/lessons/a1/chat", { question, ...(selection ? { selection } : {}) });

describe("grounded chat", () => {
  it("queues a chat job with lesson text, sources and history; shows a pending assistant message", async () => {
    const h = setup();
    const r = await ask(h, "Why shapes?", "compared by their shape");
    expect(r.status).toBe(200);
    expect(r.json.user).toMatchObject({ role: "user", status: "done", content: "“compared by their shape”\n\nWhy shapes?" });
    expect(r.json.assistant).toMatchObject({ role: "assistant", status: "pending", covered: null, citations: [] });

    const thread = (await h.get("/courses/mini/lessons/a1/chat")).json;
    expect(thread.ai.available).toBe(false);
    expect(thread.messages).toHaveLength(2);

    const ran = await h.runner((job) => {
      expect(job.kind).toBe("chat");
      expect(job.payload.lesson).toMatchObject({ id: "a1", title: "First lesson" });
      expect(job.payload.lesson.text).toContain("## Why it works");
      expect(job.payload.selection).toBe("compared by their shape");
      expect(job.payload.sourcesMd).toContain("The Handbook");
      return { covered: true, answer: "Because the compiler checks members.", citations: [{ kind: "source", ref: "1" }, { kind: "lesson", ref: "Why it works" }] };
    });
    expect(ran?.outcome.status).toBe("done");

    const done = (await h.get("/courses/mini/lessons/a1/chat")).json;
    expect(done.ai.available).toBe(true); // the runner just polled
    expect(done.messages[1]).toMatchObject({
      status: "done", covered: true, content: "Because the compiler checks members.",
      citations: [
        { kind: "source", ref: "1", label: "[1] The Handbook" },
        { kind: "lesson", ref: "why-it-works", label: "Why it works" },
      ],
    });
    expect((await h.get("/courses/mini/lessons/a1")).json.answerCount).toBe(1);

    // follow-up carries the history
    await ask(h, "And then?");
    await h.runner((job) => {
      expect(job.payload.history.map((m: any) => m.role)).toEqual(["user", "assistant"]);
      return { covered: false, answer: "Not covered in this course.", citations: [] };
    });
    const last = (await h.get("/courses/mini/lessons/a1/chat")).json.messages.at(-1);
    expect(last).toMatchObject({ covered: false, status: "done", citations: [] });
  });

  it("rejects a covered answer whose citations do not exist in the supplied context", async () => {
    const h = setup();
    await ask(h);
    const ran = await h.runner(() => ({ covered: true, answer: "Trust me.", citations: [{ kind: "source", ref: "99" }, { kind: "lesson", ref: "Nonexistent section" }] }));
    expect(ran?.outcome.status).toBe("failed");
    expect(ran?.outcome.error).toMatch(/cites nothing/);
    const m = (await h.get("/courses/mini/lessons/a1/chat")).json.messages[1];
    expect(m).toMatchObject({ status: "failed", covered: null, citations: [] });
    expect(m.content).not.toContain("Trust me");
  });

  it("rejects a covered answer with no citations at all", async () => {
    const h = setup();
    await ask(h);
    const ran = await h.runner(() => ({ covered: true, answer: "No cites.", citations: [] }));
    expect(ran?.outcome.status).toBe("failed");
  });

  it("drops invalid citations but keeps valid ones", async () => {
    const h = setup();
    await ask(h);
    await h.runner(() => ({ covered: true, answer: "Mixed.", citations: [{ kind: "source", ref: "2" }, { kind: "source", ref: "42" }] }));
    const m = (await h.get("/courses/mini/lessons/a1/chat")).json.messages[1];
    expect(m.citations).toEqual([{ kind: "source", ref: "2", label: "[2] Release notes" }]);
  });

  it("validates the request and the job status endpoint", async () => {
    const h = setup();
    expect((await h.post("/courses/mini/lessons/a1/chat", { question: "" })).status).toBe(400);
    expect((await h.post("/courses/mini/lessons/zzz/chat", { question: "x" })).status).toBe(404);
    const r = await ask(h);
    expect((await h.get(`/jobs/${r.json.assistant.jobId}`)).json).toEqual({ id: r.json.assistant.jobId, kind: "chat", status: "pending", error: null });
  });
});

describe("jobs and runner presence", () => {
  it("reflects runner polling in ai.available, with a TTL", async () => {
    let t = 1_000_000;
    const h = setup({ now: () => t, runnerTtlMs: 5_000 });
    expect((await h.get("/courses/mini/lessons/a1")).json.ai.available).toBe(false);
    await h.app.request("/jobs/next");
    expect((await h.get("/courses/mini/lessons/a1")).json.ai.available).toBe(true);
    t += 6_000;
    expect((await h.get("/courses/mini/lessons/a1")).json.ai.available).toBe(false);
  });

  it("hands the runner the configured model without leaking server context", async () => {
    const h = setup();
    await h.post("/courses/mini/lessons/a1/chat", { question: "hi" });
    await h.call("PUT", "/settings", { models: { chat: "sonnet" } });
    const next = await h.app.request("/jobs/next");
    const job = (await next.json()) as any;
    expect(job).toMatchObject({ kind: "chat", model: "sonnet" });
    expect(job.ctx).toBeUndefined();
  });

  it("does not accept results that fail the schema", async () => {
    const h = setup();
    await h.post("/courses/mini/lessons/a1/chat", { question: "hi" });
    const ran = await h.runner(() => ({ covered: "maybe" }));
    expect(ran?.outcome.status).toBe("failed");
    expect((await h.get("/courses/mini/lessons/a1/chat")).json.messages[1].status).toBe("failed");
  });

  it("starts every API run with empty threads and drops queued chat jobs", async () => {
    const h = setup();
    await ask(h);
    expect((await h.get("/courses/mini/lessons/a1/chat")).json.messages).toHaveLength(2);

    const restarted = createApp(h.db, { pollIntervalMs: 10, coursesDir: miniCourses() });
    const thread = await restarted.request("/courses/mini/lessons/a1/chat");
    expect(((await thread.json()) as { messages: unknown[] }).messages).toEqual([]);
    expect((await restarted.request("/jobs/next")).status).toBe(204);
  });
});
