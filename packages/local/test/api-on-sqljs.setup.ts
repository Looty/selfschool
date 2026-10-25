import initSqlJs from "sql.js";
import { configureSqlite } from "../src/shims/better-sqlite3.js";

configureSqlite(await initSqlJs());
