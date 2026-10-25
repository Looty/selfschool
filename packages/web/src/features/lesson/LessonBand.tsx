import { useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Lesson, LessonRef } from "@selfschool/shared";
import { CourseBand, cx } from "../../ui";
import { ContentsMenu } from "./ContentsMenu";
import { ChevronLeft, ChevronRight } from "./icons";

const iconBtn = "flex h-[34px] w-[34px] items-center justify-center rounded-control border border-border2 bg-bg text-text2";

/** `gate` replaces the destination (the lesson's quiz) while the next lesson is still locked. */
function Step({ courseId, to, label, gate, children }: { courseId: string; to: LessonRef | null; label: string; gate?: { href: string; hint: string }; children: ReactNode }) {
  if (to && gate) {
    return (
      <Link to={gate.href} aria-label={`${label}: ${gate.hint}`} title={gate.hint} className={iconBtn}>
        {children}
      </Link>
    );
  }
  if (!to) {
    return (
      <span aria-label={`${label} (none)`} role="img" className={cx(iconBtn, "opacity-40")}>
        {children}
      </span>
    );
  }
  return (
    <Link to={`/courses/${courseId}/lessons/${to.id}`} aria-label={`${label}: ${to.title}`} title={to.title} className={iconBtn}>
      {children}
    </Link>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

export function LessonBand({ lesson }: { lesson: Lesson }) {
  const group = useRef<HTMLSpanElement>(null);
  const chapterIdx = lesson.chapters.findIndex((c) => c.lessons.some((l) => l.id === lesson.lesson.id));
  const title = chapterIdx >= 0 ? `${chapterIdx + 1} · ${lesson.chapterTitle}` : lesson.chapterTitle;
  const chapter = lesson.origin === "quick" ? `${title} · Unverified` : title;

  return (
    <CourseBand
      course={lesson.course}
      subline={chapter}
      fade="lesson"
      maxWidth={1180}
      right={
        <>
          <span className="mr-1.5 font-mono text-[13px] text-text2" aria-label={`Lesson ${lesson.number} of ${lesson.total}`}>
            <span className="text-[22px] font-semibold tracking-[-0.02em] text-text">{pad(lesson.number)}</span> / {lesson.total}
          </span>
          <span ref={group} className="flex items-center gap-2.5">
            <ContentsMenu lesson={lesson} anchorRef={group} />
            <Step courseId={lesson.course.id} to={lesson.prev} label="Previous lesson">
              <ChevronLeft />
            </Step>
            <Step
              courseId={lesson.course.id}
              to={lesson.next}
              label="Next lesson"
              gate={lesson.quiz && !lesson.completed ? { href: `/courses/${lesson.course.id}/quizzes/${lesson.quiz.id}`, hint: "take the quiz first" } : undefined}
            >
              <ChevronRight />
            </Step>
          </span>
        </>
      }
    />
  );
}
