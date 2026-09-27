const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => typeof window.bbOffice !== "undefined", null, { timeout: 30000 });

  const result = await page.evaluate(async () => {
    const out = {};
    out.hasFn = typeof window.bbOffice.setWorkspaceColor === "function";
    await window.bbOffice.newDocument("writer");
    try {
      out.setResult = await window.bbOffice.setWorkspaceColor(0xff0000);
    } catch (e) {
      out.setError = e && e.toString ? e.toString() : String(e);
    }
    return out;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/wscolor-check.png" });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
