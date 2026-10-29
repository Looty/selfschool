import { type DragEvent, type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { publishBottom } from "./BottomStack";
import { useDrawerCovers } from "./EditorDrawer";
import { Badge, Button, cx } from "../../ui";
import { formatBytes, languageOf, pickEntry, stdinLines } from "./files";
import { tabRun, useLab } from "./lab";
import { PlayIcon } from "./PlayIcon";
import type { RunFile } from "./protocol";
import { outputHeight, ResizeHandle, useLabSize } from "./resize";
import { putFiles, removeFile, useWorkspace, type FileOrigin } from "./workspace";

const ORIGIN: Record<FileOrigin, string> = { lesson: "from the lesson", yours: "your file", output: "made by a run" };
const LAUNCHER: Record<string, string> = { python: "python", javascript: "node", typescript: "tsx" };
const MAX_UPLOAD = 50 * 1024 * 1024;

/**
 * The docked terminal at the bottom of the lesson: a tab per file, the command line with its arguments, the output,
 * and the extras (input lines, the working folder, the learner's own files). It sits in the page's sticky bottom
 * stack above the ask box, so it is always within reach while reading; the editor drawer opens above it.
 */
export function LabDock() {
  const lab = useLab();
  const files = useWorkspace(lab?.courseId ?? "");
  const [extra, setExtra] = useState<"input" | "files" | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const outRef = useRef<HTMLPreElement>(null);
  const ids = useId();
  const view = lab ? tabRun(lab, lab.active) : null;
  const size = useLabSize();
  const section = useRef<HTMLElement>(null);
  const covers = useDrawerCovers();
  const cornerX = useDrawerEdge(section, !!lab?.editing && !!lab.open && !lab.minimized && !covers, size.width);

  // the terminal's height changes the bottom stack's: tell the editor drawer where to end
  useLayoutEffect(() => publishBottom());

  // keep the newest output in view
  useEffect(() => {
    const el = outRef.current;
    if (el && view && view.output.length > 0) el.scrollTop = el.scrollHeight;
  }, [view]);

  if (!lab?.open) return null;
  const { active } = lab;
  const language = active ? languageOf(active) : null;
  const inFolder = !!active && files.some((f) => f.path === active);
  const canRun = !!language && inFolder;
  const run = view!;
  const inputCount = stdinLines(lab.stdin).length;
  const toggle = (which: "input" | "files") => setExtra((x) => (x === which ? null : which));

  async function addFiles(list: FileList | File[]) {
    if (!lab) return;
    const picked = [...list];
    const tooBig = picked.filter((f) => f.size > MAX_UPLOAD);
    setUploadError(tooBig.length ? `Skipped ${tooBig.map((f) => f.name).join(", ")}: files over ${formatBytes(MAX_UPLOAD)} are not added.` : null);
    const added: RunFile[] = await Promise.all(picked.filter((f) => f.size <= MAX_UPLOAD).map(async (f) => ({ path: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
    if (added.length === 0) return;
    putFiles(lab.courseId, added, "yours");
    // a runnable file the learner just added is what they want: open it in a tab
    const next = pickEntry(added.map((f) => f.path));
    if (next) lab.show(next);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
  }

  function download(f: RunFile) {
    const url = URL.createObjectURL(new Blob([f.data.slice()]));
    const a = document.createElement("a");
    a.href = url;
    a.download = f.path.split("/").pop() ?? f.path;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const stopped = !run.running && run.code === null && run.output.some((c) => c.stream === "note" && c.text === "Stopped.");
  const status = run.running
    ? { tone: "warn" as const, text: run.status ?? "Running…" }
    : stopped
      ? { tone: "neutral" as const, text: "Stopped" }
      : run.code === null
        ? null
        : run.code === 0
          ? { tone: "ok" as const, text: "Finished" }
          : { tone: "bad" as const, text: `Exit code ${run.code}` };
  const edited = (path: string) => !!files.find((f) => f.path === path)?.original;

  return (
    <section
      ref={section}
      aria-label="Terminal"
      className={cx("relative flex flex-col border-t bg-bg", dragging ? "border-accent ring-2 ring-inset ring-accent" : "border-border2")}
      style={{ boxShadow: "0 -10px 28px rgba(11, 18, 32, 0.10)" }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {/* drag the top edge up for a taller terminal */}
      {lab.minimized ? null : <ResizeHandle resizes="height" className="inset-x-0 -top-1.5 h-3" />}
      {/* where the terminal's top edge meets the editor's left edge: drag to resize both, centred on that point */}
      {cornerX === null ? null : <ResizeHandle resizes="both" className="-top-2 z-20 size-4" style={{ left: cornerX - 8 }} />}
      {/* title row: the tabs, the status, Edit / Run / Stop, fold and close */}
      <div className="flex min-h-10 flex-wrap items-center gap-x-1 border-b border-border bg-surface pl-3 pr-2">
        <span className="mr-2 font-mono text-[11px] uppercase tracking-[0.08em] text-text3">Terminal</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center">
          {lab.tabs.map((t) => {
            const r = lab.runs[t];
            return (
              <span key={t} className={cx("group flex h-10 items-center border-b-2", t === active ? "border-accent bg-bg" : "border-transparent")}>
                <button
                  type="button"
                  aria-current={t === active ? "true" : undefined}
                  onClick={() => lab.show(t, lab.editing)}
                  className={cx("flex h-full cursor-pointer items-center gap-1.5 border-0 bg-transparent pl-3 pr-1.5 font-mono text-[12.5px]", t === active ? "text-text" : "text-text2 hover:text-text")}
                >
                  <span className="max-w-[40vw] truncate" title={t}>
                    {t}
                  </span>
                  {/* each state is a glyph for the eye and words for a screen reader */}
                  {edited(t) ? (
                    <>
                      <span className="text-accent" aria-hidden="true">
                        ●
                      </span>
                      <span className="sr-only">, edited</span>
                    </>
                  ) : null}
                  {r?.running ? (
                    <>
                      <span className="spinner text-warn" aria-hidden="true" />
                      <span className="sr-only">, running</span>
                    </>
                  ) : r?.code === 0 ? (
                    <>
                      <span className="text-ok" aria-hidden="true">
                        ✓
                      </span>
                      <span className="sr-only">, finished</span>
                    </>
                  ) : r?.code ? (
                    <>
                      <span className="text-bad" aria-hidden="true">
                        !
                      </span>
                      <span className="sr-only">, exit code {r.code}</span>
                    </>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => lab.closeTab(t)}
                  aria-label={`Close ${t}`}
                  className="mr-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-text3 hover:bg-surface2 hover:text-text"
                >
                  ×
                </button>
              </span>
            );
          })}
          <button
            type="button"
            onClick={() => picker.current?.click()}
            aria-label="Add your own files"
            title="Add your own files"
            className="ml-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-control border-0 bg-transparent text-[16px] text-text2 hover:bg-surface2 hover:text-text"
          >
            +
          </button>
          <input ref={picker} type="file" multiple hidden onChange={(e) => e.target.files && void addFiles(e.target.files).then(() => (e.target.value = ""))} />
        </div>
        <span className="flex items-center gap-1.5 py-1.5">
          <span role="status" className="flex items-center">
            {status ? (
              <Badge tone={status.tone} mono={false}>
                {run.running ? <span className="spinner" aria-hidden="true" /> : null}
                {status.text}
              </Badge>
            ) : null}
          </span>
          {active ? (
            <Button size="sm" aria-pressed={lab.editing} onClick={() => lab.setEditing(!lab.editing)} className={cx(lab.editing && "border-text! bg-surface2!")}>
              {lab.editing ? "Editing" : "Edit"}
            </Button>
          ) : null}
          {run.running ? (
            <Button size="sm" onClick={lab.stop}>
              Stop
            </Button>
          ) : (
            <Button variant="primary" size="sm" disabled={!canRun} onClick={lab.runActive}>
              <PlayIcon />
              Run
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => lab.setMinimized(!lab.minimized)}
            aria-label={lab.minimized ? "Show the terminal" : "Fold the terminal"}
            aria-expanded={!lab.minimized}
            className="px-2!"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={lab.minimized ? "M2.5 7.5 6 4l3.5 3.5" : "M2.5 4.5 6 8l3.5-3.5"} />
            </svg>
          </Button>
          <Button size="sm" onClick={lab.closeDock} aria-label="Close the terminal" className="px-2!">
            <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
            </svg>
          </Button>
        </span>
      </div>

      {lab.minimized ? null : (
        <>
          {active ? (
            <label className="flex items-center gap-2 border-b border-border px-3.5 py-1.5 font-mono text-[13px]">
              <span className="min-w-0 max-w-[60%] select-none truncate text-text3" title={active}>
                $ {language ? LAUNCHER[language] : "run"} {active}
              </span>
              <input
                type="text"
                aria-label="Arguments"
                value={lab.args[active] ?? ""}
                onChange={(e) => lab.setArgs(active, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canRun) lab.runActive();
                }}
                placeholder="arguments (optional)"
                className="min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-[13px] text-text outline-none placeholder:text-text3"
              />
            </label>
          ) : null}

          <div className="flex min-h-0">
            <pre
              ref={outRef}
              data-lab-output=""
              style={{ height: outputHeight(size.height) }}
              role="log"
              aria-label="Output"
              // biome-ignore lint/a11y/noNoninteractiveTabindex: the output scrolls, and keyboard users must be able to scroll it
              tabIndex={0}
              className="m-0 h-[min(220px,26vh)] min-w-0 flex-1 overflow-auto [@media(max-height:600px)]:h-[min(120px,22vh)] whitespace-pre-wrap break-words bg-surface px-3.5 py-2.5 font-mono text-[12.5px] leading-relaxed"
            >
              {run.output.length === 0 ? (
                <span className="text-text3">
                  {run.running
                    ? (run.status ?? "Starting…")
                    : active
                      ? lab.loading && !inFolder
                        ? `Loading ${active}…`
                        : canRun
                          ? "Press Run (or Enter in the command line). Output appears here."
                          : `${active} cannot run here; download it to use it on your computer.`
                      : "Run a lab from the lesson, or add your own file with +."}
                </span>
              ) : (
                run.output.map((c, i) => (
                  <span key={i} className={cx(c.stream === "stderr" && "text-bad", c.stream === "note" && "mt-2 block rounded-lg bg-warn-bg px-2.5 py-2 font-sans text-[13px] text-warn")}>
                    {c.text}
                  </span>
                ))
              )}
            </pre>

            {extra === "input" ? (
              <div className="flex w-[min(320px,40%)] shrink-0 flex-col gap-1.5 border-l border-border px-3 py-2.5 text-[13px]">
                <label htmlFor={`${ids}-stdin`} className="text-text2">
                  Input lines, one per input() call
                </label>
                <textarea
                  id={`${ids}-stdin`}
                  value={lab.stdin}
                  onChange={(e) => lab.setStdin(e.target.value)}
                  placeholder={"I feel tired\nquit"}
                  className="min-h-0 flex-1 resize-none rounded-control border border-border2 bg-bg p-2 font-mono text-text"
                />
              </div>
            ) : null}

            {extra === "files" ? (
              <div className="w-[min(380px,45%)] shrink-0 overflow-auto border-l border-border px-3 py-2.5 text-[13px]">
                <p className="m-0 mb-1.5 text-text3">This course's working folder: lesson files, your files and what runs write.</p>
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                  {files.map((f) => (
                    <li key={f.path} className="flex flex-wrap items-center gap-x-2">
                      <span className="font-mono">{f.path}</span>
                      <span className="text-text3">
                        {formatBytes(f.data.length)} · {f.original ? "edited" : ORIGIN[f.origin]}
                      </span>
                      <span className="ml-auto flex gap-2">
                        <button type="button" onClick={() => lab.show(f.path, true)} className="cursor-pointer border-0 bg-transparent p-0 text-accent hover:underline">
                          Open
                        </button>
                        <button type="button" onClick={() => download(f)} className="cursor-pointer border-0 bg-transparent p-0 text-accent hover:underline">
                          Download
                        </button>
                        {f.origin !== "lesson" ? (
                          <button
                            type="button"
                            onClick={() => removeFile(lab.courseId, f.path)}
                            aria-label={`Remove ${f.path}`}
                            className="cursor-pointer border-0 bg-transparent p-0 text-text3 hover:text-text"
                          >
                            Remove
                          </button>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          {lab.loadError || uploadError ? (
            <p role="alert" className="m-0 border-t border-border px-3.5 py-1.5 text-[13px] text-bad">
              {lab.loadError ?? uploadError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-1 border-t border-border px-2 py-1 text-xs">
            <button type="button" aria-expanded={extra === "input"} onClick={() => toggle("input")} className={footerButton(extra === "input")}>
              Input lines{inputCount ? ` (${inputCount})` : ""}
            </button>
            <button type="button" aria-expanded={extra === "files"} onClick={() => toggle("files")} className={footerButton(extra === "files")}>
              Files ({files.length})
            </button>
            <span
              className="ml-auto flex items-center gap-1.5 px-1.5 text-text3"
              title="Code runs inside this browser tab. It cannot read or change anything on your computer, your Selfschool data or your local network; it can download from the public internet."
            >
              <svg width="11" height="12" viewBox="0 0 11 12" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                <rect x="1" y="5" width="9" height="6.5" rx="1.5" />
                <path d="M3 5V3.5a2.5 2.5 0 0 1 5 0V5" />
              </svg>
              Sandboxed in your browser
            </span>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Where the editor drawer's left edge is, in pixels from the terminal's left, while `on`; null otherwise. Kept
 * current as the drawer's width or the window changes.
 */
function useDrawerEdge(section: RefObject<HTMLElement | null>, on: boolean, width: number | null): number | null {
  const [x, setX] = useState<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: width is a trigger; the drawer is measured, not read from it
  useLayoutEffect(() => {
    const drawer = document.querySelector<HTMLElement>("[data-lab-drawer]");
    const el = section.current;
    if (!on || !drawer || !el) {
      setX(null);
      return;
    }
    const measure = () => setX(Math.round(drawer.getBoundingClientRect().left - el.getBoundingClientRect().left));
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(drawer);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [section, on, width]);
  return x;
}

const footerButton = (on: boolean) =>
  cx("cursor-pointer rounded-control border-0 px-2 py-1 text-xs hover:bg-surface2 hover:text-text", on ? "bg-surface2 text-text" : "bg-transparent text-text2");
