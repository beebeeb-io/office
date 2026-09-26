const { chromium } = require("@playwright/test");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));

  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(20000);
  console.log("clicking Writer Document...");
  await page.mouse.click(130, 325);
  await page.waitForTimeout(8000);
  await page.screenshot({ path: "screenshots/explore2-01-after-click.png" });
  await page.waitForTimeout(7000);
  await page.screenshot({ path: "screenshots/explore2-02-settled.png" });

  await browser.close();
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
