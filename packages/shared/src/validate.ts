import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ZodType } from "zod";
import {
  courseManifestSchema,
  EXTENSION_ID_PREFIX,
  EXTENSION_SOURCE_BASE,
  examBlueprintSchema,
  lessonFrontmatterSchema,
  overlayManifestSchema,
  quizSchema,
  type CourseManifest,
} from "./course.js";

export interface ValidationIssue {
  /** Path relative to the package root. */
  file: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /** Authoring advice that does not make a package invalid (missing glossary, a lab with no files). */
  warnings?: ValidationIssue[];
  manifest?: CourseManifest;
}

/** Splits `---\nyaml\n---\nbody`; returns null when there is no frontmatter block. */
export function splitFrontmatter(md: string): { data: unknown; body: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
  if (!m) return null;
  return { data: parseYaml(m[1] ?? ""), body: m[2] ?? "" };
}

/**
 * Stub validator: loads course.yaml, lesson frontmatter, quizzes and exam blueprints and checks
 * them against the zod schemas, plus that referenced files exist. No network. The fuller rules
 * from plan.md section 4 (link checks, alt text, option explanations coverage) land in phase 1.
 */
export function validateCoursePackage(dir: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  const add = (file: string, message: string) => issues.push({ file, message });
  const warnings: ValidationIssue[] = [];
  const warn = (file: string, message: string) => warnings.push({ file, message });
  const rel = (p: string) => relative(dir, p).split("\\").join("/");

  const lessonCitations: Array<{ file: string; declared: number[]; used: number[] }> = [];

  const loadYaml = <T>(path: string, schema: ZodType<T>): T | undefined => {
    let raw: unknown;
    try {
      raw = parseYaml(readFileSync(path, "utf8"));
    } catch (e) {
      add(rel(path), `cannot read/parse YAML: ${(e as Error).message}`);
      return undefined;
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      for (const i of parsed.error.issues) add(rel(path), `${i.path.join(".") || "(root)"}: ${i.message}`);
      return undefined;
    }
    return parsed.data;
  };

  const manifestPath = join(dir, "course.yaml");
  if (!existsSync(manifestPath)) {
    return { ok: false, issues: [{ file: "course.yaml", message: "missing" }] };
  }
  const manifest = loadYaml(manifestPath, courseManifestSchema);
  if (!manifest) return { ok: false, issues };

  const cited = new Set<number>();
  const seen = new Set<string>();
  const unique = (kind: string, id: string, file: string) => {
    const key = `${kind}:${id}`;
    if (seen.has(key)) add(file, `duplicate ${kind} id "${id}"`);
    seen.add(key);
  };

  // extension levels come after the core course: levels never go back down
  manifest.chapters.forEach((c, i) => {
    const prev = manifest.chapters[i - 1];
    if (prev && c.level < prev.level) add("course.yaml", `chapter "${c.dir}" (level ${c.level}) comes after "${prev.dir}" (level ${prev.level}); list lower levels first`);
  });

  for (const chapter of manifest.chapters) {
    const chapterDir = join(dir, chapter.dir);
    if (!existsSync(chapterDir) || !statSync(chapterDir).isDirectory()) {
      add("course.yaml", `chapter dir "${chapter.dir}" does not exist`);
      continue;
    }
    const files = readdirSync(chapterDir).sort();
    for (const f of files.filter((n) => /^lesson-.*\.md$/.test(n))) {
      const path = join(chapterDir, f);
      let fm: ReturnType<typeof splitFrontmatter>;
      try {
        fm = splitFrontmatter(readFileSync(path, "utf8"));
      } catch (e) {
        add(rel(path), `cannot parse frontmatter: ${(e as Error).message}`);
        continue;
      }
      if (!fm) {
        add(rel(path), "missing frontmatter block");
        continue;
      }
      const parsed = lessonFrontmatterSchema.safeParse(fm.data);
      if (!parsed.success) {
        for (const i of parsed.error.issues) add(rel(path), `${i.path.join(".") || "(root)"}: ${i.message}`);
        continue;
      }
      unique("lesson", parsed.data.id, rel(path));
      const { quiz, resources } = parsed.data;
      if (quiz && !existsSync(join(chapterDir, quiz))) add(rel(path), `quiz "${quiz}" does not exist`);
      for (const r of resources) {
        if (!existsSync(join(chapterDir, r))) add(rel(path), `resource "${r}" does not exist`);
      }
      lessonCitations.push({ file: rel(path), declared: parsed.data.sources === "none" ? [] : parsed.data.sources, used: citationsIn(fm.body) });
      if (!/^:::glossary\s*$/m.test(fm.body)) warn(rel(path), "no :::glossary block (define the lesson's jargon in plain words)");
      if (/^(lab|capstone|exercise|workshop)\b/i.test(parsed.data.title) && resources.length === 0) {
        warn(rel(path), "hands-on lesson lists no resources: ship tested, runnable files (scripts, data generators, configs) in resources/");
      }
    }
    for (const f of files.filter((n) => /^quiz-.*\.ya?ml$/.test(n))) {
      const quiz = loadYaml(join(chapterDir, f), quizSchema);
      if (!quiz) continue;
      unique("quiz", quiz.id, rel(join(chapterDir, f)));
      for (const q of quiz.questions) {
        unique("question", q.id, rel(join(chapterDir, f)));
        if (q.type === "hotspot" && !existsSync(join(dir, q.image))) add(rel(join(chapterDir, f)), `question ${q.id}: image "${q.image}" does not exist`);
      }
    }
  }

  const sourcesPath = join(dir, "sources.md");
  if (!existsSync(sourcesPath)) add("sources.md", "missing");
  else {
    const listed = new Set(sourceNumbers(readFileSync(sourcesPath, "utf8")));
    for (const l of lessonCitations) {
      l.used.forEach((n) => cited.add(n));
      l.declared.forEach((n) => cited.add(n));
      const missing = [...new Set([...l.used, ...l.declared])].filter((n) => !listed.has(n));
      if (missing.length) warn(l.file, `cites source ${missing.join(", ")}, which is not in sources.md`);
      const undeclared = l.used.filter((n) => !l.declared.includes(n));
      if (undeclared.length) warn(l.file, `cites [${[...new Set(undeclared)].join("], [")}] in the text but not in its frontmatter sources`);
      const unused = l.declared.filter((n) => !l.used.includes(n));
      if (unused.length) warn(l.file, `lists source ${unused.join(", ")} in its frontmatter but never cites it in the text`);
    }
    const never = [...listed].filter((n) => !cited.has(n));
    if (never.length) warn("sources.md", `source ${never.join(", ")} is not cited by any lesson`);
  }

  for (const exam of manifest.exams) {
    const path = join(dir, exam.file);
    if (!existsSync(path)) {
      add("course.yaml", `exam file "${exam.file}" does not exist`);
      continue;
    }
    loadYaml(path, examBlueprintSchema);
    if (exam.after && !manifest.chapters.some((c) => c.dir === exam.after)) {
      add("course.yaml", `exam "${exam.id}" is placed after unknown chapter "${exam.after}"`);
    }
  }

  return { ok: issues.length === 0, issues, warnings, manifest };
}

