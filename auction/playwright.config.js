import { defineConfig } from "@playwright/test";
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
}
if (process.env.APP_ORIGIN !== "http://localhost:8097")
  throw new Error("Browser tests are restricted to the local rehearsal");
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://localhost:8097",
    headless: true,
    viewport: { width: 1440, height: 1100 },
    launchOptions: {
      ...(process.env.CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
        : {}),
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
    permissions: ["camera", "microphone"],
    screenshot: "only-on-failure",
  },
});
