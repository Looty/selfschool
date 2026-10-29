/// <reference lib="webworker" />
// Runs a Python file with Pyodide (CPython compiled to WebAssembly) inside this worker. The code sees only the virtual
// working folder below; it has no access to the learner's disk, shell or programs. Pyodide loads from the CDN on the
// first run (about 10 MB, then cached by the browser) and stays loaded for later runs until the page stops the worker.
import { NO_MORE_INPUT, type RunEvent, type RunFile, type RunRequest } from "./protocol";
import { lockDown } from "./sandbox";

lockDown(self as unknown as DedicatedWorkerGlobalScope);

const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";
const WORK = "/home/pyodide/work";

interface Pyodide {
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array;
    readdir(path: string): string[];
    stat(path: string): { mode: number; size: number };
    isDir(mode: number): boolean;
    chdir(path: string): void;
  };
  globals: { set(name: string, value: unknown): void };
  setStdout(o: { batched: (s: string) => void }): void;
  setStderr(o: { batched: (s: string) => void }): void;
  loadPackage(names: string | string[], o?: { messageCallback?: (m: string) => void; errorCallback?: (m: string) => void }): Promise<unknown>;
  loadPackagesFromImports(code: string, o?: { messageCallback?: (m: string) => void; errorCallback?: (m: string) => void }): Promise<unknown>;
  runPythonAsync(code: string): Promise<unknown>;
}

const post = (e: RunEvent, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(e, transfer);
let pyodide: Promise<Pyodide> | null = null;

async function load(): Promise<Pyodide> {
  post({ type: "status", text: "Loading Python (the first run downloads about 10 MB)…" });
  const mod = (await import(/* @vite-ignore */ `${PYODIDE_URL}pyodide.mjs`)) as { loadPyodide: (o: { indexURL: string }) => Promise<Pyodide> };
  return mod.loadPyodide({ indexURL: PYODIDE_URL });
}

// Runs the entry as __main__ with the given argv and input lines, then reports the exit code. Frames from this wrapper
// and runpy are cut from tracebacks so the learner sees only their own file. Modules from the working folder are
// dropped from sys.modules first, so an edited helper (minigpt.py) is imported fresh.
const RUNNER = `
import builtins, os, runpy, sys, traceback
for _name, _mod in list(sys.modules.items()):
    if (getattr(_mod, "__file__", None) or "").startswith(_work + "/"):
        del sys.modules[_name]
if _work not in sys.path:
    sys.path.insert(0, _work)
sys.argv = [_entry] + list(_args)
_lines = list(_stdin)
class _NoMoreInput(BaseException):
    pass
def _input(prompt=""):
    sys.stdout.write(str(prompt))
    if not _lines:
        sys.stdout.write("\\n")
        sys.stdout.flush()
        raise _NoMoreInput()
    line = _lines.pop(0)
    sys.stdout.write(line + "\\n")
    return line
builtins.input = _input
_entry_abs = os.path.join(_work, _entry)
_code = 0
try:
    runpy.run_path(_entry_abs, run_name="__main__")
except _NoMoreInput:
    # a normal end for a program that keeps asking: it used every line it was given
    print(_no_more, file=sys.stderr)
except SystemExit as e:
    if e.code is None or isinstance(e.code, int):
        _code = e.code or 0
    else:
        print(e.code, file=sys.stderr)
        _code = 1
except BaseException as e:
    tb = e.__traceback__
    while tb is not None and tb.tb_frame.f_code.co_filename != _entry_abs:
        tb = tb.tb_next
    # no frame in the learner's file (a SyntaxError while compiling it): the error line alone says where
    traceback.print_exception(type(e), e, tb)
    _code = 1
finally:
    sys.stdout.flush()
    sys.stderr.flush()
_code
`;

/** Every file under the working folder, with its relative path. */
function walk(py: Pyodide, dir: string, rel = ""): RunFile[] {
  const out: RunFile[] = [];
  for (const name of py.FS.readdir(dir)) {
    if (name === "." || name === ".." || name === "__pycache__") continue;
    const full = `${dir}/${name}`;
    const path = rel ? `${rel}/${name}` : name;
    const st = py.FS.stat(full);
    if (py.FS.isDir(st.mode)) out.push(...walk(py, full, path));
    else if (st.size <= 50 * 1024 * 1024) out.push({ path, data: py.FS.readFile(full) });
  }
  return out;
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

self.onmessage = async (msg: MessageEvent<RunRequest>) => {
  const req = msg.data;
  try {
    pyodide ??= load();
    const py = await pyodide;
    py.setStdout({ batched: (s) => post({ type: "out", stream: "stdout", text: `${s}\n` }) });
    py.setStderr({ batched: (s) => post({ type: "out", stream: "stderr", text: `${s}\n` }) });

    // a fresh working folder each run, holding exactly the files the page sent
    await py.runPythonAsync(`import shutil, os\nshutil.rmtree(${JSON.stringify(WORK)}, ignore_errors=True)`);
    py.FS.mkdirTree(WORK);
    for (const f of req.files) {
      const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
      if (dir) py.FS.mkdirTree(`${WORK}/${dir}`);
      py.FS.writeFile(`${WORK}/${f.path}`, f.data);
    }
    py.FS.chdir(WORK);

    // packages the code imports (numpy, pandas, ...) come from the Pyodide distribution
    const sources = req.files.filter((f) => f.path.endsWith(".py")).map((f) => new TextDecoder().decode(f.data)).join("\n");
    const note = (m: string) => post({ type: "status", text: m });
    await py.loadPackagesFromImports(sources, { messageCallback: note, errorCallback: note });
    if (/\b(urllib|requests)\b/.test(sources)) {
      // lets urllib/requests download over the browser's fetch (the site must allow it with CORS)
      await py.loadPackage("pyodide-http", { messageCallback: note, errorCallback: note });
      await py.runPythonAsync("import pyodide_http\npyodide_http.patch_all()");
    }

    post({ type: "status", text: "Running…" });
    py.globals.set("_work", WORK);
    py.globals.set("_entry", req.entry);
    py.globals.set("_args", req.args);
    py.globals.set("_stdin", req.stdin);
    py.globals.set("_no_more", NO_MORE_INPUT);
    const code = Number(await py.runPythonAsync(RUNNER)) || 0;

    const before = new Map(req.files.map((f) => [f.path, f.data]));
    const changed = walk(py, WORK).filter((f) => {
      const prev = before.get(f.path);
      return !prev || !same(prev, f.data);
    });
    if (changed.length) post({ type: "files", files: changed }, changed.map((f) => f.data.buffer));
    post({ type: "done", code });
  } catch (e) {
    post({ type: "out", stream: "stderr", text: `${e instanceof Error ? e.message : String(e)}\n` });
    post({ type: "done", code: 1 });
  }
};
