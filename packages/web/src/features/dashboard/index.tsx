import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ContinueCard, Dashboard } from "@selfschool/shared";
import { useDashboard, useSettings } from "../../api/hooks";
import { Button, SectionLabel, cx } from "../../ui";
import { BackupNudge } from "./BackupNudge";
import { CourseCard } from "./CourseCard";
import {
  activeDays, barHeights, continueLabel, dateLabel, formatMinutes, heatColor, heatmapWeeks, plural, ringDash, weakSpotTone,
} from "./logic";
import { Icon, PageError, PageLoading } from "./shared";

export default function DashboardFeature() {
  const q = useDashboard();
  const settings = useSettings();
  if (q.isPending) return <PageLoading what="dashboard" />;
  if (q.isError) return <PageError what="the dashboard" error={q.error} onRetry={() => void q.refetch()} />;
  const paused = settings.data ? !settings.data.runner.connected : false;
  return <DashboardView data={q.data} paused={paused} />;
}

export function DashboardView({ data, paused, now = new Date() }: { data: Dashboard; paused: boolean; now?: Date }) {
  const hue = data.continue?.course.hue ?? data.courses.find((c) => c.started)?.hue ?? "blue";
  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-7 px-7 pb-14 pt-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text3">{dateLabel(now)}</div>
          <h1 className="m-0 mt-1 text-[30px] font-semibold leading-[1.2] tracking-[-0.02em]">Dashboard</h1>
        </div>
        {data.pendingGrading > 0 ? (
          <Link to="/attempts" className="flex items-center gap-2.5 rounded-button border border-border bg-warn-bg px-3.5 py-2 text-text no-underline">
            <span className="flex text-warn">
              <Icon name="clock" />
            </span>
            <span>
              {plural(data.pendingGrading, "answer")} awaiting grading{paused ? " · runner paused" : ""}
            </span>
            <span className="font-medium text-warn">View</span>
          </Link>
        ) : null}
      </div>

      <BackupNudge hasProgress={data.courses.some((c) => c.started)} />

      {data.continue ? <ContinueHero card={data.continue} /> : null}

      <div data-hue={hue} className="flex flex-wrap gap-10">
        <ThisWeek week={data.week} />
        <Heatmap activity={data.activity} />
        <WeakSpots spots={data.weakSpots} />
      </div>

      <section className="mt-1 flex flex-col gap-4" aria-label="Courses">
        <SectionLabel meta={<Link to="/courses" className="text-[13px] text-text2">All courses</Link>}>
          Courses · {String(data.courses.length).padStart(2, "0")}
        </SectionLabel>
        <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))" }}>
          {data.courses.map((c) => (
            <CourseCard key={c.id} course={c} />
          ))}
          <div className="flex min-h-[188px] flex-col items-start justify-center gap-2 rounded-card border border-dashed border-border2 p-5">
            <span className="font-semibold">Add a course</span>
            <span className="text-[13px] text-text3">From a package: repo URL, path and ref.</span>
            <Button to="/settings#packages">Add package</Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function ContinueHero({ card }: { card: ContinueCard }) {
  const { course, progress } = card;
  return (
    <section
      data-hue={course.hue}
      aria-label="Continue learning"
      className="dot-grid rounded-card border border-border px-8 py-7"
      style={{ "--dot-opacity": 0.45, "--dot-mask": "linear-gradient(90deg, transparent 55%, #000 85%)" } as CSSProperties}
    >
      <div className="relative flex flex-wrap items-center justify-between gap-6">
        <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-[18px]">
          <div>
            <div className="font-mono text-xs font-medium uppercase tracking-[0.08em] text-hue-ink">{continueLabel(course.monogram, card.lessonNumber)}</div>
            <h2 className="m-0 mt-2 text-[32px] font-semibold leading-[1.15] tracking-[-0.025em]">{card.lesson.title}</h2>
            <div className="mt-1.5 text-[15px] text-text2">
              {course.title} · {card.chapterTitle} · {card.minutes} min
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3.5">
            <Button variant="primary" size="lg" to={`/courses/${course.id}/lessons/${card.lesson.id}`}>
              Resume lesson
              <Icon name="arrow" />
            </Button>
            {card.upNext ? <span className="text-sm text-text2">Up next: {card.upNext.title}</span> : null}
          </div>
        </div>
        <ProgressRing percent={progress.percent} done={progress.done} total={progress.total} />
      </div>
    </section>
  );
}

