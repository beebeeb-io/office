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
      try {
        const oargs = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(0, Module.uno_Sequence.FromSize);
        const model = css.frame.XComponentLoader.query(desktop).loadComponentFromURL("private:factory/swriter", "_blank", 0, oargs);
        oargs.delete();
        const controller = css.frame.XModel.query(model).getCurrentController();
        const frame = controller.getFrame();
        const ps = css.beans.XPropertySet.query(frame);
        const lm = css.frame.XLayoutManager.query(ps.getPropertyValue("LayoutManager").get());
        out.lmOk = !!lm;
        out.visibleBefore = lm.isVisible();
        lm.setVisible(false);
        lm.lock();
        out.visibleAfter = lm.isVisible();

        // rulers via ViewSettings
        const vss = css.view.XViewSettingsSupplier.query(controller);
        const viewSettings = vss.getViewSettings();
        try {
          out.rulerHoriBefore = viewSettings.getPropertyValue("ShowHoriRuler").get();
          out.rulerVertBefore = viewSettings.getPropertyValue("ShowVertRuler").get();
          viewSettings.setPropertyValue("ShowHoriRuler", new Module.uno_Any(Module.uno_Type.Boolean(), false));
          viewSettings.setPropertyValue("ShowVertRuler", new Module.uno_Any(Module.uno_Type.Boolean(), false));
          out.rulerHoriAfter = viewSettings.getPropertyValue("ShowHoriRuler").get();
        } catch (e) { out.ruler_err = String(e); }
      } catch (e) {
        out.err = String(e) + (e && e.stack ? ("\n" + e.stack) : "");
      }
      return out;
    }).catch(e => ({ top_err: String(e) }));
  });
  console.log("RESULT:", JSON.stringify(result, null, 2));
  await page.screenshot({ path: "screenshots/probe-chrome2-hidden.png" });
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
