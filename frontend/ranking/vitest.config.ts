import path from "path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Next.js loads .env.local for the app; Vitest does not. Without this,
// TEST_DATABASE_URL is ignored and the tests fall back to the hardcoded
// localhost:5432 default - which is wrong on any machine where an older
// PostgreSQL already holds that port. Real environment variables still win,
// so CI can override without touching a file.
Object.assign(process.env, {
  ...loadEnv("test", __dirname, ""),
  ...process.env,
});

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
