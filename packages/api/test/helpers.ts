import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, type AppOptions } from "../src/app.js";
import { openDb } from "../src/db/client.js";

export const fixtureDir = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
export const repoCourses = fileURLToPath(new URL("../../../examples/sample-courses", import.meta.url));

/** A fresh courses folder containing a copy of the `mini` fixture (tests may edit it). */
export function miniCourses(): string {
  const dir = mkdtempSync(join(tmpdir(), "selfschool-api-"));
  cpSync(fixtureDir("mini"), join(dir, "mini"), { recursive: true });
  return dir;
}

export function setup(opts: AppOptions = {}) {
  const db = openDb(":memory:");
  const app = createApp(db, { pollIntervalMs: 10, coursesDir: opts.coursesDir ?? miniCourses(), ...opts });
  const call = async <T = any>(method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      ...(body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : null) as T };
  };
  const get = <T = any>(path: string) => call<T>("GET", path);
  const post = <T = any>(path: string, body?: unknown) => call<T>("POST", path, body ?? {});
  /** Plays the runner: claims the next job and posts `answer(job)` (or a failure). */
  const runner = async (answer: (job: { id: string; kind: string; payload: any }) => unknown) => {
    const next = await app.request("/jobs/next");
    if (next.status === 204) return null;
    const job = (await next.json()) as { id: string; kind: string; payload: any };
    const result = answer(job);
    const res =
      result instanceof Error
        ? await post(`/jobs/${job.id}/result`, { ok: false, error: result.message })
        : await post(`/jobs/${job.id}/result`, { ok: true, result });
    return { job, outcome: res.json as { status: string; error?: string } };
  };
  return { db, app, get, post, call, runner };
}

export type Harness = ReturnType<typeof setup>;

/** Passes the first quiz of the mini course; returns the attempt id. */
export async function passQuiz1(h: Harness): Promise<string> {
  const { json } = await h.post("/courses/mini/quizzes/qz1/attempts");
  const id = json.attemptId as string;
  const q = (await h.get("/courses/mini/quizzes/qz1")).json.questions as { id: string }[];
  await h.post(`/attempts/${id}/answers/${q[0]!.id}`, { type: "mcq", selected: [1] });
  await h.post(`/attempts/${id}/answers/${q[1]!.id}`, { type: "short", text: "object" });
  await h.post(`/attempts/${id}/answers/${q[2]!.id}`, { type: "open", text: "Shapes." });
  await h.post(`/attempts/${id}/finish`);
  await h.runner(() => ({ score: 1, correct: true, feedback: "Good." }));
  return id;
}
