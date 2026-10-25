import { useEffect, useState } from "react";
import type { AttemptResult } from "@selfschool/shared";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAttempt, useJob, useRegenerateExam, useReportQuestion } from "../../api/hooks";
import { Button, CourseBand, cx } from "../../ui";
import { Inline } from "../quiz/inline";
import { ErrorPage, LoadingPage, Narrow, Notice, Page, errorMessage } from "../quiz/PageState";
import { QuizResults } from "../quiz/Results";
import { DomainCard, HistoryList, MissedList, ScoreCard, panel } from "./ResultParts";

export function ExamResultPage({ attemptId }: { attemptId: string }) {
  const q = useAttempt(attemptId);
  if (q.isPending) return <LoadingPage width={880} label="Loading result" />;
  if (q.isError || !q.data) {
    return <ErrorPage width={880} title="Could not load this result" message={errorMessage(q.error)} onRetry={() => void q.refetch()} backTo="/attempts" backLabel="All attempts" />;
  }
  const a = q.data;
  if (a.kind === "quiz") {
    return (
      <Page>
        <CourseBand course={a.course} fade="quiz" maxWidth={720} progress={100} subline={a.title} right={<span className="text-[13px] text-text2">RESULTS · QUIZ</span>} />
        <Narrow width={720}>
          <QuizResults attempt={a} lessonHref={`/courses/${a.course.id}`} />
        </Narrow>
      </Page>
    );
  }
  return <ExamResult a={a} />;
}

function ExamResult({ a }: { a: AttemptResult }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const regenerate = useRegenerateExam();
  const report = useReportQuestion();
  const [reported, setReported] = useState<ReadonlySet<string>>(new Set());
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filling, setFilling] = useState<{ instanceId: string; jobId: string; fromBank: number; generating: number } | null>(null);
  const job = useJob(filling?.jobId);

  const takeHref = (instanceId: string) => `/courses/${a.course.id}/exams/${a.targetId}/take/${instanceId}`;

  // generation jobs finished: the new instance is full now
  useEffect(() => {
    if (filling && job.data?.status === "done") navigate(takeHref(filling.instanceId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filling, job.data?.status]);

  async function doRegenerate() {
    setError(null);
    try {
      const r = await regenerate.mutateAsync({ params: { courseId: a.course.id, examId: a.targetId } });
      if (r.jobId) setFilling({ instanceId: r.instance.id, jobId: r.jobId, ...r.drawn });
      else navigate(takeHref(r.instance.id));
    } catch (e) {
      setError(`Could not regenerate the exam: ${errorMessage(e)}`);
    }
  }

  async function doReport(questionId: string) {
    setError(null);
    setReportingId(questionId);
    try {
      await report.mutateAsync({ params: { questionId }, body: {} });
      setReported((prev) => new Set(prev).add(questionId));
    } catch (e) {
      setError(`Could not report the question: ${errorMessage(e)}`);
    } finally {
      setReportingId(null);
    }
  }

  const finished = a.finishedAt !== null;

  return (
    <Page>
      <CourseBand
        course={a.course}
        fade="exam"
        maxWidth={880}
        subline={a.title}
        right={
          <span className="text-[13px] text-text2">
            ATTEMPT <span className="text-[22px] font-semibold tracking-[-0.02em] text-text">{a.number}</span>
          </span>
        }
      />
      <Narrow width={880}>
        <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em]">Result</h1>

        {params.get("timeup") === "1" ? <Notice tone="neutral">Time ran out, so the answers you had saved were submitted.</Notice> : null}
        {!finished ? <Notice tone="neutral">This attempt is still in progress. Finish it from the exam page to see a result.</Notice> : null}
        {error ? (
          <div role="alert" className="rounded-lg border border-bad bg-bad-bg px-3 py-2.5 text-[13px] text-bad">
            {error}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-4">
          <ScoreCard a={a} />
          <DomainCard a={a} />
        </div>

        <section aria-label="Take the exam again" className={cx(panel, "flex flex-wrap items-center justify-between gap-4 px-5 py-4")}>
          <div className="min-w-[260px] flex-1">
            <div className="font-semibold">Take it again with new questions</div>
            <div className="text-[13px] text-text2">
              Draws unseen questions from the bank first, then generates and verifies new ones. This attempt and your earlier results stay as they are.
            </div>
            {filling ? (
              <div role="status" aria-live="polite" className="mt-2 text-[13px] text-warn">
                <Inline
                  text={
                    job.data?.status === "failed"
                      ? "Generating new questions failed. Try regenerating again."
                      : `Drew ${filling.fromBank} from the bank; ${filling.generating} more are being generated${a.ai.available ? "…" : ". AI is paused, so this continues when you start the runner with `school up`."} You can leave this page.`
                  }
                />
              </div>
            ) : null}
          </div>
          <Button variant="primary" size="lg" onClick={() => void doRegenerate()} disabled={regenerate.isPending || (!!filling && job.data?.status !== "failed")}>
            {regenerate.isPending ? "Preparing…" : "Regenerate exam"}
          </Button>
        </section>

        <MissedList a={a} canReport={finished} reported={reported} reportingId={reportingId} onReport={(id) => void doReport(id)} />
        <HistoryList a={a} />
      </Narrow>
    </Page>
  );
}
