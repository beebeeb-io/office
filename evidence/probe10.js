const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let mainWorker = null;
  page.on("worker", (w) => { if (!mainWorker) mainWorker = w; });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(20000);
  const result = await mainWorker.evaluate(() => {
    return Module.uno_init.then(function () {
      const css = Module.uno.com.sun.star;
      const ctx = Module.getUnoComponentContext();
      const desktop = css.frame.Desktop.create(ctx);
      const out = {};
      ["scalc", "simpress"].forEach((factory) => {
        try {
          const oargs = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(0, Module.uno_Sequence.FromSize);
          const model = css.frame.XComponentLoader.query(desktop).loadComponentFromURL("private:factory/" + factory, "_blank", 0, oargs);
          oargs.delete();
          const controller = css.frame.XModel.query(model).getCurrentController();
          const info = {};
          info.serviceNames = (function () {
            try {
              const xsi = css.lang.XServiceInfo.query(controller);
              return xsi ? xsi.getSupportedServiceNames().toArray ? xsi.getSupportedServiceNames().toArray() : "no-toArray" : "no-xsi";
            } catch (e) { return "ERR:" + e; }
          })();
          // try dispatch .uno:Zoom directly instead
          try {
            const frame = controller.getFrame();
            const dp = css.frame.XDispatchProvider.query(frame);
            const InOutURL = Module["uno_InOutParam_com$sun$star$util$URL"];
            const inst = new InOutURL({ Complete: ".uno:Zoom", Main: "", Protocol: "", User: "", Password: "", Server: "", Port: 0, Path: "", Name: "", Arguments: "", Mark: "" });
            const trans = css.util.URLTransformer.create(ctx);
            trans.parseStrict(inst);
            const disp = dp.queryDispatch(inst.val, "", 0);
            info.zoomDispatchAvailable = !!disp;
          } catch (e) { info.zoomDispatch_err = String(e); }
          // try XViewSettingsSupplier again but capture null vs throw
          try {
            const vss = css.view.XViewSettingsSupplier.query(controller);
            info.vss = vss ? "non-null" : "null";
          } catch (e) { info.vss_err = String(e); }
          out[factory] = info;
        } catch (e) {
          out[factory] = "ERR:" + e;
        }
      });
      return out;
    }).catch(e => ({ top_err: String(e) }));
  });
  console.log("RESULT:", JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
