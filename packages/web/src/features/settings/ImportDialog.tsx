import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CourseChoice, PackageInfo, PackagePreview } from "@selfschool/shared";
import { ApiError, callApi, installZip, previewRepo, previewZip } from "../../api/client";
import { Button, cx } from "../../ui";
import { Modal } from "./Modal";
import { formatBytes } from "./prefs";

/** What the user handed over: a dropped zip, or a repo / folder from the add form. */
export type ImportSource = { kind: "zip"; file: File } | { kind: "repo"; body: { url: string; path: string; ref: string } };

type Phase =
  | { name: "uploading"; fraction: number }
  | { name: "checking" }
  | { name: "ready"; preview: PackagePreview }
  | { name: "installing"; preview: PackagePreview; fraction: number }
  | { name: "done"; preview: PackagePreview; info: PackageInfo }
  // a repository with several courses: install the ticked ones one by one
  | { name: "installingMany"; preview: PackagePreview; done: number; total: number }
  | { name: "doneMany"; preview: PackagePreview; results: { path: string; title: string; error?: string }[] }
  | { name: "failed"; message: string; preview?: PackagePreview };

const STEPS_ZIP = ["Upload the file", "Read the archive safely", "Find course.yaml", "Validate the package", "Course id is free"];
const STEPS_REPO = ["Fetch the package", "Find course.yaml", "Validate the package", "Course id is free"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The popup behind every course import. It runs the dry-run checks as soon as it opens (nothing is installed),
 * shows each step, then a quick glance at the chapters, lessons and quizzes, and installs only on "Import course".
 */
export function ImportDialog({ source, onClose }: { source: ImportSource; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>(source.kind === "zip" ? { name: "uploading", fraction: 0 } : { name: "checking" });
  const qc = useQueryClient();
  const abort = useRef(new AbortController());
  // which courses are ticked when the repository holds several (by path)
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // run the dry run once; a fresh controller per run, because React's dev double-mount aborts the first one
  useEffect(() => {
    const ctl = new AbortController();
    abort.current = ctl;
    const run =
      source.kind === "zip"
        ? previewZip(source.file, (f) => setPhase((p) => (p.name === "uploading" ? { name: f >= 1 ? "checking" : "uploading", fraction: f } as Phase : p)), ctl.signal)
        : previewRepo(source.body, ctl.signal);
    run.then(
      (preview) => {
        setSelected(new Set((preview.choices ?? []).filter(importable).map((c) => c.path)));
        setPhase({ name: "ready", preview });
      },
      (e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setPhase({ name: "failed", message: e instanceof ApiError ? e.message : "Something went wrong while checking the course." });
      },
    );
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = phase.name === "uploading" || phase.name === "checking" || phase.name === "installing" || phase.name === "installingMany";
  const close = () => {
    abort.current.abort();
    onClose();
  };

  async function confirm(preview: PackagePreview) {
    setPhase({ name: "installing", preview, fraction: 0 });
    try {
      const info =
        source.kind === "zip"
          ? await installZip(source.file, (fraction) => setPhase((p) => (p.name === "installing" ? { ...p, fraction } : p)))
          : await callApi("addPackage", { body: (source as Extract<ImportSource, { kind: "repo" }>).body });
      await Promise.all(["packages", "courses", "dashboard"].map((n) => qc.invalidateQueries({ queryKey: ["api", n] })));
      await qc.invalidateQueries({ queryKey: ["removed"] });
      setPhase({ name: "done", preview, info });
    } catch (e) {
      setPhase({ name: "failed", message: e instanceof ApiError ? e.message : "Could not add the course.", preview });
    }
  }

  /** Installs the ticked courses of a multi-course repository, one request each; a failure does not stop the rest. */
  async function confirmMany(preview: PackagePreview) {
    if (source.kind !== "repo") return;
    const chosen = (preview.choices ?? []).filter((c) => selected.has(c.path));
    const results: { path: string; title: string; error?: string }[] = [];
    for (const [i, c] of chosen.entries()) {
      setPhase({ name: "installingMany", preview, done: i, total: chosen.length });
      try {
        await callApi("addPackage", { body: { ...source.body, path: c.path } });
        results.push({ path: c.path, title: c.title });
      } catch (e) {
        results.push({ path: c.path, title: c.title, error: e instanceof ApiError ? e.message : "could not add this course" });
      }
    }
    await Promise.all(["packages", "courses", "dashboard"].map((n) => qc.invalidateQueries({ queryKey: ["api", n] })));
    await qc.invalidateQueries({ queryKey: ["removed"] });
    setPhase({ name: "doneMany", preview, results });
  }

  const preview = "preview" in phase ? phase.preview : undefined;
  const choices = preview?.choices?.length ? preview.choices : undefined;
  const name = source.kind === "zip" ? source.file.name : source.body.url;
  const stepLabels = source.kind === "zip" ? STEPS_ZIP : STEPS_REPO;

  return (
    <Modal labelId="import-title" busy={busy} onClose={close}>
      <>
        <div className="border-b border-border px-6 pb-4 pt-5">
          <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text3">{phase.name === "done" ? "Course added" : phase.name === "doneMany" ? "Courses added" : choices ? "Add courses" : "Add a course"}</div>
          <h2 id="import-title" className="m-0 mt-1 break-all text-xl font-semibold leading-[1.25] tracking-[-0.01em]">
            {preview?.course?.title ?? name}
          </h2>
          <div className="mt-1 break-all font-mono text-xs text-text3">
            {choices
              ? `${plural(choices.length, "course")} in this repository`
              : preview
                ? `${preview.course?.id ?? preview.fileName} · ${plural(preview.fileCount, "file")} · ${formatBytes(preview.sizeBytes)}`
                : source.kind === "zip"
                  ? formatBytes(source.file.size)
                  : "from a repository"}
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-5 overflow-y-auto px-6 py-5">
          {phase.name === "failed" && !preview ? (
            <p role="alert" className="m-0 text-[13px] text-bad">
              {phase.message}
            </p>
          ) : choices ? (
            <ChoiceList
              choices={choices}
              selected={selected}
              locked={phase.name !== "ready"}
              results={phase.name === "doneMany" ? phase.results : undefined}
              progress={phase.name === "installingMany" ? phase : undefined}
              onChange={setSelected}
            />
          ) : (
            <Steps labels={stepLabels} phase={phase} preview={preview} />
          )}

          {phase.name === "failed" && preview ? (
            <p role="alert" className="m-0 text-[13px] text-bad">
              {phase.message}
            </p>
          ) : null}

          {preview && preview.issues.length > 0 ? (
            <div>
              <div className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-text3">What to fix</div>
              <ul className="m-0 flex max-h-48 list-none flex-col gap-1.5 overflow-y-auto rounded-control border border-border bg-bad-bg p-3 text-[13px]">
                {preview.issues.map((i, n) => (
                  <li key={n}>
                    <span className="font-mono text-xs text-bad">{i.file}</span> <span className="text-text2">{i.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview?.course ? <Glance course={preview.course} /> : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4">
          {choices && phase.name !== "failed" ? (
            phase.name === "doneMany" ? (
              <>
                <span className="mr-auto text-[13px] text-text2" role="status">
                  {plural(phase.results.filter((r) => !r.error).length, "course")} added
                  {phase.results.some((r) => r.error) ? `, ${phase.results.filter((r) => r.error).length} failed` : ""}.
                </span>
                <Button size="sm" onClick={close}>
                  Close
                </Button>
                <Button size="sm" variant="primary" to="/courses">
                  Open courses
                </Button>
              </>
            ) : (
              <>
                <span className="mr-auto text-[13px] text-text2">
                  {phase.name === "installingMany" ? `Importing ${phase.done + 1} of ${phase.total}…` : `${selected.size} of ${choices.filter(importable).length} selected`}
                </span>
                <Button size="sm" onClick={close} disabled={busy}>
                  Cancel
                </Button>
                <Button size="sm" variant="primary" disabled={phase.name !== "ready" || selected.size === 0} onClick={() => phase.name === "ready" && void confirmMany(phase.preview)}>
                  {phase.name === "installingMany" ? "Importing…" : selected.size === 1 ? "Import 1 course" : `Import ${selected.size} courses`}
                </Button>
              </>
            )
          ) : phase.name === "done" ? (
            <>
              <span className="mr-auto text-[13px] text-ok" role="status">
                Added to your courses.
              </span>
              <Button size="sm" onClick={close}>
                Close
              </Button>
              <Button size="sm" variant="primary" to={`/courses/${phase.info.id}`}>
                Open course
              </Button>
            </>
          ) : (
            <>
              {preview && preview.conflict === "update" && phase.name === "ready" ? (
                <span className="mr-auto text-[13px] text-text2">This replaces the version you have. Your progress stays.</span>
              ) : null}
              <Button size="sm" onClick={close} disabled={phase.name === "installing"}>
                {phase.name === "failed" || (preview && !preview.ok) ? "Close" : "Cancel"}
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={phase.name !== "ready" || !phase.preview.ok}
                onClick={() => phase.name === "ready" && void confirm(phase.preview)}
                title={phase.name === "ready" && !phase.preview.ok ? "Fix the problems above first" : undefined}
              >
                {phase.name === "installing" ? "Importing…" : preview?.conflict === "update" ? "Replace course" : "Import course"}
              </Button>
            </>
          )}
        </div>
      </>
    </Modal>
  );
}

// ---------- several courses in one repository ----------

/** A course that can be ticked: it validates and its id is free or comes from this same repository. */
const importable = (c: CourseChoice) => c.ok && c.conflict !== "clash";

function ChoiceList({
  choices,
  selected,
  locked,
  results,
  progress,
  onChange,
}: {
  choices: CourseChoice[];
  selected: Set<string>;
  locked: boolean;
  results: { path: string; title: string; error?: string }[] | undefined;
  progress: { done: number; total: number } | undefined;
  onChange: (next: Set<string>) => void;
}) {
  const ready = choices.filter(importable);
  const toggle = (path: string) => {
    const next = new Set(selected);
    if (!next.delete(path)) next.add(path);
    onChange(next);
  };
  const state = (c: CourseChoice) => {
    const r = results?.find((x) => x.path === c.path);
    if (r) return r.error ? { text: r.error, tone: "bad" as const } : { text: "Added", tone: "ok" as const };
    if (!c.ok) return { text: "Does not validate", tone: "bad" as const };
    if (c.conflict === "clash") return { text: "Already installed from another source", tone: "muted" as const };
    if (c.conflict === "update") return { text: "Installed; import replaces it", tone: "muted" as const };
    return { text: "New", tone: "ok" as const };
  };
  return (
    <div className="flex flex-col gap-3">
      {!results && ready.length > 1 ? (
        <div className="flex items-center gap-3 text-[13px]">
          <button type="button" disabled={locked} onClick={() => onChange(new Set(ready.map((c) => c.path)))} className="cursor-pointer border-0 bg-transparent p-0 text-accent underline-offset-2 hover:underline disabled:opacity-50">
            Select all
          </button>
          <button type="button" disabled={locked} onClick={() => onChange(new Set())} className="cursor-pointer border-0 bg-transparent p-0 text-accent underline-offset-2 hover:underline disabled:opacity-50">
            Select none
          </button>
        </div>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Courses in this repository">
        {choices.map((c, i) => {
          const s = state(c);
          const can = importable(c) && !results;
          const running = progress && selected.has(c.path) && [...choices.filter((x) => selected.has(x.path))].findIndex((x) => x.path === c.path) === progress.done;
          return (
            <li key={c.path}>
              <label
                className={cx(
                  "flex items-start gap-3 rounded-control border border-border bg-surface px-3.5 py-3",
                  can && !locked ? "cursor-pointer hover:border-border2" : "cursor-default",
                  !importable(c) && !results && "opacity-60",
                )}
              >
                <input type="checkbox" className="mt-1 h-4 w-4 flex-none accent-[var(--accent)]" checked={selected.has(c.path)} disabled={!can || locked} onChange={() => toggle(c.path)} aria-describedby={`choice-${i}`} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium leading-snug">{c.title}</span>
                  <span className="break-all font-mono text-xs text-text3">
                    {c.path}
                    {c.lessonCount ? ` · ${plural(c.lessonCount, "lesson")}` : ""}
                    {c.level ? ` · ${c.level}` : ""}
                  </span>
                </span>
                <span id={`choice-${i}`} className={cx("flex-none pt-0.5 text-right text-xs", s.tone === "ok" && "text-ok", s.tone === "bad" && "text-bad", s.tone === "muted" && "text-text3")}>
                  {running ? <span className="spinner text-text2" aria-label="importing" /> : s.text}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------- the steps ----------

function Steps({ labels, phase, preview }: { labels: string[]; phase: Phase; preview: PackagePreview | undefined }) {
  // before the server answers, the planned steps show with a spinner on the current one
  const rows = preview
    ? preview.checks.map((c) => ({ label: c.label, state: c.ok ? ("ok" as const) : ("bad" as const), detail: c.detail }))
    : labels.map((label, i) => ({
        label,
        state: i === 0 ? (phase.name === "uploading" ? ("running" as const) : ("ok" as const)) : phase.name === "uploading" ? ("todo" as const) : i === 1 ? ("running" as const) : ("todo" as const),
        detail: i === 0 && phase.name === "uploading" ? `${Math.round(phase.fraction * 100)}%` : undefined,
      }));
  const uploadRow = preview && labels[0] === STEPS_ZIP[0] ? [{ label: "Upload the file", state: "ok" as const, detail: undefined }] : [];
  return (
    <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Checks">
      {[...uploadRow, ...rows].map((r) => (
        <li key={r.label} className="flex items-baseline gap-3 text-[13px]">
          <span
            aria-hidden="true"
            className={cx("w-4 flex-none text-center font-mono", r.state === "ok" && "text-ok", r.state === "bad" && "text-bad", r.state === "todo" && "text-text3")}
          >
            {r.state === "ok" ? "✓" : r.state === "bad" ? "✕" : r.state === "running" ? <span className="spinner text-text2" /> : "·"}
          </span>
          <span className={cx(r.state === "todo" ? "text-text3" : "text-text", r.state === "bad" && "font-medium")}>{r.label}</span>
          <span className="sr-only">{r.state === "ok" ? "passed" : r.state === "bad" ? "failed" : r.state === "running" ? "in progress" : "waiting"}</span>
          {r.detail ? <span className={cx("min-w-0 break-words text-xs", r.state === "bad" ? "text-bad" : "text-text3")}>{r.detail}</span> : null}
        </li>
      ))}
    </ol>
  );
}

// ---------- the quick glance ----------

function Glance({ course }: { course: NonNullable<PackagePreview["course"]> }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text3">At a glance</div>
      {course.shortIntro ? <p className="m-0 text-[13px] text-text2">{course.shortIntro}</p> : null}
      <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-text2">
        <span>{plural(course.chapters.length, "chapter")}</span>
        <span>{plural(course.lessonCount, "lesson")}</span>
        <span>{plural(course.quizCount, "quiz", "quizzes")}</span>
        <span>{plural(course.questionCount, "question")}</span>
        <span>{plural(course.examCount, "exam")}</span>
        <span>{course.level}</span>
      </div>
      <div className="flex max-h-72 flex-col gap-3 overflow-y-auto rounded-control border border-border bg-surface p-3.5">
        {course.chapters.map((ch, i) => (
          <div key={ch.dir} className="flex flex-col gap-1">
            <div className="text-[13px] font-medium">
              <span className="font-mono text-text3">{i + 1}</span> {ch.title}
            </div>
            {ch.lessons.length === 0 ? <div className="pl-5 text-xs text-text3">No lessons.</div> : null}
            {ch.lessons.map((l) => (
              <div key={l.id} className="flex flex-wrap items-baseline gap-x-3 pl-5 text-[13px]">
                <span className="text-text2">{l.title}</span>
                {l.quiz ? (
                  <span className="font-mono text-xs text-text3">
                    quiz · {plural(l.quiz.questions, "question")} · {l.quiz.types.join(", ")}
                  </span>
                ) : (
                  <span className="font-mono text-xs text-text3">no quiz</span>
                )}
              </div>
            ))}
          </div>
        ))}
        {course.exams.map((e) => (
          <div key={e.id} className="flex flex-wrap items-baseline gap-x-3 border-t border-border pt-2.5 text-[13px]">
            <span className="font-medium">Exam: {e.title}</span>
            <span className="font-mono text-xs text-text3">
              {e.minutes} min · {plural(e.questions, "question")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
