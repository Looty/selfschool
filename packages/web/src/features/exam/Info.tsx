import { useState } from "react";
import type { ExamInfo } from "@selfschool/shared";
import { Link, useNavigate } from "react-router-dom";
import { useExam, useStartExam } from "../../api/hooks";
import { Button, CourseBand, ProgressBar, cx } from "../../ui";
import { monoLabel } from "../quiz/inline";
import { ErrorPage, LoadingPage, Narrow, Notice, Page, errorMessage } from "../quiz/PageState";
import { STATUS_LABEL, STATUS_TONE, formatWhen, percentText, plural } from "./display";
import { panel, panelHead } from "./ResultParts";

export function ExamInfoPage({ courseId, examId }: { courseId: string; examId: string }) {
  const q = useExam(courseId, examId);
  if (q.isPending) return <LoadingPage width={880} label="Loading exam" />;
  if (q.isError || !q.data) {
    return <ErrorPage width={880} title="Could not load this exam" message={errorMessage(q.error)} onRetry={() => void q.refetch()} backTo={`/courses/${courseId}`} backLabel="Back to the course" />;
  }
  return <Info info={q.data} courseId={courseId} />;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex min-w-[120px] flex-1 flex-col gap-1">
      <dt className={monoLabel}>{label}</dt>
      <dd className="m-0 font-mono text-2xl font-semibold tracking-[-0.02em] tabular-nums">{value}</dd>
      {sub ? <div className="text-xs text-text3">{sub}</div> : null}
    </div>
  );
}

function Info({ info, courseId }: { info: ExamInfo; courseId: string }) {
  const { exam, course, domains, attempts } = info;
  const navigate = useNavigate();
  const start = useStartExam();
  const [error, setError] = useState<string | null>(null);
  const used = exam.attemptCount;
  const unlimited = exam.maxAttempts === 0;
  const exhausted = !unlimited && used >= exam.maxAttempts;
  const inProgress = exam.status === "in_progress";
  const totalWeight = domains.reduce((n, d) => n + d.weight, 0) || 1;

  async function begin() {
    setError(null);
    try {
      const inst = await start.mutateAsync({ params: { courseId, examId: exam.id } });
      navigate(`/courses/${courseId}/exams/${exam.id}/take/${inst.id}`);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Page>
      <CourseBand
        course={course}
        fade="exam"
        maxWidth={880}
        subline={exam.title}
        right={
          <span className="text-[13px] text-text2">
            ATTEMPTS <span className="text-[22px] font-semibold tracking-[-0.02em] text-text">{used}</span>
            {unlimited ? "" : ` / ${exam.maxAttempts}`}
          </span>
        }
      />
      <Narrow width={880}>
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em]">{exam.title}</h1>
          <p className="m-0 text-text2">Closed-book. Questions are drawn once and frozen for this sitting; the timer keeps running if you leave the page.</p>
        </div>

        <dl className={cx(panel, "m-0 flex flex-wrap gap-5 p-5")} aria-label="Exam blueprint">
          <Stat label="Duration" value={`${exam.durationMinutes} min`} />
          <Stat label="Questions" value={String(exam.questionCount)} />
          <Stat label="Pass mark" value={`${exam.passingPercentage}%`} />
          <Stat label="Attempts" value={unlimited ? String(used) : `${used} of ${exam.maxAttempts}`} sub={unlimited ? "unlimited" : exhausted ? "none left" : `${exam.maxAttempts - used} left`} />
        </dl>

        <section aria-label="Blueprint by domain" className={cx(panel, "flex flex-col gap-3 p-5")}>
          <div className={monoLabel}>Coverage by domain</div>
          {domains.map((d) => (
            <div key={d.id} className="flex flex-col gap-1">
              <div className="flex justify-between gap-3 text-[13px]">
                <span>{d.title}</span>
                <span className="font-mono text-xs tabular-nums">{percentText((d.weight / totalWeight) * 100)}</span>
              </div>
              <ProgressBar value={(d.weight / totalWeight) * 100} label={`${d.title} weight`} />
            </div>
          ))}
        </section>

        {exam.pendingCount > 0 ? (
          <Notice tone="neutral">
            {exam.pendingCount} AI-graded {plural(exam.pendingCount, "answer")} from earlier attempts {exam.pendingCount === 1 ? "is" : "are"} still waiting for the runner.
          </Notice>
        ) : null}
        {inProgress ? <Notice tone="neutral">You have an attempt in progress. Starting again begins a new sitting; the unfinished one stays on record.</Notice> : null}
        {error ? (
          <div role="alert" className="rounded-lg border border-bad bg-bad-bg px-3 py-2.5 text-[13px] text-bad">
            Could not start the exam: {error}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {info.latestAttemptId ? (
            <Button to={`/attempts/${info.latestAttemptId}`} size="lg">
              View latest result
            </Button>
          ) : null}
          <Button variant="primary" size="lg" disabled={exhausted || start.isPending} onClick={() => void begin()}>
            {start.isPending ? "Preparing questions…" : used === 0 ? "Start exam" : `Start attempt ${used + 1}`}
          </Button>
        </div>

        <section aria-label="Attempts" className={cx(panel, "overflow-hidden")}>
          <h2 className={cx(panelHead, "m-0 text-sm")}>Attempts</h2>
          {attempts.length === 0 ? <p className="m-0 px-4 py-3 text-[13px] text-text2">No attempts yet.</p> : null}
          <ul className="m-0 list-none p-0">
            {attempts.map((h) => {
              const tone = STATUS_TONE[h.status];
              return (
                <li key={h.id} className="border-b border-border last:border-b-0">
                  <Link to={`/attempts/${h.id}`} className="flex justify-between gap-3 px-4 py-3 text-text no-underline hover:bg-surface">
                    <span>
                      Attempt {h.number} · {formatWhen(h.date)}
                    </span>
                    <span className={cx("font-mono text-xs uppercase tabular-nums", tone === "bad" && "text-bad", tone === "warn" && "text-warn", tone === "ok" && "text-ok", tone === "neutral" && "text-text2")}>
                      {percentText(h.percent)} · {STATUS_LABEL[h.status]}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </Narrow>
    </Page>
  );
}
