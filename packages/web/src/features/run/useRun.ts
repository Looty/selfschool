import { useCallback, useEffect, useRef, useState } from "react";
import { languageOf } from "./files";
import type { RunEvent, RunLanguage, RunRequest } from "./protocol";
import { listFiles, putFiles } from "./workspace";

export interface OutputChunk {
  stream: "stdout" | "stderr" | "note";
  text: string;
}

export interface RunState {
  running: boolean;
  /** What the worker is doing ("Loading Python…", "Running…"); null when idle. */
  status: string | null;
  output: OutputChunk[];
  /** Exit code of the last finished run; null while running or before the first run. */
  code: number | null;
}

export type CreateWorker = (language: RunLanguage) => Worker;

/** Each language runs in its own module worker (see python.worker.ts and js.worker.ts). */
export const createRunWorker: CreateWorker = (language) =>
  language === "python"
    ? new Worker(new URL("./python.worker.ts", import.meta.url), { type: "module" })
    : new Worker(new URL("./js.worker.ts", import.meta.url), { type: "module" });

const MAX_OUTPUT = 200_000;
const IDLE: RunState = { running: false, status: null, output: [], code: null };

/** Adds a chunk, merging it into the previous one of the same stream and capping the total size. */
export function appendOutput(output: OutputChunk[], chunk: OutputChunk): OutputChunk[] {
  const size = output.reduce((n, c) => n + c.text.length, 0);
  if (size >= MAX_OUTPUT) return output;
  const text = size + chunk.text.length > MAX_OUTPUT ? `${chunk.text.slice(0, MAX_OUTPUT - size)}\n… output cut here (too long to show)\n` : chunk.text;
  const last = output[output.length - 1];
  if (last && last.stream === chunk.stream) return [...output.slice(0, -1), { ...last, text: last.text + text }];
  return [...output, { stream: chunk.stream, text }];
}

/** A plain-words hint for the errors that mean "this cannot run in the browser". */
export function hintFor(language: RunLanguage, output: OutputChunk[]): string | null {
  const err = output.filter((c) => c.stream === "stderr").map((c) => c.text).join("");
  const py = /No module named '([^'.]+)/.exec(err);
  if (language === "python" && py) {
    return `The package '${py[1]}' is not available in the browser runner (torch and most GPU libraries are not). Download the file and run it on your computer.`;
  }
  const js = /'([^']+)' is a Node or npm module/.exec(err);
  if (js) return `'${js[1]}' needs Node.js or npm. Download the file and run it on your computer.`;
  // the working folder lives in this tab, so a file an earlier lab wrote is gone after a reload
  const missing = /No such file or directory: '([^']+)'/.exec(err);
  if (missing) {
    return `'${missing[1]}' is not in the working folder yet. If another script in this lab creates it, run that one first; or add the file with Add files.`;
  }
  return null;
}

/**
 * Runs files from a course's working folder. Python keeps one worker alive between runs (Pyodide is slow to load);
 * JavaScript gets a fresh worker per run, ended when the run finishes, and a worker that is not the current run's is
 * never listened to, so timers from an earlier run cannot print into the next one. Stop ends the worker outright,
 * which also stops a program stuck in a loop.
 */
export function useRun(courseId: string, create: CreateWorker = createRunWorker) {
  const [state, setState] = useState<RunState>(IDLE);
  const workers = useRef(new Map<RunLanguage, Worker>());
  const active = useRef<{ worker: Worker; language: RunLanguage } | null>(null);

  const drop = useCallback((language: RunLanguage) => {
    workers.current.get(language)?.terminate();
    workers.current.delete(language);
  }, []);

  useEffect(() => {
    const all = workers.current;
    return () => {
      for (const w of all.values()) w.terminate();
      all.clear();
    };
  }, []);

  const run = useCallback(
    (v: { entry: string; args: string[]; stdin: string[] }) => {
      const language = languageOf(v.entry);
      if (!language || active.current) return;
      if (language !== "python") drop(language);
      let worker = workers.current.get(language);
      if (!worker) {
        worker = create(language);
        workers.current.set(language, worker);
      }
      const current = { worker, language };
      active.current = current;
      setState({ running: true, status: "Starting…", output: [], code: null });

      // Only the current run may report. Anything else from a worker (a JS timer firing after its run, an error from a
      // worker being replaced) is ignored, so it can never write into, or end, another run.
      const isCurrent = () => active.current === current;
      worker.onmessage = (e: MessageEvent<RunEvent>) => {
        if (!isCurrent()) return;
        const ev = e.data;
        if (ev.type === "status") setState((s) => ({ ...s, status: ev.text }));
        else if (ev.type === "out") setState((s) => ({ ...s, output: appendOutput(s.output, { stream: ev.stream, text: ev.text }) }));
        else if (ev.type === "files") putFiles(courseId, ev.files, "output");
        else if (ev.type === "done") {
          active.current = null;
          // a JS program's timers would keep running in its worker after "done": end the worker with the run
          if (language !== "python") drop(language);
          setState((s) => {
            const hint = ev.code !== 0 ? hintFor(language, s.output) : null;
            return { running: false, status: null, code: ev.code, output: hint ? appendOutput(s.output, { stream: "note", text: hint }) : s.output };
          });
        }
      };
      worker.onerror = (e) => {
        e.preventDefault();
        if (!isCurrent()) return;
        active.current = null;
        drop(language);
        setState((s) => ({ running: false, status: null, code: 1, output: appendOutput(s.output, { stream: "stderr", text: `${e.message || "The runner stopped unexpectedly."}\n` }) }));
      };

      // copies, not transfers: the working folder keeps its own bytes
      const files = listFiles(courseId).map((f) => ({ path: f.path, data: f.data.slice() }));
      const req: RunRequest = { type: "run", language, files, entry: v.entry, args: v.args, stdin: v.stdin };
      worker.postMessage(req);
    },
    [courseId, create, drop],
  );

  const stop = useCallback(() => {
    const a = active.current;
    if (!a) return;
    active.current = null;
    drop(a.language);
    setState((s) => ({ running: false, status: null, code: null, output: appendOutput(s.output, { stream: "note", text: "Stopped." }) }));
  }, [drop]);

  const clear = useCallback(() => setState((s) => (s.running ? s : IDLE)), []);

  return { ...state, run, stop, clear };
}
