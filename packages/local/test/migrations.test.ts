import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import NativeDatabase from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate as nativeMigrate } from "drizzle-orm/better-sqlite3/migrator";
import initSqlJs from "sql.js";
import { beforeAll, describe, expect, it } from "vitest";
import ShimDatabase, { configureSqlite } from "../src/shims/better-sqlite3.js";
import { migrate as shimMigrate } from "../src/shims/migrator.js";

const migrationsDir = fileURLToPath(new URL("../../api/drizzle", import.meta.url));
const journal = JSON.parse(readFileSync(join(migrationsDir, "meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
const OLD = 3; // pretend the saved file comes from a build that only knew the first OLD migrations
const insertPackage = "INSERT INTO package (id, url, path, ref, fetched_at, schema_version, sha) VALUES ('c1', 'u', '', 'main', 1, 1, 'abc')";

/** A folder holding only the first `n` migrations, as an older build of the app had them. */
function olderMigrations(n: number): string {
  const dir = mkdtempSync(join(tmpdir(), "mig-"));
  mkdirSync(join(dir, "meta"));
  const entries = journal.entries.slice(0, n);
  for (const e of entries) copyFileSync(join(migrationsDir, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
  writeFileSync(join(dir, "meta/_journal.json"), JSON.stringify({ ...JSON.parse(readFileSync(join(migrationsDir, "meta/_journal.json"), "utf8")), entries }));
  return dir;
}

const applied = (db: { prepare(s: string): { all(): unknown[] } }) => db.prepare("SELECT count(*) AS n FROM __drizzle_migrations").all()[0] as { n: number };

beforeAll(async () => {
  configureSqlite(await initSqlJs());
});

describe("database files move between the Node api and the browser build", () => {
  it("brings a database saved by an older build up to date and keeps its rows", async () => {
    const old = new NativeDatabase(":memory:");
    nativeMigrate(drizzle(old), { migrationsFolder: olderMigrations(OLD) });
    old.exec(insertPackage);
    const bytes = old.serialize();
    expect(applied(old).n).toBe(OLD);

    configureSqlite(await initSqlJs(), new Uint8Array(bytes));
    const db = new ShimDatabase();
    shimMigrate({ $client: db });
    expect(applied(db).n).toBe(journal.entries.length);
    expect(db.prepare("SELECT id FROM package").all()).toEqual([{ id: "c1" }]);
  });

  it("adopts a file saved by the first browser builds, which tracked migrations in their own table", async () => {
    const first = new ShimDatabase();
    for (const e of journal.entries.slice(0, OLD)) first.exec(readFileSync(join(migrationsDir, `${e.tag}.sql`), "utf8"));
    first.exec("CREATE TABLE __local_migrations (name TEXT PRIMARY KEY)");
    for (const e of journal.entries.slice(0, OLD)) first.prepare("INSERT INTO __local_migrations (name) VALUES (?)").run(`${e.tag}.sql`);
    first.exec(insertPackage);

    configureSqlite(await initSqlJs(), first.serialize());
    const db = new ShimDatabase();
    shimMigrate({ $client: db });
    expect(applied(db).n).toBe(journal.entries.length);
    expect(db.prepare("SELECT id FROM package").all()).toEqual([{ id: "c1" }]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = '__local_migrations'").all()).toEqual([]);
  });

  it("starting twice on the same file applies nothing the second time", async () => {
    const first = new ShimDatabase();
    shimMigrate({ $client: first });
    first.exec(insertPackage);

    configureSqlite(await initSqlJs(), first.serialize());
    const second = new ShimDatabase();
    shimMigrate({ $client: second });
    expect(applied(second).n).toBe(journal.entries.length);
    expect(second.prepare("SELECT count(*) AS n FROM package").all()).toEqual([{ n: 1 }]);
  });

  it("a file the browser build migrated is accepted by the Node api's migrator unchanged (Docker restore)", () => {
    const browser = new ShimDatabase();
    shimMigrate({ $client: browser });
    browser.exec(insertPackage);

    const file = join(mkdtempSync(join(tmpdir(), "restore-")), "restored.db");
    writeFileSync(file, browser.serialize());
    const native = new NativeDatabase(file);
    expect(() => nativeMigrate(drizzle(native), { migrationsFolder: migrationsDir })).not.toThrow();
    expect(native.prepare("SELECT id FROM package").all()).toEqual([{ id: "c1" }]);
    expect(applied(native).n).toBe(journal.entries.length);
  });

  it("a file the Node api migrated is accepted by the browser build unchanged (browser restore)", async () => {
    const native = new NativeDatabase(":memory:");
    nativeMigrate(drizzle(native), { migrationsFolder: migrationsDir });
    native.exec(insertPackage);

    configureSqlite(await initSqlJs(), new Uint8Array(native.serialize()));
    const db = new ShimDatabase();
    expect(() => shimMigrate({ $client: db })).not.toThrow();
    expect(db.prepare("SELECT id FROM package").all()).toEqual([{ id: "c1" }]);
    expect(applied(db).n).toBe(journal.entries.length);
  });
});
