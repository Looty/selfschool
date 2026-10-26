import { describe, expect, it } from "vitest";
import { miniCourses, passQuiz1, setup } from "./helpers.js";

const count = (h: ReturnType<typeof setup>, table: string) => (h.db.$client.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("portable backup", () => {
  it("exports progress as JSON and restores it into a fresh install", async () => {
    const dir = miniCourses();
    const a = setup({ coursesDir: dir });
    await passQuiz1(a);
    const file = (await a.get("/backup/portable")).json;

    expect(file.format).toBe("selfschool-backup");
    expect(file.tables.attempt.length).toBe(1);
    expect(file.courses.map((c: { id: string }) => c.id)).toEqual(["mini"]);
    expect(file.tables.__drizzle_migrations).toBeUndefined();

    // a new install on the same course files: empty progress, then the file puts it back
    const b = setup({ coursesDir: dir });
    expect(count(b, "attempt")).toBe(0);
    const res = await b.post("/restore", file);
    expect(res.status).toBe(200);
    expect(count(b, "attempt")).toBe(count(a, "attempt"));
    expect(count(b, "xp_event")).toBe(count(a, "xp_event"));
    expect((await b.get("/dashboard")).json.courses[0].progress).toEqual((await a.get("/dashboard")).json.courses[0].progress);
  });

  it("replaces what is there, not merges", async () => {
    const dir = miniCourses();
    const a = setup({ coursesDir: dir });
    const empty = (await a.get("/backup/portable")).json;
    await passQuiz1(a);
    expect(count(a, "attempt")).toBe(1);
    await a.post("/restore", empty);
    expect(count(a, "attempt")).toBe(0);
  });

  it("refuses files that are not backups, and tables or columns it does not know", async () => {
    const h = setup();
    expect((await h.post("/restore", { hello: "world" })).status).toBe(400);
    const file = (await h.get("/backup/portable")).json;
    expect((await h.post("/restore", { ...file, tables: { ...file.tables, evil: [{ a: 1 }] } })).status).toBe(400);
    expect((await h.post("/restore", { ...file, tables: { ...file.tables, package: [{ "id) VALUES (1); --": "x" }] } })).status).toBe(400);
    // a refused file changes nothing
    expect(count(h, "package")).toBe(file.tables.package.length);
  });
});
