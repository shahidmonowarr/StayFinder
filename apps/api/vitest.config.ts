import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests share one Postgres and truncate between cases, so they
    // must not run concurrently in separate workers.
    fileParallelism: false,
  },
});
