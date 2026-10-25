import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { zipSync } from "fflate";
import { defineConfig, type Plugin } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const repo = here("../..");
const shim = (f: string) => here(`./src/shims/${f}`);

/** Serves the unchanged web app (packages/web) but boots it through src/entry.ts, which starts the api in the page first. */
function localEntry(): Plugin {
  const entry = here("./src/entry.ts");
  return {
    name: "selfschool-local-entry",
    enforce: "pre",
    transformIndexHtml: { order: "pre", handler: (html) => html.replace("/src/main.tsx", "/src/local-entry.ts") },
    resolveId: (id) => (id === "/src/local-entry.ts" ? entry : undefined),
  };
}

/** Publishes src/sw.js at /local-sw.js (dev server and build output) so it can control the whole origin. */
function serviceWorker(): Plugin {
  const file = here("./src/sw.js");
  return {
    name: "selfschool-local-sw",
    configureServer(server) {
      server.middlewares.use("/local-sw.js", (_req, res) => {
        res.setHeader("content-type", "text/javascript");
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "local-sw.js", source: readFileSync(file, "utf8") });
    },
  };
}

/** Changes on every build; the running page compares it with /version.json to notice a newer deploy. */
const buildId = Date.now().toString(36);

/** Publishes /version.json (the build id) so open tabs can tell they are out of date. */
function versionFile(): Plugin {
  const body = JSON.stringify({ build: buildId });
  return {
    name: "selfschool-local-version",
    configureServer(server) {
      server.middlewares.use("/version.json", (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(body);
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: body });
    },
  };
}

/** Dev only: /sample.zip is a zip of the TypeScript sample course; `?sample` in the URL imports it on a first visit. */
function sampleZip(): Plugin {
  return {
    name: "sample-zip",
    configureServer(server) {
      server.middlewares.use("/sample.zip", (_req, res) => {
        const dir = join(repo, "examples/sample-courses/typescript-fundamentals");
        const files: Record<string, Uint8Array> = {};
        const walk = (d: string, rel: string) => {
          for (const name of readdirSync(d)) {
            const full = join(d, name);
            if (statSync(full).isDirectory()) walk(full, `${rel}${name}/`);
            else files[`${rel}${name}`] = readFileSync(full);
          }
        };
        walk(dir, "");
        res.setHeader("content-type", "application/zip");
        res.end(Buffer.from(zipSync(files)));
      });
    },
  };
}

export default defineConfig({
  root: here("../web"),
  cacheDir: here("./node_modules/.vite"),
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    // tells the web app it runs with browser storage (shows the backup reminder)
    "import.meta.env.VITE_LOCAL": JSON.stringify("1"),
  },
  plugins: [localEntry(), serviceWorker(), versionFile(), sampleZip(), react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@selfschool\/shared$/, replacement: here("../shared/src/index.ts") },
      { find: /^@selfschool\/shared\/node$/, replacement: here("../shared/src/node.ts") },
      { find: /^@web\/main$/, replacement: here("../web/src/main.tsx") },
      // The api's Node imports, answered by browser equivalents. Nothing under packages/api is edited.
      { find: /^better-sqlite3$/, replacement: shim("better-sqlite3.ts") },
      { find: /^drizzle-orm\/better-sqlite3\/migrator$/, replacement: shim("migrator.ts") },
      { find: /^node:fs\/promises$/, replacement: shim("fs-promises.ts") },
      { find: /^node:fs$/, replacement: shim("fs.ts") },
      { find: /^node:path$/, replacement: shim("path.ts") },
      { find: /^node:url$/, replacement: shim("url.ts") },
      { find: /^node:crypto$/, replacement: shim("crypto.ts") },
      { find: /^node:util$/, replacement: shim("util.ts") },
      { find: /^node:child_process$/, replacement: shim("child_process.ts") },
    ],
  },
  server: { port: 5175, fs: { allow: [repo] } },
  build: { outDir: here("./dist"), emptyOutDir: true, target: "es2023" },
});
