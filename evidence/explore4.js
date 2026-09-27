const { chromium } = require("@playwright/test");

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout:${label}`)), ms)),
  ]);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const workers = [];
  page.on("worker", (w) => {
    console.log("WORKER CREATED:", w.url());
    workers.push(w);
  });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));

  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(20000);

  console.log("workers so far:", workers.length);
  for (const w of workers) {
    try {
      const hasModule = await withTimeout(w.evaluate(() => typeof Module !== "undefined"), 3000, "hasModule");
      console.log(w.url(), "hasModule=", hasModule);
    } catch (e) {
      console.log(w.url(), "eval failed/timeout:", e.message);
    }
  }

  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
