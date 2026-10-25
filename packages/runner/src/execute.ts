import { jobPayloadSchemas, jobResultSchemas, type JobEnvelope } from "@selfschool/shared";
import { assertSandboxed, type ProviderAdapter } from "./adapter.js";
import { modelFor, type RunnerConfig } from "./config.js";
import { STREAM_FIELD, streamedField } from "./partial.js";
import { stdinFor, systemPromptFor } from "./prompts.js";

export type JobOutcome =
  | { ok: true; result: unknown; meta: { costUsd: number | null; attempts: number } }
  | { ok: false; error: string };

const tryParse = (s: string): { value: unknown } | null => {
  try {
    return { value: JSON.parse(s) };
  } catch {
    return null;
  }
};

/**
 * Pulls the JSON object out of a model reply, tolerating code fences or stray prose. Fences inside the JSON's own
 * strings (a lesson's code blocks) are never mistaken for a wrapper, so the strictest reading is tried first.
 */
export function extractJson(text: string): unknown {
  const whole = tryParse(text.trim());
  if (whole) return whole.value;
  const wrapped = /^\s*```(?:json)?\s*([\s\S]*?)```\s*$/.exec(text);
  const unwrapped = wrapped ? tryParse(wrapped[1]!.trim()) : null;
  if (unwrapped) return unwrapped.value;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const sliced = start !== -1 && end > start ? tryParse(text.slice(start, end + 1)) : null;
  if (sliced) return sliced.value;
  const loose = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const found = loose ? tryParse(loose[1]!.trim()) : null;
  if (found) return found.value;
  throw new Error("reply contains no JSON object");
}

const MAX_TRIES = 2;

/**
 * Runs one job through the adapter. The reply must validate against the job kind's result schema;
 * one retry with the validation error appended, then the job fails (no free-form side effects).
 */
export async function executeJob(
  job: JobEnvelope,
  adapter: ProviderAdapter,
  cfg: Pick<RunnerConfig, "modelFast" | "modelStrong" | "jobTimeoutMs">,
  signal?: AbortSignal,
  /** Receives the chat answer as it is written. Progress only: the result is still validated at the end. */
  onPartial?: (text: string) => void,
): Promise<JobOutcome> {
  try {
    assertSandboxed(adapter);
    const payload = jobPayloadSchemas[job.kind].safeParse(job.payload);
    if (!payload.success) return { ok: false, error: `invalid ${job.kind} payload: ${payload.error.message}` };

    const model = modelFor(job.kind, cfg);
    const systemPrompt = systemPromptFor(job.kind);
    let stdin = stdinFor(payload.data);
    let cost: number | null = null;
    let lastError = "";

    const field = STREAM_FIELD[job.kind];
    const onText =
      onPartial && field
        ? (soFar: string) => {
            const text = streamedField(soFar, field);
            if (text) onPartial(text);
          }
        : undefined;

    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      const res = await adapter.run({ systemPrompt, stdin, model, timeoutMs: cfg.jobTimeoutMs, signal, ...(onText ? { onText } : {}) });
      if (res.costUsd !== null) cost = (cost ?? 0) + res.costUsd;
      if (res.permissionDenials.length > 0) {
        return { ok: false, error: `model attempted ${res.permissionDenials.length} tool call(s) despite tools being off` };
      }
      try {
        const parsed = jobResultSchemas[job.kind].safeParse(extractJson(res.text));
        if (parsed.success) return { ok: true, result: parsed.data, meta: { costUsd: cost, attempts: attempt } };
        lastError = parsed.error.message;
      } catch (e) {
        lastError = (e as Error).message;
      }
      stdin = `${stdinFor(payload.data)}\n\nYour previous reply was rejected: ${lastError}\nReply again with only the JSON object.`;
    }
    return { ok: false, error: `reply failed ${job.kind} schema after ${MAX_TRIES} tries: ${lastError}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
