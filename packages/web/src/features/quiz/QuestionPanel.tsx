import { useEffect, useRef } from "react";
import type { AnswerResult, LearnerQuestion, SelfMark } from "@selfschool/shared";
import { Link } from "react-router-dom";
import { Button, cx } from "../../ui";
import { AnswerInputs } from "./AnswerInputs";
import { FillReview } from "./FillInput";
import { HotspotReview } from "./HotspotInput";
import { MatchReview } from "./MatchInput";
import { TraceReview } from "./TraceInput";
import { SortReview } from "./SortInput";
import { SpotReview } from "./SpotInput";
import { ChatIcon, CheckCircle, InfoIcon, XCircle } from "./icons";
import { CodeBlock, Inline, StatusPill, monoLabel } from "./inline";
import { AWAITING_SELF_MARK, announcement, answerPill, canSelfCheck, isMultiple, selectOption, toInput, typeLabel, type Draft, type Stage } from "./state";

export interface QuestionPanelProps {
  index: number;
  total: number;
  question: LearnerQuestion;
  draft: Draft;
  result: AnswerResult | undefined;
  stage: Stage;
  error: string | null;
  courseId: string;
  /** Lesson the quiz belongs to ("Ask about this" goes there). */
  lessonId: string;
  /** Runner is down: open answers are saved and graded later; meanwhile the learner can mark them against the rubric. */
  aiPaused: boolean;
  finishing: boolean;
  /** Marks an open answer against its rubric (only offered while AI cannot grade it). */
  onSelfMark?: (mark: SelfMark) => void;
  selfMarking?: boolean;
  onDraft: (d: Draft) => void;
  onCheck: () => void;
  onNext: () => void;
  onFinish: () => void;
}

