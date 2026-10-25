import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertSandboxed,
  ClaudeAdapter,
  claudeArgs,
  executeJob,
  extractJson,
  parseClaudeOutput,
  UnsafeAdapterError,
  type ProviderAdapter,
} from "../src/index.js";

const fake = fileURLToPath(new URL("./fake-claude.mjs", import.meta.url));
const adapter = () => new ClaudeAdapter({ bin: process.execPath, argsPrefix: [fake] });
const req = { systemPrompt: "SYS PROMPT", stdin: '{"hello":"world"}', model: "haiku", timeoutMs: 15_000 };

let tmp: string;
let record: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "selfschool-test-"));
  record = join(tmp, "record.json");
  process.env.FAKE_RECORD = record;
  delete process.env.FAKE_MODE;
  delete process.env.FAKE_REPLY;
});
afterEach(() => {
  delete process.env.FAKE_RECORD;
  delete process.env.FAKE_MODE;
  delete process.env.FAKE_REPLY;
  rmSync(tmp, { recursive: true, force: true });
});
const recorded = () => JSON.parse(readFileSync(record, "utf8")) as { argv: string[]; cwd: string; entries: string[]; stdin: string };

describe("claude adapter", () => {
  it("passes exactly the baseline flags, prompt on stdin, in an empty temp dir that is removed", async () => {
    const res = await adapter().run(req);
    const r = recorded();
    expect(r.argv).toEqual(claudeArgs("haiku", "SYS PROMPT"));
    expect(r.argv).toEqual([
      "--model", "haiku", "-p", "--system-prompt", "SYS PROMPT", "--tools", "",
      "--strict-mcp-config", "--disable-slash-commands", "--setting-sources", "", "--output-format", "json",
    ]);
    expect(r.stdin).toBe(req.stdin);
    expect(r.entries).toEqual([]);
    expect(r.cwd).not.toBe(process.cwd());
    expect(existsSync(r.cwd)).toBe(false);
    expect(res).toMatchObject({ costUsd: 0.0002, permissionDenials: [] });
    expect(JSON.parse(res.text)).toMatchObject({ correct: true });
  });

  it("throws when the CLI reports is_error", async () => {
    process.env.FAKE_MODE = "error";
    await expect(adapter().run(req)).rejects.toThrow(/Not logged in/);
  });

  it("throws on non-JSON output", async () => {
    process.env.FAKE_MODE = "garbage";
    await expect(adapter().run(req)).rejects.toThrow(/single JSON object/);
  });

  it("times out", async () => {
    await expect(adapter().run({ ...req, timeoutMs: 1 })).rejects.toThrow(/timed out/);
  });

  it("parseClaudeOutput requires a string result", () => {
    expect(() => parseClaudeOutput('{"is_error":false}')).toThrow(/result/);
  });
});

describe("sandbox rule", () => {
  const unsafe: ProviderAdapter = { name: "bad", toolsDisabled: false, run: async () => ({ text: "", costUsd: null, permissionDenials: [] }) };

  it("refuses adapters that cannot disable tools", async () => {
    expect(() => assertSandboxed(unsafe)).toThrow(UnsafeAdapterError);
    expect(() => assertSandboxed(adapter())).not.toThrow();
    const out = await executeJob({ id: "j", kind: "verify", attempts: 1, payload: {} }, unsafe, { modelFast: "h", modelStrong: "s", jobTimeoutMs: 1000 });
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining("cannot disable tools") });
  });
});

describe("executeJob", () => {
  const cfg = { modelFast: "fast-m", modelStrong: "strong-m", jobTimeoutMs: 15_000 };
  const gradeJob = {
    id: "j1",
    kind: "grade" as const,
    attempts: 1,
    payload: { question: { id: "q", text: "t", rubric: "r" }, answer: "a" },
  };

  it("validates the reply and uses the fast model for grade", async () => {
    const out = await executeJob(gradeJob, adapter(), cfg);
    expect(out).toMatchObject({ ok: true, result: { score: 1, correct: true } });
    expect(recorded().argv).toContain("fast-m");
    expect(JSON.parse(recorded().stdin)).toMatchObject({ answer: "a" });
  });

  it("accepts fenced JSON", async () => {
    process.env.FAKE_MODE = "fenced";
    expect(await executeJob(gradeJob, adapter(), cfg)).toMatchObject({ ok: true });
  });

  it("fails (after one retry) when the reply violates the schema", async () => {
    process.env.FAKE_REPLY = JSON.stringify({ score: 9 });
    const out = await executeJob(gradeJob, adapter(), cfg);
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining("schema") });
    expect(recorded().stdin).toContain("previous reply was rejected");
  });

  it("fails the job if the model attempted tool calls", async () => {
    process.env.FAKE_MODE = "tools";
    expect(await executeJob(gradeJob, adapter(), cfg)).toMatchObject({ ok: false, error: expect.stringContaining("tool call") });
  });

  it("fails on invalid payload without calling the CLI", async () => {
    const out = await executeJob({ ...gradeJob, payload: {} }, adapter(), cfg);
    expect(out.ok).toBe(false);
    expect(existsSync(record)).toBe(false);
  });
});

describe("extractJson", () => {
  it("handles plain, fenced and prose-wrapped replies", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":1} hope that helps')).toEqual({ a: 1 });
    expect(() => extractJson("nothing here")).toThrow();
  });

  it("keeps code fences inside a JSON string (a lesson with a code block) instead of treating them as the wrapper", () => {
    const body = "Intro.\n\n```ts\nconst x = 1;\n```\n\nOutro.";
    expect(extractJson(JSON.stringify({ body, questions: [] }))).toEqual({ body, questions: [] });
    expect(extractJson("```json\n" + JSON.stringify({ body }) + "\n```")).toEqual({ body });
    expect(extractJson("Here you go: " + JSON.stringify({ body }))).toEqual({ body });
  });
});
