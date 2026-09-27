const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  page.on("console", (msg) => console.log("[console]", msg.text()));
  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.addScriptTag({ url: "/bridge/bb-office-api.js" });
  await page.waitForTimeout(20000);
  const r = await page.evaluate(async () => window.bbOffice.newDocument("writer"));
  console.log("newDocument result:", JSON.stringify(r));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "screenshots/probe-chrome-debug.png" });
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
