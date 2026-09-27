const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => typeof window.bbOffice !== "undefined", null, { timeout: 30000 });

  const result = await page.evaluate(async () => {
    await window.bbOffice.newDocument("impress");
    const out = {};
    const states = [];
    const unsub = await window.bbOffice.onState(".uno:ScrollBar", (s) => states.push(s));
    out.initialStates = states.slice();
    out.dispatch1 = await window.bbOffice.dispatch(".uno:ScrollBar");
    await new Promise((r) => setTimeout(r, 300));
    out.statesAfter1 = states.slice();
    out.dispatch2 = await window.bbOffice.dispatch(".uno:ScrollBar");
    await new Promise((r) => setTimeout(r, 300));
    out.statesAfter2 = states.slice();
    unsub();
    return out;
  });
  console.log(JSON.stringify(result, null, 2));
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/impress-scrollbar-check.png" });
  await browser.close();
})();
