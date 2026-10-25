import { z } from "zod";
import { jobKindSchema, jobStatusSchema } from "./jobs.js";

// Row shapes of the tables in plan.md section 5 (camelCase, as returned by the API's Drizzle layer).
// Timestamps are unix milliseconds.

export const packageRowSchema = z.object({
  id: z.string(),
  url: z.string(),
  path: z.string(),
  ref: z.string(),
  fetchedAt: z.number().int(),
  schemaVersion: z.number().int(),
});
export type PackageRow = z.infer<typeof packageRowSchema>;

export const lessonRevisionRowSchema = z.object({
  id: z.number().int(),
  packageId: z.string(),
  lessonId: z.string(),
  contentHash: z.string(),
  revision: z.number().int(),
  createdAt: z.number().int(),
});
export type LessonRevisionRow = z.infer<typeof lessonRevisionRowSchema>;

export const completionRowSchema = z.object({
  id: z.number().int(),
  packageId: z.string(),
  lessonId: z.string(),
  revision: z.number().int(),
  completedAt: z.number().int(),
});
export type CompletionRow = z.infer<typeof completionRowSchema>;

export const attemptRowSchema = z.object({
  id: z.string(),
  packageId: z.string(),
  kind: z.enum(["quiz", "exam"]),
  quizId: z.string().nullable(),
  examInstanceId: z.string().nullable(),
  startedAt: z.number().int(),
  finishedAt: z.number().int().nullable(),
  score: z.number().nullable(),
});
export type AttemptRow = z.infer<typeof attemptRowSchema>;

export const attemptAnswerRowSchema = z.object({
  id: z.number().int(),
  attemptId: z.string(),
  questionId: z.string(),
  answer: z.unknown(),
  correct: z.boolean().nullable(),
  marks: z.number().nullable(),
  grader: z.enum(["local", "ai"]),
  feedback: z.string().nullable(),
  jobId: z.string().nullable(),
});
export type AttemptAnswerRow = z.infer<typeof attemptAnswerRowSchema>;

export const xpEventRowSchema = z.object({
  id: z.number().int(),
  at: z.number().int(),
  amount: z.number().int(),
  reason: z.string(),
  ref: z.string().nullable(),
});
export type XpEventRow = z.infer<typeof xpEventRowSchema>;

export const questionRowSchema = z.object({
  id: z.string(),
  packageId: z.string(),
  contentHash: z.string(),
  type: z.enum(["mcq", "short", "open", "fill", "sort", "spot", "hotspot", "match", "trace"]),
  payload: z.unknown(),
  concepts: z.array(z.string()),
  difficulty: z.number().int().nullable(),
  sources: z.array(z.number().int()),
  origin: z.enum(["authored", "generated"]),
  status: z.enum(["active", "retired", "unverified"]),
});
export type QuestionRow = z.infer<typeof questionRowSchema>;

export const examInstanceRowSchema = z.object({
  id: z.string(),
  packageId: z.string(),
  examId: z.string(),
  createdAt: z.number().int(),
  /** Frozen snapshot: full question payload copies, so bank changes never alter a taken exam. */
  questions: z.array(z.unknown()),
});
export type ExamInstanceRow = z.infer<typeof examInstanceRowSchema>;

export const jobRowSchema = z.object({
  id: z.string(),
  kind: jobKindSchema,
  payload: z.unknown(),
  status: jobStatusSchema,
  result: z.unknown().nullable(),
  error: z.string().nullable(),
  attempts: z.number().int(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type JobRow = z.infer<typeof jobRowSchema>;

export const chatMessageRowSchema = z.object({
  id: z.number().int(),
  packageId: z.string(),
  lessonId: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  citations: z.array(z.unknown()),
  jobId: z.string().nullable(),
  createdAt: z.number().int(),
});
export type ChatMessageRow = z.infer<typeof chatMessageRowSchema>;
