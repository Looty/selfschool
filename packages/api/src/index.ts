import { dirname, join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createApp, defaultCoursesDir } from "./app.js";
import { openDb } from "./db/client.js";

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001);
const dbFile = process.env.SELFSCHOOL_DB ?? "./.selfschool/selfschool.db";

// The catalog keeps its saved copy next to the database (the /data volume in the container), so it survives restarts.
const cacheDir = process.env.SELFSCHOOL_CACHE_DIR || (dbFile === ":memory:" ? undefined : join(dirname(resolve(dbFile)), "catalog-cache"));

const db = openDb(dbFile);
const app = createApp(db, cacheDir ? { catalogCacheDir: cacheDir } : {});
console.log(`courses dir ${defaultCoursesDir()}`);

// Read the courses once now, so the first page a person opens is not the one that pays for it.
void app.request("/courses");

const server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`api listening on :${info.port}, db ${dbFile}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
