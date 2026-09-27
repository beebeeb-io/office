// @ts-check
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./playwright",
  timeout: 120_000,
  fullyParallel: false, // serialize: single COOP/COEP server, single Legion-built artifact
  reporter: [["list"], ["json", { outputFile: "playwright-report.json" }]],
  use: {
    baseURL: "http://127.0.0.1:8743",
    screenshot: "on",
    trace: "retain-on-failure",
  },
});
