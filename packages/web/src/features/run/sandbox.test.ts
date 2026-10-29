// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lockDown } from "./sandbox";

// A stand-in for a worker's global scope. lockDown pins its guards for good (on it and on XMLHttpRequest.prototype),
// exactly as in a worker, so it runs once for this whole file.
const realFetch = vi.fn(async (_req: Request) => new Response("ok"));
const proto = { fetch: realFetch, indexedDB: {}, caches: {}, Worker: class {}, BroadcastChannel: class {} };
const scope = Object.create(proto) as Record<string, unknown>;
scope.location = { href: "http://localhost:5176/selfschool/assets/w.js" };
scope.Request = Request;
scope.navigator = {};
lockDown(scope as unknown as DedicatedWorkerGlobalScope);
const guardedFetch = scope.fetch as typeof globalThis.fetch;

/** Reads as a harmless public URL the first time, and as the app's api after that. */
const sneaky = () => {
  let reads = 0;
  return { toString: () => (reads++ === 0 ? "https://example.com/" : "/api/backup") } as unknown as string;
};

beforeEach(() => realFetch.mockClear());

describe("lockDown", () => {
  it("refuses this app and the local network; passes the public internet on as the exact request it checked", async () => {
    await expect(guardedFetch("/api/backup")).rejects.toThrow(/cannot reach this app or your local network/);
    await expect(guardedFetch("http://127.0.0.1:3001/packages")).rejects.toThrow(/cannot reach/);
    await expect(guardedFetch(new Request("http://localhost:5176/api/settings"))).rejects.toThrow(/cannot reach/);
    await guardedFetch("https://cdn.jsdelivr.net/x.js");
    expect(realFetch).toHaveBeenCalledTimes(1);
    expect((realFetch.mock.calls[0]![0] as Request).url).toBe("https://cdn.jsdelivr.net/x.js");
  });

  it("an argument that answers differently on a second read cannot slip past the check", async () => {
    await guardedFetch(sneaky()).catch(() => {});
    // it was read once: what was sent is what was checked, and never the app's api
    expect(realFetch).toHaveBeenCalledTimes(1);
    expect((realFetch.mock.calls[0]![0] as Request).url).toBe("https://example.com/");
  });

  it("XMLHttpRequest refuses the app and opens only the URL it checked", () => {
    const xhr = new XMLHttpRequest();
    expect(() => xhr.open("GET", "/api/backup")).toThrow(/cannot reach/);
    const opened = new XMLHttpRequest();
    opened.open("GET", sneaky());
    expect(opened.readyState).toBe(1);
  });

  it("removes the origin's storage and nested workers, and the guards cannot be put back", () => {
    expect(scope.indexedDB).toBeUndefined();
    expect(scope.Worker).toBeUndefined();
    expect(() => {
      (proto as Record<string, unknown>).fetch = realFetch;
    }).toThrow();
    expect(() => Object.defineProperty(proto, "fetch", { value: realFetch })).toThrow();
  });
});
