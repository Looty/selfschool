import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { languageOf, splitArgs, stdinLines } from "./files";
import { type CreateWorker, createRunWorker, type OutputChunk, useRun } from "./useRun";
import { hasFile, needsLessonFile, putFiles, useWorkspace } from "./workspace";

/** What the dock shows for one file: its last (or current) run. */
export interface TabRun {
  output: OutputChunk[];
  /** Exit code once finished; null while running, before a run, or after Stop. */
  code: number | null;
  running: boolean;
  /** What the runner is doing ("Loading Python…"); null when idle. */
  status: string | null;
}

const NO_RUN: TabRun = { output: [], code: null, running: false, status: null };

/**
 * The lab of a lesson page: one run engine, the docked terminal's tabs, and the editor drawer. The Lab card, the Run
 * buttons in the lesson text, the dock and the drawer all act through this, so a Run anywhere lands in the one dock.
 * It lives as long as the lesson page, so the dock (and Python, once loaded) carries over from lesson to lesson.
 */
export interface Lab {
  courseId: string;
  /** Files open in the dock, in tab order. */
  tabs: string[];
  /** The tab shown (and run); null with no file open yet. */
  active: string | null;
  /** Each file's last run; `runs[active]` is what the terminal shows. */
  runs: Record<string, TabRun>;
  /** A run is going (for any file). */
  running: boolean;
  /** The dock is shown (anything was run or opened); `minimized` folds it to its title row. */
  open: boolean;
  minimized: boolean;
  /** The editor drawer shows `active`. */
  editing: boolean;
  /** Command-line arguments per file, as typed. */
  args: Record<string, string>;
  /** Input lines for input()/prompt(), shared by the runs. */
  stdin: string;
  /** A lesson file is still being fetched into the working folder. */
  loading: boolean;
  loadError: string | null;
  /** Opens `entry` in the dock and runs it now (stopping a run in progress); `args` replaces its arguments when given. */
  run: (entry: string, args?: string) => void;
  /** Runs the active tab with its arguments. */
  runActive: () => void;
  stop: () => void;
  /** Opens `entry` in a dock tab without running it; `edit` also opens the editor drawer on it. */
  show: (entry: string, edit?: boolean) => void;
  /** Opens the dock with no file chosen, to add the learner's own. */
  openEmpty: () => void;
  closeTab: (entry: string) => void;
  setEditing: (on: boolean) => void;
  setMinimized: (on: boolean) => void;
  closeDock: () => void;
  setArgs: (entry: string, args: string) => void;
  setStdin: (text: string) => void;
}

const LabContext = createContext<Lab | null>(null);

/** The page's lab, or null outside a LabProvider (the article then shows no Run buttons). */
export const useLab = () => useContext(LabContext);