function ProgressRing({ percent, done, total }: { percent: number; done: number; total: number }) {
  return (
    <svg width={116} height={116} viewBox="0 0 96 96" role="img" aria-label={`${Math.round(percent)} percent complete, ${done} of ${total} lessons`} className="mr-6 shrink-0">
      <circle cx={48} cy={48} r={46} style={{ fill: "var(--hue-bg)" }} />
      <circle cx={48} cy={48} r={42} fill="none" strokeWidth={7} style={{ stroke: "var(--bg)" }} />
      <circle
        cx={48} cy={48} r={42} fill="none" strokeWidth={7} strokeLinecap="round"
        strokeDasharray={ringDash(percent)} transform="rotate(-90 48 48)" style={{ stroke: "var(--hue)" }}
      />
      <text x={48} y={49} textAnchor="middle" style={{ fill: "var(--text)", fontSize: 21, fontWeight: 600, fontFamily: "var(--font-mono)" }}>
        {Math.round(percent)}%
      </text>
      <text x={48} y={65} textAnchor="middle" style={{ fill: "var(--text2)", fontSize: 9, fontFamily: "var(--font-mono)" }}>
        {done} / {total}
      </text>
    </svg>
  );
}

function Section({ label, meta, className, children }: { label: string; meta?: ReactNode; className: string; children: ReactNode }) {
  return (
    <section className={cx("flex min-w-0 flex-col gap-4", className)}>
      <SectionLabel meta={meta}>{label}</SectionLabel>
      {children}
    </section>
  );
}

function ThisWeek({ week }: { week: Dashboard["week"] }) {
  const heights = barHeights(week.days);
  return (
    <Section label="This week" meta={<span className="font-mono text-[11px]">{week.streakDays}-day streak</span>} className="flex-[1_1_260px]">
      <div className="flex items-baseline gap-2">
        <span className="text-[32px] font-semibold leading-none tracking-[-0.02em] [font-variant-numeric:tabular-nums]">{formatMinutes(week.studiedMinutes)}</span>
        <span className="text-xs text-text3">studied · {plural(week.questionsAnswered, "question")}</span>
      </div>
      <ul className="m-0 flex h-16 list-none items-end gap-2 p-0" aria-label="Minutes studied per day">
        {week.days.map((d, i) => (
          <li key={i} className="flex h-full flex-1 flex-col justify-end" title={`${d.label}: ${formatMinutes(d.minutes)}`}>
            <span className="sr-only">{`${d.label}: ${formatMinutes(d.minutes)}${d.today ? " (today)" : ""}`}</span>
            <div aria-hidden className="w-full rounded" style={{ height: `${heights[i]}%`, background: heatColor(d.today ? 4 : 2) }} />
          </li>
        ))}
      </ul>
      <div aria-hidden className="flex gap-2 font-mono text-[10px] text-text3">
        {week.days.map((d, i) => (
          <span key={i} className={cx("flex-1 text-center", d.today && "font-semibold text-text")}>
            {d.label}
          </span>
        ))}
      </div>
    </Section>
  );
}

function Heatmap({ activity }: { activity: Dashboard["activity"] }) {
  const weeks = heatmapWeeks(activity);
  return (
    <Section label="Activity" meta={<span className="font-mono text-[11px]">Last {weeks.length} weeks</span>} className="flex-[1_1_340px]">
      <div className="overflow-x-auto" tabIndex={0} role="group" aria-label={`Activity heatmap, ${activeDays(activity)} active days in the last ${weeks.length} weeks`}>
        <div className="grid w-max grid-flow-col gap-1" style={{ gridTemplateRows: "repeat(7, 16px)", gridAutoColumns: "16px" }}>
          {activity.map((c) => (
            <div key={c.date} title={`${c.date}: level ${c.level}`} className="h-4 w-4 rounded-[3px]" style={{ background: heatColor(c.level) }} />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1.5 font-mono text-[10px] text-text3" aria-hidden>
        Less
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className="h-3 w-3 rounded-[3px]" style={{ background: heatColor(l) }} />
        ))}
        More
      </div>
    </Section>
  );
}

function WeakSpots({ spots }: { spots: Dashboard["weakSpots"] }) {
  return (
    <Section label="Weak spots" meta={<span className="font-mono text-[11px]">From attempts</span>} className="flex-[1_1_300px]">
      {spots.length === 0 ? (
        <p className="m-0 text-[13px] text-text3">Nothing weak yet. Quiz and exam results show up here.</p>
      ) : (
        spots.map((s) => {
          const tone = weakSpotTone(s.percent);
          return (
            <Link key={`${s.course.id}/${s.lesson.id}/${s.concept}`} to={`/courses/${s.course.id}/lessons/${s.lesson.id}`} className="flex flex-col gap-1 text-text no-underline">
              <div className="flex justify-between gap-3 text-[13px]">
                <span>{s.concept}</span>
                <span className={cx("font-mono text-xs", tone === "bad" ? "text-bad" : "text-warn")}>{Math.round(s.percent)}%</span>
              </div>
              <div className="h-1 overflow-hidden rounded-[2px] bg-border" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.percent)} aria-label={`${s.concept} mastery`}>
                <div className={cx("h-full", tone === "bad" ? "bg-bad" : "bg-warn")} style={{ width: `${s.percent}%` }} />
              </div>
              <span className="text-xs text-text3">
                {s.course.title} · {s.lesson.title}
              </span>
            </Link>
          );
        })
      )}
    </Section>
  );
}
