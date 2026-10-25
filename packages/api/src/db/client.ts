import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

/** Committed migrations live in packages/api/drizzle (same relative depth from src/ and dist/). */
const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Opens (creating if needed) the SQLite file, applies pending migrations and returns the handle. */
export function openDb(file: string): Db {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return db;
}

/** True when the `job` table exists, i.e. migrations ran. */
export function isMigrated(db: Db): boolean {
  const row = db.$client
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'job'")
    .get();
  return row !== undefined;
}
