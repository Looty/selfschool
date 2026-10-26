import { eq } from "drizzle-orm";
import type {
  ChapterOutline,
  CourseDetail,
  CourseSummary,
  CourseTime,
  Lesson,
  LearnerQuiz,
  LessonRef,
  Progress,
} from "@selfschool/shared";
import { quizMinutes, type TranslationManifest } from "@selfschool/shared";
import { attemptHistory, awardXp, learnerQuestion, quizGateCleared, type SnapQ } from "./attempts.js";
import { questionKey, type LightLesson, type LoadedCourse, type LoadedLesson } from "./catalog.js";
import { answerCount } from "./chat.js";
import { getCourse, loadCourses, type Ctx } from "./ctx.js";
import { attempts, completions, lessonRevisions, packages } from "./db/schema.js";
import { examRow } from "./exams.js";
import { languagesOf, quizIn, titlesFor, translationFor } from "./i18n.js";
import { cached } from "./summaryCache.js";
import { HttpError } from "./util.js";

export const lessonRef = (l: Pick<LoadedLesson, "id" | "title">): LessonRef => ({ id: l.id, title: l.title });

export function completionMap(ctx: Ctx, courseId: string) {
  const rows = ctx.db.select().from(completions).where(eq(completions.packageId, courseId)).all();
  return new Map(rows.map((r) => [r.lessonId, r]));
}

export function latestRevisions(ctx: Ctx, courseId: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of ctx.db.select().from(lessonRevisions).where(eq(lessonRevisions.packageId, courseId)).all()) {
    out.set(r.lessonId, Math.max(out.get(r.lessonId) ?? 0, r.revision));
  }
  return out;
}

// The summaries below read `course.light` only (never lesson bodies) and are cached per course; see summaryCache.ts.

export const progressOf = (ctx: Ctx, course: LoadedCourse): Progress =>
  cached(ctx, `progress:${course.id}`, () => {
    const done = completionMap(ctx, course.id);
    // the core course only: extensions never move this percentage (plan.md section 6)
    const core = course.light.lessons.filter((l) => l.level === 1);
    const n = core.filter((l) => done.has(l.id)).length;
    const total = core.length;
    return { done: n, total, percent: total ? Math.round((n / total) * 100) : 0 };
  });

export const currentLesson = (ctx: Ctx, course: LoadedCourse): LightLesson | null =>
  cached(ctx, `current:${course.id}`, () => {
    const done = completionMap(ctx, course.id);
    return course.light.lessons.find((l) => !done.has(l.id)) ?? null;
  });

export const outline = (ctx: Ctx, course: LoadedCourse): ChapterOutline[] => cached(ctx, `outline:${course.id}`, () => buildOutline(ctx, course));

function buildOutline(ctx: Ctx, course: LoadedCourse): ChapterOutline[] {
  const { light } = course;
  const done = completionMap(ctx, course.id);
  const revs = latestRevisions(ctx, course.id);
  const current = light.lessons.find((l) => !done.has(l.id));
  return course.manifest.chapters.map((ch) => {
    const lessons = light.lessons
      .filter((l) => l.chapterDir === ch.dir)
      .map((l) => {
        const c = done.get(l.id);
        const revision = revs.get(l.id) ?? 1;
        return {
          id: l.id,
          title: l.title,
          minutes: l.minutes,
          status: c ? ("done" as const) : l === current ? ("current" as const) : ("todo" as const),
          revision,
          updated: !!c && revision > c.revision,
          quiz: l.quizId && light.quizQuestions.has(l.quizId) ? { questionCount: light.quizQuestions.get(l.quizId)!.length } : null,
        };
      });
    const practice = light.lessons
      .filter((l) => l.chapterDir === ch.dir && l.quizId)
      .reduce((n, l) => n + quizMinutes(light.quizQuestions.get(l.quizId!) ?? []), 0);
    return {
      dir: ch.dir,
      title: ch.title,
      level: ch.level,
      origin: ch.origin,
      minutes: lessons.reduce((n, l) => n + l.minutes, 0) + practice,
      done: lessons.filter((l) => l.status === "done").length,
      total: lessons.length,
      lessons,
    };
  });
}

/** Chapter and lesson titles only, in order: what the outline job sees of the existing course. */
export function courseOutlineFor(ctx: Ctx, course: LoadedCourse): { title: string; lessons: string[] }[] {
  return outline(ctx, course).map((c) => ({ title: c.title, lessons: c.lessons.map((l) => l.title) }));
}

/** End-to-end time from the content: lessons, quizzes answered once, exams sat once. Remaining skips what is done. */
export const courseTime = (ctx: Ctx, course: LoadedCourse): CourseTime =>
  cached(ctx, `time:${course.id}`, () => {
    const done = completionMap(ctx, course.id);
    let reading = 0, practice = 0, left = 0;
    for (const l of course.light.lessons.filter((x) => x.level === 1)) {
      const qs = l.quizId ? course.light.quizQuestions.get(l.quizId) : undefined;
      const q = qs ? quizMinutes(qs) : 0;
      reading += l.minutes;
      practice += q;
      if (!done.has(l.id)) left += l.minutes + q;
    }
    let exams = 0;
    for (const e of course.exams) {
      exams += e.blueprint.duration_minutes;
      if (examRow(ctx, course, e).status !== "passed") left += e.blueprint.duration_minutes;
    }
    return { readingMinutes: reading, practiceMinutes: practice, examMinutes: exams, totalMinutes: reading + practice + exams, remainingMinutes: left };
  });

