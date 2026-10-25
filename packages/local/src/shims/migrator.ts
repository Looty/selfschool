/**
 * Stand-in for `drizzle-orm/better-sqlite3/migrator`. The real one reads the migrations folder from disk; here the same
 * committed files are bundled as text. It follows drizzle's own bookkeeping exactly (the `__drizzle_migrations` table:
 * sha256 of each file, the journal's `when` as created_at, run what is newer than the last row), so a database file
 * is interchangeable with the Node api's: a Docker backup restores into the browser and the other way round, and an
 * old file saved by an older build is brought up to date the next time the page starts.
 */
import { createHash } from "./crypto.js";

const files = import.meta.glob("../../../api/drizzle/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const journalRaw = Object.values(import.meta.glob("../../../api/drizzle/meta/_journal.json", { query: "?raw", import: "default", eager: true }))[0] as string;

interface Client {
  exec(sql: string): unknown;
  prepare(sql: string): { all(...a: unknown[]): unknown[]; run(...a: unknown[]): unknown };
  transaction<R>(fn: () => R): () => R;
}

/**
 * The first builds of the browser app tracked migrations in their own `__local_migrations` table (one row per file name).
 * A file saved by such a build already has those tables, so running its migrations again would fail: record what it
 * did in drizzle's table instead, then drop the old one. A no-op for every database that never had it.
 */
function adoptLegacyBookkeeping(sqlite: Client, entries: { tag: string; when: number }[], sqlOf: (tag: string) => string) {
  const has = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__local_migrations'`).all().length > 0;
  if (!has) return;
  const done = new Set((sqlite.prepare(`SELECT name FROM __local_migrations`).all() as { name: string }[]).map((r) => r.name.replace(/\.sql$/, "")));
  for (const e of entries) {
    if (!done.has(e.tag)) continue;
    sqlite.prepare(`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)`).run(createHash("sha256").update(sqlOf(e.tag)).digest("hex"), e.when);
  }
  sqlite.exec(`DROP TABLE __local_migrations`);
}

export function migrate(db: { $client: Client }, _config?: unknown) {
  const sqlite = db.$client;
  const journal = JSON.parse(journalRaw) as { entries: { tag: string; when: number }[] };
  const sqlOf = (tag: string) => {
    const hit = Object.entries(files).find(([path]) => path.endsWith(`/${tag}.sql`));
    if (!hit) throw new Error(`migration file ${tag}.sql is missing from the bundle`);
    return hit[1];
  };

  sqlite.exec(`CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`);
  adoptLegacyBookkeeping(sqlite, journal.entries, sqlOf);
  const last = sqlite.prepare(`SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1`).all()[0] as { created_at: number } | undefined;

  sqlite.transaction(() => {
    for (const entry of journal.entries) {
      if (last && Number(last.created_at) >= entry.when) continue;
      const sql = sqlOf(entry.tag);
      // statements are separated by `--> statement-breakpoint`, which is an SQL comment, so the file runs as one script
      sqlite.exec(sql);
      sqlite.prepare(`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)`).run(createHash("sha256").update(sql).digest("hex"), entry.when);
    }
  })();
}
