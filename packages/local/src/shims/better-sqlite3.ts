/**
 * The slice of better-sqlite3 that drizzle's better-sqlite3 driver and packages/api use, on top of sql.js
 * (SQLite compiled to WebAssembly). Aliased over the `better-sqlite3` import, so the api code is unchanged.
 */
import type { Database as SqlJsDb, SqlJsStatic, SqlValue } from "sql.js";

let SQL: SqlJsStatic | undefined;
let initialBytes: Uint8Array | undefined;

/** Must be called once before the first `new Database()`; `bytes` restores a saved database file. */
export function configureSqlite(sqlJs: SqlJsStatic, bytes?: Uint8Array) {
  SQL = sqlJs;
  initialBytes = bytes;
}

type Params = unknown[];
const norm = (v: unknown): SqlValue => {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "bigint") return Number(v);
  return v as SqlValue;
};
const flat = (args: unknown[]): SqlValue[] => (args.length === 1 && Array.isArray(args[0]) ? (args[0] as Params) : args).map(norm);

class Statement {
  private rawMode = false;
  private pluckMode = false;
  readonly reader: boolean;

  constructor(
    private readonly db: Database,
    readonly source: string,
  ) {
    this.reader = /^\s*(select|pragma|with|explain)\b/i.test(source) || /\breturning\b/i.test(source);
  }

  raw(on = true) {
    this.rawMode = on;
    return this;
  }
  pluck(on = true) {
    this.pluckMode = on;
    return this;
  }

  private shape(columns: string[], row: SqlValue[]): unknown {
    if (this.pluckMode) return row[0];
    if (this.rawMode) return row;
    const o: Record<string, SqlValue> = {};
    for (const [i, c] of columns.entries()) o[c] = row[i]!;
    return o;
  }

  /** Runs the statement, handing each result row to `each`; returns rows modified. */
  private exec(args: unknown[], each?: (columns: string[], row: SqlValue[]) => boolean | undefined) {
    const st = this.db.native.prepare(this.source);
    try {
      st.bind(flat(args));
      const columns = st.getColumnNames();
      while (st.step()) if (each?.(columns, st.get()) === false) break;
    } finally {
      st.free();
    }
    return this.db.native.getRowsModified();
  }

  all(...args: unknown[]) {
    const out: unknown[] = [];
    this.exec(args, (c, r) => {
      out.push(this.shape(c, r));
      return undefined;
    });
    return out;
  }
  get(...args: unknown[]) {
    let out: unknown;
    this.exec(args, (c, r) => {
      out = this.shape(c, r);
      return false;
    });
    return out;
  }
  *iterate(...args: unknown[]) {
    yield* this.all(...args);
  }
  run(...args: unknown[]) {
    const changes = this.exec(args);
    const id = this.db.native.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0;
    return { changes, lastInsertRowid: id as number };
  }
}

type TxFn<A extends unknown[], R> = (...args: A) => R;

export default class Database {
  readonly native: SqlJsDb;
  inTransaction = false;
  open = true;
  readonly memory = true;

  constructor(_file?: string, _options?: unknown) {
    if (!SQL) throw new Error("configureSqlite() must run before opening a database");
    this.native = new SQL.Database(initialBytes);
    initialBytes = undefined;
  }

  prepare(source: string) {
    return new Statement(this, source);
  }

  exec(source: string) {
    this.native.run(source);
    return this;
  }

  pragma(source: string, opts?: { simple?: boolean }) {
    const rows = this.prepare(`PRAGMA ${source}`).all() as Record<string, unknown>[];
    return opts?.simple ? Object.values(rows[0] ?? {})[0] : rows;
  }

  /** better-sqlite3 returns a function with .deferred/.immediate/.exclusive variants; a transaction here is BEGIN/COMMIT around fn. */
  transaction<A extends unknown[], R>(fn: TxFn<A, R>) {
    const run = (begin: string) =>
      ((...args: A) => {
        if (this.inTransaction) return fn(...args); // better-sqlite3 nests with savepoints; drizzle does its own, so just join
        this.native.run(begin);
        this.inTransaction = true;
        try {
          const result = fn(...args);
          this.native.run("COMMIT");
          return result;
        } catch (e) {
          this.native.run("ROLLBACK");
          throw e;
        } finally {
          this.inTransaction = false;
        }
      }) as TxFn<A, R>;
    return Object.assign(run("BEGIN"), {
      default: run("BEGIN"),
      deferred: run("BEGIN DEFERRED"),
      immediate: run("BEGIN IMMEDIATE"),
      exclusive: run("BEGIN EXCLUSIVE"),
    });
  }

  serialize() {
    return this.native.export();
  }

  close() {
    this.open = false;
    this.native.close();
  }
}
