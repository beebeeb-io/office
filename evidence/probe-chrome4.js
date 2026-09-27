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
        const containerWindow = frame.getContainerWindow();

        const peerCandidates = [
          "com.sun.star.awt.XVclWindowPeer",
          "com.sun.star.awt.XWindowPeer",
          "com.sun.star.beans.XPropertySet",
          "com.sun.star.awt.XWindow2",
        ];
        const support = {};
        peerCandidates.forEach((c) => {
          try {
            const t = Module["uno_Type_" + c.replace(/\./g, "$")];
            support[c] = t ? !!t.query(containerWindow) : "no-type-binding";
          } catch (e) { support[c] = "ERR:" + e; }
        });
        out.support = support;

        const ps = css.beans.XPropertySet.query(containerWindow);
        if (ps) {
          try {
            const info = ps.getPropertySetInfo();
            const props = info.getProperties();
            const names = [];
            for (let i = 0; i < props.size(); i++) names.push(props.get(i).Name);
            out.propNames = names;
          } catch (e) { out.propNames_err = String(e); }
        }
      } catch (e) {
        out.err = String(e) + (e && e.stack ? ("\n" + e.stack) : "");
      }
      return out;
    }).catch(e => ({ top_err: String(e) }));
  });
  console.log("RESULT:", JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
