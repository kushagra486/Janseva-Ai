import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname), "server-only": resolve(__dirname, "tests/unit/server-only-stub.ts") } },
  test: { include: ["tests/unit/**/*.test.ts"] },
});
