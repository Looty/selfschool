import type {
  ChapterOutline,
  ChatMessage,
  CourseSummary,
  CourseTime,
  ExamRow,
  ExtensionView,
  OutlineResult,
  Progress,
  RouteInput,
  RouteName,
  RouteResponse,
} from "@selfschool/shared";
import { DEFAULT_DEPTH_MINUTES, EXTENSION_SOURCE_BASE, PLANNED_LESSON_MINUTES, buildBrief, outlineResultSchema } from "@selfschool/shared";
import { ApiError } from "../client";
import {
  BANK, CHAPTERS, DOMAINS, EXAMS, EXAM_POOL_IDS, LESSONS, LESSON_ORDER, OTHER_COURSES, QUIZ, QUIZ_QUESTION_IDS,
  SOURCES, TS, TS_DESCRIPTION, lessonBody, lessonRef,
} from "./fixtures";
import {
  answerView, attemptView, learnerQuestion, newQuizAttempt, pendingGradingCount, statusOf, type AttemptRec, type MockDb,
} from "./state";

type Handler<N extends RouteName> = (input: RouteInput<N>, db: MockDb) => RouteResponse<N> | Promise<RouteResponse<N>>;
export type Handlers = { [N in RouteName]: Handler<N> };

const DAY = 86_400_000;
const notFound = (what: string) => new ApiError(404, `${what} not found`);

// ---------- shared builders ----------

function progressOf(db: MockDb): Progress {
  const done = LESSON_ORDER.filter((id) => db.completed.has(id)).length;
  return { done, total: LESSON_ORDER.length, percent: Math.round((done / LESSON_ORDER.length) * 100) };
}

const currentLessonId = (db: MockDb) => LESSON_ORDER.find((id) => !db.completed.has(id)) ?? null;

function outline(db: MockDb): ChapterOutline[] {
  const current = currentLessonId(db);
  return CHAPTERS.map((c) => {
    const lessons = c.lessons.map((id) => ({
      id,
      title: LESSONS[id]!.title,
      minutes: LESSONS[id]!.minutes,
      status: db.completed.has(id) ? ("done" as const) : id === current ? ("current" as const) : ("todo" as const),
      revision: LESSONS[id]!.revision,
      updated: LESSONS[id]!.revision > 1,
      quiz: id === "l06" ? { questionCount: 5 } : null,
    }));
    return {
      dir: c.dir, title: c.title, level: 1, origin: "researched" as const, minutes: lessons.reduce((n, l) => n + l.minutes + PRACTICE_PER_LESSON, 0),
      done: lessons.filter((l) => l.status === "done").length, total: lessons.length, lessons,
    };
  });
}

function examRows(db: MockDb): ExamRow[] {
  return EXAMS.map((e) => {
    const atts = [...db.attempts.values()].filter((a) => a.kind === "exam" && a.targetId === e.id).sort((a, b) => a.number - b.number);
    const views = atts.map((a) => attemptView(db, a));
    const last = views.at(-1);
    return {
      id: e.id, title: e.title, questionCount: e.questionCount, durationMinutes: e.durationMinutes,
      passingPercentage: e.passingPercentage, maxAttempts: e.maxAttempts,
      attemptCount: atts.length,
      pendingCount: views.reduce((n, v) => n + v.score.pendingCount, 0),
      status: !last ? "not_started" : last.finishedAt === null ? "in_progress" : last.provisional ? "provisional" : last.passed ? "passed" : "failed",
    };
  });
}

const PRACTICE_PER_LESSON = 6; // one 4-question quiz

function tsTime(db: MockDb): CourseTime {
  const reading = LESSON_ORDER.reduce((n, id) => n + LESSONS[id]!.minutes, 0);
  const practice = LESSON_ORDER.length * PRACTICE_PER_LESSON;
  const exams = EXAMS.reduce((n, e) => n + e.durationMinutes, 0);
  const left = LESSON_ORDER.filter((id) => !db.completed.has(id)).reduce((n, id) => n + LESSONS[id]!.minutes + PRACTICE_PER_LESSON, 0) + exams;
  return { readingMinutes: reading, practiceMinutes: practice, examMinutes: exams, totalMinutes: reading + practice + exams, remainingMinutes: left };
}

