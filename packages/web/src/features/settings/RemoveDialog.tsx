import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CourseRemoval, PackageInfo } from "@selfschool/shared";
import { ApiError, getRemoval, removeCourse } from "../../api/client";
import { Button } from "../../ui";
import { markBackupDone } from "./backup";
import { Modal } from "./Modal";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Confirm popup for removing a course. It lists what goes (the course and all progress on it, which cannot be
 * undone), points at "Export backup" first, and removes only on the final button. Getting the course back means
 * importing it again, from the same zip or repo.
 */
export function RemoveDialog({ pkg, onClose }: { pkg: PackageInfo; onClose: () => void }) {
  const qc = useQueryClient();
  const [summary, setSummary] = useState<CourseRemoval | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let live = true;
    getRemoval(pkg.id).then(
      (s) => live && setSummary(s),
      (e: unknown) => live && setError(e instanceof ApiError ? e.message : "Could not read what would be removed."),
    );
    return () => {
      live = false;
    };
  }, [pkg.id]);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await removeCourse(pkg.id);
      await Promise.all(["packages", "courses", "dashboard", "attempts", "course"].map((n) => qc.invalidateQueries({ queryKey: ["api", n] })));
      await qc.invalidateQueries({ queryKey: ["removed"] });
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not remove the course.");
    } finally {
      setBusy(false);
    }
  }

  const rows: [string, string][] = summary
    ? [
        ["Course", "hidden from the app: its lessons, quizzes and exams"],
        ["Progress", `${plural(summary.lessonsCompleted, "completed lesson")}, ${plural(summary.attempts, "quiz or exam attempt")}`],
        ["XP", `${summary.xp} XP earned on this course comes off your total`],
        ["Question bank", plural(summary.bankQuestions, "saved question")],
        ["Tutor chat", plural(summary.chatMessages, "message")],
        ...(summary.extensionProposals > 0 ? ([["Extensions", plural(summary.extensionProposals, "proposal")]] as [string, string][]) : []),
      ]
    : [];

  return (
    <Modal labelId="remove-title" busy={busy} onClose={onClose}>
      <div className="border-b border-border px-6 pb-4 pt-5">
        <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text3">{done ? "Course removed" : "Remove a course"}</div>
        <h2 id="remove-title" className="m-0 mt-1 break-all text-xl font-semibold leading-[1.25] tracking-[-0.01em]">
          {pkg.course.title}
        </h2>
        <div className="mt-1 break-all font-mono text-xs text-text3">{pkg.id}</div>
      </div>

      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 py-5 text-[13px]">
        {done ? (
          <p role="status" className="m-0 text-text2">
            The course and its progress are gone from the app. To get it back, import it again or restore it from the Removed list; it starts from zero.
          </p>
        ) : (
          <>
            <p className="m-0 text-text2">
              This removes the course and all your progress on it from the app. It cannot be undone, and you import the course again to use it later.
            </p>
            {summary ? (
              <dl className="m-0 grid grid-cols-[110px_1fr] gap-x-4 gap-y-2 rounded-control border border-border bg-surface p-3.5">
                {rows.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="font-mono text-xs text-text3">{k}</dt>
                    <dd className="m-0 text-text">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : error ? null : (
              <p role="status" className="m-0 text-text3">
                Checking what is stored…
              </p>
            )}
            <p className="m-0 text-text2">No files are touched: the course folder stays where it is, so you can import it again or restore it from the Removed list.</p>
            <p className="m-0 text-text2">
              Want a copy of your progress first?{" "}
              <a href="/api/backup" download onClick={() => markBackupDone()} className="text-text underline">
                Export backup
              </a>
              . It saves the whole progress database.
            </p>
          </>
        )}
        {error ? (
          <p role="alert" className="m-0 text-bad">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4">
        {done ? (
          <Button size="sm" variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" disabled={!summary || busy} onClick={() => void remove()}>
              {busy ? "Removing…" : "Remove course and progress"}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
