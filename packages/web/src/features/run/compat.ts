import { useEffect, useState } from "react";
import { languageOf } from "./files";
import type { RunLanguage } from "./protocol";

/**
 * Python packages that cannot run in the browser runner: native GPU/ML stacks with no WebAssembly build, and services
 * that need a real machine. Pure-Python and scientific packages (numpy, pandas, scikit-learn, ...) come with Pyodide.
 */
const NATIVE_ONLY = new Set([
  "torch", "torchvision", "torchaudio", "transformers", "tensorflow", "keras", "jax", "jaxlib", "flax", "accelerate",
  "datasets", "peft", "bitsandbytes", "triton", "vllm", "onnxruntime", "xformers", "deepspeed", "sentence_transformers",
  "diffusers", "mlflow", "evidently", "dvc", "cv2", "psycopg2", "docker", "kubernetes", "ray", "pyspark", "tkinter",
]);

export type Compat = { ok: true } | { ok: false; needs: string[] };

/** Top-level module names a Python file imports. */
export function pythonImports(source: string): string[] {
  const out = new Set<string>();
  for (const m of source.matchAll(/^[ \t]*(?:from[ \t]+([\w.]+)[ \t]+import\b|import[ \t]+([\w., \t]+?)(?:[ \t]*#.*)?$)/gm)) {
    if (m[1]) {
      if (!m[1].startsWith(".")) out.add(m[1].split(".")[0]!);
    } else {
      for (const part of m[2]!.split(",")) {
        const name = part.trim().split(/\s+/)[0]?.split(".")[0];
        if (name) out.add(name);
      }
    }
  }
  return [...out];
}

/** Module specifiers a JS/TS file imports or requires. */
export function jsImports(source: string): string[] {
  const out = new Set<string>();
  for (const m of source.matchAll(/(?:^|[^.\w])(?:import\s[^'"]*?from\s*|import\s*\(?\s*|require\s*\(\s*)(['"])([^'"]+)\1/g)) out.add(m[2]!);
  return [...out];
}

/**
 * Whether `entry` can run in the browser, following the lesson's own modules it imports (lab08 imports minigpt.py,
 * which imports torch). `sources` maps file name to text. JS/TS: any npm or Node module means it needs Node.js.
 */
export function checkCompat(entry: string, sources: ReadonlyMap<string, string>): Compat {
  const needs = new Set<string>();
  const seen = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const src = sources.get(name);
    if (src === undefined) return;
    if (languageOf(name) === "python") {
      for (const mod of pythonImports(src)) {
        if (sources.has(`${mod}.py`)) visit(`${mod}.py`);
        else if (NATIVE_ONLY.has(mod)) needs.add(mod);
      }
    } else {
      for (const spec of jsImports(src)) {
        if (spec.startsWith(".")) {
          const base = spec.replace(/^\.\//, "").replace(/\.(js|mjs|cjs)$/, "");
          const local = [`${base}.ts`, `${base}.js`, `${base}.mts`, `${base}.mjs`, base].find((p) => sources.has(p));
          if (local) visit(local);
        } else needs.add(spec.replace(/^node:/, ""));
      }
    }
  };
  visit(entry);
  return needs.size ? { ok: false, needs: [...needs].sort() } : { ok: true };
}

export interface LabFile {
  name: string;
  url: string;
  language: RunLanguage;
  /** null while the file is still being read. */
  compat: Compat | null;
  /** Imported by another of the lesson's files (minigpt.py): a helper, not a lab to run on its own. */
  helper: boolean;
}

/** Names of the given files that another one of them imports. */
export function helperFiles(sources: ReadonlyMap<string, string>): Set<string> {
  const helpers = new Set<string>();
  for (const [name, src] of sources) {
    const mods = languageOf(name) === "python" ? pythonImports(src).map((m) => `${m}.py`) : jsImports(src).map((s) => s.replace(/^\.\//, ""));
    for (const m of mods) for (const cand of [m, `${m}.ts`, `${m}.js`, m.replace(/\.js$/, ".ts")]) if (cand !== name && sources.has(cand)) helpers.add(cand);
  }
  return helpers;
}

const texts = new Map<string, Promise<string>>();
const textOf = (url: string) => {
  let p = texts.get(url);
  if (!p) {
    p = fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))));
    texts.set(url, p);
    p.catch(() => texts.delete(url));
  }
  return p;
};

/** The lesson's runnable files and whether each can run in the browser (read once per tab). */
export function useLabFiles(resources: readonly { name: string; url: string }[]): LabFile[] {
  const runnable = resources.filter((r) => languageOf(r.name));
  const key = runnable.map((r) => r.url).join("|");
  const [result, setResult] = useState<{ key: string; files: LabFile[] } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `runnable` is derived from `key`
  useEffect(() => {
    if (!key) return;
    let live = true;
    const list = key.split("|").map((url) => runnable.find((r) => r.url === url)!);
    Promise.all(list.map((r) => textOf(r.url).then((t) => [r.name, t] as const, () => [r.name, null] as const))).then((pairs) => {
      if (!live) return;
      const sources = new Map(pairs.filter((p): p is readonly [string, string] => p[1] !== null));
      const helpers = helperFiles(sources);
      setResult({
        key,
        // a file that could not be read is offered anyway: the run itself will say what is wrong
        files: list.map((r) => ({
          name: r.name,
          url: r.url,
          language: languageOf(r.name)!,
          compat: sources.has(r.name) ? checkCompat(r.name, sources) : { ok: true },
          helper: helpers.has(r.name),
        })),
      });
    });
    return () => {
      live = false;
    };
  }, [key]);

  if (result?.key === key) return result.files;
  return runnable.map((r) => ({ name: r.name, url: r.url, language: languageOf(r.name)!, compat: null, helper: false }));
}
