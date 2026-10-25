import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { questions } from "../src/db/schema.js";
import { miniCourses, setup, type Harness } from "./helpers.js";

const outline = {
  title: "Level 2 · Deep dive",
  rationale: "r",
  unverified: true,
  chapters: [
    {
      title: "Guards",
      why: "w",
      lessons: [
        { title: "First guard", objective: "write a guard", why: "" },
        { title: "Second guard", objective: "compose guards", why: "" },
      ],
    },
  ],
};

const lessonResult = (n: number) => ({
  // the model tries to take control of the frontmatter, the title and the ids; none of it may survive
  body: `---\nid: l01\ntitle: Hijacked\nquiz: ../../../evil.yaml\n---\n# ${n === 1 ? "First guard" : "Second guard"}\n\nBody ${n}.\n\n## Section\n\nMore.`,
  questions: [
    {
      id: "a1-hijack",
      type: "mcq",
      text: `Question ${n}?`,
      concepts: ["guards"],
      sources: [1],
      options: [
        { text: "yes", correct: true, explanation: "because" },
        { text: "no", correct: false, explanation: "not so" },
      ],
    },
    { id: "q2", type: "open", text: "Explain.", concepts: ["guards"], rubric: "- Mentions guards." },
  ],
});

/** A harness with an extensions folder and an approved proposal. */
async function approved(opts: { extensions?: boolean } = {}) {
  const extensionsDir = mkdtempSync(join(tmpdir(), "selfschool-gen-"));
  const h = setup(opts.extensions === false ? { coursesDir: miniCourses() } : { coursesDir: miniCourses(), extensionsDir });
  const { json } = await h.post("/courses/mini/extensions", { topic: "guards" });
  await h.runner(() => outline);
  await h.post(`/extensions/${json.extensionId}/decision`, { decision: "approve", outline });
  return { h, id: json.extensionId as string, extensionsDir };
}

const ext = async (h: Harness, id: string) => (await h.get(`/extensions/${id}`)).json;

