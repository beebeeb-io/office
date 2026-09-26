const { chromium } = require("@playwright/test");
function withTimeout(p, ms, l) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout:" + l)), ms))]); }
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let mainWorker = null;
  page.on("worker", (w) => { if (!mainWorker) mainWorker = w; });
  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(20000);
  const result = await withTimeout(mainWorker.evaluate(() => {
    return Module.uno_init.then(function () {
      const css = Module.uno.com.sun.star;
      const ctx = Module.getUnoComponentContext();
      const desktop = css.frame.Desktop.create(ctx);
      const out = {};
      try {
        const oargs = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(0, Module.uno_Sequence.FromSize);
        const xModel = css.frame.XComponentLoader.query(desktop).loadComponentFromURL("private:factory/swriter", "_blank", 0, oargs);
        oargs.delete();
        const controller = css.frame.XModel.query(xModel).getCurrentController();

        // Attempt 2: XAccessible on the controller itself
        try {
          const accCtrl = css.accessibility.XAccessible.query(controller);
          out.accessibleOnController = !!accCtrl;
        } catch (e) { out.accessibleOnController_err = String(e); }

        // Attempt 3: enumerate available service names for anything accessibility-related
        try {
          const sm = ctx.getServiceManager();
          const smQ = css.lang.XMultiComponentFactory.query(sm);
          const names = smQ.getAvailableServiceNames();
          const filtered = [];
          for (let i = 0; i < names.size(); i++) {
            const n = names.get(i);
            if (/access/i.test(n)) filtered.push(n);
          }
          out.accessServiceNames = filtered;
        } catch (e) { out.serviceNames_err = String(e); }

        // Diagnostic: what interfaces does the window peer actually support? probe a handful of plausible ones
        const win = css.frame.XFrame.query(controller.getFrame()).getContainerWindow();
        const candidates = [
          "com.sun.star.awt.XWindow2",
          "com.sun.star.awt.XView",
          "com.sun.star.awt.XVclWindowPeer",
          "com.sun.star.accessibility.XAccessible",
        ];
        const support = {};
        candidates.forEach((c) => {
          try {
            const t = Module["uno_Type_" + c.replace(/\./g, "$")];
            support[c] = t ? !!t.query(win) : "no-type-binding";
          } catch (e) {
            support[c] = "ERR:" + e;
          }
        });
        out.windowInterfaceSupport = support;
      } catch (e) {
        out.err = String(e) + (e && e.stack ? ("\n" + e.stack) : "");
      }
      return out;
    }).catch(e => ({ top_err: String(e) }));
  }), 20000, "probe7").catch(e => ({ timeout: e.message }));
  console.log("RESULT:", JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(0);
})().catch(e => { console.error("FAILED", e); process.exit(1); });
