// Fast direct check (task 1567 fix pass): open Impress via the REAL bbOffice
// bridge (bb-office-api.js + bb-office-worker.js, same code path production
// uses -- not a hand-rolled UNO reimplementation) and read back ZoomType/
// ZoomValue via the debug op, to isolate whether applyDocumentChrome's own
// zoom-fit code actually ran, without paying for the full e2e stack.
const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  page.on("console", (msg) => { if (msg.type() === "error") console.log("[console.error]", msg.text()); });
  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => typeof window.bbOffice !== "undefined", null, { timeout: 30000 });

  const result = await page.evaluate(async () => {
    await window.bbOffice.newDocument("impress");
    const state1 = await window.bbOffice.__debugChromeState();
    await window.bbOffice.dispatch(".uno:InsertText", [{ name: "Text", value: "ZOOM TEST" }]).catch(() => {});
    return { state1 };
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "/tmp/zoom-check-1.png" });
  const result2 = await page.evaluate(async () => window.bbOffice.__debugChromeState());
  console.log(JSON.stringify({ result, result2 }, null, 2));
  await browser.close();
})();
