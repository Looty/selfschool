import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openDb, type Db } from "../src/db/client.js";
import { claimNextJob, enqueueJob, getJob, MAX_ATTEMPTS, STALE_RUNNING_MS } from "../src/jobs.js";

const gradePayload = {
  question: { id: "q1", text: "Explain.", rubric: "Mention shapes." },
  answer: "Types are compared by shape.",
};
const gradeResult = { score: 1, correct: true, feedback: "Good." };

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb(":memory:");
  app = createApp(db, { pollIntervalMs: 10 });
});

const post = (path: string, body: unknown) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("GET /health", () => {
  it("reports migrated db and runner not connected", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, migrated: true, runner: { connected: false, lastSeen: null } });
  });

  it("marks the runner connected after it polls", async () => {
    await app.request("/jobs/next");
    const body = (await (await app.request("/health")).json()) as { runner: { connected: boolean } };
    expect(body.runner.connected).toBe(true);
  });
});

describe("jobs queue", () => {
  it("returns 204 when empty", async () => {
    expect((await app.request("/jobs/next")).status).toBe(204);
  });

  it("rejects invalid payloads and kinds", async () => {
    expect((await post("/jobs", { kind: "grade", payload: {} })).status).toBe(400);
    expect((await post("/jobs", { kind: "nope", payload: {} })).status).toBe(400);
  });

  it("enqueue -> claim -> result happy path", async () => {
    const { id } = (await (await post("/jobs", { kind: "grade", payload: gradePayload })).json()) as { id: string };
    const next = await app.request("/jobs/next");
    expect(next.status).toBe(200);
    expect(await next.json()).toMatchObject({ id, kind: "grade", attempts: 1 });
    // claimed: nobody else gets it
    expect((await app.request("/jobs/next")).status).toBe(204);

    const res = await post(`/jobs/${id}/result`, { ok: true, result: gradeResult });
    expect(await res.json()).toEqual({ status: "done" });
    expect(getJob(db, id)).toMatchObject({ status: "done", result: gradeResult });
  });

  it("long-poll wakes when a job arrives", async () => {
    const pending = app.request("/jobs/next?wait=5");
    setTimeout(() => enqueueJob(db, "grade", gradePayload), 50);
    const res = await pending;
    expect(res.status).toBe(200);
  });

  it("long-poll returns 204 after the wait elapses", async () => {
    const t0 = Date.now();
    const res = await app.request("/jobs/next?wait=0.1");
    expect(res.status).toBe(204);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(90);
  });

  it("serves oldest first", async () => {
    const a = enqueueJob(db, "grade", gradePayload, 1000);
    const b = enqueueJob(db, "grade", gradePayload, 2000);
    expect(claimNextJob(db)?.id).toBe(a);
    expect(claimNextJob(db)?.id).toBe(b);
  });

  it("fails a job whose result does not match the kind schema", async () => {
    const id = enqueueJob(db, "grade", gradePayload);
    claimNextJob(db);
    const res = await post(`/jobs/${id}/result`, { ok: true, result: { score: 5 } });
    expect(((await res.json()) as { status: string }).status).toBe("failed");
    expect(getJob(db, id)?.status).toBe("failed");
  });

  it("records runner-reported failures", async () => {
    const id = enqueueJob(db, "grade", gradePayload);
    claimNextJob(db);
    await post(`/jobs/${id}/result`, { ok: false, error: "cli crashed" });
    expect(getJob(db, id)).toMatchObject({ status: "failed", error: "cli crashed" });
  });

  it("404s unknown jobs and 409s results for jobs that are not running", async () => {
    expect((await post("/jobs/missing/result", { ok: false, error: "x" })).status).toBe(404);
    const id = enqueueJob(db, "grade", gradePayload);
    expect((await post(`/jobs/${id}/result`, { ok: false, error: "x" })).status).toBe(409);
  });

  it("re-claims stale running jobs, then gives up after MAX_ATTEMPTS", () => {
    const id = enqueueJob(db, "grade", gradePayload, 0);
    let now = 0;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect(claimNextJob(db, now)?.id).toBe(id);
      now += STALE_RUNNING_MS + 1;
    }
    expect(claimNextJob(db, now)).toBeNull();
    expect(getJob(db, id)?.status).toBe("failed");
  });
});