/** The other courses are card fixtures only: a rough time from their size and progress. */
function otherSummary(c: (typeof OTHER_COURSES)[number]): CourseSummary {
  const reading = c.lessonCount * 10, practice = c.lessonCount * PRACTICE_PER_LESSON, exams = c.examCount * 50;
  const total = reading + practice + exams;
  return {
    ...c.course, lessonCount: c.lessonCount, examCount: c.examCount, percent: c.percent, started: c.started, updated: c.updated,
    language: "en", translations: [],
    time: { readingMinutes: reading, practiceMinutes: practice, examMinutes: exams, totalMinutes: total, remainingMinutes: Math.round(total * (1 - c.percent / 100)) },
  };
}

function tsSummary(db: MockDb): CourseSummary {
  return { ...TS, lessonCount: LESSON_ORDER.length, examCount: EXAMS.length, time: tsTime(db), percent: progressOf(db).percent, started: db.completed.size > 0, updated: true, language: "en", translations: [] };
}

function chatMessages(db: MockDb): ChatMessage[] {
  return db.chat.map((r) => {
    if (r.readyAt && r.msg.status === "pending" && db.aiAvailable() && Date.now() >= r.readyAt) {
      const miss = /decorator|react|python|rust/i.test(r.question ?? "");
      r.msg = miss
        ? { ...r.msg, status: "done", covered: false, content: "Not covered in this course. The lessons and sources here don't discuss that." }
        : {
            ...r.msg, status: "done", covered: true,
            content: "Narrowing works because the compiler follows control flow: after a check such as `typeof x === \"string\"` it treats `x` as `string` inside that branch. [3]",
            citations: [{ kind: "source", ref: "3", label: "[3] Handbook: Narrowing" }, { kind: "lesson", ref: "narrowing-with-typeof", label: "Narrowing with typeof" }],
          };
    }
    return r.msg;
  });
}

function activityGrid() {
  const today = new Date();
  return Array.from({ length: 112 }, (_, i) => {
    const d = new Date(today.getTime() - (111 - i) * DAY);
    const level = (((i * 7919) % 11) + ((i * 31) % 5)) % 5;
    return { date: d.toISOString().slice(0, 10), level: i > 105 ? 4 - (i % 3) : level };
  });
}

function examInstanceView(db: MockDb, instanceId: string) {
  const inst = db.instances.get(instanceId);
  if (!inst) throw notFound("exam instance");
  const e = EXAMS.find((x) => x.id === inst.examId)!;
  return {
    id: inst.id, examId: inst.examId, course: TS, title: e.title, attemptId: inst.attemptId,
    durationMinutes: e.durationMinutes, startedAt: inst.startedAt,
    questions: inst.questionIds.map((q) => learnerQuestion(BANK[q]!)),
  };
}

function createInstance(db: MockDb, examId: string, reverse: boolean) {
  if (!EXAMS.some((e) => e.id === examId)) throw notFound("exam");
  const number = [...db.attempts.values()].filter((a) => a.kind === "exam" && a.targetId === examId).length + 1;
  const questionIds = reverse ? [...EXAM_POOL_IDS].reverse() : [...EXAM_POOL_IDS];
  const attempt: AttemptRec = {
    id: `att-${++db.seq}`, kind: "exam", targetId: examId, title: EXAMS.find((e) => e.id === examId)!.title,
    number, startedAt: Date.now(), finishedAt: null, questionIds, answers: {}, reveal: false,
  };
  db.attempts.set(attempt.id, attempt);
  const inst = { id: `inst-${++db.seq}`, examId, attemptId: attempt.id, startedAt: attempt.startedAt, questionIds };
  db.instances.set(inst.id, inst);
  return inst;
}

const getAttempt = (db: MockDb, id: string) => db.attempts.get(id) ?? (() => { throw notFound("attempt"); })();

function requireTs(courseId: string) {
  if (courseId !== TS.id) throw notFound(`course "${courseId}" (the mock only has ${TS.id})`);
}

