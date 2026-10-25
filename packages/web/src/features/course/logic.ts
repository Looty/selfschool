import { formatDuration, type ChapterOutline, type CourseDetail, type CourseTime, type ExamRow, type ExtensionView, type LessonRow } from "@selfschool/shared";

export type ChapterState = "complete" | "partial" | "untouched";

export function chapterState(c: Pick<ChapterOutline, "done" | "total">): ChapterState {
  if (c.total > 0 && c.done >= c.total) return "complete";
  return c.done > 0 ? "partial" : "untouched";
}

export interface LevelGroup {
  level: number;
  chapters: ChapterOutline[];
  done: number;
  total: number;
  minutes: number;
}

/** Chapters of level 1 (the core course) and, apart, each extension level with its own totals. */
export function splitLevels(chapters: readonly ChapterOutline[]): { core: ChapterOutline[]; extensions: LevelGroup[] } {
  const core = chapters.filter((c) => c.level === 1);
  const extensions = [...new Set(chapters.filter((c) => c.level > 1).map((c) => c.level))]
    .sort((a, b) => a - b)
    .map((level) => {
      const cs = chapters.filter((c) => c.level === level);
      return {
        level,
        chapters: cs,
        done: cs.reduce((n, c) => n + c.done, 0),
        total: cs.reduce((n, c) => n + c.total, 0),
        minutes: cs.reduce((n, c) => n + c.minutes, 0),
      };
    });
  return { core, extensions };
}

/**
 * An approved proposal whose lessons are not in the course yet, so the learner can find their way back to it.
 * Writing in progress or stopped always counts; an approved outline with nothing started (it may be going to the
 * deep path, which the app cannot see) counts only while the course has no extension chapters.
 */
export function waitingProposal(
  extensions: readonly Pick<ExtensionView, "id" | "status" | "generation">[],
  courseHasExtensionChapters: boolean,
): { id: string; label: string; action: string } | null {
  for (const e of extensions) {
    if (e.status !== "approved") continue;
    const g = e.generation;
    if (g?.state === "running") return { id: e.id, label: `Writing lessons · ${g.done} of ${g.total}`, action: "View progress" };
    if (g?.state === "failed") return { id: e.id, label: `Stopped after ${g.done} of ${g.total} lessons`, action: "Continue" };
    if (!g && !courseHasExtensionChapters) return { id: e.id, label: "Approved outline · lessons not written yet", action: "Get them written" };
  }
  return null;
}

/** Completed chapters start collapsed; the rest are open. */
export const defaultOpen = (c: Pick<ChapterOutline, "done" | "total">): boolean => chapterState(c) !== "complete";

export const chapterTitle = (index: number, title: string) => `${index + 1} · ${title}`;

export type LessonIcon = "check" | "current" | "todo";
export const lessonIcon = (l: Pick<LessonRow, "status">): LessonIcon => (l.status === "done" ? "check" : l.status === "current" ? "current" : "todo");

/** "UPDATED · REV 2" pill text, or null when the lesson has no newer revision for the learner. */
export const updatedLabel = (l: Pick<LessonRow, "updated" | "revision">): string | null => (l.updated ? `Updated · rev ${l.revision}` : null);

export const examMeta = (e: Pick<ExamRow, "questionCount" | "durationMinutes" | "passingPercentage">) =>
  `${e.questionCount} questions · ${e.durationMinutes} min · pass at ${e.passingPercentage}%`;

export type ExamPill = { tone: "neutral" | "ok" | "bad" | "warn"; text: string } | null;

/** Right-hand status of an exam row; null = plain "Not started" text. */
export function examPill(e: Pick<ExamRow, "status" | "attemptCount" | "pendingCount">): ExamPill {
  const n = e.attemptCount;
  switch (e.status) {
    case "not_started":
      return null;
    case "in_progress":
      return { tone: "neutral", text: `Attempt ${n} · in progress` };
    case "provisional":
      return { tone: "warn", text: `Attempt ${n} · ${e.pendingCount} pending` };
    case "passed":
      return { tone: "ok", text: `Passed · attempt ${n}` };
    case "failed":
      return { tone: "bad", text: `Failed · attempt ${n}` };
  }
}

export const heroMeta = (c: Pick<CourseDetail, "lessonCount" | "examCount" | "level" | "time">) =>
  `${c.lessonCount} ${c.lessonCount === 1 ? "lesson" : "lessons"} · ${c.examCount} ${c.examCount === 1 ? "exam" : "exams"} · ${formatDuration(c.time.totalMinutes)} · ${c.level}`;

/** "2 h 15 min left" (the total already sits in the hero). */
export const timeLeftLabel = (t: Pick<CourseTime, "remainingMinutes">) => `${formatDuration(t.remainingMinutes)} left`;

export const sourceLine = (s: CourseDetail["source"]) => `${s.repo} @ ${s.sha} · ${s.sourceCount} ${s.sourceCount === 1 ? "source" : "sources"}`;
