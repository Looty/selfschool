import { cpSync, existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { packages } from "../src/db/schema.js";
import type { GitRunner } from "../src/ctx.js";
import { validateGitUrl, validateRef, validateSubpath } from "../src/packages.js";
import { fixtureDir, setup } from "./helpers.js";

describe("settings", () => {
  it("defaults, updates per job kind and rejects unknown models", async () => {
    const h = setup();
    const s = (await h.get("/settings")).json;
    expect(s.models).toEqual({ grade: "haiku", chat: "haiku", generate: "sonnet", verify: "sonnet" });
    expect(s.modelOptions.chat).toEqual(["haiku", "sonnet", "opus"]);
    expect(s.runner).toEqual({ connected: false, lastSeen: null });
    expect(s.database.sizeBytes).toBeGreaterThan(0);

    const u = await h.call("PUT", "/settings", { models: { verify: "opus" } });
    expect(u.json.models).toEqual({ grade: "haiku", chat: "haiku", generate: "sonnet", verify: "opus" });
    expect((await h.get("/settings")).json.models.verify).toBe("opus");
    expect((await h.call("PUT", "/settings", { models: { chat: "gpt-9" } })).status).toBe(400);
    expect((await h.call("PUT", "/settings", {})).status).toBe(400);
  });
});

describe("package updates", () => {
  const mark = (h: ReturnType<typeof setup>, set: Partial<typeof packages.$inferInsert>) =>
    h.db.update(packages).set(set).where(eq(packages.id, "mini")).run();
  const SHA = "b".repeat(40);

  afterEach(() => vi.unstubAllGlobals());

  it("says there is nothing to check for a course that did not come from GitHub", async () => {
    const h = setup();
    await h.get("/packages"); // registers the course folder as a package
    const r = (await h.get("/packages/mini/updates")).json;
    expect(r).toMatchObject({ status: "unknown", latestSha: null, branches: [], tags: [], ref: "local" });
    expect(r.note).toMatch(/GitHub/);
    expect((await h.get("/packages/nope/updates")).status).toBe(404);
  });

  it("reports an update when the ref moved, and the other branches and tags", async () => {
    const h = setup();
    await h.get("/packages");
    mark(h, { url: "https://github.com/o/r", ref: "v1", sha: "a".repeat(40) });
    vi.stubGlobal("fetch", async (url: string) =>
      url.includes("/commits/") ? new Response(SHA)
        : url.includes("/branches") ? Response.json([{ name: "main" }, { name: "v1.1" }])
        : Response.json([{ name: "v1" }]),
    );
    const r = (await h.get("/packages/mini/updates")).json;
    expect(r).toEqual({ ref: "v1", sha: "a".repeat(40), latestSha: SHA, status: "update_available", branches: ["main", "v1.1"], tags: ["v1"], note: null });

    mark(h, { sha: SHA });
    expect((await h.get("/packages/mini/updates")).json.status).toBe("up_to_date");
  });

  it("stays 'unknown' with a reason when GitHub cannot be reached", async () => {
    const h = setup();
    await h.get("/packages");
    mark(h, { url: "https://github.com/o/r", ref: "main", sha: "a".repeat(40) });
    vi.stubGlobal("fetch", async () => new Response("", { status: 403 }));
    const r = (await h.get("/packages/mini/updates")).json;
    expect(r.status).toBe("unknown");
    expect(r.note).toMatch(/rate limit/);
  });
});

describe("packages", () => {
  it("lists courses on disk with url/ref metadata", async () => {
    const h = setup();
    const { packages } = (await h.get("/packages")).json;
    expect(packages).toEqual([
      { id: "mini", course: expect.objectContaining({ id: "mini" }), url: "local:mini", path: "", ref: "local", sha: expect.stringMatching(/^[0-9a-f]{12}$/), status: "up_to_date", latestSha: null },
    ]);
  });

  it("clones a git package shallowly via argv (fake git), validates it and installs it", async () => {
    const calls: string[][] = [];
    const git: GitRunner = async (args, opts) => {
      calls.push(args);
      if (args.includes("clone")) {
        const dest = args[args.length - 1]!;
        cpSync(fixtureDir("mini"), join(dest, "pkg", "mini"), { recursive: true });
        // an attacker-controlled repo may carry symlinks; they must not survive
        try { symlinkSync(join(dest, "..", "x"), join(dest, "pkg", "mini", "resources", "link")); } catch { /* needs privileges on windows */ }
        return "";
      }
      expect(args).toEqual(["rev-parse", "HEAD"]);
      expect(opts.cwd).toBeDefined();
      return "abc123def456";
    };
    const empty = mkdtempSync(join(tmpdir(), "selfschool-pk-"));
    const h = setup({ coursesDir: empty, git });
    const r = await h.post("/packages", { url: "https://github.com/friend/courses.git", path: "pkg/mini", ref: "v1" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ id: "mini", url: "https://github.com/friend/courses.git", path: "pkg/mini", ref: "v1", sha: "abc123def456" });

    const clone = calls[0]!;
    expect(clone).toEqual(expect.arrayContaining(["clone", "--depth", "1", "--branch", "v1", "--"]));
    expect(clone).toContain("protocol.allow=never");
    expect(clone[clone.length - 2]).toBe("https://github.com/friend/courses.git"); // after `--`, never parsed as an option
    expect(existsSync(join(empty, "mini", "course.yaml"))).toBe(true);
    expect(existsSync(join(empty, "mini", "resources", "link"))).toBe(false);
    expect((await h.get("/courses")).json.courses).toHaveLength(1);
    expect((await h.get("/packages")).json.packages[0]).toMatchObject({ url: "https://github.com/friend/courses.git", ref: "v1", sha: "abc123def456" });
    expect(existsSync(join(empty, ".fetch-x"))).toBe(false);

    // adding the same repo again updates in place; a different origin with the same id conflicts
    expect((await h.post("/packages", { url: "https://github.com/friend/courses.git", path: "pkg/mini", ref: "v1" })).status).toBe(200);
    expect((await h.post("/packages", { url: "https://github.com/other/courses.git", path: "pkg/mini", ref: "v1" })).status).toBe(409);
  });

  it("rejects clones that are not valid course packages", async () => {
    const git: GitRunner = async (args) => {
      if (args.includes("clone")) {
        const dest = args[args.length - 1]!;
        mkdirSync(dest, { recursive: true });
        writeFileSync(join(dest, "README.md"), "hi");
      }
      return "";
    };
    const empty = mkdtempSync(join(tmpdir(), "selfschool-pk-"));
    const h = setup({ coursesDir: empty, git });
    const r = await h.post("/packages", { url: "https://github.com/friend/notes" });
    expect(r.status).toBe(422);
    expect(r.json.error).toMatch(/no course\.yaml/);
  });

  it("installs an absolute local folder", async () => {
    const empty = mkdtempSync(join(tmpdir(), "selfschool-pk-"));
    const h = setup({ coursesDir: empty });
    const r = await h.post("/packages", { url: fixtureDir("mini") });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ id: "mini", ref: "local" });
    expect(r.json.sha).toMatch(/^[0-9a-f]{12}$/);
    expect((await h.get("/courses/mini")).status).toBe(200);
  });

  it("validates untrusted input strictly and never reaches git", async () => {
    const git: GitRunner = async () => {
      throw new Error("git must not run");
    };
    const h = setup({ git });
    const bad = [
      { url: "http://github.com/a/b" },
      { url: "git@github.com:a/b.git" },
      { url: "ssh://git@github.com/a/b" },
      { url: "file:///etc" },
      { url: "ext::sh -c touch /tmp/pwned" },
      { url: "--upload-pack=touch /tmp/pwned" },
      { url: "https://user:pw@github.com/a/b" },
      { url: "https://localhost/a/b" },
      { url: "https://169.254.169.254/latest" },
      { url: "https://github.com/a/b", ref: "--upload-pack=x" },
      { url: "https://github.com/a/b", ref: "a..b" },
      { url: "https://github.com/a/b", path: "../etc" },
      { url: "https://github.com/a/b", path: "/abs" },
      { url: "relative/folder" },
      { url: "/definitely/not/here" },
    ];
    for (const b of bad) {
      const r = await h.post("/packages", b);
      expect(r.status, JSON.stringify(b)).toBe(400);
    }
  });

  it("unit: validators", () => {
    expect(validateGitUrl("https://github.com/a/b.git#frag")).toBe("https://github.com/a/b.git");
    expect(validateRef("feature/x-1.2")).toBe("feature/x-1.2");
    expect(() => validateRef("")).toThrow();
    expect(validateSubpath("")).toBe("");
    expect(validateSubpath("a/b c/")).toBe("a/b c");
    expect(() => validateSubpath("a/../b")).toThrow();
    expect(() => validateSubpath("a\\b")).toThrow();
  });
});
