import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { LANGUAGE_CODE, lessonFrontmatterSchema, quizParityIssues, quizSchema, translationManifestSchema, type Quiz, type TranslationManifest } from "@selfschool/shared";
import { splitFrontmatter } from "@selfschool/shared/node";
import { rewriteLinks, type LoadedCourse } from "./catalog.js";
import type { Ctx } from "./ctx.js";

/**
 * Reading translations (see shared/translation.ts). A course's translations come from two places: its package
 * (`i18n/<language>/`, made by the author) and the app-owned extensions folder (`extensions/<course id>/i18n/<language>/`,
 * made with `school translate`). A file in the second place wins over the same file in the first, so a learner's own
 * translation can replace a weak one without touching the package.
 *
 * Translations are applied at view time only: the catalog, lesson revisions, the question bank and exams keep working on
 * the source language, so a translation can never change anyone's progress. The language of a request comes from one
 * header and is passed down explicitly; it is never kept on shared state.
 */
export interface Translation {
  lang: string;
  manifest: TranslationManifest;
  /** Translated lesson title and body (links already rewritten), by lesson id. */
  lessons: Map<string, { title: string; body: string }>;
  /** Translated quizzes by quiz id; only those with exactly the source's structure. */
  quizzes: Map<string, Quiz>;
}

const empty: TranslationManifest = { chapters: {}, lessons: {} };

/** The folders that can hold `lang`'s files, package first; later ones override earlier ones. */
function roots(ctx: Ctx, course: Pick<LoadedCourse, "id" | "dir">, lang: string): string[] {
  const user = ctx.catalog.overlayDirFor(course.id);
  return [join(course.dir, "i18n", lang), ...(user ? [join(user, "i18n", lang)] : [])].filter((d) => existsSync(d));
}

/** Language folders a course has in either place, sorted. Cheap (two directory listings) so summaries may call it. */
export function languagesOf(ctx: Ctx, course: Pick<LoadedCourse, "id" | "dir">): string[] {
  const user = ctx.catalog.overlayDirFor(course.id);
  const found = new Set<string>();
  for (const base of [join(course.dir, "i18n"), ...(user ? [join(user, "i18n")] : [])]) {
    try {
      for (const n of readdirSync(base)) if (LANGUAGE_CODE.test(n) && statSync(join(base, n)).isDirectory()) found.add(n);
    } catch {
      /* no such folder */
    }
  }
  return [...found].sort();
}

/** Languages that have at least one translated file in a chapter (so a partly translated course says where it is). */
export function chapterLanguages(ctx: Ctx, course: Pick<LoadedCourse, "id" | "dir">, chapterDir: string): string[] {
  return languagesOf(ctx, course).filter((lang) => roots(ctx, course, lang).some((r) => existsSync(join(r, chapterDir))));
}

/** Just the titles files: what lists and outlines need. Never opens a lesson. */
export function titlesFor(ctx: Ctx, course: LoadedCourse, lang: string | undefined): TranslationManifest | null {
  if (!lang || lang === course.manifest.language || !LANGUAGE_CODE.test(lang)) return null;
  let out = null as TranslationManifest | null;
  for (const root of roots(ctx, course, lang)) {
    const file = join(root, "course.yaml");
    if (!existsSync(file)) continue;
    const parsed = translationManifestSchema.safeParse(parseYaml(readFileSync(file, "utf8")));
    if (!parsed.success) continue;
    const prev: TranslationManifest | null = out;
    out = prev
      ? { ...prev, ...parsed.data, chapters: { ...prev.chapters, ...parsed.data.chapters }, lessons: { ...prev.lessons, ...parsed.data.lessons } }
      : parsed.data;
  }
  return out;
}

/** Translations are re-read after this long, so a file just written by `school translate` shows up without a restart. */
const CACHE_MS = 2000;
const cache = new Map<string, { at: number; t: Translation | null }>();

/** The translation of a course into `lang`, or null when the course has none (or `lang` is its own language). */
export function translationFor(ctx: Ctx, course: LoadedCourse, lang: string | undefined): Translation | null {
  if (!lang || lang === course.manifest.language || !LANGUAGE_CODE.test(lang)) return null;
  const key = `${course.dir}:${ctx.catalog.overlayDirFor(course.id) ?? ""}:${lang}:${course.contentHash}`;
  const hit = cache.get(key);
  if (hit && ctx.now() - hit.at < CACHE_MS) return hit.t;
  const t = readTranslation(ctx, course, lang);
  if (cache.size > 64) cache.clear();
  cache.set(key, { at: ctx.now(), t });
  return t;
}

function readTranslation(ctx: Ctx, course: LoadedCourse, lang: string): Translation | null {
  const found = roots(ctx, course, lang);
  if (found.length === 0) return null;
  const manifest = titlesFor(ctx, course, lang) ?? empty;
  const lessons = new Map<string, { title: string; body: string }>();
  const quizzes = new Map<string, Quiz>();
  const skip = (file: string, why: string) => console.warn(`[i18n] ${course.id}: ignoring ${lang}/${file}: ${why}`);

  for (const root of found) {
    for (const chapter of course.manifest.chapters) {
      const dir = join(root, chapter.dir);
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir).sort()) {
        const file = `${chapter.dir}/${f}`;
        try {
          if (/^lesson-.*\.md$/.test(f)) {
            const fm = splitFrontmatter(readFileSync(join(dir, f), "utf8"));
            const parsed = fm ? lessonFrontmatterSchema.safeParse(fm.data) : undefined;
            if (!fm || !parsed?.success) {
              skip(file, "invalid frontmatter");
              continue;
            }
            const source = course.lessonById.get(parsed.data.id);
            if (!source) {
              skip(file, `no lesson "${parsed.data.id}" in the course`);
              continue;
            }
            lessons.set(source.id, { title: parsed.data.title, body: rewriteLinks(fm.body.trim(), course.id, source.chapterDir, ctx.catalog.publicPrefix) });
          } else if (/^quiz-.*\.ya?ml$/.test(f)) {
            const tr = quizSchema.parse(parseYaml(readFileSync(join(dir, f), "utf8")));
            const source = course.quizzes.get(tr.id)?.quiz;
            if (!source) {
              skip(file, `no quiz "${tr.id}" in the course`);
              continue;
            }
            const issues = quizParityIssues(source, tr);
            if (issues.length) skip(file, issues[0]!);
            else quizzes.set(tr.id, tr);
          }
        } catch (e) {
          skip(file, e instanceof Error ? e.message : String(e));
        }
      }
    }
  }
  return { lang, manifest, lessons, quizzes };
}

/** The language a request asks for, from the one header the web app sets; undefined when absent or not a language code. */
export function requestLanguage(header: string | undefined | null): string | undefined {
  const v = header?.trim();
  return v && LANGUAGE_CODE.test(v) ? v : undefined;
}

/**
 * The quiz to show and grade in `t`'s language: the translation when there is one, else the source. A typed short
 * answer is accepted in either language, so a learner who types the English term is not marked wrong.
 */
export function quizIn(t: Translation | null, source: Quiz): Quiz {
  const tr = t?.quizzes.get(source.id);
  if (!tr) return source;
  return {
    ...tr,
    questions: tr.questions.map((q, i) => {
      const s = source.questions[i];
      return q.type === "short" && s?.type === "short" ? { ...q, answers: [...new Set([...q.answers, ...s.answers])] } : q;
    }),
  };
}
