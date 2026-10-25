import type { AttemptResult } from "@selfschool/shared";
import { Button } from "../../ui";
import { DomainCard, HistoryList, MissedList, ScoreCard } from "../exam/ResultParts";
import { plural } from "../exam/display";

/** "See results": pass/fail, score, what was missed, attempt history, retake. Also routed at /attempts/:id for quizzes. */
export function QuizResults({
  attempt: a,
  lessonHref,
  nextHref,
  nextTitle,
  maxAttempts = 0,
  onRetake,
}: {
  attempt: AttemptResult;
  lessonHref?: string;
  /** Set once the lesson is complete (a pass, or a provisional score that clears the pass mark). */
  nextHref?: string;
  nextTitle?: string;
  /** 0 = unlimited */
  maxAttempts?: number;
  /** Quiz page resets in place; elsewhere the retake is a link to the quiz. */
  onRetake?: () => void;
}) {
  const used = a.history.length;
  const noneLeft = maxAttempts > 0 && used >= maxAttempts;
  const quizHref = `/courses/${a.course.id}/quizzes/${a.targetId}`;
  const showDomains = a.byDomain.length > 1;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em]">Result</h1>
        <span className="font-mono text-xs uppercase text-text2">
          {a.title} · Attempt {a.number}
        </span>
      </div>

      <div className="flex flex-wrap gap-4">
        <ScoreCard a={a} />
        {showDomains ? <DomainCard a={a} /> : null}
      </div>

      {a.passed === false ? (
        <p className="m-0 text-[13px] text-text2">
          {a.missed.length} {plural(a.missed.length, "question")} to review. Re-read the linked lessons, then retake: your earlier attempts stay on record.
        </p>
      ) : null}

      <MissedList a={a} canReport={false} reported={new Set()} reportingId={null} onReport={() => {}} />
      <HistoryList a={a} />

      <div className="flex flex-wrap justify-end gap-2">
        {lessonHref ? (
          <Button to={lessonHref} size="lg">
            Back to the lesson
          </Button>
        ) : null}
        {noneLeft ? (
          <span className="inline-flex h-10 items-center text-[13px] text-text3">No attempts left ({maxAttempts} of {maxAttempts} used).</span>
        ) : onRetake ? (
          <Button variant={nextHref ? "secondary" : "primary"} size="lg" onClick={onRetake}>
            Retake quiz
          </Button>
        ) : (
          <Button variant={nextHref ? "secondary" : "primary"} size="lg" to={quizHref}>
            Retake quiz
          </Button>
        )}
        {nextHref ? (
          <Button variant="primary" size="lg" to={nextHref}>
            {nextTitle ? `Continue to ${nextTitle}` : "Continue"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
