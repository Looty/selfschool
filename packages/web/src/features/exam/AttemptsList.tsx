import { useState } from "react";
import { Link } from "react-router-dom";
import type { AttemptListItem } from "@selfschool/shared";
import { useAttempts, useDeleteAttempt } from "../../api/hooks";
import { Button, Monogram, cx } from "../../ui";
import { ErrorPage, Narrow, Page, Skeleton, errorMessage } from "../quiz/PageState";
import { STATUS_LABEL, STATUS_TONE, formatWhen, percentText, plural } from "./display";
import { panel, panelHead } from "./ResultParts";

interface Group {
  key: string;
  course: AttemptListItem["course"];
  kind: AttemptListItem["kind"];
  targetId: string;
  title: string;
  items: AttemptListItem[];
}

/** Attempts of one quiz or exam sit together, newest first; the list itself is already newest first. */
function groupAttempts(list: AttemptListItem[]): Group[] {
  const groups = new Map<string, Group>();
  for (const a of list) {
    const key = `${a.course.id}/${a.kind}/${a.targetId}`;
    const g = groups.get(key) ?? { key, course: a.course, kind: a.kind, targetId: a.targetId, title: a.title, items: [] };
    g.items.push(a);
    groups.set(key, g);
  }
  return [...groups.values()];
}

/** `/attempts`: every quiz and exam attempt, with what is still waiting for AI grading, and delete. */
export function AttemptsListPage() {
  const attempts = useAttempts();
  const remove = useDeleteAttempt();
  const [confirming, setConfirming] = useState<string | null>(null);

  if (attempts.isError) {
    return <ErrorPage width={880} title="Could not load your attempts" message={errorMessage(attempts.error)} onRetry={() => void attempts.refetch()} />;
  }
  const groups = groupAttempts(attempts.data?.attempts ?? []);
  const pending = (attempts.data?.attempts ?? []).reduce((n, a) => n + a.pendingCount, 0);

  return (
    <Page>
      <Narrow width={880}>
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text3">History</span>
          <h1 className="m-0 text-[24px] font-semibold tracking-[-0.02em]">Attempts</h1>
          {pending > 0 ? (
            <p className="m-0 text-[13px] text-text2">
              {pending} {plural(pending, "answer")} waiting for AI grading. They are graded when the runner is up; delete an attempt to drop its pending answers.
            </p>
          ) : null}
        </div>

        {attempts.isPending ? (
          <div role="status" aria-live="polite" aria-busy="true" className="flex flex-col gap-3">
            <span className="sr-only">Loading attempts</span>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : groups.length === 0 ? (
          <div className={cx(panel, "flex flex-col items-start gap-3 p-5")}>
            <div className="font-semibold">No attempts yet</div>
            <p className="m-0 text-[13px] text-text2">Quiz and exam results appear here, including answers still waiting for AI grading.</p>
            <Button to="/courses">Browse courses</Button>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.key} data-hue={g.course.hue} className={cx(panel, "overflow-hidden")}>
              <div className={cx(panelHead, "flex items-center gap-3")}>
                <Monogram text={g.course.monogram} size={18} />
                <div className="min-w-0 grow">
                  <Link
                    to={g.kind === "exam" ? `/courses/${g.course.id}/exams/${g.targetId}` : `/courses/${g.course.id}/quizzes/${g.targetId}`}
                    className="text-text no-underline"
                  >
                    {g.title}
                  </Link>
                  <div className="text-xs font-normal text-text3">
                    {g.course.title} · {g.kind === "exam" ? "Exam" : "Quiz"}
                  </div>
                </div>
              </div>
              <ul className="m-0 list-none p-0">
                {g.items.map((h) => {
                  const tone = STATUS_TONE[h.status];
                  const asking = confirming === h.id;
                  return (
                    <li key={h.id} className="flex items-center border-b border-border last:border-b-0">
                      <Link to={`/attempts/${h.id}`} className="flex min-w-0 grow flex-wrap justify-between gap-x-3 gap-y-1 px-4 py-3 text-text no-underline hover:bg-surface">
                        <span>
                          Attempt {h.number} · {formatWhen(h.date)}
                          {h.pendingCount > 0 ? <span className="text-warn"> · {h.pendingCount} awaiting grading</span> : null}
                        </span>
                        <span className={cx("font-mono text-xs uppercase tabular-nums", tone === "bad" && "text-bad", tone === "warn" && "text-warn", tone === "ok" && "text-ok", tone === "neutral" && "text-text2")}>
                          {percentText(h.percent)} · {STATUS_LABEL[h.status]}
                        </span>
                      </Link>
                      <div className="flex shrink-0 items-center gap-2 pr-3">
                        {asking ? (
                          <>
                            <Button
                              size="sm"
                              disabled={remove.isPending}
                              onClick={() => remove.mutate({ params: { attemptId: h.id } }, { onSettled: () => setConfirming(null) })}
                            >
                              Delete
                            </Button>
                            <Button size="sm" onClick={() => setConfirming(null)}>
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <button
                            type="button"
                            aria-label={`Delete attempt ${h.number} of ${g.title}`}
                            onClick={() => setConfirming(h.id)}
                            className="cursor-pointer rounded-button border-0 bg-transparent px-2 py-1 text-[13px] text-text3 hover:text-bad"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
        {remove.isError ? <p role="alert" className="m-0 text-sm text-bad">Could not delete: {errorMessage(remove.error)}</p> : null}
      </Narrow>
    </Page>
  );
}
