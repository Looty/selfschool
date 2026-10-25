import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { GitRunner } from "./ctx.js";

/** Commit each GitHub "clone" was taken at, so the `rev-parse HEAD` that follows a clone has an answer. */
const commits = new Map<string, string>();

interface TreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
}

const CLONE_CONCURRENCY = 8;
const API = "https://api.github.com";

function githubError(status: number, owner: string, repo: string, ref: string): Error {
  if (status === 404 || status === 422) return new Error(`repository or branch not found: ${owner}/${repo}@${ref} (is it public?)`);
  if (status === 403 || status === 429) return new Error("GitHub rate limit reached for anonymous requests; try again later or upload a zip");
  return new Error(`GitHub answered ${status}`);
}

/** The commit a branch, tag or sha points at (the plain-text sha media type answers with just the 40 characters). */
async function githubCommit(owner: string, repo: string, ref: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${API}/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`, {
    ...(signal ? { signal } : {}),
    headers: { accept: "application/vnd.github.sha" },
  });
  if (!res.ok) throw githubError(res.status, owner, repo, ref);
  return (await res.text()).trim();
}

/** `https://github.com/owner/repo(.git)` -> owner and repo; anything else (other hosts, local folders, zips) -> null. */
export function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const [owner, repo] = u.pathname.split("/").filter(Boolean);
  if (u.protocol !== "https:" || u.hostname !== "github.com" || !owner || !repo) return null;
  return { owner, repo: repo.replace(/\.git$/, "") };
}

export interface UpdateCheck {
  latestSha: string | null;
  branches: string[];
  tags: string[];
  /** Plain words for why a part of the check is missing (rate limit, offline); null when everything answered. */
  note: string | null;
}

/** Asks GitHub what the package's ref points at now, and which branches and tags exist to switch to. Three requests. */
export async function checkGithubUpdates(owner: string, repo: string, ref: string): Promise<UpdateCheck> {
  const names = async (kind: "branches" | "tags") => {
    const res = await fetch(`${API}/repos/${owner}/${repo}/${kind}?per_page=100`, { headers: { accept: "application/vnd.github+json" } });
    if (!res.ok) throw githubError(res.status, owner, repo, ref);
    return ((await res.json()) as { name: string }[]).map((x) => x.name);
  };
  const [latest, branches, tags] = await Promise.allSettled([githubCommit(owner, repo, ref), names("branches"), names("tags")]);
  const failed = [latest, branches, tags].find((r): r is PromiseRejectedResult => r.status === "rejected");
  return {
    latestSha: latest.status === "fulfilled" ? latest.value : null,
    branches: branches.status === "fulfilled" ? branches.value : [],
    tags: tags.status === "fulfilled" ? tags.value : [],
    note: failed ? String((failed.reason as Error).message ?? failed.reason) : null,
  };
}

/**
 * Clones a public GitHub repo without git: the git/trees API gives the file list and the commit (one request),
 * then each file comes from raw.githubusercontent.com pinned to that commit. Both hosts allow cross-origin
 * requests, which is what lets the in-browser build import by URL. Anonymous API calls are limited (60 an hour).
 */
async function cloneFromGithub(owner: string, repo: string, ref: string, dest: string, timeoutMs: number): Promise<void> {
  const signal = AbortSignal.timeout(timeoutMs);
  // The commit first (what `git rev-parse HEAD` would say), so the file list and every download are pinned to it.
  const commit = await githubCommit(owner, repo, ref, signal);
  const tree = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${commit}?recursive=1`, {
    signal,
    headers: { accept: "application/vnd.github+json" },
  });
  if (!tree.ok) throw githubError(tree.status, owner, repo, ref);
  const body = { ...((await tree.json()) as { truncated?: boolean; tree: TreeEntry[] }), sha: commit };
  if (body.truncated) throw new Error("this repository is too large to import by URL; upload a zip instead");

  // regular files only: symlinks (mode 120000) and submodules (type commit) are skipped, as a clone here never follows them
  const files = body.tree.filter((e) => e.type === "blob" && e.mode !== "120000");
  mkdirSync(dest, { recursive: true });

  let next = 0;
  const worker = async () => {
    for (let e = files[next++]; e; e = files[next++]) {
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/${body.sha}/${e.path.split("/").map(encodeURIComponent).join("/")}`;
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`could not download ${e.path} (${res.status})`);
      const target = `${dest}/${e.path}`;
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, new Uint8Array(await res.arrayBuffer()));
    }
  };
  await Promise.all(Array.from({ length: CLONE_CONCURRENCY }, worker));
  commits.set(dest, body.sha);
}

/**
 * A GitRunner that handles clones of github.com repos over HTTPS through GitHub's web APIs, and hands everything
 * else (other hosts, other git commands) to `fallback`, normally the real git binary.
 */
export const withGithub =
  (fallback: GitRunner): GitRunner =>
  async (args, opts) => {
    if (args[0] === "rev-parse" && args[1] === "HEAD" && opts.cwd && commits.has(opts.cwd)) return commits.get(opts.cwd)!;
    if (!args.includes("clone")) return fallback(args, opts);

    const dest = args.at(-1)!;
    const gh = parseGithubUrl(args.at(-2)!);
    if (!gh) return fallback(args, opts);

    const ref = args[args.indexOf("--branch") + 1] ?? "main";
    await cloneFromGithub(gh.owner, gh.repo, ref, dest, opts.timeoutMs);
    return "";
  };