/** Titles in the reader's language, applied after the cached (source-language) summaries so the cache never mixes languages. */
export function localizeOutline(chapters: ChapterOutline[], t: TranslationManifest | null): ChapterOutline[] {
  if (!t) return chapters;
  return chapters.map((c) => ({
    ...c,
    title: t.chapters[c.dir] ?? c.title,
    lessons: c.lessons.map((l) => ({ ...l, title: t.lessons[l.id] ?? l.title })),
  }));
}

export const localizeRef = <T extends { id: string; title: string }>(ref: T, t: TranslationManifest | null, kind: "lessons"): T =>
  t?.[kind][ref.id] ? { ...ref, title: t[kind][ref.id]! } : ref;

export function localizeSummary<T extends CourseSummary>(ctx: Ctx, s: T, course: LoadedCourse, lang: string | undefined): T {
  const t = titlesFor(ctx, course, lang);
  // the language list is read fresh: a translation written by `school translate` appears without any course changing
  return { ...s, translations: languagesOf(ctx, course), ...(t?.title ? { title: t.title } : {}) };
}

export const courseSummary = (ctx: Ctx, course: LoadedCourse): CourseSummary =>
  cached(ctx, `summary:${course.id}`, () => {
    const done = completionMap(ctx, course.id);
    const revs = latestRevisions(ctx, course.id);
    const started = done.size > 0 || ctx.db.select({ id: attempts.id }).from(attempts).where(eq(attempts.packageId, course.id)).limit(1).get() !== undefined;
    return {
      ...course.ref,
      lessonCount: course.light.lessons.filter((l) => l.level === 1).length,
      examCount: course.exams.length,
      time: courseTime(ctx, course),
      percent: progressOf(ctx, course).percent,
      started,
      updated: course.light.lessons.some((l) => {
        const c = done.get(l.id);
        return !!c && (revs.get(l.id) ?? 1) > c.revision;
      }),
      language: course.manifest.language,
      translations: languagesOf(ctx, course),
    };
  });

export function listCourses(ctx: Ctx, lang?: string): CourseSummary[] {
  return loadCourses(ctx).map((c) => localizeSummary(ctx, courseSummary(ctx, c), c, lang));
}

export function courseDetail(ctx: Ctx, courseId: string, lang?: string): CourseDetail {
  const course = getCourse(ctx, courseId);
  const detail = cachedDetail(ctx, course);
  const t = titlesFor(ctx, course, lang);
  if (!t) return { ...detail, translations: languagesOf(ctx, course) };
  return {
    ...localizeSummary(ctx, detail, course, lang),
    description: t.description ?? detail.description,
    chapters: localizeOutline(detail.chapters, t),
    resume: detail.resume ? localizeRef(detail.resume, t, "lessons") : null,
  };
}

const cachedDetail = (ctx: Ctx, course: LoadedCourse): CourseDetail =>
  cached(ctx, `detail:${course.id}`, () => {
    const pkg = ctx.db.select().from(packages).where(eq(packages.id, course.id)).get();
    const cur = currentLesson(ctx, course);
    return {
      ...courseSummary(ctx, course),
      description: course.manifest.description,
      level: course.manifest.level,
      tags: course.manifest.tags,
      progress: progressOf(ctx, course),
      chapters: outline(ctx, course),
      exams: course.exams.map((e) => examRow(ctx, course, e)),
      resume: cur ? lessonRef(cur) : null,
      // TODO(catalog): `sources` needs the full course; a `sourceCount` on CourseLight would keep this one cheap too
      source: { repo: pkg?.url ?? `local:${course.dirName}`, sha: pkg?.sha ?? "", sourceCount: course.light.sourceCount },
    };
  });

// ---------- lesson ----------

