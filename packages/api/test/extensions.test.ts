import { describe, expect, it } from "vitest";
import { setup } from "./helpers.js";

const drafted = {
  title: "Level 2 · Deep dive",
  rationale: "You missed structural typing twice.",
  unverified: true,
  chapters: [{ title: "Structural typing, properly", why: "weak spot", lessons: [{ title: "Excess property checks", objective: "Explain why fresh literals are checked.", why: "missed" }] }],
};

const propose = (h: ReturnType<typeof setup>, body: object = { topic: "generics" }) => h.post("/courses/mini/extensions", body);

describe("extension proposals", () => {
  it("queues an outline job with the course outline and the seed, and starts as drafting", async () => {
    const h = setup();
    const { status, json } = await propose(h, { question: "Why typeof?", answer: "Because it returns the type." });
    expect(status).toBe(200);
    const ext = (await h.get(`/extensions/${json.extensionId}`)).json;
    expect(ext).toMatchObject({ status: "drafting", outline: null, jobId: json.jobId, seed: { question: "Why typeof?", answer: "Because it returns the type." } });

    const ran = await h.runner((job) => {
      expect(job.kind).toBe("outline");
      expect(job.payload.course.title).toBeTypeOf("string");
      expect(job.payload.outline.length).toBeGreaterThan(0);
      expect(job.payload.seed.question).toBe("Why typeof?");
      return drafted;
    });
    expect(ran?.outcome.status).toBe("done");
    const ready = (await h.get(`/extensions/${json.extensionId}`)).json;
    expect(ready.status).toBe("ready");
    expect(ready.outline.chapters[0].title).toBe("Structural typing, properly");
  });

  it("sizes the proposal by depth: default 1 hour, and the budget reaches the outline job", async () => {
    const h = setup();
    const a = (await propose(h)).json;
    expect((await h.get(`/extensions/${a.extensionId}`)).json.budgetMinutes).toBe(60);
    await h.runner((job) => { expect(job.payload.budgetMinutes).toBe(60); return drafted; });

    const b = (await propose(h, { topic: "x", budgetMinutes: 240 })).json;
    expect((await h.get(`/extensions/${b.extensionId}`)).json.budgetMinutes).toBe(240);
    await h.runner((job) => { expect(job.payload.budgetMinutes).toBe(240); return drafted; });
    expect((await propose(h, { budgetMinutes: 0 })).status).toBe(400);
  });

  it("re-drafts at another depth: replaces the outline, only before a decision, and drops a stale result", async () => {
    const h = setup();
    const { json } = await propose(h);
    const url = `/extensions/${json.extensionId}/redraft`;
    expect((await h.post(url, { budgetMinutes: 15 })).status).toBe(409); // still drafting

    await h.runner(() => drafted);
    const again = await h.post(url, { budgetMinutes: 15 });
    expect(again.status).toBe(200);
    expect((await h.get(`/extensions/${json.extensionId}`)).json).toMatchObject({ status: "drafting", outline: null, budgetMinutes: 15, jobId: again.json.jobId });

    const small = { ...drafted, title: "Level 2 · Quick look" };
    await h.runner((job) => { expect(job.payload.budgetMinutes).toBe(15); return small; });
    expect((await h.get(`/extensions/${json.extensionId}`)).json).toMatchObject({ status: "ready", outline: { title: "Level 2 · Quick look" } });

    await h.post(`/extensions/${json.extensionId}/decision`, { decision: "reject" });
    expect((await h.post(url, { budgetMinutes: 60 })).status).toBe(409); // decided
  });

  it("a failed outline job fails the proposal", async () => {
    const h = setup();
    const { json } = await propose(h);
    await h.runner(() => new Error("model refused"));
    expect((await h.get(`/extensions/${json.extensionId}`)).json).toMatchObject({ status: "failed", error: "model refused" });
  });

  it("rejects an outline result that does not match the schema", async () => {
    const h = setup();
    const { json } = await propose(h);
    const ran = await h.runner(() => ({ title: "x", rationale: "y", chapters: [] }));
    expect(ran?.outcome.status).toBe("failed");
    expect((await h.get(`/extensions/${json.extensionId}`)).json.status).toBe("failed");
  });

  it("approve stores the edited outline; decisions only apply to a ready proposal and only once", async () => {
    const h = setup();
    const { json } = await propose(h);
    const url = `/extensions/${json.extensionId}/decision`;
    expect((await h.post(url, { decision: "reject" })).status).toBe(409);

    await h.runner(() => drafted);
    const edited = { ...drafted, chapters: [{ ...drafted.chapters[0], title: "Renamed by me" }] };
    const approved = await h.post(url, { decision: "approve", outline: edited });
    expect(approved.json).toMatchObject({ status: "approved", outline: { chapters: [{ title: "Renamed by me" }] } });
    expect(approved.json.decidedAt).toBeTypeOf("number");
    expect((await h.post(url, { decision: "reject" })).status).toBe(409);
    // approving generates nothing: no further jobs are queued
    expect(await h.runner(() => drafted)).toBeNull();
  });

  it("serves a brief only for an approved proposal, built from the approved outline and the real package", async () => {
    const h = setup();
    const { json } = await propose(h, { topic: "generics" });
    const url = `/extensions/${json.extensionId}/brief`;
    expect((await h.get(url)).status).toBe(409); // drafting
    await h.runner(() => drafted);
    expect((await h.get(url)).status).toBe(409); // ready, not approved
    const edited = { ...drafted, chapters: [{ ...drafted.chapters[0], title: "Renamed by me" }] };
    await h.post(`/extensions/${json.extensionId}/decision`, { decision: "approve", outline: edited });

    const { status, json: brief } = await h.get(url);
    expect(status).toBe(200);
    expect(brief.markdown).toContain("Renamed by me");
    expect(brief.markdown).toContain("Excess property checks");
    expect(brief.markdown).toContain("origin: researched");
    expect(brief.markdown).toContain("extensions/mini/extension.yaml");
    expect((await h.get("/extensions/nope/brief")).status).toBe(404);
  });

  it("reject keeps the outline and lists newest first", async () => {
    const h = setup();
    const a = (await propose(h, { topic: "a" })).json;
    await h.runner(() => drafted);
    await h.post(`/extensions/${a.extensionId}/decision`, { decision: "reject" });
    const b = (await propose(h, { topic: "b" })).json;
    const list = (await h.get("/courses/mini/extensions")).json.extensions;
    expect(list.map((e: any) => [e.id, e.status])).toEqual([[b.extensionId, "drafting"], [a.extensionId, "rejected"]]);
  });

  it("validates the request", async () => {
    const h = setup();
    expect((await h.post("/courses/nope/extensions", { topic: "x" })).status).toBe(404);
    expect((await h.post("/courses/mini/extensions", { fromLessonId: "nope" })).status).toBe(404);
    expect((await h.get("/extensions/nope")).status).toBe(404);
    expect((await h.post("/extensions/nope/decision", { decision: "maybe" })).status).toBe(400);
  });
});
