/// <reference lib="webworker" />
// Runs a JavaScript or TypeScript file inside this worker, which has no DOM and no access to the learner's files or
// programs. TypeScript has its types stripped (sucrase, no type checking); ES imports become a small require() that
// resolves other files in the working folder. Node's built-in modules do not exist here.
import { transform } from "sucrase";
import { NO_MORE_INPUT, type RunEvent, type RunFile, type RunRequest } from "./protocol";
import { lockDown } from "./sandbox";

lockDown(self as unknown as DedicatedWorkerGlobalScope);

const post = (e: RunEvent) => (self as DedicatedWorkerGlobalScope).postMessage(e);
const out = (stream: "stdout" | "stderr", text: string) => post({ type: "out", stream, text });

class Exit {
  constructor(readonly code: number) {}
}

/** console.log-style formatting: strings as they are, everything else as readable JSON-ish text. */
function show(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Error) return v.stack ?? `${v.name}: ${v.message}`;
  if (typeof v === "function") return `[Function ${v.name || "anonymous"}]`;
  if (typeof v === "bigint") return `${v}n`;
  if (v === undefined) return "undefined";
  if (v instanceof Map) return `Map(${v.size}) ${show(Object.fromEntries(v))}`;
  if (v instanceof Set) return `Set(${v.size}) ${show([...v])}`;
  try {
    const seen = new WeakSet<object>();
    return JSON.stringify(v, (_k, x) => {
      if (typeof x === "bigint") return `${x}n`;
      if (typeof x === "object" && x !== null) {
        if (seen.has(x)) return "[Circular]";
        seen.add(x);
      }
      return x;
    }, 2) ?? String(v);
  } catch {
    return String(v);
  }
}

const line = (args: unknown[]) => `${args.map(show).join(" ")}\n`;

const norm = (p: string) => {
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
};

const EXTS = ["", ".ts", ".js", ".mts", ".mjs", ".cjs", "/index.ts", "/index.js"];

self.onmessage = async (msg: MessageEvent<RunRequest>) => {
  const req = msg.data;
  const files = new Map<string, RunFile>(req.files.map((f) => [norm(f.path), f]));
  const stdin = [...req.stdin];
  const cache = new Map<string, { exports: unknown }>();

  const console = {
    log: (...a: unknown[]) => out("stdout", line(a)),
    info: (...a: unknown[]) => out("stdout", line(a)),
    debug: (...a: unknown[]) => out("stdout", line(a)),
    table: (...a: unknown[]) => out("stdout", line(a)),
    warn: (...a: unknown[]) => out("stderr", line(a)),
    error: (...a: unknown[]) => out("stderr", line(a)),
  };
  const proc = {
    argv: ["node", req.entry, ...req.args],
    env: {} as Record<string, string>,
    platform: "browser",
    exit: (code = 0) => {
      throw new Exit(code);
    },
    stdout: { write: (s: string) => (out("stdout", String(s)), true) },
    stderr: { write: (s: string) => (out("stderr", String(s)), true) },
  };
  // prompt() reads the provided input lines, like input() in Python
  const prompt = (question = "") => {
    out("stdout", String(question));
    const next = stdin.shift();
    if (next === undefined) {
      out("stdout", "\n");
      // a normal end for a program that keeps asking: it used every line it was given
      out("stderr", `${NO_MORE_INPUT}\n`);
      throw new Exit(0);
    }
    out("stdout", `${next}\n`);
    return next;
  };
  // also as globals, for code that reads globalThis.process
  try {
    Object.assign(self, { process: proc, prompt });
  } catch {
    // a read-only global: the module parameters below still provide them
  }

  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...a: unknown[]) => Promise<unknown>;

  async function load(path: string): Promise<unknown> {
    const hit = cache.get(path);
    if (hit) return hit.exports;
    const file = files.get(path)!;
    const isTs = /\.m?ts$/.test(path);
    const source = new TextDecoder().decode(file.data);
    const code = transform(source, { transforms: isTs ? ["typescript", "imports"] : ["imports"], filePath: path, production: true }).code;
    const module = { exports: {} as unknown };
    cache.set(path, module);
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const required = new Map<string, unknown>();
    // require() is synchronous, so every relative import is loaded before the module body runs
    for (const m of code.matchAll(/require\((['"])([^'"]+)\1\)/g)) {
      const spec = m[2]!;
      if (!spec.startsWith(".")) continue;
      const base = norm(`${dir}/${spec}`);
      const found = EXTS.map((e) => norm(base.replace(/\.js$/, "") + e)).find((p) => files.has(p)) ?? EXTS.map((e) => norm(base + e)).find((p) => files.has(p));
      if (found) required.set(spec, await load(found));
    }
    const require = (spec: string) => {
      if (required.has(spec)) return required.get(spec);
      if (spec.startsWith(".")) throw new Error(`Cannot find module '${spec}' in the working folder`);
      throw new Error(`'${spec}' is a Node or npm module; it is not available in the browser runner`);
    };
    await new AsyncFunction("require", "module", "exports", "console", "process", "prompt", code)(require, module, module.exports, console, proc, prompt);
    return module.exports;
  }

  let code = 0;
  try {
    post({ type: "status", text: "Running…" });
    await load(norm(req.entry));
  } catch (e) {
    if (e instanceof Exit) code = e.code;
    else {
      out("stderr", `${e instanceof Error ? (e.stack ?? `${e.name}: ${e.message}`) : String(e)}\n`);
      code = 1;
    }
  }
  post({ type: "done", code });
};

self.addEventListener("unhandledrejection", (e) => out("stderr", `Unhandled promise rejection: ${show((e as PromiseRejectionEvent).reason)}\n`));
