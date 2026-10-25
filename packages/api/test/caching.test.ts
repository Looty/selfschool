import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { miniCourses, setup } from "./helpers.js";

describe("course files", () => {
  it("send a validator and answer a repeat request with 304 and no body", async () => {
    const h = setup();
    const first = await h.app.request("/courses/mini/files/resources/pic.svg");
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^W\//);
    expect(first.headers.get("cache-control")).toContain("max-age");
    expect((await first.text()).length).toBeGreaterThan(0);

    const again = await h.app.request("/courses/mini/files/resources/pic.svg", { headers: { "if-none-match": etag } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");

    const stale = await h.app.request("/courses/mini/files/resources/pic.svg", { headers: { "if-none-match": 'W/"nope"' } });
    expect(stale.status).toBe(200);
  });
});

describe("backup", () => {
  it("downloads the progress database as a SQLite file", async () => {
    const h = setup();
    const res = await h.app.request("/backup");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="selfschool-backup-\d{4}-\d{2}-\d{2}\.sqlite"$/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 15))).toBe("SQLite format 3");
  });
});

describe("catalog re-scan", () => {
  const titleOf = async (h: ReturnType<typeof setup>) => (await h.get("/courses/mini")).json.title as string;

  it("notices an edit on the next request by default (tests and one-off tools)", async () => {
    const dir = miniCourses();
    const h = setup({ coursesDir: dir });
    const before = await titleOf(h);
    const file = join(dir, "mini", "course.yaml");
    writeFileSync(file, (await import("node:fs")).readFileSync(file, "utf8").replace(/^title: .*/m, "title: Renamed"));
    expect(await titleOf(h)).toBe("Renamed");
    expect(before).not.toBe("Renamed");
  });

  it("with a re-scan interval, serves the cache at once and picks up the edit in the background", async () => {
    const dir = miniCourses();
    // Wide enough that a slow CI machine does not let the interval lapse between the edit and the first read.
    const h = setup({ coursesDir: dir, catalogRecheckMs: 600 });
    await titleOf(h);
    const file = join(dir, "mini", "course.yaml");
    const text = (await import("node:fs")).readFileSync(file, "utf8");
    writeFileSync(file, text.replace(/^title: .*/m, "title: Later"));
    expect(await titleOf(h)).not.toBe("Later"); // inside the interval: no file walk
    await new Promise((r) => setTimeout(r, 700));
    // Past the interval the request is still answered from the cache (it never waits for the walk) ...
    expect(await titleOf(h)).not.toBe("Later");
    // ... and the background check swaps the new content in shortly after.
    let title = "";
    for (let i = 0; i < 40 && title !== "Later"; i++) {
      await new Promise((r) => setTimeout(r, 50));
      title = await titleOf(h);
    }
    expect(title).toBe("Later");
    appendFileSync(file, "\n");
  });
});
