import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "e2e.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://localhost:3000",
    channel: "chrome",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm start",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
});
