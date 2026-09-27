const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("console", (m) => console.log("[console]", m.type(), m.text()));
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  page.on("requestfailed", (r) => console.log("[reqfail]", r.url(), r.failure()));
  await page.goto("http://127.0.0.1:8743/probe-iframe-host.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(5000);
  const info = await page.evaluate(() => {
    const f = document.getElementById("office");
    let hasWin = false, hasBB = false, err = null;
    try { hasWin = !!f.contentWindow; hasBB = f.contentWindow && typeof f.contentWindow.bbOffice !== "undefined"; } catch(e) { err = e.toString(); }
    return { hasWin, hasBB, err, src: f.src };
  });
  console.log(JSON.stringify(info));
  await browser.close();
})();
