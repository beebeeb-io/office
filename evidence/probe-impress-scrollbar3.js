const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => typeof window.bbOffice !== "undefined", null, { timeout: 30000 });
  await page.evaluate(async () => { await window.bbOffice.newDocument("impress"); });
  await page.waitForTimeout(500);
  const d = await page.evaluate(async () => {
    const r1 = await window.bbOffice.dispatch(".uno:ScrollBar");
    // force a couple more dispatch cycles / events, mimicking the documented
    // "one further dispatch cycle" lag elsewhere in this engine for Impress
    await window.bbOffice.dispatch(".uno:Escape").catch(() => {});
    await window.bbOffice.setZoom(80).catch(() => {});
    return r1;
  });
  console.log("dispatch:", JSON.stringify(d));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "/tmp/impress-scrollbar-after2.png" });
  await browser.close();
})();
