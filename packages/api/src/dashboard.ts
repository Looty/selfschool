import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Dashboard } from "@selfschool/shared";
import { loadCourses, type Ctx } from "./ctx.js";
import { attemptAnswers, attempts, completions, jobs, questions } from "./db/schema.js";
import type { LightLesson } from "./catalog.js";
import { courseSummary, currentLesson, lessonRef, localizeRef, localizeSummary, progressOf } from "./courses.js";
import { titlesFor } from "./i18n.js";
import { cached } from "./summaryCache.js";
import { localDate } from "./util.js";

const DAY = 86_400_000;
const MAX_ATTEMPT_MINUTES = 30;
const WEAK_BELOW = 85;

/** Concept mastery from graded answers, weakest first, for the given courses. */
/** The dashboard card lists the weakest few concepts, not everything. */
export const WEAK_SPOTS_SHOWN = 3;

export function weakSpotsOf(ctx: Ctx, courses: ReturnType<typeof loadCourses>) {
  const byId = new Map(courses.map((c) => [c.id, c]));
  // lesson lookup from the light data (no bodies), built only for courses that have a weak spot
  const lightIndex = new Map<string, Map<string, LightLesson>>();
  const lightLesson = (courseId: string, lessonId: string) => {
    let m = lightIndex.get(courseId);
    if (!m) lightIndex.set(courseId, (m = new Map(byId.get(courseId)!.light.lessons.map((l) => [l.id, l]))));
    return m.get(lessonId);
  };
  const stats = new Map<string, { courseId: string; concept: string; got: number; n: number; lessonId: string | null }>();
  const graded = ctx.db
    .select({ qid: attemptAnswers.questionId, marks: attemptAnswers.marks })
    .from(attemptAnswers)
    .all()
    .filter((r) => r.marks !== null);
  const qrows = new Map(
    ctx.db
      .select({ id: questions.id, packageId: questions.packageId, concepts: questions.concepts, lessonId: questions.lessonId })
      .from(questions)
      .all()
      .map((q) => [q.id, q]),
  );
  for (const r of graded) {
    const q = qrows.get(r.qid);
    if (!q || !byId.has(q.packageId)) continue;
    for (const concept of q.concepts) {
      const key = `${q.packageId}\0${concept}`;
      const s = stats.get(key) ?? { courseId: q.packageId, concept, got: 0, n: 0, lessonId: null };
      s.got += r.marks!;
      s.n++;
      if (r.marks! < 1 && q.lessonId) s.lessonId = q.lessonId;
      else s.lessonId ??= q.lessonId;
      stats.set(key, s);
    }
  }
  return [...stats.values()]
    .map((s) => ({ ...s, percent: Math.round((s.got / s.n) * 100) }))
    .filter((s) => s.percent < WEAK_BELOW && s.lessonId && lightLesson(s.courseId, s.lessonId))
    .sort((x, y) => x.percent - y.percent || y.n - x.n)
    .map((s) => {
      const c = byId.get(s.courseId)!;
      return { concept: s.concept, percent: s.percent, course: c.ref, lesson: lessonRef(lightLesson(s.courseId, s.lessonId!)!) };
    });
}

interface Activity {
  /** Event count per local date (heatmap + streak). */
  counts: Map<string, number>;
  minutes: Map<string, number>;
  answers: Map<string, number>;
  lastByCourse: Map<string, number>;
}

const activity = (ctx: Ctx): Activity => cached(ctx, "dashboard:activity", () => buildActivity(ctx));

