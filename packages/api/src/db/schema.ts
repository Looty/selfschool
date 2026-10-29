import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { JobKind, JobStatus } from "@selfschool/shared";

// Tables from plan.md section 5. Timestamps are unix ms. JSON columns use text mode json.

export const packages = sqliteTable("package", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  path: text("path").notNull().default(""),
  ref: text("ref").notNull(),
  fetchedAt: integer("fetched_at").notNull(),
  schemaVersion: integer("schema_version").notNull(),
  /** Git commit for fetched packages; content hash prefix for packages found on disk. */
  sha: text("sha").notNull().default(""),
});

/** Key/value app settings (JSON values), e.g. `models`. */
export const settings = sqliteTable("setting", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
});

/** A proposed Level 2 extension: drafted by an `outline` job, then approved (outline kept) or rejected. */
export const extensions = sqliteTable("extension", {
  id: text("id").primaryKey(),
  packageId: text("package_id").notNull().references(() => packages.id),
  status: text("status", { enum: ["drafting", "ready", "failed", "approved", "rejected"] }).notNull(),
  seed: text("seed", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  budgetMinutes: integer("budget_minutes").notNull().default(60),
  jobId: text("job_id"),
  error: text("error"),
  outline: text("outline", { mode: "json" }).$type<unknown>(),
  /** "Generate here": the assigned ids and files, fixed when generation starts, with a done flag per lesson. */
  plan: text("plan", { mode: "json" }).$type<unknown>(),
  /** The lesson job currently in flight (or the one that failed) for `plan`. */
  generationJobId: text("generation_job_id"),
  createdAt: integer("created_at").notNull(),
  decidedAt: integer("decided_at"),
});

export const lessonRevisions = sqliteTable(
  "lesson_revision",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    packageId: text("package_id").notNull().references(() => packages.id),
    lessonId: text("lesson_id").notNull(),
    contentHash: text("content_hash").notNull(),
    revision: integer("revision").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("lesson_revision_uq").on(t.packageId, t.lessonId, t.revision)],
);

export const completions = sqliteTable(
  "completion",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    packageId: text("package_id").notNull().references(() => packages.id),
    lessonId: text("lesson_id").notNull(),
    revision: integer("revision").notNull(),
    completedAt: integer("completed_at").notNull(),
  },
  (t) => [uniqueIndex("completion_uq").on(t.packageId, t.lessonId)],
);

export const examInstances = sqliteTable("exam_instance", {
  id: text("id").primaryKey(),
  packageId: text("package_id").notNull().references(() => packages.id),
  examId: text("exam_id").notNull(),
  createdAt: integer("created_at").notNull(),
  questions: text("questions", { mode: "json" }).$type<unknown[]>().notNull(),
});

export const attempts = sqliteTable("attempt", {
  id: text("id").primaryKey(),
  packageId: text("package_id").notNull().references(() => packages.id),
  kind: text("kind", { enum: ["quiz", "exam"] }).notNull(),
  quizId: text("quiz_id"),
  examInstanceId: text("exam_instance_id").references(() => examInstances.id),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at"),
  score: real("score"),
  /** Quiz id or exam id. */
  targetId: text("target_id").notNull().default(""),
  /** 1-based attempt number within (package, target). */
  number: integer("number").notNull().default(1),
});

export const jobs = sqliteTable(
  "job",
  {
    id: text("id").primaryKey(),
    kind: text("kind").$type<JobKind>().notNull(),
    payload: text("payload", { mode: "json" }).$type<unknown>().notNull(),
    /** Server-side routing info for applying the result (never sent to the runner). */
    ctx: text("ctx", { mode: "json" }).$type<Record<string, unknown>>(),
    status: text("status").$type<JobStatus>().notNull().default("pending"),
    result: text("result", { mode: "json" }).$type<unknown>(),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("job_status_created_idx").on(t.status, t.createdAt)],
);

export const attemptAnswers = sqliteTable(
  "attempt_answer",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    attemptId: text("attempt_id").notNull().references(() => attempts.id),
    questionId: text("question_id").notNull(),
    answer: text("answer", { mode: "json" }).$type<unknown>(),
    correct: integer("correct", { mode: "boolean" }),
    marks: real("marks"),
    /** `self`: an open answer the learner marked against the rubric; its grade job stays queued and an AI grade replaces the mark. */
    grader: text("grader", { enum: ["local", "ai", "self"] }).notNull(),
    /** JSON array of feedback points (AI-graded answers). */
    feedback: text("feedback"),
    jobId: text("job_id").references(() => jobs.id),
    answeredAt: integer("answered_at").notNull().default(0),
  },
  (t) => [uniqueIndex("attempt_answer_uq").on(t.attemptId, t.questionId)],
);

export const xpEvents = sqliteTable(
  "xp_event",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    at: integer("at").notNull(),
    amount: integer("amount").notNull(),
    reason: text("reason").notNull(),
    ref: text("ref"),
  },
  (t) => [uniqueIndex("xp_event_reason_ref_uq").on(t.reason, t.ref)],
);

export const questions = sqliteTable(
  "question",
  {
    id: text("id").primaryKey(),
    packageId: text("package_id").notNull().references(() => packages.id),
    contentHash: text("content_hash").notNull(),
    type: text("type", { enum: ["mcq", "short", "open", "fill", "sort", "spot", "hotspot", "match", "trace"] }).notNull(),
    payload: text("payload", { mode: "json" }).$type<unknown>().notNull(),
    concepts: text("concepts", { mode: "json" }).$type<string[]>().notNull(),
    difficulty: integer("difficulty"),
    sources: text("sources", { mode: "json" }).$type<number[]>().notNull(),
    origin: text("origin", { enum: ["authored", "generated"] }).notNull(),
    status: text("status", { enum: ["active", "retired", "unverified"] }).notNull(),
    /** Chapter dir, lesson and exam domain the question belongs to (for the exam draw and weak spots). */
    chapter: text("chapter"),
    lessonId: text("lesson_id"),
    domain: text("domain"),
    reportReason: text("report_reason"),
  },
  (t) => [uniqueIndex("question_hash_uq").on(t.packageId, t.contentHash)],
);

export const chatMessages = sqliteTable("chat_message", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  packageId: text("package_id").notNull().references(() => packages.id),
  lessonId: text("lesson_id").notNull(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  /** Assistant only: false = "not covered in this course". */
  covered: integer("covered", { mode: "boolean" }),
  citations: text("citations", { mode: "json" }).$type<unknown[]>().notNull(),
  jobId: text("job_id").references(() => jobs.id),
  createdAt: integer("created_at").notNull(),
});
