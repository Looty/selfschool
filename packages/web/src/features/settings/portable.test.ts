// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { restorePortableBackup } from "./portable";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const backup = (over: object = {}) =>
  new File(
    [JSON.stringify({ format: "selfschool-backup", version: 1, exportedAt: "2026-10-26T00:00:00.000Z", tables: {}, courses: [], prefs: {}, ...over })],
    "b.json",
  );

describe("restorePortableBackup", () => {
  it("refuses a file that is not a backup before touching anything", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(restorePortableBackup(new File(["{\"hello\":1}"], "x.json"), () => {})).rejects.toThrow("not a Selfschool backup");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("puts the preferences back, ignoring keys that are not ours, and lists zip courses to add by hand", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ restored: true, courses: [] }), { status: 200 })));
    const report = await restorePortableBackup(
      backup({
        prefs: { "selfschool-theme": "dark", "other-app": "x", "selfschool-last-backup": "1" },
        courses: [{ id: "zipped", url: "zip:a.zip", path: "", ref: "upload", sha: "abc" }],
      }),
      () => {},
    );
    expect(localStorage.getItem("selfschool-theme")).toBe("dark");
    expect(localStorage.getItem("other-app")).toBeNull();
    expect(localStorage.getItem("selfschool-last-backup")).toBeNull();
    expect(report.missing.map((m) => m.id)).toEqual(["zipped"]);
  });

  it("reports the server's reason when it refuses the file", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "unknown table: evil" }), { status: 400 })));
    await expect(restorePortableBackup(backup(), () => {})).rejects.toThrow("unknown table: evil");
  });
});
