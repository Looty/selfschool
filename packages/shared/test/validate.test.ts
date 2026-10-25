import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { splitFrontmatter, validateCoursePackage, validateExtensionOverlay } from "../src/node.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "selfschool-validate-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (rel: string, content: string) => {
  const p = join(dir, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, content);
};

function goodPackage() {
  write(
    "course.yaml",
    `schemaVersion: 1
id: tiny
title: Tiny
short_intro: Small.
level: Beginner
chapters:
  - {dir: 01-basics, title: Basics}
exams:
  - {id: mid, file: exams/mid.yaml, after: 01-basics}
`,
  );
  write("sources.md", "1. Something\n");
  write("01-basics/lesson-01.md", "---\nid: l01\ntitle: One\nquiz: quiz-01.yaml\nsources: [1]\n---\nHello\n");
  write(
    "01-basics/quiz-01.yaml",
    `id: q01
title: Check
questions:
  - {id: q01-1, type: short, text: "Type?", answers: [string]}
`,
  );
  write(
    "exams/mid.yaml",
    `id: mid
title: Mid
duration_minutes: 30
limit_questions: 5
domains:
  - {id: types, title: Types, weight: 1}
`,
  );
}

describe("splitFrontmatter", () => {
  it("splits yaml and body, null without a block", () => {
    expect(splitFrontmatter("---\na: 1\n---\nbody")).toEqual({ data: { a: 1 }, body: "body" });
    expect(splitFrontmatter("no frontmatter")).toBeNull();
  });
});

describe("validateCoursePackage", () => {
  it("passes a minimal good package", () => {
    goodPackage();
    const r = validateCoursePackage(dir);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.manifest?.id).toBe("tiny");
  });

  it("warns, without failing, about a missing glossary and a lab with no files", () => {
    goodPackage();
    write("01-basics/lesson-01.md", "---\nid: l01\ntitle: Lab 1 build it\nquiz: quiz-01.yaml\nsources: [1]\n---\nHello\n");
    const r = validateCoursePackage(dir);
    expect(r.ok).toBe(true);
    const msgs = (r.warnings ?? []).map((w) => w.message).join(" | ");
    expect(msgs).toMatch(/no :::glossary block/);
    expect(msgs).toMatch(/hands-on lesson lists no resources/);
  });

  const withChapters = (chapters: string, extra = "") =>
    write("course.yaml", `schemaVersion: 1
id: tiny
title: Tiny
short_intro: Small.
level: Beginner
${extra}chapters:
${chapters}
exams:
  - {id: mid, file: exams/mid.yaml, after: 01-basics}
`);

  it("defaults chapters to level 1, researched, and accepts level, origin and budget", () => {
    goodPackage();
    expect(validateCoursePackage(dir).manifest?.chapters[0]).toMatchObject({ level: 1, origin: "researched" });

    write("02-deep/lesson-01.md", "---\nid: d01\ntitle: Deep\nsources: none\n---\nMore\n");
    withChapters("  - {dir: 01-basics, title: Basics}\n  - {dir: 02-deep, title: Deep, level: 2, origin: quick}", "budget_minutes: 90\n");
    const r = validateCoursePackage(dir);
    expect(r.issues).toEqual([]);
    expect(r.manifest?.budget_minutes).toBe(90);
    expect(r.manifest?.chapters[1]).toMatchObject({ level: 2, origin: "quick" });
  });

  it("rejects an unknown origin, a level below 1 and a lower level listed after a higher one", () => {
    goodPackage();
    write("02-deep/lesson-01.md", "---\nid: d01\ntitle: Deep\nsources: none\n---\nMore\n");
    withChapters("  - {dir: 01-basics, title: Basics, origin: guessed}");
    expect(validateCoursePackage(dir).ok).toBe(false);
    withChapters("  - {dir: 01-basics, title: Basics, level: 0}");
    expect(validateCoursePackage(dir).ok).toBe(false);
    withChapters("  - {dir: 02-deep, title: Deep, level: 2}\n  - {dir: 01-basics, title: Basics}");
    expect(validateCoursePackage(dir).issues.map((i) => i.message).join(" ")).toMatch(/lower levels first/);
  });

  it("reports a missing manifest", () => {
    expect(validateCoursePackage(dir).issues[0]).toEqual({ file: "course.yaml", message: "missing" });
  });

  it("reports schema, reference and duplicate problems", () => {
    goodPackage();
    write("01-basics/lesson-01.md", "---\nid: l01\ntitle: One\nquiz: nope.yaml\n---\nHi\n"); // no sources, bad quiz ref
    write("01-basics/lesson-02.md", "---\nid: l01\ntitle: Dup\nsources: none\n---\n");
    const msgs = validateCoursePackage(dir).issues.map((i) => `${i.file}: ${i.message}`);
    expect(msgs.some((m) => m.includes("lesson-01.md") && m.includes("sources"))).toBe(true);
    expect(validateCoursePackage(dir).ok).toBe(false);
  });

  it("flags missing exam file and unknown chapter reference", () => {
    goodPackage();
    write("course.yaml", `schemaVersion: 1
id: tiny
title: Tiny
short_intro: Small.
level: Beginner
chapters:
  - {dir: 01-basics, title: Basics}
  - {dir: 02-missing, title: Gone}
exams:
  - {id: final, file: exams/final.yaml}
  - {id: mid, file: exams/mid.yaml, after: 09-nope}
`);
    const msgs = validateCoursePackage(dir).issues.map((i) => i.message);
    expect(msgs).toContain('chapter dir "02-missing" does not exist');
    expect(msgs).toContain('exam file "exams/final.yaml" does not exist');
    expect(msgs).toContain('exam "mid" is placed after unknown chapter "09-nope"');
  });
});

