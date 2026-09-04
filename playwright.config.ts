import { defineConfig } from "@playwright/test";

const usesLocalProfile = Boolean(process.env.HWPX_LENS_PROFILE_CONFIG?.trim());

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:1420",
    trace: "retain-on-failure",
  },
  webServer: {
    command: usesLocalProfile ? "npm run dev:profile" : "npm run dev",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: true,
  },
});
