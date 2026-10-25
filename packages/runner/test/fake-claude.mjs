// Stand-in for the `claude` CLI. Records how it was invoked, then prints a canned reply.
// FAKE_RECORD: file to write {argv, cwd, entries, stdin} to. FAKE_MODE: ok | error | garbage | tools | fenced
import { readdirSync, writeFileSync } from "node:fs";

let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;

writeFileSync(
  process.env.FAKE_RECORD,
  JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), entries: readdirSync(process.cwd()), stdin }),
);

const reply = process.env.FAKE_REPLY ?? JSON.stringify({ score: 1, correct: true, feedback: "Nice." });
const mode = process.env.FAKE_MODE ?? "ok";
const base = { type: "result", total_cost_usd: 0.0002, permission_denials: [], session_id: "s" };

if (process.argv.includes("stream-json")) {
  // stream-json: one event per line, text deltas in small pieces, then the same `result` object json mode prints
  console.log(JSON.stringify({ type: "system", subtype: "init" }));
  console.log("not an event, and ignored");
  for (const text of reply.match(/[\s\S]{1,7}/g) ?? []) {
    console.log(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } }));
  }
  console.log(JSON.stringify({ ...base, is_error: mode === "error", result: mode === "error" ? "Not logged in" : reply }));
} else if (mode === "garbage") console.log("not json at all");
else if (mode === "error") console.log(JSON.stringify({ ...base, is_error: true, result: "Not logged in" }));
else if (mode === "tools") console.log(JSON.stringify({ ...base, is_error: false, result: reply, permission_denials: [{ tool_name: "Read" }] }));
else if (mode === "fenced") console.log(JSON.stringify({ ...base, is_error: false, result: "```json\n" + reply + "\n```" }));
else console.log(JSON.stringify({ ...base, is_error: false, result: reply }));
