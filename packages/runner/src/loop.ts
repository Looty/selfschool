import { jobEnvelopeSchema } from "@selfschool/shared";
import { assertSandboxed, type ProviderAdapter } from "./adapter.js";
import type { RunnerConfig } from "./config.js";
import { executeJob } from "./execute.js";

export interface LoopOptions {
  cfg: RunnerConfig;
  adapter: ProviderAdapter;
  signal: AbortSignal;
  log?: (msg: string) => void;
  /** Backoff after an API error, ms. */
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

const PARTIAL_EVERY_MS = 350;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/** Long-polls the API for jobs until aborted. Never throws on API/CLI errors; it logs and backs off. */
export async function runLoop(opts: LoopOptions): Promise<void> {
  const { cfg, adapter, signal } = opts;
  const log = opts.log ?? (() => {});
  const doFetch = opts.fetchImpl ?? fetch;
  assertSandboxed(adapter);
  log(`runner connected to ${cfg.apiUrl} (adapter: ${adapter.name})`);

  while (!signal.aborted) {
    try {
      const res = await doFetch(`${cfg.apiUrl}/jobs/next?wait=${cfg.pollWaitSeconds}`, { signal });
      if (res.status === 204) continue;
      if (!res.ok) throw new Error(`GET /jobs/next -> ${res.status}`);
      const job = jobEnvelopeSchema.parse(await res.json());
      log(`job ${job.id} (${job.kind})`);
      // progress only, at most a few times a second; the result post below is what counts
      let lastSent = 0;
      const onPartial = (text: string) => {
        const now = Date.now();
        if (now - lastSent < PARTIAL_EVERY_MS) return;
        lastSent = now;
        void doFetch(`${cfg.apiUrl}/jobs/${job.id}/partial`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        }).catch(() => {});
      };
      const outcome = await executeJob(job, adapter, cfg, signal, onPartial);
      if (!outcome.ok) log(`job ${job.id} failed: ${outcome.error}`);
      const body = outcome.ok ? { ok: true, result: outcome.result, meta: outcome.meta } : outcome;
      const post = await doFetch(`${cfg.apiUrl}/jobs/${job.id}/result`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!post.ok) log(`POST result for ${job.id} -> ${post.status}`);
    } catch (e) {
      if (signal.aborted) break;
      log(`api error: ${(e as Error).message}; retrying`);
      await sleep(opts.retryDelayMs ?? 3000, signal);
    }
  }
  log("runner stopped");
}
