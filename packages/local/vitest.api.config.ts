import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Runs packages/api's own test suite with better-sqlite3 swapped for the sql.js shim (the filesystem stays real,
 * so tests that build course folders in a temp dir still work). A pass means the database layer the browser build
 * uses behaves like the native one for everything the api does.
 */
export default defineConfig({
  root: here("../api"),
  resolve: {
    alias: [
      { find: /^@selfschool\/shared\/node$/, replacement: here("../shared/src/node.ts") },
      { find: /^@selfschool\/shared$/, replacement: here("../shared/src/index.ts") },
      { find: /^better-sqlite3$/, replacement: here("./src/shims/better-sqlite3.ts") },
      { find: /^drizzle-orm\/better-sqlite3\/migrator$/, replacement: here("./src/shims/migrator.ts") },
    ],
  },
  test: { include: ["test/**/*.test.ts"], setupFiles: [here("./test/api-on-sqljs.setup.ts")] },
});
