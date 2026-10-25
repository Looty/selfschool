import type { LearnerQuestion } from "@selfschool/shared";
import { cx } from "../../ui";
import { FillInput } from "./FillInput";
import { HotspotInput } from "./HotspotInput";
import { MatchInput } from "./MatchInput";
import { TraceInput } from "./TraceInput";
import { SortInput } from "./SortInput";
import { SpotInput } from "./SpotInput";
import { Inline } from "./inline";
import { isMultiple, selectOption, type Draft } from "./state";

/**
 * Editable answer controls for one question: real radios/checkboxes for MCQ, a text input for short
 * answers, a textarea for open-ended. Used by the quiz runner and by exam taking.
 */
export function AnswerInputs({
  question,
  draft,
  onChange,
  disabled,
  idPrefix,
  describedBy,
}: {
  question: LearnerQuestion;
  draft: Draft;
  onChange: (d: Draft) => void;
  disabled?: boolean;
  idPrefix: string;
  describedBy?: string;
}) {
  if (question.type === "mcq") {
    const multiple = isMultiple(question);
    return (
      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0" aria-describedby={describedBy}>
        <legend className="sr-only">{multiple ? "Choose all answers that apply" : "Choose one answer"}</legend>
        {question.options.map((o, i) => {
          const checked = draft.selected.includes(i);
          return (
            <label
              key={i}
              className={cx(
                "flex cursor-pointer items-start gap-3 rounded-[10px] border px-3.5 py-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-text",
                checked ? "border-ok bg-ok-bg" : "border-border hover:border-border2",
                disabled && "cursor-default opacity-70",
              )}
            >
              <input
                type={multiple ? "checkbox" : "radio"}
                name={`${idPrefix}-choice`}
                value={i}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(selectOption(draft, i, multiple))}
                className="mt-[3px] h-4 w-4 shrink-0 accent-[var(--ok)]"
              />
              <span className="min-w-0 break-words">
                <span className="mr-2 font-mono text-xs text-text3" aria-hidden="true">
                  {i + 1}
                </span>
                <Inline text={o.text} />
              </span>
            </label>
          );
        })}
      </fieldset>
    );
  }

  // keyed by question so a picked chip or crosshair never carries over to the next question
  if (question.type === "fill") return <FillInput key={question.id} question={question} draft={draft} onChange={onChange} disabled={disabled} describedBy={describedBy} />;
  if (question.type === "sort") return <SortInput key={question.id} question={question} draft={draft} onChange={onChange} disabled={disabled} describedBy={describedBy} />;
  if (question.type === "spot") return <SpotInput key={question.id} question={question} draft={draft} onChange={onChange} disabled={disabled} describedBy={describedBy} />;
  if (question.type === "match") return <MatchInput key={question.id} question={question} draft={draft} onChange={onChange} disabled={disabled} describedBy={describedBy} />;
  if (question.type === "trace") return <TraceInput key={question.id} question={question} draft={draft} onChange={onChange} disabled={disabled} describedBy={describedBy} />;
  if (question.type === "hotspot") return <HotspotInput key={question.id} question={question} draft={draft} onChange={onChange} disabled={disabled} describedBy={describedBy} />;

  const common = "w-full rounded-lg border border-border2 bg-bg px-3.5 py-2.5 text-sm text-text placeholder:text-text3 disabled:opacity-70";
  const inputId = `${idPrefix}-answer`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="sr-only">
        {question.type === "short" ? "Your short answer" : "Your answer"}
      </label>
      {question.type === "short" ? (
        <textarea
          id={inputId}
          ref={(el) => {
            // grow with the text: a long answer wraps onto more lines instead of scrolling sideways
            if (!el) return;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
          }}
          rows={1}
          data-single-line=""
          autoComplete="off"
          spellCheck={false}
          value={draft.text}
          disabled={disabled}
          aria-describedby={describedBy}
          placeholder="Type your answer"
          onChange={(e) => onChange({ ...draft, text: e.target.value.replace(/\s*\n+\s*/g, " ") })}
          className={cx(common, "block min-h-10 resize-none overflow-hidden font-mono leading-normal")}
        />
      ) : (
        <textarea
          id={inputId}
          rows={5}
          value={draft.text}
          disabled={disabled}
          aria-describedby={describedBy}
          placeholder="Write your answer in your own words"
          onChange={(e) => onChange({ ...draft, text: e.target.value })}
          className={cx(common, "min-h-[120px] resize-y leading-normal")}
        />
      )}
    </div>
  );
}
