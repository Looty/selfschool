import { useEffect, useState } from "react";
import { useSettings } from "../../api/hooks";
import { Button } from "../../ui";
import { AddPackageForm, ZipDrop } from "../settings";
import { ImportDialog, type ImportSource } from "../settings/ImportDialog";
import { Modal } from "../settings/Modal";
import { RestoreDialog } from "../settings/RestoreDialog";
import { LOCAL } from "../settings/backup";

const COURSES_REPO = "https://github.com/Looty/selfschool-courses";

/** The sample course is only served by the in-browser dev build; anything else answers with the app's HTML. */
async function fetchSample(): Promise<File | null> {
  try {
    const res = await fetch("/sample.zip");
    if (!res.ok || !res.headers.get("content-type")?.includes("zip")) return null;
    return new File([await res.blob()], "sample.zip", { type: "application/zip" });
  } catch {
    return null;
  }
}

/** First run: no courses installed yet. One thing to do (get a course), then what to know about where data lives and the AI tutor. */
export function Welcome() {
  const settings = useSettings();
  const [importing, setImporting] = useState<ImportSource | null>(null);
  const [adding, setAdding] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [sample, setSample] = useState<File | null>(null);
  useEffect(() => {
    if (LOCAL) void fetchSample().then(setSample);
  }, []);
  // In the in-browser build there is no runner at all, so "paused" would blame the person for something they cannot fix.
  const aiConnected = settings.data?.runner.connected ?? false;

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-8 px-7 pb-14 pt-12">
      <header>
        <h1 className="m-0 text-[30px] font-semibold leading-[1.2] tracking-[-0.02em]">Welcome to Selfschool</h1>
        <p className="m-0 mt-2 text-[15px] text-text2">Courses are plain files; your progress and quiz results are tracked here. Start by adding a course.</p>
      </header>

      <section aria-label="Get a course" className="flex flex-col gap-3 rounded-card border border-border p-5">
        <h2 className="m-0 text-base font-semibold">1. Get a course</h2>
        <div className="flex flex-wrap gap-2.5">
          {sample ? (
            <Button variant="primary" onClick={() => setImporting({ kind: "zip", file: sample })}>
              Try a sample course
            </Button>
          ) : null}
          <Button variant={sample ? "secondary" : "primary"} onClick={() => setAdding(true)}>
            Import from a GitHub link or zip
          </Button>
        </div>
        <p className="m-0 text-[13px] text-text3">
          Looking for one? <a href={COURSES_REPO} target="_blank" rel="noreferrer" className="text-text2">Ready-made courses</a> you can import by pasting their link.
        </p>
        <p className="m-0 text-[13px] text-text3">
          Coming from another device or address?{" "}
          <button type="button" onClick={() => setRestoring(true)} className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-text2 underline">
            Restore from a backup file
          </button>
          .
        </p>
      </section>

      {LOCAL ? (
        <section aria-label="Where your data lives" className="flex flex-col gap-1.5">
          <h2 className="m-0 text-base font-semibold">2. Your data stays in this browser</h2>
          <p className="m-0 text-[13px] text-text2">
            Nothing is uploaded. Clearing this site's data deletes your progress, so export a backup now and then (Settings, Backup). You can restore it in any browser.
          </p>
        </section>
      ) : null}

      <section aria-label="AI tutor" className="flex flex-col gap-1.5">
        <h2 className="m-0 text-base font-semibold">{LOCAL ? "3." : "2."} AI tutor</h2>
        <p className="m-0 text-[13px] text-text2">
          {LOCAL
            ? "Chat and AI grading are not available in the browser version yet. Lessons, quizzes and exams work."
            : aiConnected
              ? "Connected. Chat and grading are ready."
              : "Optional. Chat and grading need the runner and a logged-in Claude CLI: run `school up`. Everything else works without it."}
        </p>
      </section>

      {restoring ? <RestoreDialog onClose={() => setRestoring(false)} /> : null}
      {adding && !importing ? (
        <Modal labelId="add-course-title" busy={false} onClose={() => setAdding(false)}>
          <div className="flex flex-col gap-4 px-6 py-5">
            <h2 id="add-course-title" className="m-0 text-xl font-semibold leading-[1.25] tracking-[-0.01em]">
              Import a course
            </h2>
            <ZipDrop onFile={(file) => setImporting({ kind: "zip", file })} />
            <AddPackageForm initialUrl={COURSES_REPO} onCheck={(body) => setImporting({ kind: "repo", body })} />
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
      {importing ? (
        <ImportDialog
          source={importing}
          onClose={() => {
            setImporting(null);
            setAdding(false);
          }}
        />
      ) : null}
    </div>
  );
}
