import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify } from "yaml";
import { validateCoursePackage } from "@selfschool/shared/node";
import type { AdapterRequest, ProviderAdapter } from "@selfschool/runner";
import { findCourseDir, translationOutDir } from "../src/commands.js";
import { estimate, lessonBodyIssues, parseLessonReply, translateCourse, unfence, unitsOf } from "../src/translate.js";

const sample = fileURLToPath(new URL("../../../examples/sample-courses/typescript-fundamentals", import.meta.url));

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "selfschool-translate-"));
  cpSync(sample, dir, { recursive: true });
  rmSync(join(dir, "i18n"), { recursive: true, force: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

type Handler = { lesson?: (body: string, call: number) => string; quiz?: (yaml: string, call: number) => string };

/** A fake model: tells the three kinds of request apart by their system prompt, and answers like a careful translator by default. */
function fakeModel(h: Handler = {}) {
  const calls: { kind: string; stdin: string }[] = [];
  const adapter: ProviderAdapter = {
    name: "fake",
    toolsDisabled: true,
    async run(req: AdapterRequest) {
      const kind = req.systemPrompt.includes("one lesson") ? "lesson" : req.systemPrompt.includes("one quiz") ? "quiz" : "course";
      calls.push({ kind, stdin: req.stdin });
      const n = calls.filter((c) => c.kind === kind && c.stdin.split("\n---\n")[0] === req.stdin.split("\n---\n")[0]).length;
      let text: string;
      if (kind === "lesson") {
        const body = /<lesson>\n([\s\S]*?)\n<\/lesson>/.exec(req.stdin)![1]!;
        const title = /Lesson title: (.*)/.exec(req.stdin)![1]!;
        text = h.lesson ? h.lesson(body, n) : `TITLE: [he] ${title}\n\n[he] ${body}`;
      } else if (kind === "quiz") {
        const yaml = req.stdin.slice(req.stdin.indexOf("\n\n") + 2).split("\n\n---\n")[0]!;
        text = h.quiz ? h.quiz(yaml, n) : yaml.replace(/^title: (.*)$/m, (_, t: string) => `title: "[he] ${t.replace(/"/g, "")}"`);
      } else {
        const input = JSON.parse(req.stdin.split("\n\n---\n")[0]!) as { title: string; short_intro: string; description: string; chapters: Record<string, string> };
        text = JSON.stringify({ ...input, title: `[he] ${input.title}`, chapters: Object.fromEntries(Object.entries(input.chapters).map(([k, v]) => [k, `[he] ${v}`])) });
      }
      return { text, costUsd: 0.01, permissionDenials: [] };
    },
  };
  return { adapter, calls };
}

const run = (adapter: ProviderAdapter, extra: object = {}) => translateCourse({ courseDir: dir, outDir: join(dir, "i18n", "he"), lang: "he", adapter, model: "sonnet", concurrency: 2, retries: 2, ...extra });

describe("school translate", () => {
  it("translates every lesson and quiz, and the result passes the package validator with no translation warnings", async () => {
    const { adapter } = fakeModel();
    const units = unitsOf(dir);
    const report = await run(adapter);
    expect(report.failed).toEqual([]);
    expect(report.translated.length).toBe(units.length + 1); // every file, plus course.yaml
    expect(report.costUsd).toBeGreaterThan(0);

    const r = validateCoursePackage(dir);
    expect(r.ok).toBe(true);
    expect((r.warnings ?? []).filter((w) => w.message.startsWith("translation:"))).toEqual([]);

    const titles = parseYaml(readFileSync(join(dir, "i18n/he/course.yaml"), "utf8"));
    expect(titles.title).toBe("[he] TypeScript Fundamentals");
    expect(titles.chapters["01-basics"]).toBe("[he] Types you actually use");
    expect(titles.lessons.l04).toBe("[he] Narrowing with typeof");
    // frontmatter is rebuilt from the source with only the title changed
    const lesson = readFileSync(join(dir, "i18n/he/02-narrowing/lesson-01.md"), "utf8");
    expect(lesson).toContain("id: l04");
    expect(lesson).toContain("[he] Narrowing with typeof");
    expect(lesson).toContain("resources:");
  });

  it("sends a reply that changed a code block back with the reason, and keeps the corrected one", async () => {
    let seenFeedback = false;
    const { adapter, calls } = fakeModel({
      lesson: (body, call) => {
        if (!body.includes("padLeft")) return `TITLE: t\n\n[he] ${body}`;
        if (call === 1) return `TITLE: t\n\n${body.replace("padLeft", "padLeftX")}`; // touches a code block
        return `TITLE: t\n\n[he] ${body}`;
      },
    });
    const report = await run(adapter);
    seenFeedback = calls.some((c) => c.stdin.includes("Your previous reply was rejected") && c.stdin.includes("fenced code blocks"));
    expect(seenFeedback).toBe(true);
    expect(report.failed).toEqual([]);
    expect(readFileSync(join(dir, "i18n/he/02-narrowing/lesson-01.md"), "utf8")).toContain("function padLeft(");
  });

  it("leaves a file out when the model never gets it right, and reports it", async () => {
    const { adapter } = fakeModel({ lesson: (body) => `TITLE: t\n\n${body.replace(/```/g, "~~~")}` });
    const report = await run(adapter, { retries: 1 });
    expect(report.failed.some((f) => f.file === "02-narrowing/lesson-01.md" && /still invalid/.test(f.reason))).toBe(true);
    expect(existsSync(join(dir, "i18n/he/02-narrowing/lesson-01.md"))).toBe(false);
    // everything else still got done, and the course stays valid
    expect(report.translated.length).toBeGreaterThan(5);
    expect(validateCoursePackage(dir).ok).toBe(true);
  });

  it("rejects a quiz whose options came back reordered, then accepts the corrected one", async () => {
    const { adapter, calls } = fakeModel({
      quiz: (yaml, call) => {
        if (call > 1) return yaml;
        const q = parseYaml(yaml);
        const mcq = q.questions.find((x: { type: string }) => x.type === "mcq");
        if (!mcq) return yaml;
        mcq.options.reverse();
        return stringify(q);
      },
    });
    const report = await run(adapter);
    expect(report.failed).toEqual([]);
    expect(calls.some((c) => c.kind === "quiz" && c.stdin.includes("differs in structure"))).toBe(true);
  });

  it("resumes: a second run asks the model for nothing, --force translates everything again", async () => {
    const first = fakeModel();
    await run(first.adapter);
    const second = fakeModel();
    const report = await run(second.adapter);
    expect(second.calls).toEqual([]);
    expect(report.translated).toEqual([]);
    expect(report.kept.length).toBeGreaterThan(5);
    const forced = fakeModel();
    await run(forced.adapter, { force: true });
    expect(forced.calls.length).toBe(first.calls.length);
  });

  it("does not overwrite a good file after a partial run, and fills in only what is missing", async () => {
    const first = fakeModel();
    await run(first.adapter);
    rmSync(join(dir, "i18n/he/02-narrowing/quiz-03.yaml"));
    const second = fakeModel();
    const report = await run(second.adapter);
    expect(second.calls.map((c) => c.kind)).toEqual(["quiz"]);
    expect(report.translated).toEqual(["02-narrowing/quiz-03.yaml"]);
  });
});

describe("translate helpers", () => {
  it("parses the TITLE reply, with or without a fence around it", () => {
    expect(parseLessonReply("TITLE: שלום\n\nגוף")).toEqual({ title: "שלום", body: "גוף" });
    expect(parseLessonReply("```\nTITLE: שלום\n\nגוף\n```")).toEqual({ title: "שלום", body: "גוף" });
    expect(parseLessonReply("no title here")).toBeNull();
    expect(unfence("```yaml\na: 1\n```")).toBe("a: 1");
  });

  it("checks code blocks, citations, link targets and block fences", () => {
    const src = "Text [3] and [a](x.md).\n\n```ts\nlet a = 1; // c\n```\n\n:::glossary\n- t\n:::\n";
    expect(lessonBodyIssues(src, src.replace("Text", "טקסט"))).toEqual([]);
    expect(lessonBodyIssues(src, src.replace("let a", "let b")).length).toBe(1);
    expect(lessonBodyIssues(src, src.replace("[3]", "[4]")).length).toBe(1);
    expect(lessonBodyIssues(src, src.replace("x.md", "y.md")).length).toBe(1);
    expect(lessonBodyIssues(src, src.replace(":::glossary", ":::other")).length).toBe(1);
  });

  it("sizes a run: Hebrew costs about 2x the tokens out, at Sonnet 5.5 prices", () => {
    const e = estimate(unitsOf(dir));
    expect(e.files).toBeGreaterThan(5);
    expect(e.outputTokens).toBeGreaterThan(e.inputTokens);
    expect(e.usd).toBeGreaterThan(0);
  });

  it("finds a course by folder or id, and picks the output folder", () => {
    expect(findCourseDir(dir)).toBe(dir);
    const library = join(sample, "..");
    expect(findCourseDir("typescript-fundamentals", { SELFSCHOOL_COURSES_DIR: library } as NodeJS.ProcessEnv, tmpdir())).toBe(join(library, "typescript-fundamentals"));
    expect(findCourseDir("no-such-course", { SELFSCHOOL_COURSES_DIR: library } as NodeJS.ProcessEnv, tmpdir())).toBeNull();
    expect(translationOutDir("/c", "id", "he", { intoPackage: true })).toBe(join("/c", "i18n", "he"));
    expect(translationOutDir("/c", "id", "he", { intoPackage: false, extensions: "/ext" })).toMatch(/ext[\\/]id[\\/]i18n[\\/]he$/);
    expect(translationOutDir("/c", "id", "he", { intoPackage: false }, { SELFSCHOOL_EXTENSIONS_DIR: "/from-env" } as NodeJS.ProcessEnv)).toMatch(/from-env[\\/]id[\\/]i18n[\\/]he$/);
  });
});
