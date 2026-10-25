import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { AdapterRequest, AdapterResponse, ProviderAdapter } from "./adapter.js";

export interface ClaudeAdapterOptions {
  /** Executable; default `claude` resolved via PATH. */
  bin?: string;
  /** Args placed before the baseline flags (tests use it to run a fake CLI through node). */
  argsPrefix?: string[];
}

/** Baseline flags from plan.md section 3 (verified 2026-10-20). Prompt goes on stdin, not argv. */
export function claudeArgs(model: string, systemPrompt: string, stream = false): string[] {
  return [
    "--model", model,
    "-p",
    "--system-prompt", systemPrompt,
    "--tools", "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--setting-sources", "",
    // stream-json prints one event per line, ending with the same `result` object the json format prints
    ...(stream ? ["--output-format", "stream-json", "--include-partial-messages", "--verbose"] : ["--output-format", "json"]),
  ];
}

/**
 * Reads the CLI's stream-json output line by line: text deltas go to `onText` as they arrive, and the final
 * `result` line is kept for `parseClaudeOutput`. Lines that are not JSON are ignored.
 */
export class StreamReader {
  private buffer = "";
  private text = "";
  /** The CLI's final `result` line, once it has arrived. */
  resultLine: string | null = null;

  constructor(private readonly onText: (textSoFar: string) => void) {}

  push(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      this.line(this.buffer.slice(0, nl));
      this.buffer = this.buffer.slice(nl + 1);
    }
  }

  end(): void {
    if (this.buffer.trim()) this.line(this.buffer);
    this.buffer = "";
  }

  private line(raw: string): void {
    const line = raw.trim();
    if (!line) return;
    let ev: { type?: unknown; event?: { type?: unknown; delta?: { type?: unknown; text?: unknown } } };
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    if (ev.type === "result") this.resultLine = line;
    else if (ev.type === "stream_event" && ev.event?.type === "content_block_delta" && ev.event.delta?.type === "text_delta" && typeof ev.event.delta.text === "string") {
      this.text += ev.event.delta.text;
      try {
        this.onText(this.text);
      } catch {
        /* a failing progress callback must never fail the job */
      }
    }
  }
}

/** Resolves a bare command name on PATH (with PATHEXT on Windows); absolute/relative paths pass through. */
export function resolveBin(bin: string, env: NodeJS.ProcessEnv = process.env): string {
  if (/[\\/]/.test(bin)) return bin;
  const exts = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = join(dir, bin + ext.toLowerCase());
      if (existsSync(candidate)) return candidate;
      const upper = join(dir, bin + ext);
      if (existsSync(upper)) return upper;
    }
  }
  throw new Error(`"${bin}" not found on PATH (set SELFSCHOOL_CLAUDE_BIN to its full path)`);
}

interface ClaudeJson {
  result?: unknown;
  is_error?: unknown;
  total_cost_usd?: unknown;
  permission_denials?: unknown;
}

export function parseClaudeOutput(stdout: string): AdapterResponse {
  let obj: ClaudeJson;
  try {
    obj = JSON.parse(stdout) as ClaudeJson;
  } catch {
    throw new Error(`claude did not print a single JSON object: ${stdout.slice(0, 200)}`);
  }
  if (obj === null || typeof obj !== "object") throw new Error("claude output is not a JSON object");
  if (obj.is_error === true) throw new Error(`claude reported an error: ${String(obj.result).slice(0, 300)}`);
  if (typeof obj.result !== "string") throw new Error("claude output has no string `result`");
  return {
    text: obj.result,
    costUsd: typeof obj.total_cost_usd === "number" ? obj.total_cost_usd : null,
    permissionDenials: Array.isArray(obj.permission_denials) ? obj.permission_denials : [],
  };
}

export class ClaudeAdapter implements ProviderAdapter {
  readonly name = "claude";
  /** The baseline flags (`--tools ""`, strict MCP, no slash commands, no settings) are always applied. */
  readonly toolsDisabled = true;

  constructor(private readonly opts: ClaudeAdapterOptions = {}) {}

  async run(req: AdapterRequest): Promise<AdapterResponse> {
    const bin = resolveBin(this.opts.bin ?? "claude");
    if (process.platform === "win32" && /\.(cmd|bat)$/i.test(bin)) {
      throw new Error(`${bin} is a .cmd shim, which cannot be spawned safely; point SELFSCHOOL_CLAUDE_BIN at claude.exe`);
    }
    const args = [...(this.opts.argsPrefix ?? []), ...claudeArgs(req.model, req.systemPrompt, !!req.onText)];
    const reader = req.onText ? new StreamReader(req.onText) : null;

    // Fresh empty cwd so a misbehaving CLI has nothing to read or write.
    const cwd = await mkdtemp(join(tmpdir(), "selfschool-run-"));
    try {
      const stdout = await new Promise<string>((resolve, reject) => {
        const child = spawn(bin, args, { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
        let out = "";
        let err = "";
        let failure: string | undefined;
        // Reject only once the process has closed, so the temp dir isn't removed while it is held.
        const kill = (why: string) => {
          failure ??= why;
          child.kill();
        };
        const timer = setTimeout(() => kill(`claude timed out after ${req.timeoutMs}ms`), req.timeoutMs);
        req.signal?.addEventListener("abort", () => kill("aborted"), { once: true });
        child.stdout.on("data", (d: Buffer) => {
          const s = d.toString("utf8");
          if (reader) reader.push(s);
          else out += s;
        });
        child.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
        child.on("error", (e) => (clearTimeout(timer), reject(e)));
        child.on("close", (code) => {
          clearTimeout(timer);
          reader?.end();
          const printed = reader ? (reader.resultLine ?? "") : out;
          if (failure) reject(new Error(failure));
          else if (code !== 0 && printed.trim() === "") reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`));
          else resolve(printed);
        });
        child.stdin.on("error", () => {}); // EPIPE if it exits early; surfaced via close
        child.stdin.end(req.stdin);
      });
      return parseClaudeOutput(stdout);
    } finally {
      await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}
