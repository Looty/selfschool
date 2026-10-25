import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { miniCourses, setup } from "./helpers.js";

const lesson = (id: string, title: string, extra = "") => `---
id: ${id}
title: ${title}
quiz: quiz-01.yaml
sources: [101]
${extra}---
Extension lesson body. [101]
`;

const quiz = (id: string, qid: string) => `id: ${id}
title: "Check: extension"
questions:
  - id: ${qid}
    type: mcq
    text: "Which one?"
    concepts: [ext]
    options:
      - {text: "A", correct: true, explanation: "Because."}
      - {text: "B", correct: false, explanation: "Not this."}
`;

const SOURCES = "# Sources\n\n101. [Deep source](https://example.com/deep) · Author · reliability: high\n   - Notes: extension.\n";

/** An extensions folder holding an overlay for the `mini` course. */
function overlay(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "selfschool-ext-"));
  const dir = join(root, "mini");
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return root;
}

const manifest = "schemaVersion: 1\nchapters:\n  - {dir: x-deep, title: Deep dive, origin: researched}\n";
const good = {
  "extension.yaml": manifest,
  "sources.md": SOURCES,
  "x-deep/lesson-01.md": lesson("x01", "Deep one"),
  "x-deep/quiz-01.yaml": quiz("xq01", "xq01-1"),
};

describe("extension overlay", () => {
  it("merges the overlay after the core chapters as level 2, leaving the core numbers alone", async () => {
    const plain = setup();
    const before = (await plain.get("/courses/mini")).json;

    const h = setup({ coursesDir: miniCourses(), extensionsDir: overlay(good) });
    const course = (await h.get("/courses/mini")).json;
    expect(course.chapters.map((c: any) => [c.dir, c.level, c.origin])).toEqual([
      ...before.chapters.map((c: any) => [c.dir, c.level, c.origin]),
      ["x-deep", 2, "researched"],
    ]);
    expect(course.progress).toEqual(before.progress); // core percent ignores level 2
    expect(course.time.totalMinutes).toBe(before.time.totalMinutes);

    const l = (await h.get("/courses/mini/lessons/x01")).json;
    expect(l).toMatchObject({ lesson: { id: "x01", title: "Deep one" }, quiz: { id: "xq01" } });
    expect(l.sources.map((s: any) => s.n)).toContain(101);
  });

  it("leaves the package folder untouched and picks up files added later", async () => {
    const courses = miniCourses();
    const before = readdirSync(join(courses, "mini")).sort();
    const root = mkdtempSync(join(tmpdir(), "selfschool-ext-"));
    const h = setup({ coursesDir: courses, extensionsDir: root });
    expect((await h.get("/courses/mini")).json.chapters.some((c: any) => c.level === 2)).toBe(false);

    for (const [name, text] of Object.entries(good)) {
      mkdirSync(join(root, "mini", name, ".."), { recursive: true });
      writeFileSync(join(root, "mini", name), text);
    }
    expect((await h.get("/courses/mini")).json.chapters.some((c: any) => c.dir === "x-deep")).toBe(true);
    expect(readdirSync(join(courses, "mini")).sort()).toEqual(before);
  });

  it("skips lessons whose ids are not in the extension namespace or already exist, and says nothing else breaks", async () => {
    const h = setup({
      coursesDir: miniCourses(),
      extensionsDir: overlay({
        ...good,
        "extension.yaml": "schemaVersion: 1\nchapters:\n  - {dir: x-deep, title: Deep dive}\n",
        "x-deep/lesson-02.md": lesson("l99", "Squatting on a core-style id").replace("quiz: quiz-01.yaml\n", ""),
        "x-deep/lesson-03.md": lesson("a1", "Collides with a core lesson").replace("quiz: quiz-01.yaml\n", ""),
        "x-deep/lesson-04.md": lesson("x04", "Reuses a quiz id"),
        "x-deep/quiz-04.yaml": quiz("xq01", "xq04-1"),
      }),
    });
    const course = (await h.get("/courses/mini")).json;
    const ext = course.chapters.find((c: any) => c.dir === "x-deep");
    expect(ext.lessons.map((l: any) => l.id)).toEqual(["x01"]);
  });

  it("ignores an overlay chapter named like a core chapter, a bad manifest, and sources below the extension range", async () => {
    const clash = setup({ coursesDir: miniCourses(), extensionsDir: overlay({ ...good, "extension.yaml": "schemaVersion: 1\nchapters:\n  - {dir: c1, title: Clash}\n", "c1/lesson-01.md": lesson("x01", "Nope") }) });
    expect((await clash.get("/courses/mini")).json.chapters.filter((c: any) => c.level === 2)).toHaveLength(0);

    const broken = setup({ coursesDir: miniCourses(), extensionsDir: overlay({ "extension.yaml": "chapters: nope" }) });
    expect((await broken.get("/courses/mini")).status).toBe(200);

    const low = setup({ coursesDir: miniCourses(), extensionsDir: overlay({ ...good, "sources.md": "# Sources\n\n2. [Collides](https://example.com) · A · reliability: high\n" }) });
    const l = (await low.get("/courses/mini/lessons/x01")).json;
    expect(l.sources.find((s: any) => s.title === "Collides")).toBeUndefined();
  });

  it("serves an extension chapter's resources from the overlay, and only from resources/", async () => {
    const root = overlay({ ...good, "resources/diagram.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>", "x-deep/secret.yaml": "answer: yes" });
    const h = setup({ coursesDir: miniCourses(), extensionsDir: root });
    expect((await h.app.request("/courses/mini/files/resources/diagram.svg")).status).toBe(200);
    expect((await h.app.request("/courses/mini/files/x-deep/secret.yaml")).status).toBe(404);
    expect((await h.app.request("/courses/mini/files/resources/pic.svg")).status).toBe(200); // the package's own still works
  });

  it("feeds the merged sources and chapters to the brief and the outline job", async () => {
    const h = setup({ coursesDir: miniCourses(), extensionsDir: overlay(good) });
    const { json } = await h.post("/courses/mini/extensions", { topic: "more" });
    const ran = await h.runner((job) => {
      expect(job.payload.sourcesMd).toContain("Deep source");
      expect(job.payload.outline.map((c: any) => c.title)).toContain("Deep dive");
      return { title: "T", rationale: "r", unverified: true, chapters: [{ title: "C", why: "", lessons: [{ title: "L", objective: "o", why: "" }] }] };
    });
    expect(ran?.outcome.status).toBe("done");
    await h.post(`/extensions/${json.extensionId}/decision`, { decision: "approve", outline: (await h.get(`/extensions/${json.extensionId}`)).json.outline });
    const brief = (await h.get(`/extensions/${json.extensionId}/brief`)).json.markdown;
    expect(brief).toContain("x01 Deep one");
  });
});