export function LabProvider({
  courseId,
  resources,
  createWorker = createRunWorker,
  children,
}: {
  courseId: string;
  /** The current lesson's files; put in the working folder as they are needed. */
  resources: readonly { name: string; url: string }[];
  createWorker?: CreateWorker;
  children: ReactNode;
}) {
  const engine = useRun(courseId, createWorker);
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [editing, setEditing] = useState(false);
  const [args, setArgsState] = useState<Record<string, string>>({});
  const [stdin, setStdin] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, TabRun>>({});
  // the file the engine's current (or last) run belongs to
  const [ranEntry, setRanEntry] = useState<string | null>(null);
  // a run asked for while its file is still loading, or while another run is being stopped
  const pending = useRef<{ entry: string; args: string } | null>(null);

  // put the lesson's files in the working folder (once per tab; a learner's edit or own file of the same name wins)
  const resourceKey = resources.map((r) => r.url).join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `resources` is captured through `resourceKey`
  useEffect(() => {
    // a lesson change starts clean: no "Loading…" or error left over from the previous lesson
    setLoadError(null);
    const missing = resources.filter((r) => needsLessonFile(courseId, r));
    if (missing.length === 0) {
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    // each file on its own: one missing file must not keep the others out of the folder
    Promise.allSettled(
      missing.map(async (r) => {
        const res = await fetch(r.url);
        if (!res.ok) throw new Error(`${r.name}: ${res.status}`);
        return { path: r.name, url: r.url, data: new Uint8Array(await res.arrayBuffer()) };
      }),
    ).then((results) => {
      // the bytes belong to the course's folder whichever lesson is shown now
      putFiles(courseId, results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])), "lesson");
      if (!live) return;
      const failed = results.flatMap((r, i) => (r.status === "rejected" ? [missing[i]!.name] : []));
      setLoadError(failed.length ? `Could not load ${failed.join(", ")} from the lesson. Reload the page to try again.` : null);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [courseId, resourceKey]);

  // the engine's output belongs to the file it ran: keep it on that file's tab
  useEffect(() => {
    if (!ranEntry) return;
    setRuns((r) => ({ ...r, [ranEntry]: { output: engine.output, code: engine.code, running: engine.running, status: engine.status } }));
  }, [ranEntry, engine.output, engine.code, engine.running, engine.status]);

  const openTab = useCallback((entry: string) => {
    setTabs((t) => (t.includes(entry) ? t : [...t, entry]));
    setActive(entry);
    setOpen(true);
    setMinimized(false);
  }, []);

  const { run: start, stop: stopEngine, running } = engine;
  const tryStart = useCallback(() => {
    const p = pending.current;
    if (!p || running || !languageOf(p.entry) || !hasFile(courseId, p.entry)) return;
    pending.current = null;
    setRanEntry(p.entry);
    start({ entry: p.entry, args: splitArgs(p.args), stdin: stdinLines(stdin) });
  }, [courseId, running, start, stdin]);

  // a waiting run starts once its file has arrived and nothing else is running
  const files = useWorkspace(courseId);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `files` changes when a lesson file arrives
  useEffect(() => tryStart(), [tryStart, files]);

  const runNow = useCallback(
    (entry: string, given?: string) => {
      openTab(entry);
      if (given !== undefined) setArgsState((s) => ({ ...s, [entry]: given }));
      pending.current = { entry, args: given ?? args[entry] ?? "" };
      // the click means "run this now": a run still going is stopped first, and this one starts after it
      if (running) stopEngine();
      else tryStart();
    },
    [args, openTab, running, stopEngine, tryStart],
  );
  // one stable `run` for the whole page: the lesson's Run buttons (in every code block) need not re-render with it
  const latestRun = useRef(runNow);
  latestRun.current = runNow;
  const run = useCallback((entry: string, given?: string) => latestRun.current(entry, given), []);

  const lab = useMemo<Lab>(
    () => ({
      courseId,
      tabs,
      active,
      runs,
      running,
      open,
      minimized,
      editing: editing && active !== null,
      args,
      stdin,
      loading,
      loadError,
      run,
      runActive: () => {
        if (active) run(active);
      },
      stop: () => {
        pending.current = null;
        stopEngine();
      },
      show: (entry, edit = false) => {
        openTab(entry);
        if (edit) setEditing(true);
      },
      openEmpty: () => {
        setOpen(true);
        setMinimized(false);
      },
      closeTab: (entry) => {
        // closing a file's tab also ends its run, or its run waiting to start: nothing keeps going out of sight
        if (pending.current?.entry === entry) pending.current = null;
        if (running && ranEntry === entry) stopEngine();
        const next = tabs.filter((x) => x !== entry);
        setTabs(next);
        if (active === entry) setActive(next[next.length - 1] ?? null);
        if (next.length === 0) setEditing(false);
      },
      setEditing,
      setMinimized,
      closeDock: () => {
        pending.current = null;
        if (running) stopEngine();
        setOpen(false);
        setEditing(false);
      },
      setArgs: (entry, a) => setArgsState((s) => ({ ...s, [entry]: a })),
      setStdin,
    }),
    [courseId, tabs, active, runs, running, ranEntry, open, minimized, editing, args, stdin, loading, loadError, run, stopEngine, openTab],
  );

  return <LabContext.Provider value={lab}>{children}</LabContext.Provider>;
}

/** The run shown on a tab: its last run, or nothing yet. */
export const tabRun = (lab: Lab, entry: string | null): TabRun => (entry ? (lab.runs[entry] ?? NO_RUN) : NO_RUN);
