import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoCourses, setup } from "./helpers.js";

/** A private copy of the sample course (it has a Hebrew translation of one lesson, one quiz and the titles). */
function sampleDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "selfschool-i18n-api-"));
  cpSync(join(repoCourses, "typescript-fundamentals"), join(dir, "typescript-fundamentals"), { recursive: true });
  return dir;
}

// biome-ignore lint/suspicious/noExplicitAny: response bodies are checked field by field by the assertions
type J = any;

const he = { "x-selfschool-lang": "he" };
const get = async (h: ReturnType<typeof setup>, path: string, headers: Record<string, string> = {}) => {
  const res = await h.app.request(path, { headers });
  return { status: res.status, json: (await res.json()) as J };
};
const post = async (h: ReturnType<typeof setup>, path: string, body: unknown, headers: Record<string, string> = {}) => {
  const res = await h.app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as J };
};

describe("course translations", () => {
  it("serves a translated lesson with its titles, and falls back to the source for a lesson with no translation", async () => {
    const h = setup({ coursesDir: sampleDir() });
    const en = (await get(h, "/courses/typescript-fundamentals/lessons/l04")).json;
    expect(en.lesson.title).toBe("Narrowing with typeof");
    expect(en.language).toBe("en");

    const tr = (await get(h, "/courses/typescript-fundamentals/lessons/l04", he)).json;
    expect(tr.lesson.title).toBe("צמצום טיפוסים עם typeof");
    expect(tr.language).toBe("he");
    expect(tr.standfirst).toContain("typeof");
    expect(tr.chapterTitle).toBe("צמצום טיפוסים ואיחודים");
    expect(tr.markdown).toContain("```ts");
    // links to course files still resolve to the course files endpoint
    expect(tr.markdown).toContain("/api/courses/typescript-fundamentals/files/resources/narrowing-cheatsheet.md");
    // same progress data either way
    expect({ ...tr.progress }).toEqual({ ...en.progress });
    expect(tr.revision).toBe(en.revision);

    // l05 has no translated file: it stays in English, while the outline shows the translated titles that exist
    const l5 = (await get(h, "/courses/typescript-fundamentals/lessons/l05", he)).json;
    expect(l5.lesson.title).toBe("Unions and discriminants");
    expect(l5.language).toBe("en");
    expect(l5.chapters.find((c: J) => c.dir === "02-narrowing").title).toBe("צמצום טיפוסים ואיחודים");
  });

  it("lists the languages, translates course titles, and never mixes languages through the summary cache", async () => {
    const h = setup({ coursesDir: sampleDir() });
    const tr1 = (await get(h, "/courses", he)).json.courses[0];
    const en1 = (await get(h, "/courses")).json.courses[0];
    const tr2 = (await get(h, "/courses", he)).json.courses[0];
    expect(en1.title).toBe("TypeScript Fundamentals");
    expect(tr1.title).toBe("יסודות TypeScript");
    expect(tr2.title).toBe(tr1.title);
    expect(en1.language).toBe("en");
    expect(en1.translations).toEqual(["he"]);
    const detail = (await get(h, "/courses/typescript-fundamentals", he)).json;
    expect(detail.description).toContain("JavaScript");
    expect(detail.chapters[0].title).toBe("הטיפוסים שבאמת משתמשים בהם");
    expect((await get(h, "/courses/typescript-fundamentals")).json.chapters[0].title).toBe("Types you actually use");
  });

  it("translates the dashboard and lists the languages in the packages list", async () => {
    const h = setup({ coursesDir: sampleDir() });
    const dash = (await get(h, "/dashboard", he)).json;
    expect(dash.courses[0].title).toBe("יסודות TypeScript");
    expect(dash.courses[0].translations).toEqual(["he"]);
    expect(dash.continue.course.title).toBe("יסודות TypeScript");
    expect((await get(h, "/dashboard")).json.courses[0].title).toBe("TypeScript Fundamentals");
    // each chapter says which languages have files in it: the sample translates only chapter 02
    const detail = (await get(h, "/courses/typescript-fundamentals")).json;
    expect(detail.chapters.map((c: J) => [c.dir, c.translations])).toEqual([
      ["01-basics", []],
      ["02-narrowing", ["he"]],
      ["03-generics", []],
      ["04-question-types", []],
    ]);
    const pkg = (await get(h, "/packages")).json.packages[0];
    expect(pkg).toMatchObject({ language: "en", translations: ["he"] });
  });

  it("asking for a language the course does not have, or a malformed one, gives the source language", async () => {
    const h = setup({ coursesDir: sampleDir() });
    for (const lang of ["fr", "../x", "HE!", ""]) {
      const r = (await get(h, "/courses/typescript-fundamentals/lessons/l04", { "x-selfschool-lang": lang })).json;
      expect(r.lesson.title).toBe("Narrowing with typeof");
    }
  });

  it("runs a translated quiz end to end: same ids, graded by position, Hebrew or English short answers accepted", async () => {
    const h = setup({ coursesDir: sampleDir() });
    const quiz = (await get(h, "/courses/typescript-fundamentals/quizzes/q06", he)).json;
    expect(quiz.language).toBe("he");
    expect(quiz.quiz.title).toBe("בדיקה: שומרי טיפוס");
    const srcIds = (await get(h, "/courses/typescript-fundamentals/quizzes/q06")).json.questions.map((q: J) => q.id);
    expect(quiz.questions.map((q: J) => q.id)).toEqual(srcIds);

    const { attemptId } = (await post(h, "/courses/typescript-fundamentals/quizzes/q06/attempts", {}, he)).json;
    const [q1, q2] = quiz.questions;
    const a1 = await post(h, `/attempts/${attemptId}/answers/${q1.id}`, { type: "mcq", selected: [1] }, he);
    expect(a1.json.correct).toBe(true);
    // the explanation after answering is in Hebrew
    expect(JSON.stringify(a1.json)).toContain("אי אפשר לשנות");
    const a2 = await post(h, `/attempts/${attemptId}/answers/${q2.id}`, { type: "short", text: "object" }, he);
    expect(a2.json.correct).toBe(true);

    const result = (await get(h, `/attempts/${attemptId}`, he)).json;
    expect(result.language).toBe("he");
    // the same attempt read without the header is the source-language view of the same data
    const plain = (await get(h, `/attempts/${attemptId}`)).json;
    expect(plain.language).toBe("en");
    expect(plain.score).toEqual(result.score);
  });

  it("ignores a translation whose quiz was reordered instead of grading right answers wrong", async () => {
    const dir = sampleDir();
    const f = join(dir, "typescript-fundamentals/i18n/he/02-narrowing/quiz-03.yaml");
    const text = readFileSync(f, "utf8");
    // swap the first two options (correct flags move with them, so the position of the right answer changes)
    writeFileSync(f, text.replace(/(\s+- \{text: "const n = 5;".*\n)(\s+- \{text: "n = 6;".*\n)/, "$2$1"));
    const h = setup({ coursesDir: dir });
    const quiz = (await get(h, "/courses/typescript-fundamentals/quizzes/q06", he)).json;
    expect(quiz.language).toBe("en");
    expect(quiz.quiz.title).toBe("Check: type guards");
  });

  it("reads a learner's own translation from the extensions folder, and lets it win over the package's", async () => {
    const dir = sampleDir();
    const ext = mkdtempSync(join(tmpdir(), "selfschool-ext-"));
    const base = join(ext, "typescript-fundamentals", "i18n");
    mkdirSync(join(base, "fr", "02-narrowing"), { recursive: true });
    mkdirSync(join(base, "he", "02-narrowing"), { recursive: true });
    writeFileSync(join(base, "fr", "course.yaml"), "title: Les bases de TypeScript\nlessons:\n  l04: Affiner avec typeof\n");
    writeFileSync(join(base, "fr", "02-narrowing", "lesson-01.md"), "---\nid: l04\ntitle: Affiner avec typeof\nsources: [2, 3]\n---\nBonjour, voici la leçon.\n");
    writeFileSync(join(base, "he", "course.yaml"), "title: הקורס שלי\n");
    const h = setup({ coursesDir: dir, extensionsDir: ext });
    const fr = { "x-selfschool-lang": "fr" };

    const course = (await get(h, "/courses", fr)).json.courses[0];
    expect(course.translations).toEqual(["fr", "he"]);
    expect(course.title).toBe("Les bases de TypeScript");
    const lesson = (await get(h, "/courses/typescript-fundamentals/lessons/l04", fr)).json;
    expect(lesson.language).toBe("fr");
    expect(lesson.standfirst).toBe("Bonjour, voici la leçon.");
    expect(lesson.languages).toEqual(["en", "fr", "he"]);
    // the learner's title wins, the package's other Hebrew titles are kept
    const heDetail = (await get(h, "/courses/typescript-fundamentals", he)).json;
    expect(heDetail.title).toBe("הקורס שלי");
    expect(heDetail.chapters[0].title).toBe("הטיפוסים שבאמת משתמשים בהם");
  });

  it("does not touch progress, revisions or the question bank: the same lessons count in either language", async () => {
    const h = setup({ coursesDir: sampleDir() });
    await get(h, "/courses/typescript-fundamentals/lessons/l04", he);
    const rows = () => h.db.$client.prepare("SELECT COUNT(*) AS n FROM lesson_revision").get() as { n: number };
    const before = rows().n;
    await get(h, "/courses/typescript-fundamentals/lessons/l04");
    await get(h, "/courses/typescript-fundamentals/lessons/l04", he);
    expect(rows().n).toBe(before);
    expect((h.db.$client.prepare("SELECT COUNT(*) AS n FROM question WHERE payload LIKE '%צמצום%' OR payload LIKE '%מחרוזת%'").get() as { n: number }).n).toBe(0);
  });
});
