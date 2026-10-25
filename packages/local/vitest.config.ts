import { defineConfig } from "vitest/config";

// The shims' own tests. The api's suite on the sql.js shim runs from vitest.api.config.ts.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
