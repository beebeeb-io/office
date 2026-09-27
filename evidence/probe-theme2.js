// Attempt 3: set the config BEFORE anything paints (right after page load,
// before waiting for full boot), to test whether color-scheme/icon-theme
// resolution is cached at first-use rather than read fresh per-window.
const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let mainWorker = null;
  page.on("worker", (w) => { if (!mainWorker) mainWorker = w; });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });

  // Poll for the worker + Module.uno_init as early as possible instead of a
  // fixed 20s wait.
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    await page.waitForTimeout(200);
    if (!mainWorker) continue;
    try {
      ready = await mainWorker.evaluate(() => typeof Module !== "undefined" && !!Module.uno_init);
    } catch (e) { /* worker not ready yet */ }
  }
  console.log("uno_init present after early poll:", ready, "elapsed~", 200 * 100);

  const result = await mainWorker.evaluate(() => {
    return Module.uno_init.then(function () {
      const css = Module.uno.com.sun.star;
      const ctx = Module.getUnoComponentContext();
      const out = {};
      function getSingleton(name) {
        var any = ctx.getValueByName("/singletons/" + name);
        return any.get();
      }
      function mkPV2(name, unoType, value) {
        return { Name: name, Handle: -1, Value: new Module.uno_Any(unoType, value), State: 0 };
      }
      function setConfig(path, propName, value, unoType) {
        var cp = css.lang.XMultiServiceFactory.query(getSingleton("com.sun.star.configuration.theDefaultProvider"));
        var pv = mkPV2("nodepath", Module.uno_Type.String(), path);
        var pvAny = new Module.uno_Any(Module.uno_Type.Struct("com.sun.star.beans.PropertyValue"), pv);
        var argSeq = new Module.uno_Sequence_any([pvAny]);
        var access = cp.createInstanceWithArguments("com.sun.star.configuration.ConfigurationUpdateAccess", argSeq);
        argSeq.delete();
        var ps = css.beans.XPropertySet.query(access);
        ps.setPropertyValue(propName, new Module.uno_Any(unoType, value));
        css.util.XChangesBatch.query(access).commitChanges();
      }
      try {
        setConfig("/org.openoffice.Office.Common/Appearance", "ApplicationAppearance", 2, Module.uno_Type.Short());
        setConfig("/org.openoffice.Office.Common/Misc", "SymbolStyle", "colibre_dark_svg", Module.uno_Type.String());
        out.configuredEarly = true;

        var desktop = css.frame.Desktop.create(ctx);
        var oargs = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(0, Module.uno_Sequence.FromSize);
        var model = css.frame.XComponentLoader.query(desktop).loadComponentFromURL("private:factory/swriter", "_blank", 0, oargs);
        oargs.delete();
        var controller = css.frame.XModel.query(model).getCurrentController();
        var win = controller.getFrame().getContainerWindow();
        var top = css.awt.XTopWindow.query(win);
        if (top) top.toFront();
        css.awt.XWindow.query(win).setVisible(true);
      } catch (e) {
        out.err = String(e);
      }
      return out;
    }).catch(e => ({ top_err: String(e) }));
  });
  console.log("RESULT:", JSON.stringify(result, null, 2));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "screenshots/probe-theme2-early.png" });
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
