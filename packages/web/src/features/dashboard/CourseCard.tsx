import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { formatDuration, type CourseSummary } from "@selfschool/shared";
import { Badge, Monogram, ProgressBar } from "../../ui";
import { courseCaption, plural } from "./logic";

/** Course tile: 92px cover (hue tint, dot grid, monogram), title, counts, progress. Used on the dashboard and the course list. */
export function CourseCard({ course }: { course: CourseSummary }) {
  return (
    <Link
      to={`/courses/${course.id}`}
      data-hue={course.hue}
      className="flex flex-col overflow-hidden rounded-card border border-border bg-bg text-text no-underline"
    >
      <div className="dot-grid h-[92px]" style={{ "--dot-opacity": 0.35 } as CSSProperties}>
        <Monogram text={course.monogram} size={28} className="absolute bottom-2.5 left-4" />
        {course.updated ? (
          <Badge tone="hue" className="absolute right-3 top-3 !bg-bg">
            Updated
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-col gap-3 px-4 pb-4 pt-3.5">
        <div>
          <div className="text-[15px] font-semibold leading-[1.35]">{course.title}</div>
          <div className="text-xs text-text3">
            {plural(course.lessonCount, "lesson")} · {plural(course.examCount, "exam")} · {formatDuration(course.time.totalMinutes)}
          </div>
        </div>
        <div>
          <ProgressBar value={course.percent} label={`${course.title} progress`} />
          <div className="mt-1.5 font-mono text-[11px] text-text2">{courseCaption(course)}</div>
        </div>
      </div>
    </Link>
  );
}
