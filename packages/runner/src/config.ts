import type { JobKind } from "@selfschool/shared";

export interface RunnerConfig {
  apiUrl: string;
  claudeBin?: string;
  modelFast: string;
  modelStrong: string;
  jobTimeoutMs: number;
  /** Server-side long-poll window requested per GET /jobs/next, seconds. */
  pollWaitSeconds: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RunnerConfig {
  return {
    apiUrl: (env.SELFSCHOOL_API_URL || "http://127.0.0.1:3001").replace(/\/+$/, ""),
    claudeBin: env.SELFSCHOOL_CLAUDE_BIN || undefined,
    modelFast: env.SELFSCHOOL_MODEL_FAST || "haiku",
    modelStrong: env.SELFSCHOOL_MODEL_STRONG || "sonnet",
    jobTimeoutMs: Number(env.SELFSCHOOL_JOB_TIMEOUT_MS) || 180_000,
    pollWaitSeconds: 25,
  };
}

/** Cheap model for chat and short grading, stronger one for generate and verify. */
export function modelFor(kind: JobKind, cfg: Pick<RunnerConfig, "modelFast" | "modelStrong">): string {
  return kind === "generate" || kind === "verify" || kind === "outline" || kind === "lesson" ? cfg.modelStrong : cfg.modelFast;
}
