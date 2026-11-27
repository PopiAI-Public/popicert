import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // La firma y la canonicalización RDF tardan algo más que un test normal.
    testTimeout: 20_000,
    pool: "forks",
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["src/**/*.test.ts", "tests/**/*.test.ts"], exclude: ["tests/**/*.integration.test.ts"] },
      },
      {
        extends: true,
        // Comparten la base de datos y la vacían entre tests: de uno en uno.
        test: { name: "integration", include: ["tests/**/*.integration.test.ts"], fileParallelism: false },
      },
    ],
  },
});
