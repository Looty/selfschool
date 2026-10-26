import { useState, type CSSProperties } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ChapterOutline, CourseDetail, ExamRow } from "@selfschool/shared";
import { useCourse, useCourses, useExtensions, useProposeExtension, useSettings } from "../../api/hooks";
import { Badge, Button, Monogram, ProgressBar, SectionLabel, cx } from "../../ui";
import { formatDuration } from "@selfschool/shared";
import { languageName, readingLanguage, textDirection } from "../../api/language";
import { InlineMarkdown } from "../../components/InlineMarkdown";
import { LanguageSwitch } from "../../components/LanguageSwitch";
import { CourseCard } from "../dashboard/CourseCard";
import { plural } from "../dashboard/logic";
import { AiPausedNotice, Icon, PageError, PageLoading } from "../dashboard/shared";
import { chapterState, chapterTitle, defaultOpen, examMeta, examPill, heroMeta, lessonIcon, sourceLine, splitLevels, timeLeftLabel, updatedLabel, waitingProposal } from "./logic";

const WIDTH = 1120;
/** The designed width, scaled by Settings > Content width (see --content-scale in index.css). */
const MAX_WIDTH = `calc(${WIDTH}px * var(--content-scale, 1))`;

export default function CourseFeature() {
  const { courseId } = useParams();
  return courseId ? <CourseDetailScreen courseId={courseId} /> : <CourseList />;
}

// ---------- /courses ----------

function CourseList() {
  const q = useCourses();
  if (q.isPending) return <PageLoading what="courses" width={WIDTH} />;
  if (q.isError) return <PageError what="courses" error={q.error} onRetry={() => void q.refetch()} width={WIDTH} />;
  const courses = q.data.courses;
  return (
    <div className="mx-auto flex flex-col gap-6 px-7 pb-14 pt-7" style={{ maxWidth: MAX_WIDTH }}>
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text3">Library</div>
        <h1 className="m-0 mt-1 text-[30px] font-semibold leading-[1.2] tracking-[-0.02em]">Courses</h1>
      </div>
      <section aria-label="All courses" className="flex flex-col gap-4">
        <SectionLabel>{plural(courses.length, "course")}</SectionLabel>
        <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))" }}>
          {courses.map((c) => (
            <CourseCard key={c.id} course={c} />
          ))}
          <div className="flex min-h-[188px] flex-col items-start justify-center gap-2 rounded-card border border-dashed border-border2 p-5">
            <span className="font-semibold">{courses.length === 0 ? "No courses yet" : "Add a course"}</span>
            <span className="text-[13px] text-text3">From a package: repo URL, path and ref.</span>
            <Button to="/settings#packages">Add package</Button>
          </div>
        </div>
      </section>
    </div>
  );
}

// ---------- /courses/:courseId ----------

function CourseDetailScreen({ courseId }: { courseId: string }) {
  const q = useCourse(courseId);
  const settings = useSettings();
  if (q.isPending) return <PageLoading what="course" width={WIDTH} />;
  if (q.isError) return <PageError what="this course" error={q.error} onRetry={() => void q.refetch()} width={WIDTH} />;
  const paused = settings.data ? !settings.data.runner.connected : false;
  return <CourseView course={q.data} paused={paused} />;
}