/** First paragraph becomes the standfirst when it is plain prose. */
export function splitStandfirst(body: string): { standfirst: string; markdown: string } {
  const m = /^([\s\S]*?)(?:\r?\n\s*\r?\n|$)([\s\S]*)$/.exec(body);
  const first = (m?.[1] ?? "").trim();
  if (!first || /^(#|```|:::|!\[|\||[-*>]\s|\d+\.\s)/.test(first)) return { standfirst: "", markdown: body };
  return { standfirst: first, markdown: (m?.[2] ?? "").trim() };
}

export function findLesson(course: LoadedCourse, lessonId: string): LoadedLesson {
  const l = course.lessonById.get(lessonId);
  if (!l) throw new HttpError(404, "lesson not found");
  return l;
}

export function lessonView(ctx: Ctx, courseId: string, lessonId: string, lang?: string): Lesson {
  const course = getCourse(ctx, courseId);
  const l = findLesson(course, lessonId);
  const revs = latestRevisions(ctx, course.id);
  // a lesson with no translated file is shown in the course's own language, with its titles translated when listed
  const t = translationFor(ctx, course, lang);
  const titles = titlesFor(ctx, course, lang);
  const tl = t?.lessons.get(l.id);
  const { standfirst, markdown } = splitStandfirst(tl?.body ?? l.body);
  const quiz = l.quizId ? course.quizzes.get(l.quizId) : undefined;
  const quizTitle = quiz ? quizIn(t, quiz.quiz).title : "";
  const ref = (x: LoadedLesson) => (x.id === l.id && tl ? { id: x.id, title: tl.title } : localizeRef(lessonRef(x), titles, "lessons"));
  const exam = course.exams.find((e) => e.after === l.chapterDir);
  // Heal attempts finished before the gate counted provisional scores.
  if (l.quizId && !completionMap(ctx, course.id).has(l.id) && quizGateCleared(ctx, course.id, l.quizId)) completeLesson(ctx, course.id, l.id);
  return {
    course: titles?.title ? { ...course.ref, title: titles.title } : course.ref,
    chapterTitle: titles?.chapters[l.chapterDir] ?? l.chapterTitle,
    lesson: ref(l),
    number: l.index + 1,
    total: course.lessons.length,
    revision: revs.get(l.id) ?? 1,
    minutes: l.minutes,
    level: l.level,
    origin: l.origin,
    standfirst,
    markdown,
    sources: l.sourceNumbers.map((n) => {
      const s = course.sources.find((x) => x.n === n);
      return s ?? { n, title: `Source ${n}` };
    }),
    resources: l.resources,
    prev: course.lessons[l.index - 1] ? ref(course.lessons[l.index - 1]!) : null,
    next: course.lessons[l.index + 1] ? ref(course.lessons[l.index + 1]!) : null,
    quiz: quiz ? { id: quiz.quiz.id, title: quizTitle, questionCount: quiz.quiz.questions.length } : null,
    completed: completionMap(ctx, course.id).has(l.id),
    progress: progressOf(ctx, course),
    chapters: localizeOutline(outline(ctx, course), titles),
    exam: exam ? examRow(ctx, course, exam) : null,
    ai: { available: ctx.aiAvailable() },
    answerCount: answerCount(ctx, course.id, l.id),
    language: tl ? t!.lang : course.manifest.language,
    languages: [course.manifest.language, ...languagesOf(ctx, course)],
  };
}

export function completeLesson(ctx: Ctx, courseId: string, lessonId: string) {
  const course = getCourse(ctx, courseId);
  const l = findLesson(course, lessonId);
  if (l.quizId) {
    if (!quizGateCleared(ctx, course.id, l.quizId)) throw new HttpError(409, "pass the lesson quiz before completing the lesson");
  }
  const revision = latestRevisions(ctx, course.id).get(l.id) ?? 1;
  const existing = completionMap(ctx, course.id).get(l.id);
  if (!existing) {
    ctx.db.insert(completions).values({ packageId: course.id, lessonId: l.id, revision, completedAt: ctx.now() }).run();
    awardXp(ctx, 20, "lesson_complete", `${course.id}:${l.id}`);
  } else if (existing.revision < revision) {
    // Re-reading the newer revision acknowledges it; completion itself is never reset.
    ctx.db.update(completions).set({ revision }).where(eq(completions.id, existing.id)).run();
  }
  return { completed: true as const, revision, progress: progressOf(ctx, course) };
}

// ---------- quiz ----------

export function quizView(ctx: Ctx, courseId: string, quizId: string, lang?: string): LearnerQuiz {
  const course = getCourse(ctx, courseId);
  const lq = course.quizzes.get(quizId);
  if (!lq) throw new HttpError(404, "quiz not found");
  const lesson = course.lessonById.get(lq.lessonId)!;
  const used = attemptHistory(ctx, course.id, "quiz", quizId).length;
  const t = translationFor(ctx, course, lang);
  const quiz = quizIn(t, lq.quiz);
  const titles = titlesFor(ctx, course, lang);
  return {
    course: titles?.title ? { ...course.ref, title: titles.title } : course.ref,
    lesson: t?.lessons.has(lesson.id) ? { id: lesson.id, title: t.lessons.get(lesson.id)!.title } : localizeRef(lessonRef(lesson), titles, "lessons"),
    quiz: {
      id: quiz.id,
      title: quiz.title,
      passingPercentage: quiz.passing_percentage,
      maxAttempts: quiz.max_attempts,
      showAnswers: quiz.show_answers,
    },
    language: t?.quizzes.has(quizId) ? t.lang : course.manifest.language,
    attemptNumber: used + 1,
    questions: quiz.questions.map((q): SnapQ => ({ id: questionKey(course.id, q.id), domain: null, chapter: lq.chapterDir, lessonId: lq.lessonId, q })).map(learnerQuestion),
    progress: progressOf(ctx, course),
  };
}
