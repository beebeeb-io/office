const { chromium } = require("@playwright/test");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));

  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(20000);
  await page.mouse.click(130, 325); // Writer Document
  await page.waitForTimeout(15000);
  console.log("clicking into document body...");
  await page.mouse.click(400, 300);
  await page.waitForTimeout(1000);
  const marker = "beebeeb-1567-roundtrip-marker-2026-09-26";
  console.log("typing marker...");
  await page.keyboard.type(marker, { delay: 40 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "screenshots/explore3-01-typed.png" });

  await browser.close();
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
