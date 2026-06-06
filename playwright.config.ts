import { defineConfig, devices } from "@playwright/test";

const PORT = 5188;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "off",
  },
  webServer: {
    command: "node e2e/server.mjs",
    url: `http://127.0.0.1:${PORT}/examples/browser/index.html`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
    timeout: 30000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