describe("validateExtensionOverlay", () => {
  const lesson = (id: string, extra = "sources: [101]") => `---\nid: ${id}\ntitle: T\nquiz: quiz-01.yaml\n${extra}\n---\nBody [101]\n`;
  const quiz = (id: string, qid: string, sources = "[101]") =>
    `id: ${id}\ntitle: Check\nquestions:\n  - {id: ${qid}, type: short, text: "Q?", answers: [a], sources: ${sources}}\n`;

  function goodOverlay() {
    write("extension.yaml", "schemaVersion: 1\nchapters:\n  - {dir: x01-deep, title: Deep, level: 2, origin: researched}\n");
    write("sources.md", "# Sources\n\n101. [A](https://example.com) · P · reliability: high\n");
    write("x01-deep/lesson-01.md", lesson("x01"));
    write("x01-deep/quiz-01.yaml", quiz("xq01", "xq01-1"));
  }

  const msgs = (pkg?: string) => validateExtensionOverlay(dir, pkg).issues.map((i) => `${i.file}: ${i.message}`);

  it("accepts a well-formed extensions folder, with or without the course package to compare against", () => {
    goodOverlay();
    expect(validateExtensionOverlay(dir)).toMatchObject({ ok: true, issues: [] });
    const pkg = mkdtempSync(join(tmpdir(), "selfschool-pkg-"));
    try {
      writeFileSync(join(pkg, "sources.md"), "1. Something\n");
      expect(validateExtensionOverlay(dir, pkg).ok).toBe(true);
    } finally {
      rmSync(pkg, { recursive: true, force: true });
    }
  });

  it("needs extension.yaml, and reports a broken one instead of throwing", () => {
    expect(validateExtensionOverlay(dir).issues).toEqual([{ file: "extension.yaml", message: "missing" }]);
    write("extension.yaml", "chapters: nope");
    expect(validateExtensionOverlay(dir).ok).toBe(false);
  });

  it("flags ids without the x prefix, duplicates, and a missing chapter folder", () => {
    goodOverlay();
    write("extension.yaml", "schemaVersion: 1\nchapters:\n  - {dir: x01-deep, title: Deep}\n  - {dir: x02-gone, title: Gone}\n");
    write("x01-deep/lesson-02.md", lesson("l07"));
    write("x01-deep/lesson-03.md", lesson("x01"));
    write("x01-deep/quiz-02.yaml", quiz("q09", "q09-1"));
    const out = msgs();
    expect(out).toContain('x01-deep/lesson-02.md: lesson id "l07" must start with "x"');
    expect(out).toContain('x01-deep/lesson-03.md: duplicate lesson id "x01"');
    expect(out).toContain('x01-deep/quiz-02.yaml: quiz id "q09" must start with "x"');
    expect(out).toContain('x01-deep/quiz-02.yaml: question id "q09-1" must start with "x"');
    expect(out).toContain('extension.yaml: chapter dir "x02-gone" does not exist');
  });

  it("checks sources: numbered from 101, no duplicates, and every cited number exists", () => {
    goodOverlay();
    write("sources.md", "# Sources\n\n2. [Low](https://example.com) · P\n101. [A](https://example.com) · P\n101. [Again](https://example.com) · P\n");
    write("x01-deep/lesson-01.md", lesson("x01", "sources: [101, 150]"));
    write("x01-deep/quiz-01.yaml", quiz("xq01", "xq01-1", "[160]"));
    const out = msgs();
    expect(out).toContain("sources.md: source 2 is below 101: extension sources are numbered from 101");
    expect(out).toContain("sources.md: duplicate source number 101");
    expect(out).toContain("x01-deep/lesson-01.md: cites source 150, which is not in the extension's sources.md");
    expect(out).toContain('x01-deep/quiz-01.yaml: question "xq01-1" cites source 160, which is not in the extension\'s sources.md');
  });

  it("allows quick lessons with `sources: none`", () => {
    goodOverlay();
    write("sources.md", "");
    write("x01-deep/lesson-01.md", lesson("x01", "sources: none"));
    write("x01-deep/quiz-01.yaml", quiz("xq01", "xq01-1", "[]"));
    expect(validateExtensionOverlay(dir).ok).toBe(true);
  });

  it("checks against the course package: same chapter folder, same ids, same source numbers", () => {
    const pkg = mkdtempSync(join(tmpdir(), "selfschool-pkg-"));
    try {
      goodOverlay();
      writeFileSync(join(pkg, "course.yaml"), "schemaVersion: 1\nid: tiny\ntitle: T\nshort_intro: s\nlevel: Beginner\nchapters:\n  - {dir: x01-deep, title: Clash}\n");
      mkdirSync(join(pkg, "x01-deep"), { recursive: true });
      writeFileSync(join(pkg, "x01-deep", "lesson-01.md"), "---\nid: x01\ntitle: Core\nsources: none\n---\nBody\n");
      writeFileSync(join(pkg, "x01-deep", "quiz-01.yaml"), quiz("xq01", "xq01-1", "[]"));
      writeFileSync(join(pkg, "sources.md"), "101. Core source\n");
      const out = msgs(pkg);
      expect(out).toContain('extension.yaml: chapter folder "x01-deep" has the same name as a chapter in the course package');
      expect(out).toContain('x01-deep/lesson-01.md: lesson id "x01" is already used by the course package');
      expect(out).toContain('x01-deep/quiz-01.yaml: quiz id "xq01" is already used by the course package');
      expect(out).toContain("sources.md: source 101 is already used by the course package");
    } finally {
      rmSync(pkg, { recursive: true, force: true });
    }
  });
});

describe("citation consistency warnings", () => {
  it("warns about citations that are missing, undeclared, unused or never cited, without failing", () => {
    goodPackage();
    write("sources.md", "1. One\n2. Two\n3. Three\n");
    write("01-basics/lesson-01.md", "---\nid: l01\ntitle: One\nquiz: quiz-01.yaml\nsources: [1, 2]\n---\nA claim [1]. Another [4]. Code `x[5]` is ignored.\n");
    const r = validateCoursePackage(dir);
    expect(r.ok).toBe(true);
    const msgs = (r.warnings ?? []).map((w) => w.message).join(" | ");
    expect(msgs).toMatch(/cites source 4, which is not in sources\.md/);
    expect(msgs).toMatch(/cites \[4\] in the text but not in its frontmatter/);
    expect(msgs).toMatch(/lists source 2 in its frontmatter but never cites it/);
    expect(msgs).toMatch(/source 3 is not cited by any lesson/);
    expect(msgs).not.toMatch(/\[5\]|source 5/);
  });
});