const DRAFT_OUTLINE: OutlineResult = {
  title: "Level 2 · Deep dive",
  rationale:
    "You keep missing how `typeof` and user-defined guards differ, and you asked how the compiler decides what a guard proves. These chapters build on Narrowing and unions without repeating it.",
  unverified: true,
  chapters: [
    {
      title: "How the compiler narrows",
      why: "Your weakest concept is type predicates (40% mastery).",
      lessons: [
        { title: "Control-flow analysis, step by step", objective: "Trace how a variable's type changes across branches and loops.", why: "You missed two narrowing questions in a row." },
        { title: "Writing predicates the compiler can trust", objective: "Write an `is` predicate and say what it does and does not prove.", why: "Type predicates are your lowest-scoring concept." },
        { title: "Assertion functions", objective: "Use `asserts` to narrow after a check that throws.", why: "A natural follow-up to predicates." },
      ],
    },
    {
      title: "Modelling state with unions",
      why: "Builds on discriminated unions from chapter 2.",
      lessons: [
        { title: "Making illegal states unrepresentable", objective: "Redesign a flag-based type as a discriminated union.", why: "Extends the Unions and discriminants lesson." },
        { title: "Exhaustive handling in practice", objective: "Add a union member and let the compiler list every place to update.", why: "Extends Exhaustiveness checks." },
      ],
    },
  ],
};

/** The fixture outline trimmed to about budget / 12 lessons (it only has five). */
function outlineForBudget(minutes: number): OutlineResult {
  let left = Math.max(2, Math.min(5, Math.round(minutes / PLANNED_LESSON_MINUTES)));
  const chapters = DRAFT_OUTLINE.chapters
    .map((c) => ({ ...c, lessons: c.lessons.slice(0, Math.max(0, left)) }))
    .map((c) => { left -= c.lessons.length; return c; })
    .filter((c) => c.lessons.length > 0);
  return { ...DRAFT_OUTLINE, chapters };
}

function extensionView(db: MockDb, id: string): ExtensionView {
  const rec = db.extensions.get(id);
  if (!rec) throw notFound("extension");
  const drafted = db.aiAvailable() && Date.now() >= rec.readyAt;
  const status: ExtensionView["status"] = rec.decision ?? (drafted ? "ready" : "drafting");
  return {
    id: rec.id, courseId: TS.id, status, seed: rec.seed, budgetMinutes: rec.budgetMinutes, jobId: rec.jobId, error: null,
    outline: status === "drafting" ? null : rec.outline ?? outlineForBudget(rec.budgetMinutes),
    generation: generationView(db, rec),
    createdAt: rec.createdAt, decidedAt: rec.decidedAt,
  };
}

const GENERATION_STEP_MS = 2500;

/** The mock runner writes a lesson every couple of seconds once generation has started. */
function generationView(db: MockDb, rec: NonNullable<ReturnType<MockDb["extensions"]["get"]>>): ExtensionView["generation"] {
  const g = rec.generation;
  if (!g || !rec.outline) return null;
  const titles = rec.outline.chapters.flatMap((c) => c.lessons.map((l) => l.title));
  const done = db.aiAvailable() ? Math.min(g.total, Math.floor((Date.now() - g.startedAt) / GENERATION_STEP_MS)) : 0;
  return { total: g.total, done, state: done >= g.total ? "done" : "running", current: titles[done] ?? null, error: null };
}

// ---------- handlers ----------

