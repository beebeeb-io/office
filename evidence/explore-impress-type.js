const { chromium } = require("@playwright/test");
const MARKER = "beebeeb-1567-roundtrip-marker-2026-09-26";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(20000);
  await page.mouse.click(148, 418); // Impress Presentation
  await page.waitForTimeout(15000);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1000);
  // double-click the title placeholder to enter edit mode
  await page.mouse.dblclick(465, 334);
  await page.waitForTimeout(1000);
  await page.keyboard.type(MARKER, { delay: 30 });
  await page.waitForTimeout(500);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "screenshots/impress-03-typed.png" });
  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
