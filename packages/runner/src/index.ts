import { ClaudeAdapter } from "./claude.js";
import { loadConfig, type RunnerConfig } from "./config.js";
import type { ProviderAdapter } from "./adapter.js";

export * from "./adapter.js";
export * from "./claude.js";
export * from "./config.js";
export * from "./execute.js";
export * from "./loop.js";
export * from "./partial.js";
export * from "./prompts.js";

/** Builds the configured adapter. Claude is the only one in v1; others become config entries. */
export function createAdapter(cfg: RunnerConfig = loadConfig()): ProviderAdapter {
  return new ClaudeAdapter({ bin: cfg.claudeBin });
}
