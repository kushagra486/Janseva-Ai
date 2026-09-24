import { defineConfig, devices } from "@playwright/test";

// Runs against the web app in demo mode with the AI service on :8000.
export default defineConfig({
  testDir: "tests/e2e",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    ...devices["Pixel 7"],
    // Use a preinstalled Chromium when the bundled one isn't downloaded.
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "pnpm start", port: 3000, reuseExistingServer: true, timeout: 120_000 },
});
