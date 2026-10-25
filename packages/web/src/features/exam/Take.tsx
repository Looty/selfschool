import { useEffect, useReducer, useRef, useState, type KeyboardEvent } from "react";
import type { ExamInstance } from "@selfschool/shared";
import { useNavigate } from "react-router-dom";
import { useExamInstance, useFinishAttempt, useSubmitAnswer } from "../../api/hooks";
import { Button, CourseBand, cx } from "../../ui";
import { AnswerInputs } from "../quiz/AnswerInputs";
import { FlagIcon } from "../quiz/icons";
import { CodeBlock, Inline, monoLabel } from "../quiz/inline";
import { ErrorPage, LoadingPage, Narrow, Notice, Page, errorMessage } from "../quiz/PageState";
import { isMultiple, selectOption, toInput, typeLabel } from "../quiz/state";
import { crossedWarning, formatClock, plural, remainingMs, spokenRemaining } from "./display";
import { clearTake, dirtyQuestions, draftOf, inputKey, isAnswered, loadTake, navLabel, saveTake, summarize, takeReducer } from "./takeState";
import { useNow } from "./useNow";

export function ExamTake({ instanceId }: { instanceId: string }) {
  const inst = useExamInstance(instanceId);
  if (inst.isPending) return <LoadingPage width={880} label="Loading exam" />;
  if (inst.isError || !inst.data) {
    return <ErrorPage width={880} title="Could not load this exam sitting" message={errorMessage(inst.error)} onRetry={() => void inst.refetch()} backTo="/courses" backLabel="Back to courses" />;
  }
  return <TakeRun inst={inst.data} />;
}

