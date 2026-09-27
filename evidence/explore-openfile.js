const { chromium } = require("@playwright/test");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  page.on("console", (msg) => console.log("[console]", msg.text()));

  const fcPromise = page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null);

  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(20000);
  console.log("clicking Open File...");
  await page.mouse.click(95, 51);
  await page.waitForTimeout(3000);
  const fc = await fcPromise;
  console.log("filechooser appeared?", !!fc);
  await page.screenshot({ path: "screenshots/openfile-01.png" });

  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
