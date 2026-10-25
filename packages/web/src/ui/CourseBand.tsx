import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { CourseRef } from "@selfschool/shared";
import { cx } from "./cx";
import { ProgressBar } from "./ProgressBar";

/** Where the dot grid fades in, per screen (docs/ui.md section 8.1). */
const MASK = {
  right: "linear-gradient(90deg, transparent 55%, #000 85%)", // dashboard, course
  lesson: "linear-gradient(90deg, transparent 30%, #000 50%, transparent 72%)",
  quiz: "linear-gradient(90deg, transparent 20%, #000 40%, transparent 60%)",
  exam: "linear-gradient(90deg, transparent 25%, #000 45%, transparent 65%)",
} as const;

export function Monogram({ text, size = 26, className }: { text: string; size?: number; className?: string }) {
  return (
    <span className={cx("font-mono font-semibold tracking-[-0.03em] text-hue", className)} style={{ fontSize: size, lineHeight: 1 }} aria-hidden>
      {text}
    </span>
  );
}

/**
 * Hue band at the top of course, lesson, quiz and exam pages: monogram, divider, course title link,
 * sub-line, a right slot (position, buttons) and an optional 3px progress rail on the bottom edge.
 * Sets data-hue, so descendants can use text-hue / bg-hue-bg / text-hue-ink.
 */
export function CourseBand({
  course,
  subline,
  right,
  progress,
  fade = "right",
  maxWidth = 1120,
  children,
}: {
  course: CourseRef;
  subline?: ReactNode;
  right?: ReactNode;
  /** 0..100; omit for no rail (exam). */
  progress?: number;
  fade?: keyof typeof MASK;
  /** Content width in px: course 1120, lesson 940, quiz 720, exam 880. */
  maxWidth?: number;
  /** Extra band content below the title row (course hero). */
  children?: ReactNode;
}) {
  return (
    <div data-hue={course.hue} className="dot-grid relative border-b border-border" style={{ "--dot-opacity": 0.4, "--dot-mask": MASK[fade] } as CSSProperties}>
      <div className="relative mx-auto flex flex-wrap items-center gap-4 px-7 py-4" style={{ maxWidth }}>
        <Monogram text={course.monogram} />
        <span className="h-[26px] w-px bg-hue opacity-35" aria-hidden />
        <div className="min-w-0 grow">
          <Link to={`/courses/${course.id}`} className="font-medium text-text no-underline">
            {course.title}
          </Link>
          {subline ? <div className="text-[13px] text-text2">{subline}</div> : null}
        </div>
        {right ? <div className="flex items-center gap-2 font-mono text-xs text-hue-ink">{right}</div> : null}
      </div>
      {children ? (
        <div className="relative mx-auto px-7 pb-6" style={{ maxWidth }}>
          {children}
        </div>
      ) : null}
      {progress !== undefined ? <ProgressBar rail value={progress} label="Course progress" className="absolute inset-x-0 bottom-0 rounded-none" /> : null}
    </div>
  );
}