export function CourseView({ course, paused }: { course: CourseDetail; paused: boolean }) {
  const levels = splitLevels(course.chapters);
  return (
    <div data-hue={course.hue}>
      <div
        className="dot-grid relative border-b border-border"
        style={{ "--dot-opacity": 0.4, "--dot-mask": "linear-gradient(90deg, transparent 55%, #000 85%)" } as CSSProperties}
      >
        <div className="relative mx-auto flex flex-col gap-[18px] px-7 pb-[30px] pt-[22px]" style={{ maxWidth: MAX_WIDTH }}>
          <nav aria-label="Breadcrumb" className="text-[13px] text-text2">
            <Link to="/courses" className="no-underline">
              Courses
            </Link>{" "}
            / <span aria-current="page">{course.title}</span>
          </nav>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="flex min-w-0 flex-[1_1_480px] items-start gap-5">
              <Monogram text={course.monogram} size={44} />
              <div className="min-w-0" dir={textDirection(readingLanguage(course))}>
                <h1 className="m-0 text-[32px] font-semibold leading-[1.15] tracking-[-0.025em]">{course.title}</h1>
                {course.description ? <p className="m-0 mt-2 max-w-[128ch] text-[15px] text-text2"><InlineMarkdown text={course.description} /></p> : null}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="text-right font-mono text-xs uppercase tracking-[0.06em] text-hue-ink">{heroMeta(course)}</div>
              {course.translations.length > 0 ? (
                <LanguageSwitch languages={[course.language, ...course.translations]} current={readingLanguage(course)} />
              ) : (
                <span className="text-xs text-text3">{languageName(course.language)} only</span>
              )}
            </div>
          </div>
        </div>
        <ProgressBar rail value={course.progress.percent} label="Course progress" className="absolute inset-x-0 bottom-0 rounded-none" />
      </div>

      <div className="mx-auto flex flex-wrap items-start gap-8 px-7 pb-14 pt-7" style={{ maxWidth: MAX_WIDTH }}>
        <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-5">
          {course.chapters.length === 0 ? (
            <p className="m-0 rounded-card border border-dashed border-border2 p-5 text-text2">This course has no lessons yet.</p>
          ) : (
            levels.core.map((ch, i) => <Chapter key={ch.dir} index={i} chapter={ch} courseId={course.id} />)
          )}
          <Exams exams={course.exams} courseId={course.id} />
          {levels.extensions.map((group) => (
            <section key={group.level} aria-label={`Level ${group.level}`} className="flex flex-col gap-3 pt-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-border2 pb-2">
                <h2 className="m-0 font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-text3">Level {group.level} · Extension</h2>
                <span className="font-mono text-xs text-text3">
                  {group.done} / {group.total} · {formatDuration(group.minutes)}
                </span>
              </div>
              {group.chapters.map((ch, i) => (
                <Chapter key={ch.dir} index={levels.core.length + i} chapter={ch} courseId={course.id} />
              ))}
            </section>
          ))}
        </div>
        <Aside course={course} paused={paused} />
      </div>
    </div>
  );
}

