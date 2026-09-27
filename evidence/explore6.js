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

  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(20000);

  const fsInfo = await withTimeout(
    mainWorker.evaluate(() => ({
      hasGlobalFS: typeof FS !== "undefined",
      fsKeys: typeof FS !== "undefined" ? Object.keys(FS).slice(0, 20).join(",") : "",
    })),
    5000,
    "fsInfo"
  ).catch((e) => ({ error: e.message }));
  console.log("fsInfo:", JSON.stringify(fsInfo));

  // Try the doc's own example: insert text into a NEW Writer doc via UNO, then check
  // it appears (proves the UNO Embind API is functional, independent of the keyboard
  // path already proven in explore3.js).
  const unoResult = await withTimeout(
    mainWorker.evaluate(() => {
      return Module.uno_init.then(function () {
        const css = Module.uno.com.sun.star;
        const desktop = css.frame.Desktop.create(Module.getUnoComponentContext());
        const args = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(0, Module.uno_Sequence.FromSize);
        const xModel = css.frame.XComponentLoader.query(desktop).loadComponentFromURL(
          "private:factory/swriter",
          "_blank",
          0,
          args
        );
        args.delete();
        const xTextDocument = css.text.XTextDocument.query(xModel);
        const xText = xTextDocument.getText();
        const xTextCursor = xText.createTextCursor();
        xTextCursor.setString("uno-scripted-insert-ok");
        return "OK: " + xText.getString();
      }).catch(function (e) {
        return "UNO_ERR: " + (e && e.toString ? e.toString() : JSON.stringify(e));
      });
    }),
    15000,
    "unoResult"
  ).catch((e) => "TIMEOUT: " + e.message);
  console.log("unoResult:", unoResult);

  await page.waitForTimeout(2000);
  await page.screenshot({ path: "screenshots/explore6-01-uno-insert.png" });

  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
