import type { RunLanguage } from "./protocol";

const BY_EXT: Record<string, RunLanguage> = { py: "python", js: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", mts: "typescript" };

/** The in-browser runtime for a file name, or null when it cannot run here (it can still be downloaded). */
export function languageOf(name: string): RunLanguage | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return ext ? (BY_EXT[ext] ?? null) : null;
}

/** Of several runnable files added at once, the one to run: main/index/app first (the others are usually its imports). */
export function pickEntry(paths: string[]): string | null {
  const runnable = paths.filter((p) => languageOf(p));
  return runnable.find((p) => /^(main|index|app)\.[a-z]+$/i.test(p.split("/").pop() ?? "")) ?? runnable[0] ?? null;
}

// `python lab.py ...`, `python3`, `uv run python`, `node`, `tsx`, `npx tsx`, `ts-node`, `bun run`, `deno run -A`, with an optional `$ ` prompt
const LAUNCH = /^\s*(?:[$>]\s+)?(?:uv\s+run\s+)?(?:python3?|py|node|tsx|npx\s+tsx|ts-node|bun(?:\s+run)?|deno\s+run(?:\s+--?[\w-]+)*)\s+(\S+)(.*)$/;

/**
 * The lines of a command block that run one of the lesson's files (`python lab01.py "The capital of France is"`):
 * each becomes a Run button that runs that file in the browser with the same arguments.
 */
export function commandRuns(code: string, names: readonly string[]): { entry: string; args: string; line: string }[] {
  const runs: { entry: string; args: string; line: string }[] = [];
  for (const raw of code.split("\n")) {
    const m = LAUNCH.exec(raw);
    if (!m) continue;
    const entry = m[1]!.replace(/^["']|["']$/g, "").split(/[\\/]/).pop()!;
    if (!names.includes(entry) || !languageOf(entry)) continue;
    // a trailing shell comment is not an argument
    const args = m[2]!.replace(/\s+#[^"']*$/, "").trim();
    runs.push({ entry, args, line: raw.trim() });
  }
  return runs;
}

/** A command line split like a shell would: spaces separate, quotes group, backslash escapes. */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < line.length) cur += line[++i];
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (c === "\\" && i + 1 < line.length) {
      cur += line[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += c;
    }
  }
  if (has || cur) out.push(cur);
  return out;
}

/** Input box text as lines for `input()`; a trailing empty line is not an extra input. */
export const stdinLines = (text: string): string[] => (text === "" ? [] : text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n"));

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** A Rust Playground link with the program filled in, for a block that has a `main` to run. */
export function rustPlaygroundUrl(code: string): string | null {
  if (!/\bfn\s+main\s*\(/.test(code)) return null;
  return `https://play.rust-lang.org/?version=stable&mode=debug&edition=2024&code=${encodeURIComponent(code)}`;
}
