import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
