import type Database from "better-sqlite3";
import type { Ctx } from "./ctx.js";
import type { Db } from "./db/client.js";

/**
 * Cache for the computed summaries (course list, progress, time, outline, dashboard parts). An entry is valid for one
 * invalidation key made of two numbers:
 *  - `catalog.generation`: goes up whenever any course's content changes (and when courses appear or disappear);
 *  - the database version: how many rows this connection has written (`total_changes()`), plus SQLite's
 *    `data_version`, which moves when another connection writes to the same file.
 * Both reads cost microseconds. Any change to either drops every entry, so a write is never missed; the price is that
 * a progress write in one course recomputes all courses on the next list request (once), not just that one. Writes
 * to the progress tables do not carry a package id in a way that would let us key per course soundly (exam attempts
 * reach the course through their answers), so a single key is used on purpose.
 */

interface Store {
  key: string;
  entries: Map<string, unknown>;
  hits: number;
  misses: number;
}

type Stmt = Database.Statement<[], unknown>;
interface Versions {
  changes: Stmt;
  dataVersion: Stmt;
}

const stores = new WeakMap<Db, Store>();
const versions = new WeakMap<Db, Versions>();

/** Cheap database version: changes whenever anything is written through any connection to this file. */
export function dbVersion(db: Db): string {
  let v = versions.get(db);
  if (!v) {
    v = { changes: db.$client.prepare("select total_changes()").pluck(), dataVersion: db.$client.prepare("pragma data_version").pluck() };
    versions.set(db, v);
  }
  return `${v.changes.get()}.${v.dataVersion.get()}`;
}

/** Current invalidation key. Read it after the catalog has been loaded for this request (loading may bump both). */
export function summaryKey(ctx: Ctx): string {
  return `${ctx.catalog.generation}:${dbVersion(ctx.db)}`;
}

/** Returns the cached value for `name`, computing it when missing or when the generation or database changed. */
export function cached<T>(ctx: Ctx, name: string, compute: () => T): T {
  const key = summaryKey(ctx);
  let s = stores.get(ctx.db);
  if (!s) stores.set(ctx.db, (s = { key, entries: new Map(), hits: 0, misses: 0 }));
  if (s.key !== key) {
    s.key = key;
    s.entries.clear();
  }
  if (s.entries.has(name)) {
    s.hits++;
    return s.entries.get(name) as T;
  }
  s.misses++;
  const value = compute();
  // compute() may itself write (e.g. a catalog sync); if the key moved meanwhile, do not store a possibly stale value
  if (summaryKey(ctx) === key) s.entries.set(name, value);
  return value;
}

/** Hit and miss counters since start, for tests and diagnostics. */
export function summaryStats(db: Db): { hits: number; misses: number } {
  const s = stores.get(db);
  return { hits: s?.hits ?? 0, misses: s?.misses ?? 0 };
}
