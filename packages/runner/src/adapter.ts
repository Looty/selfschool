export interface AdapterRequest {
  /** Job-specific system prompt (instructions + required output shape). Trusted. */
  systemPrompt: string;
  /** Job input piped on stdin: course text framed as data. Untrusted. */
  stdin: string;
  model: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** When set, the adapter streams and calls this with all the reply text received so far. The final response is unchanged. */
  onText?: (textSoFar: string) => void;
}

export interface AdapterResponse {
  /** The model's text answer (expected to be JSON for our jobs). */
  text: string;
  costUsd: number | null;
  /** Tool calls the CLI reported as denied; non-empty means the model tried to act. */
  permissionDenials: unknown[];
}

/**
 * A provider adapter shells out to one AI CLI. Contract: prompt on stdin, answer on stdout,
 * spawned in a fresh empty directory, with every tool / file / MCP capability disabled.
 */
export interface ProviderAdapter {
  readonly name: string;
  /** True only if this adapter's invocation really turns all tools off. */
  readonly toolsDisabled: boolean;
  run(req: AdapterRequest): Promise<AdapterResponse>;
}

export class UnsafeAdapterError extends Error {}

/** Refuses adapters that cannot disable tools (plan.md section 3 sandbox rule). */
export function assertSandboxed(adapter: ProviderAdapter): void {
  if (adapter.toolsDisabled !== true) {
    throw new UnsafeAdapterError(`adapter "${adapter.name}" cannot disable tools; refusing to use it`);
  }
}
