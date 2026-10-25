import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { JobEnvelope } from "@selfschool/shared";
import { ClaudeAdapter, StreamReader, claudeArgs, executeJob, streamedField } from "../src/index.js";

describe("streamedField", () => {
  it("is null until the field has started", () => {
    expect(streamedField('{"score": 0.5, "corr', "feedback")).toBeNull();
    expect(streamedField('{"score": 0.5, "feedback"', "feedback")).toBeNull();
  });

  it("returns the text written so far, and the whole value once the string closes", () => {
    expect(streamedField('{"score": 1, "feedback": "You got', "feedback")).toBe("You got");
    expect(streamedField('{"score": 1, "feedback": "You got it.", "x": "later"}', "feedback")).toBe("You got it.");
  });

  it("decodes escapes and holds back a half-written one", () => {
    expect(streamedField('{"answer": "line one\\nline \\"two\\" \\\\ done', "answer")).toBe('line one\nline "two" \\ done');
    expect(streamedField('{"answer": "ends with a backslash\\', "answer")).toBe("ends with a backslash");
    expect(streamedField('{"answer": "caf\\u00e9', "answer")).toBe("café");
    expect(streamedField('{"answer": "caf\\u00', "answer")).toBe("caf");
  });

  it("works through a code fence or prose before the JSON", () => {
    expect(streamedField('```json\n{"covered": true, "answer": "Hi', "answer")).toBe("Hi");
  });
});

describe("StreamReader", () => {
  const delta = (text: string) => JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } });

  it("accumulates deltas across chunk boundaries, ignores junk, and keeps the result line", () => {
    const seen: string[] = [];
    const r = new StreamReader((t) => seen.push(t));
    const lines = [JSON.stringify({ type: "system" }), "garbage", delta("Hel"), delta("lo"), JSON.stringify({ type: "result", result: "Hello" })].join("\n");
    r.push(lines.slice(0, 40));
    r.push(lines.slice(40));
    r.end();
    expect(seen).toEqual(["Hel", "Hello"]);
    expect(JSON.parse(r.resultLine!)).toMatchObject({ result: "Hello" });
  });

  it("a throwing progress callback never breaks reading", () => {
    const r = new StreamReader(() => {
      throw new Error("boom");
    });
    r.push(delta("x") + "\n" + JSON.stringify({ type: "result", result: "x" }) + "\n");
    expect(r.resultLine).not.toBeNull();
  });
});

const fake = fileURLToPath(new URL("./fake-claude.mjs", import.meta.url));
const adapter = () => new ClaudeAdapter({ bin: process.execPath, argsPrefix: [fake] });
const cfg = { modelFast: "haiku", modelStrong: "sonnet", jobTimeoutMs: 15_000 };

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "selfschool-stream-"));
  process.env.FAKE_RECORD = join(tmp, "record.json");
});
afterEach(() => {
  delete process.env.FAKE_RECORD;
  delete process.env.FAKE_REPLY;
  delete process.env.FAKE_MODE;
  rmSync(tmp, { recursive: true, force: true });
});

describe("streaming through the adapter", () => {
  it("asks the CLI for stream-json only when a listener is given", () => {
    expect(claudeArgs("haiku", "S")).toContain("json");
    expect(claudeArgs("haiku", "S")).not.toContain("--verbose");
    expect(claudeArgs("haiku", "S", true)).toEqual(expect.arrayContaining(["stream-json", "--include-partial-messages", "--verbose"]));
  });

  it("calls onText with the growing reply and still returns the final text and cost", async () => {
    process.env.FAKE_REPLY = JSON.stringify({ score: 1, correct: true, feedback: "Nice work on that one." });
    const seen: string[] = [];
    const res = await adapter().run({ systemPrompt: "S", stdin: "{}", model: "haiku", timeoutMs: 15_000, onText: (t) => seen.push(t) });
    expect(seen.length).toBeGreaterThan(3);
    expect(seen.at(-1)).toBe(process.env.FAKE_REPLY);
    expect(seen[0]!.length).toBeLessThan(seen.at(-1)!.length);
    expect(res).toMatchObject({ text: process.env.FAKE_REPLY, costUsd: 0.0002, permissionDenials: [] });
  });

  it("reports a CLI error the same way in stream mode", async () => {
    process.env.FAKE_MODE = "error";
    await expect(adapter().run({ systemPrompt: "S", stdin: "{}", model: "haiku", timeoutMs: 15_000, onText: () => {} })).rejects.toThrow(/Not logged in/);
  });
});

describe("executeJob progress", () => {
  const job = (kind: JobEnvelope["kind"], payload: unknown): JobEnvelope => ({ id: "j", kind, attempts: 1, payload });
  const grade = { question: { id: "q", text: "t", rubric: "r" }, answer: "a" };
  const chat = { lesson: { id: "l", title: "L", text: "body" }, question: "why?" };

  it("streams the chat answer, not the JSON around it", async () => {
    process.env.FAKE_REPLY = JSON.stringify({ covered: true, answer: "Because shapes decide it.", citations: [{ kind: "lesson", ref: "Why it works" }] });
    const partials: string[] = [];
    const out = await executeJob(job("chat", chat), adapter(), cfg, undefined, (t) => partials.push(t));
    expect(out).toMatchObject({ ok: true });
    expect(partials.length).toBeGreaterThan(2);
    expect(partials.at(-1)).toBe("Because shapes decide it.");
    expect(partials.every((p) => !p.includes("{") && !p.includes("covered"))).toBe(true);
  });

  it("does not stream grading: its reply is short and the score must not show early", async () => {
    process.env.FAKE_REPLY = JSON.stringify({ score: 0.5, correct: false, feedback: "You missed the contrast with nominal typing." });
    const partials: string[] = [];
    const out = await executeJob(job("grade", grade), adapter(), cfg, undefined, (t) => partials.push(t));
    expect(out).toMatchObject({ ok: true });
    expect(partials).toEqual([]);
  });

  it("does not stream other job kinds (their results stay hidden until validated)", async () => {
    process.env.FAKE_REPLY = JSON.stringify({ verdict: "ok", notes: "fine" });
    const partials: string[] = [];
    const out = await executeJob(
      job("verify", { question: { id: "q", type: "short", text: "t", answers: ["a"], concepts: [], sources: [] }, sourcesMd: "" }),
      adapter(),
      cfg,
      undefined,
      (t) => partials.push(t),
    );
    expect(out).toMatchObject({ ok: true });
    expect(partials).toEqual([]);
  });
});
