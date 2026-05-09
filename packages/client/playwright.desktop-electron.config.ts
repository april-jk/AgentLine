import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /desktop-electron-codex\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  timeout: 180_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    actionTimeout: 5_000,
  },
});
