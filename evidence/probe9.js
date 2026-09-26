const { chromium } = require("@playwright/test");
function withTimeout(p, ms, l) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout:" + l)), ms))]); }
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.addScriptTag({ url: "/bridge/bb-office-api.js" });
  await page.waitForTimeout(20000);
  const result = await page.evaluate(async () => {
    const out = {};
    for (const kind of ["writer", "calc", "impress"]) {
      await window.bbOffice.newDocument(kind);
      try {
        out[kind + "_immediate"] = await window.bbOffice.setZoom(150);
      } catch (e) {
        out[kind + "_immediate"] = "ERR:" + e;
      }
      await new Promise((r) => setTimeout(r, 1000));
      try {
        out[kind + "_after1s"] = await window.bbOffice.setZoom(150);
      } catch (e) {
        out[kind + "_after1s"] = "ERR:" + e;
      }
    }
    return out;
  });
  console.log("RESULT:", JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
