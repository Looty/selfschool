import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@selfschool\/shared\/node$/, replacement: pkg("shared/src/node.ts") },
      { find: /^@selfschool\/shared$/, replacement: pkg("shared/src/index.ts") },
      { find: /^@selfschool\/runner$/, replacement: pkg("runner/src/index.ts") },
    ],
  },
  test: { include: ["test/**/*.test.ts"] },
});
