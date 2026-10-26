import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { miniCourses, passQuiz1, setup } from "./helpers.js";

describe("course loading", () => {
  it("lists courses with ref, counts and zero progress", async () => {
    const h = setup();
    const { json } = await h.get("/courses");
    expect(json.courses).toEqual([
      { id: "mini", title: "Mini Course", monogram: "MC", hue: expect.any(String), lessonCount: 3, examCount: 1, time: expect.any(Object), percent: 0, started: false, updated: false, language: "en", translations: [] },
    ]);
  });

  it("estimates end-to-end time from the content and counts down as lessons are completed", async () => {
    const h = setup();
    const t0 = (await h.get("/courses/mini")).json.time;
    expect(t0.examMinutes).toBe(10);
    expect(t0.readingMinutes).toBeGreaterThanOrEqual(3); // three lessons, at least a minute each
    expect(t0.practiceMinutes).toBeGreaterThan(0);
    expect(t0.totalMinutes).toBe(t0.readingMinutes + t0.practiceMinutes + t0.examMinutes);
    expect(t0.remainingMinutes).toBe(t0.totalMinutes);

    // a2 has no quiz, so completing it removes exactly its reading time
    const a2 = (await h.get("/courses/mini/lessons/a2")).json.minutes;
    await h.post("/courses/mini/lessons/a2/complete");
    const t1 = (await h.get("/courses/mini")).json.time;
    expect(t1.totalMinutes).toBe(t0.totalMinutes);
    expect(t1.remainingMinutes).toBe(t0.remainingMinutes - a2);
  });

  it("serves the outline with per-lesson status and exam rows", async () => {
    const h = setup();
    const { status, json } = await h.get("/courses/mini");
    expect(status).toBe(200);
    expect(json.chapters.map((c: any) => [c.dir, c.done, c.total])).toEqual([["c1", 0, 2], ["c2", 0, 1]]);
    expect(json.chapters[0].lessons.map((l: any) => [l.id, l.status, l.revision, l.updated])).toEqual([
      ["a1", "current", 1, false],
      ["a2", "todo", 1, false],
    ]);
    expect(json.resume).toEqual({ id: "a1", title: "First lesson" });
    expect(json.exams[0]).toMatchObject({ id: "final", questionCount: 4, status: "not_started", attemptCount: 0 });
    expect(json.source.sourceCount).toBe(2);
    expect((await h.get("/courses/nope")).status).toBe(404);
  });

  it("serves a lesson: standfirst split, sources, resources, directives kept, links rewritten", async () => {
    const h = setup();
    const { json } = await h.get("/courses/mini/lessons/a1");
    expect(json.standfirst).toBe("Types are compared by their shape, not their names. [1]");
    expect(json.markdown).toContain("## Why it works");
    expect(json.markdown).toContain(":::low-confidence");
    expect(json.markdown).toContain(":::key-takeaways");
    expect(json.markdown).toContain("](/api/courses/mini/files/resources/pic.svg)");
    expect(json.sources).toEqual([{ n: 1, title: "The Handbook", url: "https://example.com/handbook", note: "shapes and names." }]);
    expect(json.resources).toEqual([{ name: "note.md", url: "/api/courses/mini/files/resources/note.md" }]);
    expect(json).toMatchObject({
      number: 1, total: 3, minutes: 1, prev: null, next: { id: "a2", title: "Second lesson" },
      quiz: { id: "qz1", title: "Check: shapes", questionCount: 3 }, completed: false, ai: { available: false }, answerCount: 0,
    });
    expect(json.exam).toBeNull();
    expect((await h.get("/courses/mini/lessons/b1")).json.exam).toMatchObject({ id: "final" });
    expect((await h.get("/courses/mini/lessons/zzz")).status).toBe(404);
  });

  it("serves resource files only from resources/ and never follows traversal", async () => {
    const h = setup();
    const ok = await h.app.request("/courses/mini/files/resources/pic.svg");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/svg+xml");
    expect((await h.app.request("/courses/mini/files/c1/quiz-01.yaml")).status).toBe(404);
    expect((await h.app.request("/courses/mini/files/resources/%2e%2e/course.yaml")).status).toBe(404);
    expect((await h.app.request("/courses/mini/files/resources/..%2fc1%2fquiz-01.yaml")).status).toBe(404);
  });

  it("completing a lesson with a quiz requires a passed quiz; completion is idempotent", async () => {
    const h = setup();
    expect((await h.post("/courses/mini/lessons/a1/complete")).status).toBe(409);
    await passQuiz1(h);
    const r = await h.post("/courses/mini/lessons/a1/complete");
    expect(r.json).toEqual({ completed: true, revision: 1, progress: { done: 1, total: 3, percent: 33 } });
    expect((await h.post("/courses/mini/lessons/a1/complete")).json.progress.done).toBe(1);

    const outline = (await h.get("/courses/mini")).json;
    expect(outline.chapters[0].lessons.map((l: any) => l.status)).toEqual(["done", "current"]);
    expect((await h.post("/courses/mini/lessons/a2/complete")).status).toBe(200);
  });

  it("pins lesson revisions by content hash; a changed lesson shows updated but keeps completion", async () => {
    const dir = (await import("./helpers.js")).miniCourses();
    const h = setup({ coursesDir: dir });
    await h.get("/courses");
    await h.post("/courses/mini/lessons/a2/complete");
    appendFileSync(join(dir, "mini", "c1", "lesson-02.md"), "\nA new paragraph.\n");

    const out = (await h.get("/courses/mini")).json;
    const a2 = out.chapters[0].lessons[1];
    expect(a2).toMatchObject({ id: "a2", status: "done", revision: 2, updated: true });
    expect(out.updated).toBe(true);
    expect(out.progress.done).toBe(1);
    expect((await h.get("/courses")).json.courses[0].updated).toBe(true);

    // re-completing acknowledges the newer revision
    const again = await h.post("/courses/mini/lessons/a2/complete");
    expect(again.json.revision).toBe(2);
    expect((await h.get("/courses/mini")).json.chapters[0].lessons[1].updated).toBe(false);
  });

  it("extension chapters stay out of the core percent, count and time, and are offered once the core is done", async () => {
    const dir = miniCourses();
    const yaml = join(dir, "mini", "course.yaml");
    const text = readFileSync(yaml, "utf8");
    writeFileSync(yaml, text.replace("exams:", "  - {dir: c3, title: Going deeper, level: 2, origin: quick}\nexams:"));
    mkdirSync(join(dir, "mini", "c3"));
    writeFileSync(join(dir, "mini", "c3", "lesson-01.md"), "---\nid: x1\ntitle: Extra\nsources: none\n---\nExtension text.\n");
    const h = setup({ coursesDir: dir });

    const before = (await h.get("/courses/mini")).json;
    expect(before.lessonCount).toBe(3);
    expect(before.progress.total).toBe(3);
    expect(before.chapters.map((c: any) => [c.dir, c.level, c.origin])).toEqual([["c1", 1, "researched"], ["c2", 1, "researched"], ["c3", 2, "quick"]]);
    const core = (await h.get("/courses")).json.courses[0].time;

    // completing the extension lesson first moves neither the percent nor the time
    await h.post("/courses/mini/lessons/x1/complete");
    const mid = (await h.get("/courses/mini")).json;
    expect(mid.progress).toMatchObject({ done: 0, total: 3, percent: 0 });
    expect((await h.get("/courses")).json.courses[0].time).toEqual(core);

    // the core lesson without a quiz moves the percent by itself; the extension lesson never did
    await h.post("/courses/mini/lessons/a2/complete");
    expect((await h.get("/courses/mini")).json.progress).toMatchObject({ done: 1, total: 3, percent: 33 });
  });
});
