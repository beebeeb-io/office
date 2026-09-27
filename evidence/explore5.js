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
  let mainWorker = null;
  page.on("worker", (w) => {
    if (!mainWorker) mainWorker = w;
  });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  page.on("console", (msg) => {
    const t = msg.text();
    if (/error|Error|FS\.|uno/i.test(t)) console.log("[console]", t);
  });

  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(20000);

  console.log("mainWorker:", mainWorker && mainWorker.url());
  const info = await withTimeout(
    mainWorker.evaluate(() => ({
      hasModule: typeof Module !== "undefined",
      hasUnoInit: !!(Module && Module.uno_init),
      hasFS: !!(Module && Module.FS),
      keys: Module ? Object.keys(Module).filter((k) => k.startsWith("uno_") || k === "FS").join(",") : "",
    })),
    5000,
    "info"
  ).catch((e) => ({ error: e.message }));
  console.log("worker info:", JSON.stringify(info));

  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
