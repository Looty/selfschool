import { spawnSync } from "node:child_process";
import { healthSchema, type Health } from "@selfschool/shared";
import { ClaudeAdapter, loadConfig, resolveBin } from "@selfschool/runner";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export async function fetchHealth(url: string, fetchImpl: typeof fetch = fetch): Promise<Health> {
  const res = await fetchImpl(`${url}/health`, { signal: AbortSignal.timeout(5000) });
  return healthSchema.parse(await res.json());
}

export function checkDocker(): Check {
  const r = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8", timeout: 15_000 });
  if (r.error) return { name: "docker", ok: false, detail: `docker not runnable: ${r.error.message}` };
  if (r.status !== 0) return { name: "docker", ok: false, detail: "docker daemon not reachable (is Docker Desktop running?)" };
  return { name: "docker", ok: true, detail: `server ${r.stdout.trim()}` };
}

/** API reachable + healthy, DB migrated, runner connected: three checks from one /health call. */
export async function checkApi(url: string, fetchImpl: typeof fetch = fetch): Promise<Check[]> {
  let h: Health;
  try {
    h = await fetchHealth(url, fetchImpl);
  } catch (e) {
    const detail = `${url}/health unreachable: ${(e as Error).message}`;
    return [
      { name: "api", ok: false, detail },
      { name: "db migrated", ok: false, detail: "unknown (api down)" },
      { name: "runner connected", ok: false, detail: "unknown (api down)" },
    ];
  }
  return [
    { name: "api", ok: h.ok, detail: `${url}/health ok=${h.ok}` },
    { name: "db migrated", ok: h.migrated, detail: h.migrated ? "migrations applied" : "migrations missing" },
    {
      name: "runner connected",
      ok: h.runner.connected,
      detail: h.runner.connected ? "polled recently" : "no recent poll (start it with `school up`)",
    },
  ];
}

export function checkClaudeOnPath(env: NodeJS.ProcessEnv = process.env): Check {
  const cfg = loadConfig(env);
  try {
    const bin = resolveBin(cfg.claudeBin ?? "claude", env);
    const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 15_000 });
    if (r.error || r.status !== 0) return { name: "claude cli", ok: false, detail: `${bin} --version failed` };
    return { name: "claude cli", ok: true, detail: `${bin} (${r.stdout.trim()})` };
  } catch (e) {
    return { name: "claude cli", ok: false, detail: (e as Error).message };
  }
}

/** One cheap haiku call with the adapter baseline flags. Costs a fraction of a cent; explicit opt-in only. */
export async function checkClaudeCall(env: NodeJS.ProcessEnv = process.env): Promise<Check> {
  const cfg = loadConfig(env);
  try {
    const res = await new ClaudeAdapter({ bin: cfg.claudeBin }).run({
      systemPrompt: "Reply with the single word: hi",
      stdin: "say hi",
      model: cfg.modelFast,
      timeoutMs: 60_000,
    });
    return { name: "claude call", ok: true, detail: `replied "${res.text.trim().slice(0, 40)}" ($${res.costUsd ?? "?"})` };
  } catch (e) {
    return { name: "claude call", ok: false, detail: (e as Error).message };
  }
}

export async function runDoctor(opts: { ai: boolean; apiUrl: string }): Promise<Check[]> {
  const checks: Check[] = [checkDocker(), ...(await checkApi(opts.apiUrl)), checkClaudeOnPath()];
  if (opts.ai) checks.push(await checkClaudeCall());
  return checks;
}
