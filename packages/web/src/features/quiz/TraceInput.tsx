import type { AnswerResult, LearnerQuestion } from "@selfschool/shared";
import { cx } from "../../ui";
import { CheckCircle, XCircle } from "./icons";
import { Inline } from "./inline";
import type { Draft } from "./state";

type TraceQuestion = Extract<LearnerQuestion, { type: "trace" }>;

const cellsOf = (d: Draft, q: TraceQuestion): string[][] => q.steps.map((_, r) => q.variables.map((_, c) => d.cells?.[r]?.[c] ?? ""));

/** Sets one cell of the grid. */
export function setCell(d: Draft, q: TraceQuestion, row: number, col: number, value: string): Draft {
  const cells = cellsOf(d, q);
  cells[row]![col] = value;
  return { ...d, cells };
}

const th = "border-b border-border bg-surface px-3 py-2 text-left font-mono text-[12px] font-normal text-text2";
const td = "border-b border-border px-3 py-1.5 align-middle";

/** The code is shown above (by the panel); this is the grid of what each variable holds after each step. */
export function TraceInput({ question, draft, onChange, disabled, describedBy }: { question: TraceQuestion; draft: Draft; onChange: (d: Draft) => void; disabled?: boolean; describedBy?: string }) {
  const cells = cellsOf(draft, question);
  return (
    <div className="flex flex-col gap-2" role="group" aria-describedby={describedBy}>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={th}>After</th>
              {question.variables.map((v) => (
                <th key={v} className={th}>
                  {v}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {question.steps.map((st, r) => (
              <tr key={r}>
                <td className={cx(td, "whitespace-nowrap font-mono text-xs text-text2")}>{st.label}</td>
                {question.variables.map((v, c) => (
                  <td key={v} className={td}>
                    {v in st.given ? (
                      <span className="inline-block min-w-[64px] px-2.5 py-1 font-mono text-[13px] text-text3" title="Given">
                        {st.given[v]}
                      </span>
                    ) : (
                      <input
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        disabled={disabled}
                        value={cells[r]![c]}
                        aria-label={`After ${st.label}, ${v}`}
                        onChange={(e) => onChange(setCell(draft, question, r, c, e.target.value))}
                        className="h-8 w-full min-w-[80px] rounded-md border border-border2 bg-bg px-2.5 font-mono text-[13px] text-text disabled:opacity-70"
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-text3">Type the value as the code would print it, for example 3, "hi", true, undefined. Greyed cells are given.</div>
    </div>
  );
}

/** After checking: the grid with every cell right or wrong, the expected value under a wrong one, then the explanation. */
export function TraceReview({ question, result, draft }: { question: TraceQuestion; result: AnswerResult; draft: Draft }) {
  const t = result.trace;
  const cells = cellsOf(draft, question);
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={th}>After</th>
              {question.variables.map((v) => (
                <th key={v} className={th}>
                  {v}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {question.steps.map((st, r) => (
              <tr key={r}>
                <td className={cx(td, "whitespace-nowrap font-mono text-xs text-text2")}>{st.label}</td>
                {question.variables.map((v, c) => {
                  const cell = t?.steps[r]?.cells[c];
                  if (v in st.given) {
                    return (
                      <td key={v} className={td}>
                        <span className="inline-block min-w-[64px] px-2.5 py-1 font-mono text-[13px] text-text3">{st.given[v]}</span>
                      </td>
                    );
                  }
                  const typed = cell?.placed ?? cells[r]![c];
                  return (
                    <td key={v} className={td}>
                      <span
                        className={cx(
                          "inline-flex min-w-[64px] flex-col rounded-md border px-2.5 py-1 font-mono text-[13px]",
                          !cell ? "border-border2 bg-surface2" : cell.correct ? "border-ok bg-ok-bg text-ok" : "border-bad bg-bad-bg text-bad",
                        )}
                      >
                        <span className="flex items-center gap-1.5">
                          {cell ? cell.correct ? <CheckCircle /> : <XCircle /> : null}
                          <span className="sr-only">{cell ? (cell.correct ? "Correct: " : "Wrong: ") : ""}</span>
                          {typed || " "}
                        </span>
                        {cell && !cell.correct ? <span className="text-[11px] text-text2">expected {cell.answer}</span> : null}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {t ? (
        <p className="m-0 text-[13px] text-text2">
          <Inline text={t.explanation} />
        </p>
      ) : null}
    </div>
  );
}
