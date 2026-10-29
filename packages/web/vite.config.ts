import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In compose the api is reachable as http://api:3001; on the host it's localhost.
const apiTarget = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3001";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // the in-browser code runner's workers are ES modules (the Python one imports Pyodide from the CDN)
  worker: { format: "es" },
  resolve: {
    // Use shared's TypeScript source directly (no dist build needed for dev, tests or bundling).
    alias: [{ find: /^@selfschool\/shared$/, replacement: fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)) }],
  },
  server: {
    port: Number(process.env.WEB_PORT) || 5174,
    // Bind-mounted sources on Windows/Docker Desktop don't emit fs events.
    watch: process.env.CHOKIDAR_USEPOLLING ? { usePolling: true, interval: 300 } : undefined,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") },
    },
  },
});
