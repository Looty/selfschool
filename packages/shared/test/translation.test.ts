import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify } from "yaml";
import { isRtl, quizParityIssues, quizSchema } from "../src/index.js";
import { validateCoursePackage } from "../src/node.js";

const sample = fileURLToPath(new URL("../../../examples/sample-courses/typescript-fundamentals", import.meta.url));
/** A small Hebrew translation of the sample course (titles, one lesson, one quiz), laid out as `i18n/he/...`. */
const fixture = fileURLToPath(new URL("./fixtures/i18n", import.meta.url));

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "selfschool-i18n-"));
  cpSync(sample, dir, { recursive: true });
  cpSync(fixture, join(dir, "i18n"), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const quizFile = () => join(dir, "i18n/he/02-narrowing/quiz-03.yaml");
const resetQuiz = () => cpSync(join(fixture, "he/02-narrowing/quiz-03.yaml"), quizFile());
// biome-ignore lint/suspicious/noExplicitAny: a parsed quiz is edited freely to break it in different ways
type Loose = any;
const editQuiz = (fn: (q: Loose) => void) => {
  const q = parseYaml(readFileSync(quizFile(), "utf8"));
  fn(q);
  writeFileSync(quizFile(), stringify(q));
};

/** Translation problems are warnings: the course itself must stay valid and loadable. */
function problems() {
  const r = validateCoursePackage(dir);
  expect(r.ok, "a bad translation must not make the course invalid").toBe(true);
  return (r.warnings ?? []).filter((w) => w.message.startsWith("translation:"));
}

describe("translations in a course package", () => {
  it("the Hebrew sample course validates cleanly", () => {
    expect(problems()).toEqual([]);
    expect(validateCoursePackage(dir).manifest?.language).toBe("en");
  });

  it("flags a translated quiz whose options were reordered (it would grade right answers wrong)", () => {
    editQuiz((q) => q.questions[0].options.reverse());
    const p = problems();
    expect(p.some((i) => i.file === "i18n/he/02-narrowing/quiz-03.yaml" && /q06-1/.test(i.message))).toBe(true);
  });

  it("flags a changed correct flag, a dropped question and a changed id", () => {
    editQuiz((q) => (q.questions[0].options[0].correct = true));
    expect(problems().length).toBeGreaterThan(0);
    resetQuiz();
    editQuiz((q) => q.questions.pop());
    expect(problems().some((i) => /has 3 questions/.test(i.message))).toBe(true);
    resetQuiz();
    editQuiz((q) => (q.questions[1].id = "other"));
    expect(problems().length).toBeGreaterThan(0);
  });

  it("allows different accepted spellings for a short answer", () => {
    editQuiz((q) => q.questions[1].answers.push("אובייקט"));
    expect(problems()).toEqual([]);
  });

  it("flags a lesson whose id differs and a folder that is not a language code", () => {
    const lesson = join(dir, "i18n/he/02-narrowing/lesson-01.md");
    writeFileSync(lesson, readFileSync(lesson, "utf8").replace("id: l04", "id: l99"));
    expect(problems().some((i) => /lesson id is "l99"/.test(i.message))).toBe(true);
    cpSync(join(fixture, "he/02-narrowing/lesson-01.md"), lesson);
    cpSync(join(dir, "i18n/he"), join(dir, "i18n/Hebrew"), { recursive: true });
    expect(problems().some((i) => i.file === "i18n/Hebrew")).toBe(true);
  });

  it("flags a titles file that disagrees with the lesson's own title", () => {
    const f = join(dir, "i18n/he/course.yaml");
    writeFileSync(f, readFileSync(f, "utf8").replace("l04: צמצום", "l04: שונה צמצום"));
    expect(problems().some((i) => /lessons\.l04/.test(i.message))).toBe(true);
  });

  it("a translation that does not even parse still leaves the course valid", () => {
    writeFileSync(quizFile(), "questions: [: not yaml");
    expect(problems().length).toBeGreaterThan(0);
  });

  it("quizParityIssues is empty for the same quiz and knows right-to-left languages", () => {
    const q = quizSchema.parse(parseYaml(readFileSync(join(sample, "02-narrowing/quiz-03.yaml"), "utf8")));
    expect(quizParityIssues(q, q)).toEqual([]);
    expect(isRtl("he")).toBe(true);
    expect(isRtl("ar-EG")).toBe(true);
    expect(isRtl("en")).toBe(false);
  });
});
