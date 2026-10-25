import type { AnswerResult, LearnerQuestion } from "@selfschool/shared";
import { cx } from "../../ui";
import { CheckCircle, XCircle } from "./icons";
import { Inline } from "./inline";
import type { Draft } from "./state";

type SpotQuestion = Extract<LearnerQuestion, { type: "spot" }>;

export const codeLines = (code: string): string[] => code.replace(/\n+$/, "").split("\n");

/** In a diff, a line starting with `+` is added and one starting with `-` is removed; everything else is context. */
export const diffKind = (text: string): "add" | "del" | null => (text.startsWith("+") ? "add" : text.startsWith("-") ? "del" : null);

const TINT = { add: "bg-[color-mix(in_srgb,var(--ok)_12%,transparent)] text-ok", del: "bg-[color-mix(in_srgb,var(--bad)_12%,transparent)] text-bad" } as const;

/** Click the line(s) of code that answer the question; click a selected line again to unselect it. */
export function SpotInput({ question, draft, onChange, disabled, describedBy }: { question: SpotQuestion; draft: Draft; onChange: (d: Draft) => void; disabled?: boolean; describedBy?: string }) {
  const selected = draft.lines ?? [];
  const toggle = (n: number) => onChange({ ...draft, lines: selected.includes(n) ? selected.filter((l) => l !== n) : [...selected, n] });
  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="Lines of code" aria-describedby={describedBy} className="overflow-hidden rounded-lg border border-border bg-surface py-1.5 font-mono text-[13px]">
        {codeLines(question.code).map((text, i) => {
          const n = i + 1;
          const on = selected.includes(n);
          const kind = question.diff ? diffKind(text) : null;
          return (
            <button
              key={n}
              type="button"
              role="checkbox"
              aria-checked={on}
              aria-label={kind ? `${kind === "add" ? "Added" : "Removed"} line ${n}: ${text.slice(1).trim()}` : undefined}
              disabled={disabled}
              onClick={() => toggle(n)}
              className={cx(
                "m-0 flex w-full cursor-pointer items-start gap-3 border-0 border-l-[3px] border-solid px-3.5 py-0.5 text-left font-[inherit] disabled:cursor-default",
                on ? "border-accent bg-accent-soft text-text" : cx("border-transparent hover:brightness-125", kind ? TINT[kind] : "bg-transparent text-text hover:bg-surface2"),
              )}
            >
              <span className="w-5 shrink-0 select-none text-right text-text3" aria-hidden="true">
                {n}
              </span>
              <span className="min-w-0 whitespace-pre-wrap break-words">{text || " "}</span>
            </button>
          );
        })}
      </div>
      <div className="text-xs text-text3">{selected.length === 0 ? "Click a line to select it. You can select more than one." : `${selected.length} ${selected.length === 1 ? "line" : "lines"} selected. Click a line again to unselect it.`}</div>
    </div>
  );
}

/** After checking: the code with right, wrong and missed lines marked, then why. */
export function SpotReview({ question, result, draft }: { question: SpotQuestion; result: AnswerResult; draft: Draft }) {
  const picked = result.spot?.picked ?? draft.lines ?? [];
  const correct = result.spot?.correct;
  const revealed = !!result.spot;
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-lg border border-border bg-surface py-1.5 font-mono text-[13px]">
        {codeLines(question.code).map((text, i) => {
          const n = i + 1;
          const on = picked.includes(n);
          const isRight = !!correct?.includes(n);
          const state = !revealed ? (on ? "plain" : "none") : on && isRight ? "right" : on ? "wrong" : isRight ? "missed" : "none";
          const kind = question.diff ? diffKind(text) : null;
          return (
            <div
              key={n}
              className={cx(
                "flex items-start gap-3 border-l-[3px] border-solid px-3.5 py-0.5",
                state === "right" && "border-ok bg-ok-bg text-ok",
                state === "wrong" && "border-bad bg-bad-bg text-bad",
                state === "missed" && "border-ok border-dashed text-text",
                state === "plain" && "border-accent bg-accent-soft",
                state === "none" && cx("border-transparent", kind && TINT[kind]),
              )}
            >
              <span className="w-5 shrink-0 select-none text-right text-text3" aria-hidden="true">
                {n}
              </span>
              <span className="min-w-0 grow whitespace-pre-wrap break-words">{text || " "}</span>
              {state === "right" || state === "wrong" || state === "missed" ? (
                <span className="flex shrink-0 items-center gap-1 font-sans text-xs">
                  {state === "wrong" ? <XCircle /> : <CheckCircle />}
                  {state === "right" ? "Correct line" : state === "wrong" ? "Not this line" : "You missed this line"}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {result.spot ? (
        <p className="m-0 text-[13px] text-text2">
          <span className="font-medium text-text">{result.spot.correct.length === 1 ? `Line ${result.spot.correct[0]}` : `Lines ${result.spot.correct.join(", ")}`}. </span>
          <Inline text={result.spot.explanation} />
        </p>
      ) : null}
    </div>
  );
}
