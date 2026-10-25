import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkApi } from "../src/doctor.js";
import { findRoot, readRunnerPid, writePid } from "../src/root.js";
import { validate } from "../src/commands.js";

let server: Server | undefined;
let tmp: string | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

function serveHealth(body: unknown, status = 200): Promise<string> {
  return new Promise((resolve) => {
    server = createServer((_, res) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    }).listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`));
  });
}

describe("doctor api checks", () => {
  it("passes when healthy, migrated and runner connected", async () => {
    const url = await serveHealth({ ok: true, migrated: true, runner: { connected: true, lastSeen: 1 } });
    expect((await checkApi(url)).map((c) => c.ok)).toEqual([true, true, true]);
  });

  it("flags a disconnected runner but still ok for api and db", async () => {
    const url = await serveHealth({ ok: true, migrated: true, runner: { connected: false, lastSeen: null } });
    expect((await checkApi(url)).map((c) => c.ok)).toEqual([true, true, false]);
  });

  it("fails everything when the api is unreachable", async () => {
    expect((await checkApi("http://127.0.0.1:1")).map((c) => c.ok)).toEqual([false, false, false]);
  });
});

describe("root + pidfile", () => {
  it("finds compose.yaml upward and tracks the pid", () => {
    tmp = mkdtempSync(join(tmpdir(), "selfschool-cli-"));
    writeFileSync(join(tmp, "compose.yaml"), "services: {}\n");
    const nested = join(tmp, "a", "b");
    mkdirSync(nested, { recursive: true });
    expect(findRoot(nested, {})).toBe(tmp);
    expect(readRunnerPid(tmp)).toBeNull();
    writePid(tmp);
    expect(readRunnerPid(tmp)).toBe(process.pid);
  });
});

describe("validate command", () => {
  it("returns 1 for a directory without course.yaml", () => {
    tmp = mkdtempSync(join(tmpdir(), "selfschool-cli-"));
    expect(validate([tmp])).toBe(1);
  });

  it("treats a folder with extension.yaml as an extensions folder and finds its course package beside it", () => {
    tmp = mkdtempSync(join(tmpdir(), "selfschool-cli-"));
    const overlay = join(tmp, "extensions", "tiny");
    mkdirSync(join(overlay, "x01-deep"), { recursive: true });
    writeFileSync(join(overlay, "extension.yaml"), "schemaVersion: 1\nchapters:\n  - {dir: x01-deep, title: Deep}\n");
    writeFileSync(join(overlay, "x01-deep", "lesson-01.md"), "---\nid: x01\ntitle: T\nsources: none\n---\nBody\n");
    expect(validate([overlay])).toBe(0);

    // a bad id is reported with a failing exit code
    writeFileSync(join(overlay, "x01-deep", "lesson-01.md"), "---\nid: l01\ntitle: T\nsources: none\n---\nBody\n");
    expect(validate([overlay])).toBe(1);
  });
});
