// One-off exploration script (not the final test) — load the real artifact, screenshot,
// see what's there before writing the calibrated Playwright specs.
const { chromium } = require("@playwright/test");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleMsgs = [];
  page.on("console", (msg) => consoleMsgs.push(`[${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => consoleMsgs.push(`[pageerror] ${err.message}`));

  console.log("navigating...");
  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  console.log("loaded, waiting for init...");
  await page.waitForTimeout(8000);
  await page.screenshot({ path: "screenshots/explore-01-after8s.png" });
  await page.waitForTimeout(10000);
  await page.screenshot({ path: "screenshots/explore-02-after18s.png" });
  await page.waitForTimeout(15000);
  await page.screenshot({ path: "screenshots/explore-03-after33s.png" });

  console.log("--- console (last 60) ---");
  console.log(consoleMsgs.slice(-60).join("\n"));

  await browser.close();
})().catch((e) => {
  console.error("EXPLORE_FAILED", e);
  process.exit(1);
});