describe("generate here (quick path)", () => {
  it("writes lessons one job at a time into the overlay, with ids and frontmatter owned by the API", async () => {
    const { h, id, extensionsDir } = await approved();
    const started = await h.post(`/extensions/${id}/generate`);
    expect(started.status).toBe(200);
    expect((await ext(h, id)).generation).toMatchObject({ total: 2, done: 0, state: "running", current: "First guard" });

    // only the first lesson is queued
    const first = await h.runner((job) => {
      expect(job.kind).toBe("lesson");
      expect(job.payload).toMatchObject({ lesson: { title: "First guard" }, previous: [], upcoming: ["Second guard"] });
      expect(job.payload.existing).toContain("First lesson");
      return lessonResult(1);
    });
    expect(first?.outcome.status).toBe("done");
    expect((await ext(h, id)).generation).toMatchObject({ done: 1, state: "running", current: "Second guard" });

    const overlay = join(extensionsDir, "mini");
    const dir = join(overlay, "x01-guards");
    const lesson = readFileSync(join(dir, "lesson-01.md"), "utf8");
    expect(lesson).toContain("id: x01");
    expect(lesson).toContain("title: First guard");
    expect(lesson).toContain("quiz: quiz-01.yaml");
    expect(lesson).toContain("sources: none");
    expect(lesson).not.toMatch(/Hijacked|evil|id: l01/);
    expect(lesson).not.toContain("# First guard"); // the model's own title heading is dropped
    const quiz = parseYaml(readFileSync(join(dir, "quiz-01.yaml"), "utf8"));
    expect(quiz.id).toBe("xq01");
    expect(quiz.questions.map((q: any) => [q.id, q.sources])).toEqual([["xq01-1", []], ["xq01-2", []]]);
    expect(parseYaml(readFileSync(join(overlay, "extension.yaml"), "utf8"))).toMatchObject({
      schemaVersion: 1,
      chapters: [{ dir: "x01-guards", title: "Guards", level: 2, origin: "quick" }],
    });

    // the loader already serves it, as an unverified level 2 chapter
    const course = (await h.get("/courses/mini")).json;
    expect(course.chapters.find((c: any) => c.dir === "x01-guards")).toMatchObject({ level: 2, origin: "quick", total: 1 });

    const second = await h.runner(() => lessonResult(2));
    expect(second?.outcome.status).toBe("done");
    expect(await h.runner(() => lessonResult(3))).toBeNull(); // nothing left to write
    expect((await ext(h, id)).generation).toMatchObject({ total: 2, done: 2, state: "done", current: null });
    expect((await h.get("/courses/mini/lessons/x02")).json.lesson.title).toBe("Second guard");
    expect(existsSync(join(dir, "lesson-02.md"))).toBe(true);
    expect(readFileSync(join(overlay, "extension.yaml"), "utf8").match(/x01-guards/g)).toHaveLength(1); // the chapter is listed once
  });

  it("marks quick lessons as unverified everywhere: lesson view, chat thread, and the question bank (exams never draw them)", async () => {
    const { h, id } = await approved();
    await h.post(`/extensions/${id}/generate`);
    await h.runner(() => lessonResult(1));

    const quick = (await h.get("/courses/mini/lessons/x01")).json;
    expect(quick).toMatchObject({ level: 2, origin: "quick" });
    expect((await h.get("/courses/mini/lessons/x01/chat")).json.unverified).toBe(true);

    const core = (await h.get("/courses/mini/lessons/a1")).json;
    expect(core).toMatchObject({ level: 1, origin: "researched" });
    expect((await h.get("/courses/mini/lessons/a1/chat")).json.unverified).toBe(false);

    const rows = h.db.select({ id: questions.id, status: questions.status, lessonId: questions.lessonId }).from(questions).all();
    const quickRows = rows.filter((r) => r.lessonId === "x01");
    expect(quickRows).toHaveLength(2);
    expect(quickRows.every((r) => r.status === "unverified")).toBe(true);
    expect(rows.filter((r) => r.lessonId === "a1").every((r) => r.status === "active")).toBe(true);
  });

  it("never queues more than one lesson, so a chat asked meanwhile is served before the next lesson", async () => {
    const { h, id } = await approved();
    await h.post(`/extensions/${id}/generate`);
    const claimed = (await (await h.app.request("/jobs/next")).json()) as { id: string; kind: string };
    expect(claimed.kind).toBe("lesson");
    expect((await h.app.request("/jobs/next")).status).toBe(204); // only that one exists

    await h.post("/courses/mini/lessons/a1/chat", { question: "Why shapes?" });
    await h.post(`/jobs/${claimed.id}/result`, { ok: true, result: lessonResult(1) });
    const next = (await (await h.app.request("/jobs/next")).json()) as { kind: string };
    expect(next.kind).toBe("chat");
  });

  it("a failed lesson stops the run, shows as failed, and resume continues from that lesson", async () => {
    const { h, id } = await approved();
    await h.post(`/extensions/${id}/generate`);
    await h.runner(() => lessonResult(1));
    expect((await h.post(`/extensions/${id}/resume`)).status).toBe(409); // still running

    await h.runner(() => new Error("model refused"));
    expect((await ext(h, id)).generation).toMatchObject({ done: 1, state: "failed", current: "Second guard", error: "model refused" });

    const resumed = await h.post(`/extensions/${id}/resume`);
    expect(resumed.status).toBe(200);
    await h.runner((job) => {
      expect(job.payload).toMatchObject({ lesson: { title: "Second guard" }, previous: ["First guard"] });
      return lessonResult(2);
    });
    expect((await ext(h, id)).generation).toMatchObject({ done: 2, state: "done" });
    expect((await h.post(`/extensions/${id}/resume`)).status).toBe(409); // nothing to resume
  });

  it("an invalid lesson result fails the job and writes nothing", async () => {
    const { h, id, extensionsDir } = await approved();
    await h.post(`/extensions/${id}/generate`);
    const ran = await h.runner(() => ({ body: "x", questions: [] }));
    expect(ran?.outcome.status).toBe("failed");
    expect(existsSync(join(extensionsDir, "mini"))).toBe(false);
    expect((await ext(h, id)).generation).toMatchObject({ done: 0, state: "failed" });
  });

  it("is refused without an approved outline, twice, without an extensions folder, or beside a run in progress", async () => {
    const draft = setup({ coursesDir: miniCourses(), extensionsDir: mkdtempSync(join(tmpdir(), "selfschool-gen-")) });
    const { json } = await draft.post("/courses/mini/extensions", { topic: "x" });
    expect((await draft.post(`/extensions/${json.extensionId}/generate`)).status).toBe(409); // not approved

    const none = await approved({ extensions: false });
    expect((await none.h.post(`/extensions/${none.id}/generate`)).status).toBe(409);

    const { h, id } = await approved();
    expect((await h.post(`/extensions/${id}/generate`)).status).toBe(200);
    expect((await h.post(`/extensions/${id}/generate`)).status).toBe(409); // already started

    const other = await h.post("/courses/mini/extensions", { topic: "more" });
    await h.runner(() => lessonResult(1)); // `id` is now one lesson in, with its next lesson queued behind the new outline job
    await h.runner(() => outline);
    await h.post(`/extensions/${other.json.extensionId}/decision`, { decision: "approve", outline });
    expect((await h.post(`/extensions/${other.json.extensionId}/generate`)).status).toBe(409); // `id` is still running
  });

  it("stops handing out the brief once generation has started (both writers would use the same ids)", async () => {
    const { h, id } = await approved();
    expect((await h.get(`/extensions/${id}/brief`)).status).toBe(200);
    await h.post(`/extensions/${id}/generate`);
    expect((await h.get(`/extensions/${id}/brief`)).status).toBe(409);
  });
});
