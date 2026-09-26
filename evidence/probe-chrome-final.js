const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.addScriptTag({ url: "/bridge/bb-office-api.js" });
  await page.waitForTimeout(20000);

  for (const kind of ["writer", "calc", "impress"]) {
    const r = await page.evaluate(async (k) => {
      return window.bbOffice.newDocument(k);
    }, kind);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `screenshots/phase4-chrome-${kind}.png` });
    console.log(kind, JSON.stringify(r));
  }
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