function Chapter({ chapter, index, courseId }: { chapter: ChapterOutline; index: number; courseId: string }) {
  const [open, setOpen] = useState(defaultOpen(chapter));
  const state = chapterState(chapter);
  const panelId = `chapter-${chapter.dir}`;
  return (
    <section aria-label={chapterTitle(index, chapter.title)} className="overflow-hidden rounded-card border border-border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={cx("flex w-full cursor-pointer items-center justify-between gap-3 border-0 bg-surface px-4 py-3 text-left font-[inherit] text-text", open && "border-b border-solid border-border")}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="font-semibold">{chapterTitle(index, chapter.title)}</span>
          {chapter.origin === "quick" ? <Badge tone="warn">Unverified</Badge> : null}
        </span>
        <span className={cx("flex items-center gap-1.5 font-mono text-xs", state === "complete" ? "text-ok" : "text-text2")}>
          {state === "complete" ? (
            <>
              <Icon name="check" />
              <span className="sr-only">Chapter complete</span>
            </>
          ) : null}
          <span className="text-text3 max-sm:hidden">{formatDuration(chapter.minutes)}</span>
          {chapter.done} / {chapter.total}
          <Icon name="chevron" className={cx("transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open ? (
        <ul id={panelId} className="m-0 list-none p-0">
          {chapter.lessons.map((l, li) => {
            const icon = lessonIcon(l);
            const upd = updatedLabel(l);
            const current = l.status === "current";
            return (
              <li key={l.id} className={cx(li < chapter.lessons.length - 1 && "border-b border-border")}>
                <Link
                  to={`/courses/${courseId}/lessons/${l.id}`}
                  aria-current={current ? "step" : undefined}
                  className={cx("flex items-center gap-3 px-4 py-3 text-text no-underline", current && "bg-hue-bg")}
                >
                  <span className={cx("flex", icon === "check" && "text-ok", icon === "current" && "text-hue-ink", icon === "todo" && "text-text3")}>
                    <Icon name={icon} />
                  </span>
                  <span className="sr-only">{l.status === "done" ? "Done:" : l.status === "current" ? "Current:" : "Not started:"}</span>
                  <span className={cx("min-w-0 grow", current && "font-medium")}>{l.title}</span>
                  {upd ? <Badge tone="hue">{upd}</Badge> : null}
                  {l.quiz ? (
                    <span className="font-mono text-xs text-text3">
                      <span className="sr-only">Has a quiz: </span>
                      Quiz · {l.quiz.questionCount} {l.quiz.questionCount === 1 ? "question" : "questions"}
                    </span>
                  ) : null}
                  {current ? <span className="font-mono text-xs text-hue-ink">CURRENT</span> : null}
                  <span className={cx("font-mono text-xs", current ? "text-text2" : "text-text3")}>{l.minutes} min</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function Exams({ exams, courseId }: { exams: ExamRow[]; courseId: string }) {
  if (exams.length === 0) return null;
  return (
    <section aria-label="Exams" className="overflow-hidden rounded-card border border-border">
      <h2 className="m-0 border-b border-border bg-surface px-4 py-3 text-sm font-semibold">Exams</h2>
      <ul className="m-0 list-none p-0">
        {exams.map((e, i) => {
          const pill = examPill(e);
          return (
            <li key={e.id} className={cx(i < exams.length - 1 && "border-b border-border")}>
              <Link to={`/courses/${courseId}/exams/${e.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-text no-underline">
                <span className={cx("min-w-0 grow", !pill && "text-text2")}>
                  {e.title}
                  <span className="block text-xs text-text3">{examMeta(e)}</span>
                </span>
                {pill ? <Badge tone={pill.tone}>{pill.text}</Badge> : <span className="text-xs text-text3">Not started</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Aside({ course, paused }: { course: CourseDetail; paused: boolean }) {
  const { progress, resume } = course;
  const propose = useProposeExtension();
  const navigate = useNavigate();
  const proposals = useExtensions(course.id);
  // an unfinished proposal is picked up again instead of starting a second one
  const open = proposals.data?.extensions.find((e) => e.status === "drafting" || e.status === "ready");
  const reviewHref = (id: string) => `/courses/${course.id}/extensions/${id}`;
  const waiting = waitingProposal(proposals.data?.extensions ?? [], course.chapters.some((c) => c.level >= 2));
  const busy = propose.isPending;
  return (
    <aside className="flex min-w-0 max-w-[320px] flex-[1_1_260px] flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-card border border-border p-[18px]">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text3">Progress</span>
          <span className="font-mono text-xs">
            {progress.done} / {progress.total} · {Math.round(progress.percent)}%
          </span>
        </div>
        <ProgressBar value={progress.percent} label="Course progress" />
        {course.time.remainingMinutes > 0 ? <div className="text-xs text-text3">{timeLeftLabel(course.time)}</div> : null}
        {resume ? (
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text3">Up next</span>
              <span className="text-[15px] font-medium leading-snug">{resume.title}</span>
            </div>
            <Button variant="primary" size="lg" to={`/courses/${course.id}/lessons/${resume.id}`} className="w-full">
              Resume lesson
              <Icon name="arrow" />
            </Button>
          </div>
        ) : (
          <div className="flex h-10 items-center justify-center rounded-button bg-ok-bg text-sm font-medium text-ok">
            {progress.total === 0 ? "No lessons yet" : "All lessons complete"}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-card border border-dashed border-border2 p-[18px]">
        <span className="font-semibold">Level 2 · Deep dive</span>
        <span className="text-[13px] text-text2">
          Claude proposes chapters from your weak spots. You choose the depth and approve the outline, then get the lessons written.
        </span>
        {paused ? <AiPausedNotice>AI is paused. Proposals resume when you start the runner with `school up`.</AiPausedNotice> : null}
        {waiting ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-accent-soft px-3 py-2 text-[13px]">
            <span className="text-text">{waiting.label}</span>
            <Button size="sm" to={reviewHref(waiting.id)}>
              {waiting.action}
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {open ? (
            <Button size="sm" to={reviewHref(open.id)}>
              {open.status === "ready" ? "Review outline" : "View draft"}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={paused || busy}
              onClick={() => propose.mutate({ params: { courseId: course.id }, body: {} }, { onSuccess: (r) => navigate(reviewHref(r.extensionId)) })}
            >
              {busy ? "Proposing…" : "Propose topics"}
            </Button>
          )}
        </div>
        {propose.isError ? (
          <p role="alert" className="m-0 text-[13px] text-bad">
            Proposal failed: {propose.error.message}
          </p>
        ) : null}
      </div>

      <div className="break-words font-mono text-[11px] text-text3">{sourceLine(course.source)}</div>
    </aside>
  );
}
