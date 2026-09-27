const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let mainWorker = null;
  page.on("worker", (w) => { if (!mainWorker) mainWorker = w; });
  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(20000);
  const result = await mainWorker.evaluate(() => {
    return Module.uno_init.then(function () {
      const css = Module.uno.com.sun.star;
      const ctx = Module.getUnoComponentContext();
      const desktop = css.frame.Desktop.create(ctx);
      const oargs = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(0, Module.uno_Sequence.FromSize);
      const model = css.frame.XComponentLoader.query(desktop).loadComponentFromURL("private:factory/swriter", "_blank", 0, oargs);
      oargs.delete();
      const controller = css.frame.XModel.query(model).getCurrentController();
      const ps = css.beans.XPropertySet.query(controller);
      const out = { psOk: !!ps };
      if (ps) {
        try {
          out.before = ps.getPropertyValue("ZoomValue").get();
          ps.setPropertyValue("ZoomValue", new Module.uno_Any(Module.uno_Type.Short(), 160));
          out.after = ps.getPropertyValue("ZoomValue").get();
        } catch (e) { out.err = String(e); }
      }
      return out;
    }).catch(e => ({ top_err: String(e) }));
  });
  console.log("RESULT:", JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
