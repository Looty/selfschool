import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitRunner } from "../src/ctx.js";
import { checkGithubUpdates, forgetGithubSnapshot, parseGithubUrl, withGithub } from "../src/githubGit.js";

const SHA = "a".repeat(40);
const tree = {
  sha: SHA,
  tree: [
    { path: "course", mode: "040000", type: "tree" },
    { path: "course/course.yaml", mode: "100644", type: "blob" },
    { path: "course/ch one/lesson-01.md", mode: "100644", type: "blob" },
    { path: "link", mode: "120000", type: "blob" },
    { path: "sub", mode: "160000", type: "commit" },
  ],
};

const stubFetch = (routes: Record<string, () => Response>) =>
  vi.stubGlobal("fetch", async (url: string) => {
    const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    return hit ? hit[1]() : new Response("nope", { status: 404 });
  });

const clone = (url: string, dest: string, ref = "main") => ["clone", "--depth", "1", "--branch", ref, "--", url, dest];

afterEach(() => {
  vi.unstubAllGlobals();
  forgetGithubSnapshot();
});

describe("withGithub", () => {
  it("clones a github.com repo through the web APIs, pinned to the commit, and answers rev-parse", async () => {
    stubFetch({
      "https://api.github.com/repos/o/r/commits/main": () => new Response(`${SHA}\n`),
      [`https://api.github.com/repos/o/r/git/trees/${SHA}?recursive=1`]: () => Response.json({ tree: tree.tree }),
      [`https://raw.githubusercontent.com/o/r/${SHA}/`]: () => new Response("body"),
    });
    const inner = vi.fn<GitRunner>();
    const git = withGithub(inner);
    const dest = join(mkdtempSync(join(tmpdir(), "ghgit-")), "repo");

    expect(await git(clone("https://github.com/o/r.git", dest), { timeoutMs: 5000 })).toBe("");
    expect(readFileSync(join(dest, "course/course.yaml"), "utf8")).toBe("body");
    expect(readFileSync(join(dest, "course/ch one/lesson-01.md"), "utf8")).toBe("body");
    expect(() => readFileSync(join(dest, "link"))).toThrow(); // symlinks and submodules are not fetched
    expect(await git(["rev-parse", "HEAD"], { cwd: dest, timeoutMs: 5000 })).toBe(SHA);
    expect(inner).not.toHaveBeenCalled();
  });

  describe("a repo of several courses", () => {
    const files = ["course/course.yaml", "course/01-a/lesson-01.md", "course-2/course.yaml", "README.md"];
    const raw = `https://raw.githubusercontent.com/o/r/${SHA}/`;
    let requested: string[] = [];
    beforeEach(() => {
      requested = [];
      vi.stubGlobal("fetch", async (url: string) => {
        requested.push(url);
        if (url === "https://api.github.com/repos/o/r/commits/main") return new Response(SHA);
        if (url.startsWith(`https://api.github.com/repos/o/r/git/trees/${SHA}`)) return Response.json({ tree: files.map((path) => ({ path, mode: "100644", type: "blob" })) });
        if (url.startsWith(raw)) return new Response(url.slice(raw.length));
        return new Response("nope", { status: 404 });
      });
    });
    const fresh = () => join(mkdtempSync(join(tmpdir(), "ghgit-")), "repo");
    const downloads = () => requested.filter((u) => u.startsWith(raw)).map((u) => u.slice(raw.length)).sort();

    it("downloads only the files under the subpath, not a sibling folder sharing its prefix", async () => {
      const git = withGithub(vi.fn<GitRunner>());
      const dest = fresh();
      await git(clone("https://github.com/o/r", dest), { timeoutMs: 5000, subpath: "course" });
      expect(downloads()).toEqual(["course/01-a/lesson-01.md", "course/course.yaml"]);
      expect(readFileSync(join(dest, "course/01-a/lesson-01.md"), "utf8")).toBe("course/01-a/lesson-01.md");
      expect(existsSync(join(dest, "course-2"))).toBe(false);
    });

    it("reuses the files of the same commit: a second clone asks only for the commit", async () => {
      const git = withGithub(vi.fn<GitRunner>());
      await git(clone("https://github.com/o/r", fresh()), { timeoutMs: 5000 }); // the whole repo (preview without a path)
      requested = [];
      const dest = fresh();
      await git(clone("https://github.com/o/r", dest), { timeoutMs: 5000, subpath: "course" }); // then one course of it
      expect(requested).toEqual(["https://api.github.com/repos/o/r/commits/main"]);
      expect(readFileSync(join(dest, "course/course.yaml"), "utf8")).toBe("course/course.yaml");
      expect(await git(["rev-parse", "HEAD"], { cwd: dest, timeoutMs: 5000 })).toBe(SHA);
    });

    it("downloads again when the branch moved to another commit", async () => {
      const git = withGithub(vi.fn<GitRunner>());
      await git(clone("https://github.com/o/r", fresh()), { timeoutMs: 5000, subpath: "course" });
      forgetGithubSnapshot(); // stands in for a new commit: nothing cached for it
      requested = [];
      await git(clone("https://github.com/o/r", fresh()), { timeoutMs: 5000, subpath: "course" });
      expect(downloads()).toEqual(["course/01-a/lesson-01.md", "course/course.yaml"]);
    });

    it("stops every download on the first failure, so nothing is written after the clone rejects", async () => {
      const many = Array.from({ length: 40 }, (_, i) => `course/f${i}.md`);
      vi.stubGlobal("fetch", async (url: string) => {
        if (url === "https://api.github.com/repos/o/r/commits/main") return new Response(SHA);
        if (url.startsWith(`https://api.github.com/repos/o/r/git/trees/${SHA}`)) return Response.json({ tree: many.map((path) => ({ path, mode: "100644", type: "blob" })) });
        if (url.endsWith("/f0.md")) return new Response("", { status: 429 });
        await new Promise((r) => setTimeout(r, 20));
        return new Response("x");
      });
      const git = withGithub(vi.fn<GitRunner>());
      const dest = fresh();
      await expect(git(clone("https://github.com/o/r", dest), { timeoutMs: 5000, subpath: "course" })).rejects.toThrow(/could not download course\/f0\.md \(429\)/);
      rmSync(dest, { recursive: true, force: true }); // what fetchPackage does on failure
      await new Promise((r) => setTimeout(r, 60));
      expect(existsSync(dest)).toBe(false);
    });

    it("creates no folder for a subpath that is not in the repo", async () => {
      const git = withGithub(vi.fn<GitRunner>());
      const dest = fresh();
      await git(clone("https://github.com/o/r", dest), { timeoutMs: 5000, subpath: "nope" });
      expect(downloads()).toEqual([]);
      expect(existsSync(join(dest, "nope"))).toBe(false);
    });
  });

  it("hands other hosts, other commands and unknown repos to the fallback git", async () => {
    const inner = vi.fn<GitRunner>(async () => "from-git");
    const git = withGithub(inner);
    expect(await git(clone("https://gitlab.com/o/r", "/tmp/x"), { timeoutMs: 1 })).toBe("from-git");
    expect(await git(["rev-parse", "HEAD"], { cwd: "/not/cloned", timeoutMs: 1 })).toBe("from-git");
    expect(await git(["status"], { timeoutMs: 1 })).toBe("from-git");
    expect(inner).toHaveBeenCalledTimes(3);
  });

  it("reports a missing repo, a rate limit and a truncated tree in plain words", async () => {
    const git = withGithub(vi.fn<GitRunner>());
    const dest = join(mkdtempSync(join(tmpdir(), "ghgit-")), "repo");
    const commit = "https://api.github.com/repos/o/r/commits/main";
    const trees = `https://api.github.com/repos/o/r/git/trees/${SHA}?recursive=1`;

    stubFetch({ [commit]: () => new Response("", { status: 404 }) });
    await expect(git(clone("https://github.com/o/r", dest), { timeoutMs: 5000 })).rejects.toThrow(/not found.*public/);
    stubFetch({ [commit]: () => new Response("", { status: 403 }) });
    await expect(git(clone("https://github.com/o/r", dest), { timeoutMs: 5000 })).rejects.toThrow(/rate limit/);
    stubFetch({ [commit]: () => new Response(SHA), [trees]: () => Response.json({ ...tree, truncated: true }) });
    await expect(git(clone("https://github.com/o/r", dest), { timeoutMs: 5000 })).rejects.toThrow(/too large/);
  });
});

