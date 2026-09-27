const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => typeof window.bbOffice !== "undefined", null, { timeout: 30000 });

  await page.evaluate(async () => {
    await window.bbOffice.newDocument("impress");
    await window.bbOffice.setWorkspaceColor(0xff0000); // immediate -- expect no-op per hypothesis
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "/tmp/impress-lag-immediate.png" });

  await page.evaluate(async () => {
    await window.bbOffice.setWorkspaceColor(0x0000ff); // delayed -- expect it WORKS
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "/tmp/impress-lag-delayed.png" });

  await browser.close();
})();
