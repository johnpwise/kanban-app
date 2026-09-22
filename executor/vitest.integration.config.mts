import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
    // Integration files share global emulator state (the same Firestore project) — running them
    // in parallel worker threads risks cross-file interference. Serialize file execution instead.
    fileParallelism: false,
  },
});
