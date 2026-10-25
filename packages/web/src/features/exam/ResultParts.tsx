import type { AttemptResult } from "@selfschool/shared";
import { Link } from "react-router-dom";
import { Button, ProgressBar, cx } from "../../ui";
import { CheckCircle, ClockIcon, XCircle } from "../quiz/icons";
import { Inline, StatusPill, monoLabel } from "../quiz/inline";
import { STATUS_LABEL, STATUS_TONE, formatWhen, isWeakDomain, percentText, scoreSummary } from "./display";

export const panel = "rounded-card border border-border";
export const panelHead = "border-b border-border bg-surface px-4 py-3 font-semibold";

/** Big mono score, status pill, "26 of 30 scored" line and the provisional note. */
export function ScoreCard({ a }: { a: AttemptResult }) {
  const s = scoreSummary(a);
  return (
    <section aria-label="Score" className={cx(panel, "flex min-w-[280px] flex-1 flex-col gap-2.5 p-5")}>
      <div className="flex items-baseline gap-2.5">
        <span className="font-mono text-[44px] font-semibold leading-none tracking-[-0.03em] tabular-nums" aria-label={`Score ${s.percent}`}>
          {s.percent}
        </span>
        <span role="status" aria-live="polite">
          <StatusPill pill={{ tone: STATUS_TONE[s.status], label: STATUS_LABEL[s.status], mono: false }} />
        </span>
      </div>
      <div className="text-text2">{s.line}</div>
      {s.note ? (
        <div className="rounded-lg border border-border bg-surface px-3 py-2.5 text-[13px] text-text2">
          <Inline text={s.note} />
        </div>
      ) : null}
    </section>
  );
}

export function DomainCard({ a }: { a: AttemptResult }) {
  return (
    <section aria-label="By domain" className={cx(panel, "flex min-w-[280px] flex-1 flex-col gap-3 p-5")}>
      <div className={monoLabel}>By domain</div>
      {a.byDomain.length === 0 ? <p className="m-0 text-[13px] text-text3">No domain scores yet.</p> : null}
      {a.byDomain.map((d) => {
        const weak = isWeakDomain(d.percent, a.passingPercentage);
        return (
          <div key={d.id} className="flex flex-col gap-1">
            <div className="flex justify-between gap-3 text-[13px]">
              <span>{d.title}</span>
              <span className={cx("font-mono text-xs tabular-nums", weak && "text-bad")}>
                {weak ? <span className="sr-only">Below pass mark: </span> : null}
                {percentText(d.percent)}
              </span>
            </div>
            <ProgressBar value={d.percent} label={d.title} />
          </div>
        );
      })}
    </section>
  );
}

export function MissedList({
  a,
  canReport,
  reported,
  reportingId,
  onReport,
}: {
  a: AttemptResult;
  canReport: boolean;
  reported: ReadonlySet<string>;
  reportingId: string | null;
  onReport: (questionId: string) => void;
}) {
  return (
    <section aria-label="Missed questions" className={cx(panel, "overflow-hidden")}>
      <h2 className={cx(panelHead, "m-0 text-sm")}>Missed questions</h2>
      {a.missed.length === 0 ? <p className="m-0 px-4 py-3 text-[13px] text-text2">Nothing missed so far.</p> : null}
      <ul className="m-0 list-none p-0">
        {a.missed.map((m) => (
          <li key={m.questionId} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
            <span className={cx("flex", m.pending ? "text-warn" : "text-bad")}>{m.pending ? <ClockIcon /> : <XCircle />}</span>
            <span className="min-w-0 grow">
              <span className="font-mono text-xs text-text3">Q{m.number}</span> · <Inline text={m.text} />
              <span className="block text-xs text-text3">
                {m.pending ? (
                  "Open-ended · awaiting grading"
                ) : (
                  <>
                    {[m.domainTitle].filter(Boolean).join("")}
                    {m.domainTitle && m.lesson ? " · " : ""}
                    {m.lesson ? (
                      <Link to={`/courses/${a.course.id}/lessons/${m.lesson.id}`} className="text-text3 underline">
                        {m.lesson.title}
                      </Link>
                    ) : null}
                  </>
                )}
              </span>
            </span>
            {!m.pending && canReport ? (
              reported.has(m.questionId) ? (
                <span className="inline-flex h-[30px] items-center gap-1.5 px-3 text-xs text-text3">
                  <CheckCircle />
                  Reported
                </span>
              ) : (
                <Button size="sm" className="text-xs text-text2" disabled={reportingId === m.questionId} onClick={() => onReport(m.questionId)}>
                  {reportingId === m.questionId ? "Reporting…" : "Report question"}
                </Button>
              )
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HistoryList({ a }: { a: AttemptResult }) {
  return (
    <section aria-label="Attempts" className={cx(panel, "overflow-hidden")}>
      <h2 className={cx(panelHead, "m-0 text-sm")}>Attempts</h2>
      <ul className="m-0 list-none p-0">
        {a.history.map((h) => {
          const here = h.id === a.id;
          const tone = STATUS_TONE[h.status];
          return (
            <li key={h.id} className="border-b border-border last:border-b-0">
              <Link
                to={`/attempts/${h.id}`}
                aria-current={here ? "page" : undefined}
                className={cx("flex justify-between gap-3 px-4 py-3 text-text no-underline hover:bg-surface", here && "bg-surface")}
              >
                <span>
                  Attempt {h.number} · {formatWhen(h.date)}
                  {here ? <span className="text-text3"> · this attempt</span> : null}
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
  );
}
