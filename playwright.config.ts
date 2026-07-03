import { defineConfig } from "@playwright/test";

declare const process: {
  env: Record<string, string | undefined>;
};

export default defineConfig({
  testDir: "./tests/layout",
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:1420",
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "npm run dev",
    env: {
      VITE_SPIDER_DEV_TOOLS: "true"
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: "http://127.0.0.1:1420"
  }
});