/** One question: input, then (after Check) per-option explanations, grading state or AI feedback. */
export function QuestionPanel(p: QuestionPanelProps) {
  const { question: q, result, stage } = p;
  const isLast = p.index === p.total - 1;
  const answered = stage === "answered";
  const selfCheck = !!p.onSelfMark && canSelfCheck(result, p.aiPaused);
  const pill = selfCheck && result?.state === "grading" ? AWAITING_SELF_MARK : answerPill(result);
  const input = toInput(q, p.draft);
  const rootRef = useRef<HTMLElement>(null);
  const headingId = `q-${q.id}-text`;

  // After Check the primary button becomes Next: keep keyboard focus on it so Enter continues.
  useEffect(() => {
    if (answered) rootRef.current?.querySelector<HTMLElement>("[data-primary]")?.focus();
  }, [answered, q.id]);

  // A new question (not the first) moves focus into its text field, or to its text for choices,
  // so screen readers start reading there and typing works straight away.
  const titleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (p.index === 0) return;
    const field = rootRef.current?.querySelector<HTMLElement>("input[type=text], textarea");
    (field ?? titleRef.current)?.focus();
  }, [p.index]);

  // Shortcuts work wherever focus is on the page (not only inside the card), e.g. right after load.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  keyRef.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (e.defaultPrevented || t.closest("header, nav, [role=dialog], [role=menu]")) return;
    const inText = t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && (t as HTMLInputElement).type === "text");
    if (e.key === "Enter" && !e.shiftKey && !e.altKey && t.tagName !== "BUTTON" && t.tagName !== "A") {
      if (t.tagName === "TEXTAREA" && !t.hasAttribute("data-single-line") && !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      if (answered) isLast ? p.onFinish() : p.onNext();
      else if (input && stage === "answering") p.onCheck();
      return;
    }
    // number keys pick the matching option
    if (!inText && !answered && stage === "answering" && q.type === "mcq" && /^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const i = Number(e.key) - 1;
      if (i < q.options.length) {
        e.preventDefault();
        p.onDraft(selectOption(p.draft, i, isMultiple(q)));
      }
    }
  };

  const askHref = `/courses/${p.courseId}/lessons/${p.lessonId}?ask=${encodeURIComponent(q.text)}`;
  const showAsk =
    result?.state === "graded" ||
    result?.state === "failed" ||
    (result?.state === "self" && result.selfMark !== "got") ||
    (result?.state === "scored" && result.correct === false);

  return (
    <section ref={rootRef} aria-labelledby={headingId} className="flex flex-col gap-3.5 rounded-card border border-border p-5">
      <div className="flex items-center justify-between gap-3">
        <span className={monoLabel}>
          Question {p.index + 1} of {p.total} · {typeLabel(q)}
        </span>
        {/* always mounted so the change is announced */}
        <span role="status" aria-live="polite" className="min-h-[22px]">
          {pill ? <StatusPill pill={pill} /> : null}
          <span className="sr-only">{pill === AWAITING_SELF_MARK ? "Answer saved. Check it against the rubric and mark it yourself." : announcement(result)}</span>
        </span>
      </div>

      <div id={headingId} ref={titleRef} tabIndex={-1} className="text-base font-medium leading-normal outline-none">
        <Inline text={q.text} />
      </div>
      {q.code && q.type !== "spot" ? <CodeBlock code={q.code} /> : null}

      {renderBody(p)}

      {q.type === "open" && !answered && p.aiPaused ? (
        <div className="flex items-start gap-2 rounded-lg bg-warn-bg px-3 py-2.5 text-[13px] text-warn" role="note">
          <InfoIcon />
          <span>
            <Inline text="AI is paused. After you submit, check your answer against the rubric and mark it yourself; AI grades it later and replaces your mark, when you start the runner with `school up`." />
          </span>
        </div>
      ) : null}

      {p.error ? (
        <div role="alert" className="rounded-lg border border-bad bg-bad-bg px-3 py-2.5 text-[13px] text-bad">
          Could not submit: {p.error}. Your answer is kept; try again.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {answered && showAsk ? (
          <Button to={askHref} variant="tutor" className="h-9!">
            <ChatIcon />
            Ask about this
          </Button>
        ) : null}
        {answered ? (
          <Button data-primary variant="primary" size="lg" className={cx(showAsk && "h-9!")} onClick={isLast ? p.onFinish : p.onNext} disabled={p.finishing}>
            {isLast ? (p.finishing ? "Finishing…" : "See results") : "Next question"}
          </Button>
        ) : (
          <Button variant="primary" size="lg" disabled={!input || stage === "checking"} onClick={p.onCheck}>
            {stage === "checking" ? "Checking…" : q.type === "open" ? "Submit answer" : "Check answer"}
          </Button>
        )}
      </div>
    </section>
  );
}

function renderBody(p: QuestionPanelProps) {
  const { question: q, result, stage } = p;
  const idPrefix = `q-${q.id}`;

  if (!result) {
    return (
      <>
        <AnswerInputs question={q} draft={p.draft} onChange={p.onDraft} disabled={stage === "checking"} idPrefix={idPrefix} describedBy={`q-${q.id}-text`} />
        {q.type === "mcq" && q.options.length > 1 ? <p className="m-0 text-xs text-text3">Tip: press a number key to choose, Enter to check.</p> : null}
      </>
    );
  }

  if (q.type === "mcq") return <OptionReview question={q} result={result} draft={p.draft} />;
  if (q.type === "fill") return <FillReview question={q} result={result} draft={p.draft} />;
  if (q.type === "sort") return <SortReview question={q} result={result} draft={p.draft} />;
  if (q.type === "spot") return <SpotReview question={q} result={result} draft={p.draft} />;
  if (q.type === "hotspot") return <HotspotReview question={q} result={result} draft={p.draft} />;
  if (q.type === "match") return <MatchReview question={q} result={result} draft={p.draft} />;
  if (q.type === "trace") return <TraceReview question={q} result={result} draft={p.draft} />;

  if (q.type === "short") {
    const ok = result.correct === true;
    return (
      <div className="flex flex-col gap-2">
        <AnswerBox text={p.draft.text} mono />
        {result.state === "scored" ? (
          <div className={cx("flex items-start gap-2 rounded-[10px] border px-3.5 py-3", ok ? "border-ok bg-ok-bg text-ok" : "border-bad bg-bad-bg text-bad")}>
            {ok ? <CheckCircle /> : <XCircle />}
            <div className="text-[13px]">
              <span className="font-medium">{ok ? "Correct" : "Not quite"}</span>
              {!ok && result.accepted?.length ? (
                <span className="text-text2">
                  {" "}
                  · Accepted: {result.accepted.map((a, i) => (
                    <code key={i} className="font-mono">
                      {i ? ", " : ""}
                      {a}
                    </code>
                  ))}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // open-ended: while AI cannot grade it (paused, or the grade failed) the learner marks it against the rubric
  const text = result.answerText ?? p.draft.text;
  const selfCheck = !!p.onSelfMark && canSelfCheck(result, p.aiPaused);
  return (
    <div className="flex flex-col gap-3.5">
      <AnswerBox text={text} />
      {result.state === "grading" && !selfCheck ? <Grading /> : null}
      {selfCheck ? <SelfCheck rubric={result.rubric!} current={result.selfMark} busy={!!p.selfMarking} onMark={p.onSelfMark!} /> : null}
      {result.state === "graded" && result.feedback ? <Feedback result={result} courseId={p.courseId} /> : null}
      {result.state === "failed" ? <p className="m-0 text-[13px] text-bad">Grading failed for this answer. Submit it again from the next attempt, or ask about it.</p> : null}
    </div>
  );
}

function AnswerBox({ text, mono }: { text: string; mono?: boolean }) {
  return <div className={cx("whitespace-pre-wrap break-words rounded-lg border border-border bg-surface px-3.5 py-3 text-sm text-text2", mono && "font-mono text-[13px]")}>{text}</div>;
}

function Grading() {
  return (
    <>
      <div className="flex items-center gap-2 text-sm font-medium text-text2" role="status">
        <span className="spinner text-warn" aria-hidden="true" />
        Grading your answer…
      </div>
      <div className="flex flex-col gap-2" aria-hidden="true">
        <div className="shimmer h-2.5 w-[70%] rounded" />
        <div className="shimmer h-2.5 w-[45%] rounded" />
      </div>
      <div className="text-xs text-text3">Queued for the runner. You can leave this page; the result appears here and on the dashboard.</div>
    </>
  );
}

const SELF_MARKS: { mark: SelfMark; label: string }[] = [
  { mark: "got", label: "Got it" },
  { mark: "partly", label: "Partly" },
  { mark: "missed", label: "Missed it" },
];

/** The rubric and three buttons: the learner's own mark counts now; an AI grade replaces it once the runner is on. */
function SelfCheck({ rubric, current, busy, onMark }: { rubric: string; current: SelfMark | undefined; busy: boolean; onMark: (m: SelfMark) => void }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-border">
      <div className="flex flex-wrap justify-between gap-x-3 border-b border-border bg-surface px-3.5 py-2.5 text-[13px]">
        <span className="font-medium">Check it yourself</span>
        <span className="text-text2">Rubric from the course</span>
      </div>
      <div className="flex flex-col gap-3 px-3.5 py-3 text-[13px]">
        {/* rubrics are often a short "- point" list written as a YAML block: keep its lines */}
        <div className="whitespace-pre-line text-text2">
          <Inline text={rubric.trim()} />
        </div>
        <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0">
          <legend className="sr-only">Mark your answer</legend>
          <span className="mr-1 font-medium">{current ? "Your mark:" : "How did you do?"}</span>
          {SELF_MARKS.map(({ mark, label }) => (
            <Button
              key={mark}
              size="sm"
              aria-pressed={current === mark}
              disabled={busy}
              onClick={() => onMark(mark)}
              className={cx(current === mark && "border-text! bg-surface2!")}
            >
              {label}
            </Button>
          ))}
        </fieldset>
        <p className="m-0 text-xs text-text3">Your mark counts now. When the runner is on, AI grades this answer and replaces it.</p>
      </div>
    </div>
  );
}

function Feedback({ result, courseId }: { result: AnswerResult; courseId: string }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-border">
      <div className="flex flex-wrap justify-between gap-x-3 border-b border-border bg-accent-soft px-3.5 py-2.5 text-[13px]">
        <span className="font-medium text-accent">Feedback</span>
        <span className="text-text2">AI-graded against the rubric</span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0 px-3.5 py-3 text-[13px]">
        {result.feedback!.points.map((pt, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className={cx("flex pt-0.5", pt.ok ? "text-ok" : "text-bad")}>{pt.ok ? <CheckCircle /> : <XCircle />}</span>
            <span>
              <span className="sr-only">{pt.ok ? "Met: " : "Missed: "}</span>
              <Inline text={pt.text} />
              {pt.lesson ? (
                <>
                  {" "}
                  See{" "}
                  <Link to={`/courses/${courseId}/lessons/${pt.lesson.id}`} className="text-accent">
                    {pt.lesson.title}
                  </Link>
                  .
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OptionReview({ question, result, draft }: { question: Extract<LearnerQuestion, { type: "mcq" }>; result: AnswerResult; draft: Draft }) {
  // quiz with show_answers off (state "recorded"): echo the choice, reveal nothing
  const rows = result.options ?? question.options.map((o, i) => ({ text: o.text, correct: false, selected: draft.selected.includes(i), explanation: "" }));
  const revealed = !!result.options;
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {rows.map((o, i) => {
        const wrong = revealed && o.selected && !o.correct;
        const right = revealed && o.correct;
        const tag = wrong ? "Your answer" : right ? (o.selected ? "Your answer · correct" : "Correct answer") : o.selected ? "Your answer" : null;
        return (
          <li
            key={i}
            className={cx(
              "flex flex-col gap-1 rounded-[10px] border px-3.5 py-3",
              wrong ? "border-bad bg-bad-bg" : right ? "border-ok bg-ok-bg" : o.selected ? "border-border2 bg-surface" : "border-border",
            )}
          >
            <div className={cx("flex items-center gap-2 font-medium", wrong && "text-bad", right && "text-ok")}>
              {wrong ? <XCircle /> : right ? <CheckCircle /> : null}
              <span className="min-w-0 break-words text-[13px]">
                <Inline text={o.text} />
              </span>
              {tag ? <span className="ml-auto shrink-0 pl-2 text-xs font-normal">{tag}</span> : null}
            </div>
            {o.explanation ? <div className="text-[13px] text-text2">{o.explanation}</div> : null}
          </li>
        );
      })}
    </ul>
  );
}