function TakeRun({ inst }: { inst: ExamInstance }) {
  const navigate = useNavigate();
  const qs = inst.questions;
  const total = qs.length;
  const [s, dispatch] = useReducer(takeReducer, inst.id, (id) => loadTake(id));
  const submitAnswer = useSubmitAnswer();
  const finish = useFinishAttempt();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const submittedRef = useRef(false);
  const confirmRef = useRef<HTMLDivElement>(null);

  // local copy of the draft so a reload keeps the sitting
  useEffect(() => saveTake(inst.id, s), [inst.id, s]);

  const now = useNow(1000);
  const remaining = remainingMs(inst.startedAt, inst.durationMinutes, now);
  const prevRemaining = useRef(remaining);
  useEffect(() => {
    const m = crossedWarning(prevRemaining.current, remaining);
    prevRemaining.current = remaining;
    if (m !== null) setAnnounce(spokenRemaining(remaining));
  }, [remaining]);

  const idx = Math.min(s.index, total - 1);
  const q = qs[idx];
  const sum = summarize(qs, s);

  async function flush(): Promise<boolean> {
    const dirty = dirtyQuestions(qs, s);
    try {
      await Promise.all(
        dirty.map(async (d) => {
          const body = toInput(d, draftOf(s, d))!;
          await submitAnswer.mutateAsync({ params: { attemptId: inst.attemptId, questionId: d.id }, body });
          dispatch({ type: "saved", qid: d.id, key: inputKey(d, draftOf(s, d)) });
        }),
      );
      return true;
    } catch (e) {
      setError(`Could not save an answer: ${errorMessage(e)}. It is kept on this device; try again.`);
      return false;
    }
  }

  async function go(i: number) {
    setError(null);
    dispatch({ type: "go", index: i, total });
    void flush(); // leaving a question saves it; failures surface in the alert, the draft stays local
  }

  async function submitAll(auto = false) {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setBusy(true);
    setError(null);
    if (!(await flush())) {
      submittedRef.current = false;
      setBusy(false);
      return;
    }
    try {
      const res = await finish.mutateAsync({ params: { attemptId: inst.attemptId } });
      clearTake(inst.id);
      navigate(`/attempts/${res.id}${auto ? "?timeup=1" : ""}`, { replace: true });
    } catch (e) {
      submittedRef.current = false;
      setBusy(false);
      setError(`Could not submit: ${errorMessage(e)}.`);
    }
  }

  // time is up: submit what we have
  useEffect(() => {
    if (remaining <= 0) void submitAll(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining <= 0]);

  useEffect(() => {
    if (confirming) confirmRef.current?.querySelector<HTMLElement>("[data-primary]")?.focus();
  }, [confirming]);

  if (!q) return <ErrorPage width={880} title="This exam has no questions" message="The instance is empty. Regenerate the exam from its result page." backTo="/courses" />;

  const flagged = s.flagged.includes(q.id);
  const draft = draftOf(s, q);
  const low = remaining <= 5 * 60_000;

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const t = e.target as HTMLElement;
    if (q.type === "mcq" && /^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && t.tagName !== "INPUT" && t.tagName !== "TEXTAREA") {
      const i = Number(e.key) - 1;
      if (i < q.options.length) {
        e.preventDefault();
        dispatch({ type: "draft", qid: q.id, draft: selectOption(draft, i, isMultiple(q)) });
      }
    }
  };

  return (
    <Page>
      <CourseBand
        course={inst.course}
        fade="exam"
        maxWidth={880}
        subline={inst.title}
        right={
          <span className="text-[13px] text-text2">
            <span className={cx("font-mono text-[22px] font-semibold tracking-[-0.02em] tabular-nums", low ? "text-bad" : "text-text")} role="timer" aria-label={`Time left ${formatClock(remaining)}`}>
              {formatClock(remaining)}
            </span>{" "}
            LEFT
          </span>
        }
      />
      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>

      <Narrow width={880}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em]">{inst.title}</h1>
          <span className="font-mono text-xs uppercase text-text2">
            {sum.answered} of {total} answered{sum.flagged ? ` · ${sum.flagged} flagged` : ""}
          </span>
        </div>

        {error ? (
          <div role="alert" className="rounded-lg border border-bad bg-bad-bg px-3 py-2.5 text-[13px] text-bad">
            {error}
          </div>
        ) : null}
        {remaining <= 0 ? <Notice>Time is up. Submitting your answers…</Notice> : null}

        {confirming ? (
          <div ref={confirmRef} role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-body" className="flex flex-col gap-3 rounded-card border border-border2 bg-surface p-5">
            <div id="confirm-title" className="font-semibold">
              Submit this exam?
            </div>
            <div id="confirm-body" className="text-[13px] text-text2">
              {sum.unanswered > 0 ? (
                <>
                  {sum.unanswered} {plural(sum.unanswered, "question")} unanswered
                  {sum.flagged ? `, ${sum.flagged} flagged for review` : ""}. Unanswered questions score zero. Submitting ends this attempt; you cannot change answers afterwards.
                </>
              ) : (
                <>All {total} questions answered{sum.flagged ? `, ${sum.flagged} still flagged for review` : ""}. Submitting ends this attempt.</>
              )}
            </div>
            {sum.unanswered > 0 ? (
              <div className="flex flex-wrap gap-1.5" aria-label="Unanswered questions">
                {sum.unansweredAt.slice(0, 8).map((i) => (
                  <Button
                    key={i}
                    size="sm"
                    onClick={() => {
                      setConfirming(false);
                      void go(i);
                    }}
                  >
                    Go to {i + 1}
                  </Button>
                ))}
                {sum.unanswered > 8 ? <span className="self-center text-xs text-text3">and {sum.unanswered - 8} more (use the navigator)</span> : null}
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setConfirming(false)} disabled={busy}>
                Keep working
              </Button>
              <Button data-primary variant="primary" size="lg" onClick={() => void submitAll()} disabled={busy}>
                {busy ? "Submitting…" : "Submit exam"}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_220px]">
          <section key={q.id} aria-labelledby="take-q" onKeyDown={onKeyDown} className="flex flex-col gap-3.5 rounded-card border border-border p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={monoLabel}>
                Question {idx + 1} of {total} · {typeLabel(q)}
              </span>
              <Button size="sm" aria-pressed={flagged} onClick={() => dispatch({ type: "flag", qid: q.id })} className={cx(flagged && "border-warn! text-warn!")}>
                <FlagIcon />
                {flagged ? "Flagged" : "Flag for review"}
              </Button>
            </div>
            <div id="take-q" className="text-base font-medium leading-normal">
              <Inline text={q.text} />
            </div>
            {q.code && q.type !== "spot" ? <CodeBlock code={q.code} /> : null}
            <AnswerInputs question={q} draft={draft} onChange={(d) => dispatch({ type: "draft", qid: q.id, draft: d })} idPrefix={`take-${q.id}`} describedBy="take-q" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button disabled={idx === 0} onClick={() => void go(idx - 1)}>
                Previous
              </Button>
              {idx < total - 1 ? (
                <Button variant={isAnswered(q, s) ? "primary" : "secondary"} onClick={() => void go(idx + 1)}>
                  {isAnswered(q, s) ? "Next question" : "Skip for now"}
                </Button>
              ) : (
                <Button variant="primary" onClick={() => setConfirming(true)}>
                  Review and submit
                </Button>
              )}
            </div>
          </section>

          <aside aria-label="Question navigator" className="flex flex-col gap-3 rounded-card border border-border p-4 lg:sticky lg:top-4">
            <div className={monoLabel}>Questions</div>
            <ol className="m-0 grid list-none grid-cols-6 gap-1.5 p-0 lg:grid-cols-5">
              {qs.map((nq, i) => {
                const answered = isAnswered(nq, s);
                const isFlag = s.flagged.includes(nq.id);
                return (
                  <li key={nq.id}>
                    <button
                      type="button"
                      aria-label={navLabel(i, nq, s)}
                      aria-current={i === idx ? "step" : undefined}
                      onClick={() => void go(i)}
                      className={cx(
                        "relative flex h-9 w-full cursor-pointer items-center justify-center rounded-control border font-mono text-xs tabular-nums",
                        i === idx ? "border-text bg-primary text-primary-fg" : answered ? "border-border2 bg-surface2 text-text" : "border-border bg-bg text-text2",
                      )}
                    >
                      {i + 1}
                      {isFlag ? <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-warn" aria-hidden="true" /> : null}
                    </button>
                  </li>
                );
              })}
            </ol>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs text-text3">
              <li>Filled = answered · outlined = not yet</li>
              <li>Dot = flagged for review</li>
              <li>Answers save when you move on.</li>
            </ul>
            <Button variant="primary" size="lg" onClick={() => setConfirming(true)} disabled={busy}>
              Submit exam
            </Button>
          </aside>
        </div>
      </Narrow>
    </Page>
  );
}