export const handlers: Handlers = {
  health: (_, db) => ({ ok: true, migrated: true, runner: { connected: db.aiAvailable(), lastSeen: Date.now() } }),

  job: ({ params }, db) => {
    const ready = db.jobs.get(params.id);
    return {
      id: params.id, kind: params.id.startsWith("job-ext") ? ("outline" as const) : ("chat" as const), error: null,
      status: !db.aiAvailable() ? ("pending" as const) : ready === undefined || Date.now() >= ready ? ("done" as const) : ("running" as const),
    };
  },

  dashboard: (_, db) => {
    const cur = currentLessonId(db);
    const idx = cur ? LESSON_ORDER.indexOf(cur) : -1;
    const nextId = idx >= 0 ? LESSON_ORDER[idx + 1] : undefined;
    const chapter = CHAPTERS.find((c) => (c.lessons as readonly string[]).includes(cur ?? ""));
    const spot = (concept: string, percent: number, lessonId: string) => ({ concept, percent, course: TS, lesson: lessonRef(lessonId) });
    return {
      continue: cur && chapter
        ? { course: TS, lesson: lessonRef(cur), lessonNumber: idx + 1, lessonTotal: LESSON_ORDER.length, chapterTitle: chapter.title, minutes: LESSONS[cur]!.minutes, progress: progressOf(db), upNext: nextId ? lessonRef(nextId) : null }
        : null,
      week: {
        streakDays: 12, studiedMinutes: 220, questionsAnswered: 41,
        days: ["M", "T", "W", "T", "F", "S", "S"].map((label, i) => ({ label, minutes: [35, 50, 0, 45, 60, 20, 10][i]!, today: i === (new Date().getDay() + 6) % 7 })),
      },
      activity: activityGrid(),
      weakSpots: [spot("user-defined type guards", 38, "l06"), spot("discriminated unions", 56, "l05"), spot("structural typing", 61, "l01")],
      pendingGrading: pendingGradingCount(db),
      courses: [tsSummary(db), ...OTHER_COURSES.map(otherSummary)],
    };
  },

  courses: (_, db) => ({
    courses: [tsSummary(db), ...OTHER_COURSES.map(otherSummary)],
  }),

  course: ({ params }, db) => {
    requireTs(params.courseId);
    const cur = currentLessonId(db);
    return {
      ...tsSummary(db), description: TS_DESCRIPTION, level: "Level 1 · Beginner", tags: ["typescript", "programming"],
      progress: progressOf(db), chapters: outline(db), exams: examRows(db),
      resume: cur ? lessonRef(cur) : null,
      source: { repo: "github.com/example/selfschool-courses", sha: "a3f9c21", sourceCount: SOURCES.length },
    };
  },

  proposeExtension: ({ params, body }, db) => {
    requireTs(params.courseId);
    const extensionId = `ext-${++db.seq}`;
    const jobId = `job-ext-${db.seq}`;
    const now = Date.now();
    db.jobs.set(jobId, now + 4000);
    const from = body.fromLessonId ? LESSONS[body.fromLessonId] : undefined;
    db.extensions.set(extensionId, {
      id: extensionId, jobId, createdAt: now, readyAt: now + 4000, decision: null, outline: null, decidedAt: null,
      budgetMinutes: body.budgetMinutes ?? DEFAULT_DEPTH_MINUTES,
      seed: {
        ...(body.topic ? { topic: body.topic } : {}), ...(body.question ? { question: body.question } : {}),
        ...(body.answer ? { answer: body.answer } : {}), ...(from ? { fromLesson: lessonRef(body.fromLessonId!) } : {}),
      },
    });
    return { extensionId, jobId };
  },
  extensions: ({ params }, db) => {
    requireTs(params.courseId);
    return { extensions: [...db.extensions.values()].sort((a, b) => b.createdAt - a.createdAt).map((e) => extensionView(db, e.id)) };
  },
  extension: ({ params }, db) => extensionView(db, params.extensionId),
  redraftExtension: ({ params, body }, db) => {
    const rec = db.extensions.get(params.extensionId);
    const cur = extensionView(db, params.extensionId);
    if (!rec || (cur.status !== "ready" && cur.status !== "failed")) throw new ApiError(409, `extension is ${cur.status}, cannot be drafted again`);
    const jobId = `job-ext-${++db.seq}`;
    db.jobs.set(jobId, Date.now() + 3000);
    Object.assign(rec, { jobId, budgetMinutes: body.budgetMinutes, readyAt: Date.now() + 3000, outline: null });
    return { jobId };
  },
  decideExtension: ({ params, body }, db) => {
    const rec = db.extensions.get(params.extensionId);
    const cur = extensionView(db, params.extensionId);
    if (!rec || cur.status !== "ready") throw new ApiError(409, `extension is ${cur.status}, not ready for a decision`);
    rec.decision = body.decision === "approve" ? "approved" : "rejected";
    rec.decidedAt = Date.now();
    if (body.decision === "approve") rec.outline = outlineResultSchema.parse(body.outline);
    return extensionView(db, params.extensionId);
  },
  generateExtension: ({ params }, db) => {
    const rec = db.extensions.get(params.extensionId);
    const ext = extensionView(db, params.extensionId);
    if (!rec || ext.status !== "approved" || !ext.outline) throw new ApiError(409, `extension is ${ext.status}, approve the outline first`);
    if (ext.generation) throw new ApiError(409, "generation has already started for this proposal");
    rec.generation = { startedAt: Date.now(), total: ext.outline.chapters.reduce((n, c) => n + c.lessons.length, 0) };
    return { jobId: `job-gen-${++db.seq}` };
  },
  resumeExtension: () => {
    throw new ApiError(409, "nothing to resume");
  },
  extensionBrief: ({ params }, db) => {
    const ext = extensionView(db, params.extensionId);
    if (ext.status !== "approved" || !ext.outline) throw new ApiError(409, `extension is ${ext.status}, approve the outline first`);
    if (ext.generation) throw new ApiError(409, "lessons are already being generated for this proposal");
    return {
      markdown: buildBrief({
        course: { id: TS.id, title: TS.title, description: TS_DESCRIPTION },
        chapters: CHAPTERS.map((c) => ({ dir: c.dir, title: c.title, level: 1, lessons: c.lessons.map((id) => lessonRef(id)) })),
        quizIds: ["q06"],
        lastSourceNumber: EXTENSION_SOURCE_BASE - 1,
        weakSpots: [{ concept: "user-defined type guards", percent: 38, lesson: "Type guards" }],
        outline: ext.outline,
        budgetMinutes: ext.budgetMinutes,
        seed: { topic: ext.seed.topic, question: ext.seed.question },
      }),
    };
  },

  lesson: ({ params }, db) => {
    requireTs(params.courseId);
    const l = LESSONS[params.lessonId];
    if (!l) throw notFound("lesson");
    const idx = LESSON_ORDER.indexOf(params.lessonId);
    const chapters = outline(db);
    const chapter = CHAPTERS.find((c) => (c.lessons as readonly string[]).includes(params.lessonId))!;
    const exam = EXAMS.find((e) => e.after === chapter.dir);
    const body = lessonBody(params.lessonId);
    const prev = LESSON_ORDER[idx - 1];
    const next = LESSON_ORDER[idx + 1];
    return {
      course: TS, chapterTitle: chapter.title, lesson: lessonRef(params.lessonId), number: idx + 1, total: LESSON_ORDER.length,
      revision: l.revision, minutes: l.minutes, level: 1, origin: "researched" as const, ...body, sources: SOURCES,
      resources: [{ name: "narrowing-cheatsheet.md", url: "/api/resources/narrowing-cheatsheet.md" }],
      prev: prev ? lessonRef(prev) : null, next: next ? lessonRef(next) : null,
      quiz: params.lessonId === "l06" ? { id: QUIZ.id, title: QUIZ.title, questionCount: QUIZ_QUESTION_IDS.length } : null,
      completed: db.completed.has(params.lessonId), progress: progressOf(db), chapters,
      exam: exam ? (examRows(db).find((r) => r.id === exam.id) ?? null) : null,
      ai: { available: db.aiAvailable() },
      answerCount: db.chat.filter((r) => r.msg.role === "assistant").length,
      languages: ["en"],
    };
  },

  completeLesson: ({ params }, db) => {
    requireTs(params.courseId);
    if (!LESSONS[params.lessonId]) throw notFound("lesson");
    db.completed.add(params.lessonId);
    return { completed: true as const, revision: LESSONS[params.lessonId]!.revision, progress: progressOf(db) };
  },

  chat: ({ params }, db) => {
    requireTs(params.courseId);
    return { ai: { available: db.aiAvailable() }, unverified: false, messages: chatMessages(db) };
  },

  ask: ({ params, body }, db) => {
    requireTs(params.courseId);
    const now = Date.now();
    const jobId = `job-chat-${++db.seq}`;
    db.jobs.set(jobId, now + 1500);
    const user: ChatMessage = { id: ++db.seq, role: "user", content: body.selection ? `“${body.selection}”\n\n${body.question}` : body.question, covered: null, citations: [], status: "done", jobId: null, createdAt: now };
    const assistant: ChatMessage = { id: ++db.seq, role: "assistant", content: "", covered: null, citations: [], status: "pending", jobId, createdAt: now };
    db.chat.push({ msg: user }, { msg: assistant, readyAt: now + 1500, question: body.question });
    return { user, assistant };
  },

  quiz: ({ params }, db) => {
    requireTs(params.courseId);
    if (params.quizId !== QUIZ.id) throw notFound("quiz");
    const n = [...db.attempts.values()].filter((a) => a.kind === "quiz" && a.targetId === QUIZ.id).length;
    return {
      course: TS, lesson: lessonRef("l06"),
      quiz: { id: QUIZ.id, title: QUIZ.title, passingPercentage: QUIZ.passingPercentage, maxAttempts: 0, showAnswers: true },
      attemptNumber: n + 1,
      questions: QUIZ_QUESTION_IDS.map((q) => learnerQuestion(BANK[q]!)),
      progress: progressOf(db),
    };
  },

  startQuizAttempt: ({ params }, db) => {
    requireTs(params.courseId);
    if (params.quizId !== QUIZ.id) throw notFound("quiz");
    return { attemptId: newQuizAttempt(db, QUIZ.title, QUIZ.id).id };
  },

  exam: ({ params }, db) => {
    requireTs(params.courseId);
    const row = examRows(db).find((r) => r.id === params.examId);
    if (!row) throw notFound("exam");
    const atts = [...db.attempts.values()].filter((a) => a.kind === "exam" && a.targetId === params.examId).sort((a, b) => a.number - b.number);
    const last = atts.at(-1);
    return {
      course: TS, exam: row, domains: DOMAINS,
      attempts: last ? attemptView(db, last).history : [],
      latestAttemptId: last?.id ?? null,
    };
  },

  startExam: ({ params }, db) => {
    requireTs(params.courseId);
    return examInstanceView(db, createInstance(db, params.examId, false).id);
  },

  regenerateExam: ({ params }, db) => {
    requireTs(params.courseId);
    const inst = createInstance(db, params.examId, true);
    return { instance: examInstanceView(db, inst.id), drawn: { fromBank: 24, generating: 6 }, jobId: null };
  },

  examInstance: ({ params }, db) => examInstanceView(db, params.instanceId),

  attempts: (_, db) => ({
    attempts: [...db.attempts.values()]
      .map((a) => {
        const v = attemptView(db, a);
        return { id: a.id, kind: a.kind, course: v.course, targetId: a.targetId, title: a.title, number: a.number, date: a.finishedAt ?? a.startedAt, percent: v.score.percent, status: statusOf(db, a), pendingCount: v.score.pendingCount };
      })
      .sort((x, y) => y.date - x.date),
  }),

  attempt: ({ params }, db) => attemptView(db, getAttempt(db, params.attemptId)),

  deleteAttempt: ({ params }, db) => {
    getAttempt(db, params.attemptId);
    db.attempts.delete(params.attemptId);
    return { deleted: true as const };
  },

  submitAnswer: ({ params, body }, db) => {
    const att = getAttempt(db, params.attemptId);
    if (!att.questionIds.includes(params.questionId)) throw notFound("question in this attempt");
    if (att.finishedAt !== null) throw new ApiError(409, "attempt already finished");
    const type = BANK[params.questionId]!.type;
    if (body.type !== type) throw new ApiError(400, `expected a ${type} answer`);
    att.answers[params.questionId] = {
      input: body,
      ...(type === "open" ? { gradeAt: Date.now() + 3000, jobId: `job-grade-${++db.seq}` } : {}),
    };
    return answerView(db, att, params.questionId)!;
  },

  finishAttempt: ({ params }, db) => {
    const att = getAttempt(db, params.attemptId);
    att.finishedAt ??= Date.now();
    return attemptView(db, att);
  },

  reportQuestion: ({ params }, db) => {
    db.reported.add(params.questionId);
    return { retired: true as const };
  },

  settings: (_, db) => ({
    models: db.models,
    modelOptions: { grade: ["haiku", "sonnet"], chat: ["haiku", "sonnet"], generate: ["sonnet", "opus"], verify: ["sonnet", "opus"], outline: ["sonnet", "opus"], lesson: ["sonnet", "opus"] },
    runner: { connected: db.aiAvailable(), lastSeen: db.aiAvailable() ? Date.now() - 4000 : null },
    provider: { name: "Claude Code CLI", detail: db.aiAvailable() ? "logged in" : "not running" },
    database: { sizeBytes: 482_816 },
  }),

  updateSettings: ({ body }, db) => {
    db.models = { ...db.models, ...Object.fromEntries(Object.entries(body.models).filter(([, v]) => v !== undefined)) } as typeof db.models;
    return handlers.settings({}, db) as RouteResponse<"settings">;
  },

  packages: (_, db) => ({
    packages: [
      ...db.packages,
      { id: "pkg-aws", course: OTHER_COURSES[0].course, language: "en", translations: [], url: "github.com/friend/aws-saa", path: "", ref: "main", sha: "91be0d4", status: "update_available" as const, latestSha: "c07d2aa" },
    ],
  }),

  addPackage: ({ body }, db) => {
    const pkg = {
      id: `pkg-${++db.seq}`, course: { id: "new-course", title: "New course", monogram: "NC", hue: "pink" as const },
      language: "en", translations: [] as string[],
      url: body.url, path: body.path ?? "", ref: body.ref ?? "main", sha: "0000000", status: "up_to_date" as const, latestSha: null,
    };
    db.packages.push(pkg as (typeof db.packages)[number]);
    return pkg;
  },
};
