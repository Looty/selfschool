import { describe, expect, it } from "vitest";
import * as fs from "../src/shims/fs.js";

describe("in-memory fs shim", () => {
  it("round-trips files and lists directories sorted, with types", () => {
    fs.mkdirSync("/t1/sub", { recursive: true });
    fs.writeFileSync("/t1/b.txt", "bee");
    fs.writeFileSync("/t1/a.txt", new Uint8Array([104, 105]));
    expect(fs.readdirSync("/t1")).toEqual(["a.txt", "b.txt", "sub"]);
    expect(fs.readFileSync("/t1/a.txt", "utf8")).toBe("hi");
    const kinds = fs.readdirSync("/t1", { withFileTypes: true }).map((d) => [d.name, d.isDirectory()]);
    expect(kinds).toEqual([["a.txt", false], ["b.txt", false], ["sub", true]]);
    expect(fs.statSync("/t1/b.txt")!.size).toBe(3);
  });

  it("throws ENOENT with a code, and returns undefined for throwIfNoEntry:false", () => {
    expect(() => fs.readFileSync("/nope")).toThrow(expect.objectContaining({ code: "ENOENT" }));
    expect(fs.statSync("/nope", { throwIfNoEntry: false })).toBeUndefined();
    expect(() => fs.writeFileSync("/missing-dir/x", "x")).toThrow(expect.objectContaining({ code: "ENOENT" }));
  });

  it("renames and copies whole trees, and removes recursively", () => {
    fs.mkdirSync("/t2/a/deep", { recursive: true });
    fs.writeFileSync("/t2/a/deep/f.txt", "f");
    fs.renameSync("/t2/a", "/t2/b");
    expect(fs.existsSync("/t2/a")).toBe(false);
    expect(fs.readFileSync("/t2/b/deep/f.txt", "utf8")).toBe("f");
    fs.cpSync("/t2/b", "/t2/c", { recursive: true });
    expect(fs.readFileSync("/t2/c/deep/f.txt", "utf8")).toBe("f");
    expect(() => fs.rmSync("/t2/b")).toThrow(expect.objectContaining({ code: "ENOTEMPTY" }));
    fs.rmSync("/t2/b", { recursive: true });
    expect(fs.existsSync("/t2/b/deep/f.txt")).toBe(false);
    fs.rmSync("/t2/gone", { force: true });
  });

  it("snapshots files under roots and restores them", () => {
    fs.mkdirSync("/t3", { recursive: true });
    fs.writeFileSync("/t3/x.md", "x");
    const snap = fs.snapshot(["/t3"]);
    expect(Object.keys(snap)).toEqual(["/t3/x.md"]);
    fs.rmSync("/t3", { recursive: true });
    fs.restore(snap);
    expect(fs.readFileSync("/t3/x.md", "utf8")).toBe("x");
  });
});