/** `[n]` citation numbers in lesson prose (code fences and inline code ignored), in order of appearance. */
const citationsIn = (body: string): number[] => {
  const prose = body.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
  return [...prose.matchAll(/(?<![\\!])\[(\d{1,3})\](?![(:]|\[(?!\d))/g)].map((m) => Number(m[1]));
};

const sourceNumbers = (md: string): number[] =>
  md
    .split(/\r?\n/)
    .map((line) => /^\s*(\d+)\.\s/.exec(line)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number);

/**
 * Checks an extensions folder (`extensions/<course-id>/`) the way the loader will read it, so nothing is skipped
 * silently: `extension.yaml`, chapter folders, lessons and quizzes against the schemas, the `x` id prefix,
 * source numbers from `EXTENSION_SOURCE_BASE`, and that every cited source exists. When the course package is
 * given, ids, chapter folders and source numbers are also checked against it for collisions.
 */
export function validateExtensionOverlay(dir: string, packageDir?: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  const add = (file: string, message: string) => issues.push({ file, message });
  const rel = (p: string) => relative(dir, p).split("\\").join("/");

  const manifestPath = join(dir, "extension.yaml");
  if (!existsSync(manifestPath)) return { ok: false, issues: [{ file: "extension.yaml", message: "missing" }] };
  let manifest: ReturnType<typeof overlayManifestSchema.parse>;
  try {
    const parsed = overlayManifestSchema.safeParse(parseYaml(readFileSync(manifestPath, "utf8")));
    if (!parsed.success) {
      for (const i of parsed.error.issues) add("extension.yaml", `${i.path.join(".") || "(root)"}: ${i.message}`);
      return { ok: false, issues };
    }
    manifest = parsed.data;
  } catch (e) {
    return { ok: false, issues: [{ file: "extension.yaml", message: `cannot read/parse YAML: ${(e as Error).message}` }] };
  }

  // what the package already uses (only known when its folder is given)
  const core = { dirs: new Set<string>(), lessons: new Set<string>(), quizzes: new Set<string>(), questions: new Set<string>(), sources: new Set<number>() };
  if (packageDir && existsSync(join(packageDir, "course.yaml"))) {
    const pkg = validateCoursePackage(packageDir);
    for (const c of pkg.manifest?.chapters ?? []) {
      core.dirs.add(c.dir);
      const chapterDir = join(packageDir, c.dir);
      if (!existsSync(chapterDir)) continue;
      for (const f of readdirSync(chapterDir)) {
        try {
          if (/^lesson-.*\.md$/.test(f)) {
            const fm = splitFrontmatter(readFileSync(join(chapterDir, f), "utf8"));
            const id = (fm?.data as { id?: unknown } | undefined)?.id;
            if (typeof id === "string") core.lessons.add(id);
          } else if (/^quiz-.*\.ya?ml$/.test(f)) {
            const q = quizSchema.safeParse(parseYaml(readFileSync(join(chapterDir, f), "utf8")));
            if (q.success) {
              core.quizzes.add(q.data.id);
              q.data.questions.forEach((x) => core.questions.add(x.id));
            }
          }
        } catch {
          /* a broken core file is the package validator's business */
        }
      }
    }
    if (existsSync(join(packageDir, "sources.md"))) sourceNumbers(readFileSync(join(packageDir, "sources.md"), "utf8")).forEach((n) => core.sources.add(n));
  }

  const ownSources = new Set<number>();
  const sourcesPath = join(dir, "sources.md");
  if (existsSync(sourcesPath)) {
    for (const n of sourceNumbers(readFileSync(sourcesPath, "utf8"))) {
      if (n < EXTENSION_SOURCE_BASE) add("sources.md", `source ${n} is below ${EXTENSION_SOURCE_BASE}: extension sources are numbered from ${EXTENSION_SOURCE_BASE}`);
      else if (core.sources.has(n)) add("sources.md", `source ${n} is already used by the course package`);
      else if (ownSources.has(n)) add("sources.md", `duplicate source number ${n}`);
      ownSources.add(n);
    }
  }

  const seen = new Set<string>();
  const unique = (kind: string, id: string, file: string, taken: Set<string>) => {
    if (!id.startsWith(EXTENSION_ID_PREFIX)) add(file, `${kind} id "${id}" must start with "${EXTENSION_ID_PREFIX}"`);
    if (taken.has(id)) add(file, `${kind} id "${id}" is already used by the course package`);
    if (seen.has(`${kind}:${id}`)) add(file, `duplicate ${kind} id "${id}"`);
    seen.add(`${kind}:${id}`);
  };

  manifest.chapters.forEach((c, i) => {
    const prev = manifest.chapters[i - 1];
    if (prev && c.level < prev.level) add("extension.yaml", `chapter "${c.dir}" (level ${c.level}) comes after "${prev.dir}" (level ${prev.level}); list lower levels first`);
  });

  for (const chapter of manifest.chapters) {
    const chapterDir = join(dir, chapter.dir);
    if (core.dirs.has(chapter.dir)) add("extension.yaml", `chapter folder "${chapter.dir}" has the same name as a chapter in the course package`);
    if (!existsSync(chapterDir) || !statSync(chapterDir).isDirectory()) {
      add("extension.yaml", `chapter dir "${chapter.dir}" does not exist`);
      continue;
    }
    const files = readdirSync(chapterDir).sort();
    if (!files.some((n) => /^lesson-.*\.md$/.test(n))) add("extension.yaml", `chapter "${chapter.dir}" has no lessons`);
    for (const f of files.filter((n) => /^lesson-.*\.md$/.test(n))) {
      const path = join(chapterDir, f);
      let fm: ReturnType<typeof splitFrontmatter>;
      try {
        fm = splitFrontmatter(readFileSync(path, "utf8"));
      } catch (e) {
        add(rel(path), `cannot parse frontmatter: ${(e as Error).message}`);
        continue;
      }
      if (!fm) {
        add(rel(path), "missing frontmatter block");
        continue;
      }
      const parsed = lessonFrontmatterSchema.safeParse(fm.data);
      if (!parsed.success) {
        for (const i of parsed.error.issues) add(rel(path), `${i.path.join(".") || "(root)"}: ${i.message}`);
        continue;
      }
      unique("lesson", parsed.data.id, rel(path), core.lessons);
      const { quiz, resources, sources } = parsed.data;
      if (quiz && !existsSync(join(chapterDir, quiz))) add(rel(path), `quiz "${quiz}" does not exist`);
      for (const r of resources) if (!existsSync(join(chapterDir, r))) add(rel(path), `resource "${r}" does not exist`);
      if (sources !== "none") for (const n of sources) if (!ownSources.has(n)) add(rel(path), `cites source ${n}, which is not in the extension's sources.md`);
    }
    for (const f of files.filter((n) => /^quiz-.*\.ya?ml$/.test(n))) {
      const path = join(chapterDir, f);
      let quiz: ReturnType<typeof quizSchema.parse>;
      try {
        const parsed = quizSchema.safeParse(parseYaml(readFileSync(path, "utf8")));
        if (!parsed.success) {
          for (const i of parsed.error.issues) add(rel(path), `${i.path.join(".") || "(root)"}: ${i.message}`);
          continue;
        }
        quiz = parsed.data;
      } catch (e) {
        add(rel(path), `cannot read/parse YAML: ${(e as Error).message}`);
        continue;
      }
      unique("quiz", quiz.id, rel(path), core.quizzes);
      for (const q of quiz.questions) {
        unique("question", q.id, rel(path), core.questions);
        if (q.type === "hotspot" && !existsSync(join(dir, q.image))) add(rel(path), `question ${q.id}: image "${q.image}" does not exist in the extensions folder`);
        for (const n of q.sources) if (!ownSources.has(n)) add(rel(path), `question "${q.id}" cites source ${n}, which is not in the extension's sources.md`);
      }
    }
  }

  return { ok: issues.length === 0, issues };
}
