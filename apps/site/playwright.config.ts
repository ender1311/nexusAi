import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "smoke",
  timeout: 60_000,
  use: { baseURL: process.env.SMOKE_BASE_URL ?? "https://beaconfrontier.com" },
});
