const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => typeof window.bbOffice !== "undefined", null, { timeout: 30000 });
  await page.evaluate(async () => {
    await window.bbOffice.newDocument("impress");
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/impress-scrollbar-before.png" });
  const d = await page.evaluate(async () => window.bbOffice.dispatch(".uno:ScrollBar"));
  console.log("dispatch result:", JSON.stringify(d));
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/impress-scrollbar-after1.png" });
  await browser.close();
})();
