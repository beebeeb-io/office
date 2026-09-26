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
        const containerWindow = controller.getFrame().getContainerWindow();
        const xTopWindow = css.awt.XTopWindow.query(containerWindow);
        if (xTopWindow) xTopWindow.toFront();
        css.awt.XWindow.query(containerWindow).setVisible(true);

        function getSingleton(ctx, name) {
          var any = ctx.getValueByName("/singletons/" + name);
          return any.get();
        }

        function setConfig(path, propName, value, unoType) {
          var cp = css.lang.XMultiServiceFactory.query(getSingleton(ctx, "com.sun.star.configuration.theDefaultProvider"));
          var pv = mkPV2("nodepath", Module.uno_Type.String(), path);
          var pvAny = new Module.uno_Any(Module.uno_Type.Struct("com.sun.star.beans.PropertyValue"), pv);
          var argSeq = new Module.uno_Sequence_any([pvAny]);
          var access = cp.createInstanceWithArguments("com.sun.star.configuration.ConfigurationUpdateAccess", argSeq);
          argSeq.delete();
          var ps = css.beans.XPropertySet.query(access);
          ps.setPropertyValue(propName, new Module.uno_Any(unoType, value));
          css.util.XChangesBatch.query(access).commitChanges();
        }
        function mkPV2(name, unoType, value) {
          return { Name: name, Handle: -1, Value: new Module.uno_Any(unoType, value), State: 0 };
        }

        setConfig("/org.openoffice.Office.Common/Appearance", "ApplicationAppearance", 2, Module.uno_Type.Short());
        setConfig("/org.openoffice.Office.Common/Misc", "SymbolStyle", "colibre_dark_svg", Module.uno_Type.String());
        out.configSetOk = true;

        // Does a NEW document/window created AFTER the config change pick up
        // the new theme, even if the already-open one doesn't repaint live?
        var oargs2 = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(0, Module.uno_Sequence.FromSize);
        var model2 = css.frame.XComponentLoader.query(desktop).loadComponentFromURL("private:factory/swriter", "_blank", 0, oargs2);
        oargs2.delete();
        var controller2 = css.frame.XModel.query(model2).getCurrentController();
        var win2 = controller2.getFrame().getContainerWindow();
        var top2 = css.awt.XTopWindow.query(win2);
        if (top2) top2.toFront();
        css.awt.XWindow.query(win2).setVisible(true);
        out.secondDocOpened = true;

        // Read back to confirm the write actually persisted.
        function readConfig(path, propName) {
          var cp = css.lang.XMultiServiceFactory.query(getSingleton(ctx, "com.sun.star.configuration.theDefaultProvider"));
          var pv = mkPV2("nodepath", Module.uno_Type.String(), path);
          var pvAny = new Module.uno_Any(Module.uno_Type.Struct("com.sun.star.beans.PropertyValue"), pv);
          var argSeq = new Module.uno_Sequence_any([pvAny]);
          var access = cp.createInstanceWithArguments("com.sun.star.configuration.ConfigurationAccess", argSeq);
          argSeq.delete();
          var ps = css.beans.XPropertySet.query(access);
          return ps.getPropertyValue(propName).get();
        }
        out.readBackAppearance = readConfig("/org.openoffice.Office.Common/Appearance", "ApplicationAppearance");
        out.readBackSymbolStyle = readConfig("/org.openoffice.Office.Common/Misc", "SymbolStyle");
      } catch (e) {
        out.err = String(e) + (e && e.stack ? ("\n" + e.stack) : "");
      }
      return out;
    }).catch(e => ({ top_err: String(e) }));
  });
  console.log("RESULT:", JSON.stringify(result, null, 2));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "screenshots/probe-theme-dark-attempt.png" });
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
