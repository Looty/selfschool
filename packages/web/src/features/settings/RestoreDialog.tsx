import { useRef, useState } from "react";
import { ApiError } from "../../api/client";
import { Button } from "../../ui";
import { Modal } from "./Modal";
import { restorePortableBackup, type RestoreReport } from "./portable";

type Phase = { name: "pick" } | { name: "working"; step: string } | { name: "done"; report: RestoreReport } | { name: "failed"; message: string };

/** Pick a portable backup file and restore it: progress and preferences first, then the courses are fetched again. */
export function RestoreDialog({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ name: "pick" });
  const pick = useRef<HTMLInputElement>(null);
  const busy = phase.name === "working";

  async function run(file: File) {
    setPhase({ name: "working", step: "Reading the file…" });
    try {
      const report = await restorePortableBackup(file, (step) => setPhase({ name: "working", step }));
      setPhase({ name: "done", report });
    } catch (e) {
      setPhase({ name: "failed", message: e instanceof ApiError ? e.message : "Something went wrong while restoring." });
    }
  }

  return (
    <Modal labelId="restore-title" busy={busy} onClose={onClose}>
      <div className="flex flex-col gap-4 px-6 py-5 text-[13px]">
        <h2 id="restore-title" className="m-0 text-xl font-semibold leading-[1.25] tracking-[-0.01em]">
          Restore from a backup file
        </h2>

        {phase.name === "pick" || phase.name === "failed" ? (
          <>
            <p className="m-0 text-text2">
              Choose a <span className="font-mono">selfschool-backup-….json</span> file. Your progress and settings here are replaced by what is in the file, and the courses are fetched again from their repositories.
            </p>
            {phase.name === "failed" ? (
              <p role="alert" className="m-0 text-bad">
                {phase.message}
              </p>
            ) : null}
            <input
              ref={pick}
              type="file"
              accept=".json,application/json"
              hidden
              aria-label="Choose a backup file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void run(f);
              }}
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={() => pick.current?.click()}>
                Choose a file
              </Button>
            </div>
          </>
        ) : null}

        {phase.name === "working" ? (
          <p role="status" className="m-0 flex items-center gap-2 text-text2">
            <span className="spinner" /> {phase.step}
          </p>
        ) : null}

        {phase.name === "done" ? (
          <>
            <p role="status" className="m-0 text-text">
              Restored. {phase.report.courses.length} {phase.report.courses.length === 1 ? "course" : "courses"} fetched again.
            </p>
            {phase.report.missing.length > 0 ? (
              <div className="rounded-button border border-border bg-warn-bg px-3 py-2.5">
                <div className="font-medium text-text">Add these by hand (your progress on them is kept):</div>
                <ul className="m-0 mt-1 list-disc pl-5 text-text2">
                  {phase.report.missing.map((m) => (
                    <li key={m.id}>
                      <span className="font-mono">{m.id}</span>: {m.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex justify-end">
              <Button variant="primary" size="sm" onClick={() => location.assign("/")}>
                Reload the app
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
