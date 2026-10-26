// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCAL_DB_NAME, purgeLocalData } from "./purge";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("purgeLocalData", () => {
  it("removes the saved database and every selfschool-* key, and leaves other keys alone", async () => {
    const deleted: string[] = [];
    vi.stubGlobal("indexedDB", {
      deleteDatabase: (name: string) => {
        deleted.push(name);
        const req: { onsuccess?: () => void } = {};
        queueMicrotask(() => req.onsuccess?.());
        return req;
      },
    });
    localStorage.setItem("selfschool-theme", "dark");
    localStorage.setItem("selfschool-last-backup", "1");
    localStorage.setItem("other-app", "keep");

    await purgeLocalData();

    expect(deleted).toEqual([LOCAL_DB_NAME]);
    expect(localStorage.getItem("selfschool-theme")).toBeNull();
    expect(localStorage.getItem("selfschool-last-backup")).toBeNull();
    expect(localStorage.getItem("other-app")).toBe("keep");
  });
});
