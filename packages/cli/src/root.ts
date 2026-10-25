import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";

/** Repo root = nearest ancestor holding compose.yaml (or $SELFSCHOOL_ROOT). */
export function findRoot(from = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
  if (env.SELFSCHOOL_ROOT) return resolve(env.SELFSCHOOL_ROOT);
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, "compose.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("compose.yaml not found; run from inside the Selfschool repo or set SELFSCHOOL_ROOT");
    dir = parent;
  }
}

export function compose(root: string, args: string[], opts: SpawnSyncOptions = {}): number {
  const r = spawnSync("docker", ["compose", ...args], { cwd: root, stdio: "inherit", ...opts });
  if (r.error) throw new Error(`cannot run docker: ${r.error.message}`);
  return r.status ?? 1;
}

const pidFile = (root: string) => join(root, ".selfschool", "runner.pid");

export function writePid(root: string): void {
  mkdirSync(join(root, ".selfschool"), { recursive: true });
  writeFileSync(pidFile(root), String(process.pid));
}

export function clearPid(root: string): void {
  rmSync(pidFile(root), { force: true });
}

/** pid of a running `school up`, or null (stale pid files are ignored). */
export function readRunnerPid(root: string): number | null {
  try {
    const pid = Number(readFileSync(pidFile(root), "utf8"));
    if (!Number.isInteger(pid) || pid <= 0) return null;
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

export function apiUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.SELFSCHOOL_API_URL || "http://127.0.0.1:3001").replace(/\/+$/, "");
}
