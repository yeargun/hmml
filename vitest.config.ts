import { defineConfig } from "vitest/config";

// Keep vitest scoped to the unit tests so it never picks up the Playwright
// specs under e2e/ (which use a different runner).
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
