import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The integration tests share one geo_test database and reset it before
    // running. Two files doing that at once truncate each other's rows
    // mid-write, so files run one at a time. The whole suite is a few
    // seconds; correctness beats the parallel speed-up here.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
