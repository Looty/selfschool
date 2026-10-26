import type { PortableBackup } from "@selfschool/shared";
import type { Ctx } from "./ctx.js";
import { listPackages } from "./packages.js";
import { HttpError } from "./util.js";

type Value = string | number | null;
type Row = Record<string, Value>;

/** drizzle's own bookkeeping and SQLite internals are not data. */
const skip = (name: string) => name.startsWith("sqlite_") || name === "__drizzle_migrations";

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

/** Every user table with its column names, read from the database itself so a new table is backed up without a code change. */
function tables(ctx: Ctx): Map<string, string[]> {
  const raw = ctx.db.$client;
  const names = (raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name).filter((n) => !skip(n));
  return new Map(names.map((n) => [n, (raw.prepare(`PRAGMA table_info(${q(n)})`).all() as { name: string }[]).map((c) => c.name)]));
}

/**
 * All progress as readable JSON (rows per table) plus the courses' sources, so the same file restores into a fresh
 * install on another origin, in the browser build or in Docker. Course files themselves are not in it: they are fetched
 * again from their repository (zip imports have no source, the caller lists those).
 */
export function exportPortable(ctx: Ctx): PortableBackup {
  const raw = ctx.db.$client;
  // listing the courses first: loading them is what records new ones in the package table
  const courses = listPackages(ctx).map((p) => ({ id: p.id, url: p.url, path: p.path, ref: p.ref, sha: p.sha }));
  const out: Record<string, Row[]> = {};
  for (const name of tables(ctx).keys()) out[name] = raw.prepare(`SELECT * FROM ${q(name)}`).all() as Row[];
  return {
    format: "selfschool-backup",
    version: 1,
    exportedAt: new Date(ctx.now()).toISOString(),
    tables: out,
    courses,
    prefs: {},
  };
}

/** Replaces everything in the database with the file's rows, all or nothing. Unknown tables and columns are refused. */
export function importPortable(ctx: Ctx, data: PortableBackup): void {
  const known = tables(ctx);
  for (const [name, rows] of Object.entries(data.tables)) {
    const cols = known.get(name);
    if (!cols) throw new HttpError(400, `this backup has a table this version does not know: ${name}`);
    for (const row of rows) {
      const bad = Object.keys(row).find((c) => !cols.includes(c));
      if (bad) throw new HttpError(400, `this backup has a column this version does not know: ${name}.${bad}`);
    }
  }

  const raw = ctx.db.$client;
  // foreign keys cannot be switched inside a transaction; off while rows go in any order, on again after
  raw.pragma("foreign_keys = OFF");
  try {
    raw.transaction(() => {
      for (const name of known.keys()) raw.prepare(`DELETE FROM ${q(name)}`).run();
      for (const [name, rows] of Object.entries(data.tables)) {
        for (const row of rows) {
          const cols = Object.keys(row);
          if (cols.length === 0) continue;
          raw.prepare(`INSERT INTO ${q(name)} (${cols.map(q).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((c) => row[c]));
        }
      }
    })();
  } finally {
    raw.pragma("foreign_keys = ON");
  }
  ctx.catalog.invalidate();
}
