import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const shared = (f: string) => fileURLToPath(new URL(`../shared/src/${f}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@selfschool\/shared\/node$/, replacement: shared("node.ts") },
      { find: /^@selfschool\/shared$/, replacement: shared("index.ts") },
    ],
  },
  test: { include: ["test/**/*.test.ts"] },
});
