import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { GitRunner, GitRunOptions, RepoPeek } from "./ctx.js";

/** Commit each GitHub "clone" was taken at, so the `rev-parse HEAD` that follows a clone has an answer. */
const commits = new Map<string, string>();

interface TreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
}

const CLONE_CONCURRENCY = 16;
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
 * The file list and the files already downloaded for the last repo commit cloned. A commit never changes, so the
 * import that follows a preview (or picking one course after previewing the whole repo) downloads nothing again.
 */
interface Snapshot {
  key: string;
  files: TreeEntry[];
  blobs: Map<string, Uint8Array>;
  bytes: number;
}
let snapshot: Snapshot | null = null;
/** Files stop being kept once this much is cached: a repo with big resources is downloaded again rather than held. */
const SNAPSHOT_BYTES = 50 * 1024 * 1024;

/** Drops the cached commit (tests). */
export function forgetGithubSnapshot(): void {
  snapshot = null;
}

/** The regular files of a commit: symlinks (mode 120000) and submodules (type commit) are skipped, as a clone here never follows them. */
async function githubFiles(owner: string, repo: string, ref: string, commit: string, signal: AbortSignal): Promise<TreeEntry[]> {
  const tree = await fetch(`${API}/repos/${owner}/${repo}/git/trees/${commit}?recursive=1`, {
    signal,
    headers: { accept: "application/vnd.github+json" },
  });
  if (!tree.ok) throw githubError(tree.status, owner, repo, ref);
  const body = (await tree.json()) as { truncated?: boolean; tree: TreeEntry[] };
  if (body.truncated) throw new Error("this repository is too large to import by URL; upload a zip instead");
  return body.tree.filter((e) => e.type === "blob" && e.mode !== "120000");
}

/** The commit a ref points at (what `git rev-parse HEAD` would say), and its file list, from the cache when it is the last one used. */
async function openCommit(owner: string, repo: string, ref: string, signal: AbortSignal, known?: string): Promise<{ commit: string; snap: Snapshot }> {
  const commit = known ?? (await githubCommit(owner, repo, ref, signal));
  const key = `${owner}/${repo}@${commit}`.toLowerCase();
  const snap = snapshot?.key === key ? snapshot : (snapshot = { key, files: await githubFiles(owner, repo, ref, commit, signal), blobs: new Map(), bytes: 0 });
  return { commit, snap };
}

/** One file of the commit, downloaded from raw.githubusercontent.com unless it is cached. */
async function githubBlob(owner: string, repo: string, commit: string, snap: Snapshot, path: string, signal: AbortSignal): Promise<Uint8Array> {
  const hit = snap.blobs.get(path);
  if (hit) return hit;
  const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`, { signal });
  if (!res.ok) throw new Error(`could not download ${path} (${res.status})`);
  const data = new Uint8Array(await res.arrayBuffer());
  if (snap.bytes + data.byteLength <= SNAPSHOT_BYTES) {
    snap.blobs.set(path, data);
    snap.bytes += data.byteLength;
  }
  return data;
}

/**
 * A look into a github.com repo without cloning it: its commit and file list (two API requests), and single files
 * on demand. Lets a repo of several courses be listed from each course.yaml instead of downloading every course.
 */
async function peekGithub(url: string, ref: string, timeoutMs: number): Promise<RepoPeek | null> {
  const gh = parseGithubUrl(url);
  if (!gh) return null;
  const signal = AbortSignal.timeout(timeoutMs);
  const { commit, snap } = await openCommit(gh.owner, gh.repo, ref, signal);
  return { commit, files: snap.files.map((e) => e.path), read: (path) => githubBlob(gh.owner, gh.repo, commit, snap, path, signal) };
}

/**
 * Clones a public GitHub repo without git: the commit, then the git/trees API for the file list, then each file
 * from raw.githubusercontent.com pinned to that commit. Both hosts allow cross-origin requests, which is what lets
 * the in-browser build import by URL. Anonymous API calls are limited (60 an hour). With `subpath`, only the files
 * under that folder are downloaded.
 */
async function cloneFromGithub(owner: string, repo: string, ref: string, dest: string, opts: GitRunOptions): Promise<void> {
  // The first failed download stops the others, so nothing writes into `dest` after the caller has removed it.
  // One controller for that and the timeout (AbortSignal.any is missing in Safari before 17.4).
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(new DOMException("The clone timed out", "TimeoutError")), opts.timeoutMs);
  try {
    await cloneInto(owner, repo, ref, dest, stop, opts.subpath ?? "", opts.commit);
  } finally {
    clearTimeout(timer);
  }
}

async function cloneInto(owner: string, repo: string, ref: string, dest: string, stop: AbortController, subpath: string, known?: string): Promise<void> {
  const signal = stop.signal;
  const { commit, snap } = await openCommit(owner, repo, ref, signal, known);

  // the trailing slash keeps sibling folders that share a prefix ("course" vs "course-2") out
  const prefix = subpath ? `${subpath}/` : "";
  const files = snap.files.filter((e) => e.path.startsWith(prefix));
  mkdirSync(dest, { recursive: true });

  let next = 0;
  let failure: unknown = null;
  const worker = async () => {
    for (let e = files[next++]; e && !signal.aborted; e = files[next++]) {
      const data = await githubBlob(owner, repo, commit, snap, e.path, signal);
      if (signal.aborted) return;
      const target = `${dest}/${e.path}`;
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, data);
    }
  };
  // allSettled, not all: return only once every worker has stopped, and report the first error, not the aborts it caused
  await Promise.allSettled(
    Array.from({ length: CLONE_CONCURRENCY }, () =>
      worker().catch((e: unknown) => {
        failure ??= e;
        stop.abort();
      }),
    ),
  );
  if (failure !== null) throw failure;
  signal.throwIfAborted();
  commits.set(dest, commit);
}

/**
 * A GitRunner that handles clones of github.com repos over HTTPS through GitHub's web APIs, and hands everything
 * else (other hosts, other git commands) to `fallback`, normally the real git binary. Its `peek` looks into
 * github.com repos without cloning.
 */
export const withGithub = (fallback: GitRunner): GitRunner =>
  Object.assign(
    async (args: string[], opts: GitRunOptions) => {
      if (args[0] === "rev-parse" && args[1] === "HEAD" && opts.cwd && commits.has(opts.cwd)) return commits.get(opts.cwd)!;
      if (!args.includes("clone")) return fallback(args, opts);

      const dest = args.at(-1)!;
      const gh = parseGithubUrl(args.at(-2)!);
      if (!gh) return fallback(args, opts);

      const ref = args[args.indexOf("--branch") + 1] ?? "main";
      await cloneFromGithub(gh.owner, gh.repo, ref, dest, opts);
      return "";
    },
    { peek: peekGithub },
  );