function buildActivity(ctx: Ctx): Activity {
  const a: Activity = { counts: new Map(), minutes: new Map(), answers: new Map(), lastByCourse: new Map() };
  const bump = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
  const seen = (courseId: string, at: number) => a.lastByCourse.set(courseId, Math.max(a.lastByCourse.get(courseId) ?? 0, at));
  // lesson minutes from the light data (no bodies)
  const lessonMinutes = new Map(loadCourses(ctx).map((c) => [c.id, new Map(c.light.lessons.map((l) => [l.id, l.minutes]))]));

  for (const c of ctx.db.select().from(completions).all()) {
    const d = localDate(c.completedAt);
    bump(a.counts, d);
    bump(a.minutes, d, lessonMinutes.get(c.packageId)?.get(c.lessonId) ?? 0);
    seen(c.packageId, c.completedAt);
  }
  const attemptPkg = new Map<string, string>();
  for (const t of ctx.db.select().from(attempts).all()) {
    attemptPkg.set(t.id, t.packageId);
    seen(t.packageId, t.finishedAt ?? t.startedAt);
    if (t.finishedAt !== null) {
      bump(a.minutes, localDate(t.finishedAt), Math.min(MAX_ATTEMPT_MINUTES, Math.max(0, Math.round((t.finishedAt - t.startedAt) / 60_000))));
    }
  }
  for (const r of ctx.db.select().from(attemptAnswers).all()) {
    if (r.answeredAt <= 0) continue;
    const d = localDate(r.answeredAt);
    bump(a.counts, d);
    bump(a.answers, d);
    const pkg = attemptPkg.get(r.attemptId);
    if (pkg) seen(pkg, r.answeredAt);
  }
  return a;
}

const level = (n: number) => (n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 7 ? 3 : 4);

export function dashboard(ctx: Ctx, lang?: string): Dashboard {
  const courses = loadCourses(ctx);
  const act = activity(ctx);
  const now = ctx.now();
  const today = new Date(now);

  // streak: consecutive active days ending today (or yesterday if today has nothing yet)
  let streak = 0;
  for (let i = act.counts.has(localDate(now)) ? 0 : 1; ; i++) {
    if (!act.counts.has(localDate(now - i * DAY))) break;
    streak++;
  }

  const mondayOffset = (today.getDay() + 6) % 7;
  const week = ["M", "T", "W", "T", "F", "S", "S"].map((label, i) => {
    const date = localDate(now - (mondayOffset - i) * DAY);
    return { label, minutes: act.minutes.get(date) ?? 0, today: i === mondayOffset, date };
  });

  // continue: the most recently active unfinished course; otherwise the first unfinished one
  const open = courses.filter((c) => currentLesson(ctx, c));
  const pick = [...open].sort((x, y) => (act.lastByCourse.get(y.id) ?? 0) - (act.lastByCourse.get(x.id) ?? 0))[0];
  let cont: Dashboard["continue"] = null;
  if (pick) {
    const cur = currentLesson(ctx, pick)!;
    const next = pick.light.lessons[cur.index + 1];
    const titles = titlesFor(ctx, pick, lang);
    cont = {
      course: titles?.title ? { ...pick.ref, title: titles.title } : pick.ref,
      lesson: localizeRef(lessonRef(cur), titles, "lessons"),
      lessonNumber: cur.index + 1,
      lessonTotal: pick.light.lessons.length,
      chapterTitle: titles?.chapters[cur.chapterDir] ?? cur.chapterTitle,
      minutes: cur.minutes,
      progress: progressOf(ctx, pick),
      upNext: next ? localizeRef(lessonRef(next), titles, "lessons") : null,
    };
  }

  const weakSpots = cached(ctx, "dashboard:weak", () => weakSpotsOf(ctx, courses).slice(0, WEAK_SPOTS_SHOWN));

  const pendingJobIds = ctx.db.select({ id: jobs.id }).from(jobs).where(inArray(jobs.status, ["pending", "running"])).all().map((j) => j.id);
  const pendingGrading = pendingJobIds.length
    ? ctx.db
        .select({ id: attemptAnswers.id })
        .from(attemptAnswers)
        .where(and(eq(attemptAnswers.grader, "ai"), isNull(attemptAnswers.marks), inArray(attemptAnswers.jobId, pendingJobIds)))
        .all().length
    : 0;

  return {
    continue: cont,
    week: {
      streakDays: streak,
      studiedMinutes: week.reduce((n, d) => n + d.minutes, 0),
      questionsAnswered: week.reduce((n, d) => n + (act.answers.get(d.date) ?? 0), 0),
      days: week.map(({ label, minutes, today: t }) => ({ label, minutes, today: t })),
    },
    activity: Array.from({ length: 112 }, (_, i) => {
      const date = localDate(now - (111 - i) * DAY);
      return { date, level: level(act.counts.get(date) ?? 0) };
    }),
    weakSpots,
    pendingGrading,
    courses: courses.map((c) => localizeSummary(ctx, courseSummary(ctx, c), c, lang)),
  };
}
