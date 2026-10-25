import { useEffect, useReducer, useState } from "react";
import type { AttemptResult, LearnerQuiz } from "@selfschool/shared";
import { Link, useParams } from "react-router-dom";
import { useApiQuery, useAttempt, useFinishAttempt, useLesson, useQuiz, useStartQuizAttempt, useSubmitAnswer } from "../../api/hooks";
import { CourseBand } from "../../ui";
import { ErrorPage, LoadingPage, Narrow, Notice, Page, errorMessage } from "./PageState";
import { QuestionPanel } from "./QuestionPanel";
import { QuizResults } from "./Results";
import { EMPTY_DRAFT, initialRunner, mergeResult, runnerReducer, stageOf, toInput } from "./state";

export default function QuizFeature() {
  const { courseId = "", quizId = "" } = useParams();
  const quiz = useQuiz(courseId, quizId);
  const [run, setRun] = useState(0);

  if (quiz.isPending) return <LoadingPage width={720} label="Loading quiz" />;
  if (quiz.isError || !quiz.data) {
    return <ErrorPage width={720} title="Could not load this quiz" message={errorMessage(quiz.error)} onRetry={() => void quiz.refetch()} backTo={`/courses/${courseId}`} backLabel="Back to the course" />;
  }
  return <QuizRun key={run} quiz={quiz.data} courseId={courseId} onRetake={() => setRun((n) => n + 1)} />;
}

function QuizRun({ quiz, courseId, onRetake }: { quiz: LearnerQuiz; courseId: string; onRetake: () => void }) {
  const [s, dispatch] = useReducer(runnerReducer, initialRunner);
  const [attemptId, setAttemptId] = useState<string>();
  const [finalResult, setFinalResult] = useState<AttemptResult | null>(null);
  const [finishError, setFinishError] = useState<string | null>(null);
  // "Attempt N" is fixed when the run starts: starting the attempt bumps the quiz's next number.
  const [plannedNumber] = useState(quiz.attemptNumber);

  const health = useApiQuery("health", undefined);
  const start = useStartQuizAttempt();
  const submit = useSubmitAnswer();
  const finish = useFinishAttempt();
  const attempt = useAttempt(attemptId);

  const questions = quiz.questions;
  const total = questions.length;
  const q = questions[Math.min(s.index, total - 1)]!;
  const lessonHref = `/courses/${courseId}/lessons/${quiz.lesson.id}`;
  const aiPaused = attempt.data ? !attempt.data.ai.available : health.data ? !health.data.runner.connected : false;
  const exhausted = quiz.quiz.maxAttempts > 0 && plannedNumber > quiz.quiz.maxAttempts;

  async function check() {
    const input = toInput(q, s.drafts[q.id] ?? EMPTY_DRAFT);
    if (!input || s.checking || s.results[q.id]) return;
    dispatch({ type: "checking" });
    try {
      let id = attemptId;
      if (!id) {
        id = (await start.mutateAsync({ params: { courseId, quizId: quiz.quiz.id } })).attemptId;
        setAttemptId(id);
      }
      const result = await submit.mutateAsync({ params: { attemptId: id, questionId: q.id }, body: input });
      dispatch({ type: "checked", qid: q.id, result });
    } catch (e) {
      dispatch({ type: "failed", message: errorMessage(e) });
    }
  }

  async function finishRun() {
    if (!attemptId || finish.isPending) return;
    setFinishError(null);
    try {
      setFinalResult(await finish.mutateAsync({ params: { attemptId } }));
    } catch (e) {
      setFinishError(errorMessage(e));
    }
  }

  // Finishing may complete the lesson on the server (also while AI grading is pending): offer the way on.
  const lesson = useLesson(courseId, quiz.lesson.id);
  const refetchLesson = lesson.refetch;
  useEffect(() => {
    if (finalResult) void refetchLesson();
  }, [finalResult, refetchLesson]);
  const nextHref = lesson.data?.completed && lesson.data.next ? `/courses/${courseId}/lessons/${lesson.data.next.id}` : undefined;
  const nextTitle = lesson.data?.next?.title;

  const done = finalResult ?? null;
  const view = done ? (attempt.data?.finishedAt ? attempt.data : done) : null;

  if (view) {
    return (
      <Page>
        <CourseBand
          course={quiz.course}
          fade="quiz"
          maxWidth={720}
          progress={100}
          subline={<Link to={lessonHref} className="text-text2 no-underline">Lesson · {quiz.lesson.title}</Link>}
          right={<span className="text-[13px] text-text2">RESULTS · QUIZ</span>}
        />
        <Narrow width={720}>
          <QuizResults attempt={view} lessonHref={lessonHref} nextHref={nextHref} nextTitle={nextTitle} maxAttempts={quiz.quiz.maxAttempts} onRetake={onRetake} />
        </Narrow>
      </Page>
    );
  }

  const number = attempt.data?.number ?? plannedNumber;
  const result = mergeResult(s.results[q.id], attempt.data?.answers.find((a) => a.questionId === q.id));

  return (
    <Page>
      <CourseBand
        course={quiz.course}
        fade="quiz"
        maxWidth={720}
        progress={((s.index + 1) / total) * 100}
        subline={<Link to={lessonHref} className="text-text2 no-underline">Lesson · {quiz.lesson.title}</Link>}
        right={
          <span className="text-[13px] text-text2">
            <span className="text-[22px] font-semibold tracking-[-0.02em] text-text">{s.index + 1}</span> / {total} · QUIZ
          </span>
        }
      />
      <Narrow width={720} className="gap-6">
        <Link to={lessonHref} className="-mb-3 w-fit text-sm text-text2 no-underline hover:text-text">
          ← Back to the lesson: {quiz.lesson.title}
        </Link>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em]">{quiz.quiz.title}</h1>
          <span className="font-mono text-xs uppercase text-text2">
            Pass at {quiz.quiz.passingPercentage}% · Attempt {number}
          </span>
        </div>

        {exhausted ? (
          <Notice tone="neutral">All {quiz.quiz.maxAttempts} attempts for this quiz are used. Review your earlier results from the Attempts page.</Notice>
        ) : null}

        <QuestionPanel
          key={q.id}
          index={s.index}
          total={total}
          question={q}
          draft={s.drafts[q.id] ?? EMPTY_DRAFT}
          result={result}
          stage={stageOf(s, q.id)}
          error={s.error ?? finishError}
          courseId={courseId}
          lessonId={quiz.lesson.id}
          aiPaused={aiPaused}
          finishing={finish.isPending}
          onDraft={(draft) => dispatch({ type: "draft", qid: q.id, draft })}
          onCheck={() => void check()}
          onNext={() => dispatch({ type: "next", total })}
          onFinish={() => void finishRun()}
        />
      </Narrow>
    </Page>
  );
}
