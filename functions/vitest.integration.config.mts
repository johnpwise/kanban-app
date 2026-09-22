import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
    // Integration files share global emulator state (the same Firestore project and the same
    // Pub/Sub topic/subscriptions) — running them in parallel worker threads lets one file's
    // publishes be delivered to another file's subscription. Serialize file execution instead.
    fileParallelism: false,
  },
});
