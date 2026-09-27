// Probe script (task 1567 phase 4, throwaway): explore UNO dispatch + status
// listener call conventions against the live pthread Worker realm directly
// (same technique as explore6.js), before committing to a shape in
// bridge/bb-office-worker.js. Not shipped, not a test.
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
  page.on("console", (msg) => console.log("[console]", msg.text()));

  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(20000);

  const result = await withTimeout(
    mainWorker.evaluate(() => {
      return Module.uno_init.then(function () {
        const css = Module.uno.com.sun.star;
        const ctx = Module.getUnoComponentContext();
        const desktop = css.frame.Desktop.create(ctx);
        const args = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(0, Module.uno_Sequence.FromSize);
        const xModel = css.frame.XComponentLoader.query(desktop).loadComponentFromURL(
          "private:factory/swriter", "_blank", 0, args
        );
        args.delete();
        const out = {};

        // 1. explore URLTransformer.parseStrict calling convention
        try {
          const trans = css.util.URLTransformer.create(ctx);
          out.transKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(trans)).join(",");
          let aURL = { Complete: ".uno:Bold" };
          let r;
          try {
            r = trans.parseStrict(aURL);
            out.parseStrict_plainObj = "OK: " + JSON.stringify(r) + " typeof=" + typeof r;
          } catch (e1) {
            out.parseStrict_plainObj_err = String(e1);
            try {
              r = trans.parseStrict([aURL]);
              out.parseStrict_arrObj = "OK: " + JSON.stringify(r);
            } catch (e2) {
              out.parseStrict_arrObj_err = String(e2);
            }
          }
        } catch (e) {
          out.trans_err = String(e);
        }

        // 2. explore getting the frame + XDispatchProvider
        try {
          const xModelIfc = css.frame.XModel.query(xModel);
          const controller = xModelIfc.getCurrentController();
          const frame = controller.getFrame();
          out.frameOk = !!frame;
          const dp = css.frame.XDispatchProvider.query(frame);
          out.dpOk = !!dp;
        } catch (e) {
          out.frame_err = String(e);
        }

        return out;
      }).catch(function (e) {
        return { top_err: (e && e.toString ? e.toString() : JSON.stringify(e)) };
      });
    }),
    15000,
    "probe"
  ).catch((e) => ({ timeout: e.message }));

  console.log("RESULT:", JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