describe("parseGithubUrl", () => {
  it("accepts https github.com repos only", () => {
    expect(parseGithubUrl("https://github.com/o/r")).toEqual({ owner: "o", repo: "r" });
    expect(parseGithubUrl("https://github.com/o/r.git")).toEqual({ owner: "o", repo: "r" });
    for (const bad of ["http://github.com/o/r", "https://gitlab.com/o/r", "https://github.com/o", "local:/x", "not a url"]) {
      expect(parseGithubUrl(bad)).toBeNull();
    }
  });
});

describe("checkGithubUpdates", () => {
  const api = "https://api.github.com/repos/o/r";

  it("returns the latest commit and the branches and tags to switch to", async () => {
    stubFetch({
      [`${api}/commits/v1`]: () => new Response(SHA),
      [`${api}/branches`]: () => Response.json([{ name: "main" }, { name: "v1.1" }]),
      [`${api}/tags`]: () => Response.json([{ name: "v1" }]),
    });
    expect(await checkGithubUpdates("o", "r", "v1")).toEqual({ latestSha: SHA, branches: ["main", "v1.1"], tags: ["v1"], note: null });
  });

  it("keeps what answered and says why the rest is missing", async () => {
    stubFetch({
      [`${api}/commits/main`]: () => new Response(SHA),
      [`${api}/branches`]: () => new Response("", { status: 403 }),
      [`${api}/tags`]: () => Response.json([]),
    });
    const r = await checkGithubUpdates("o", "r", "main");
    expect(r).toMatchObject({ latestSha: SHA, branches: [], tags: [] });
    expect(r.note).toMatch(/rate limit/);
  });
});
