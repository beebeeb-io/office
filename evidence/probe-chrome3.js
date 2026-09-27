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
        const framesSupplier = css.frame.XFramesSupplier.query(desktop);
        const framesBefore = framesSupplier.getFrames();
        out.frameCountBefore = framesBefore.getCount ? framesBefore.getCount() : framesBefore.size();

        const oargs = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(0, Module.uno_Sequence.FromSize);
        const model = css.frame.XComponentLoader.query(desktop).loadComponentFromURL("private:factory/swriter", "_blank", 0, oargs);
        oargs.delete();

        const framesAfter = framesSupplier.getFrames();
        out.frameCountAfter = framesAfter.getCount ? framesAfter.getCount() : framesAfter.size();

        // enumerate all frames, identify which is which
        const frameInfo = [];
        const n = framesAfter.getCount ? framesAfter.getCount() : framesAfter.size();
        for (let i = 0; i < n; i++) {
          const f = framesAfter.getByIndex ? framesAfter.getByIndex(i).get() : framesAfter.get(i);
          const xf = css.frame.XFrame.query(f);
          const comp = xf.getController() ? xf.getController().getModel() : null;
          let url = "unknown";
          try { url = comp ? css.frame.XModel.query(comp).getURL() : "no-model"; } catch (e) { url = "ERR:" + e; }
          const win = xf.getContainerWindow();
          const xw = css.awt.XWindow.query(win);
          let posSize = null;
          try { posSize = xw.getPosSize(); } catch (e) { posSize = "ERR:" + e; }
          frameInfo.push({ url: url, posSize: posSize });
        }
        out.frameInfo = frameInfo;

        // try toFront on the new model's window
        const controller = css.frame.XModel.query(model).getCurrentController();
        const frame = controller.getFrame();
        const containerWindow = frame.getContainerWindow();
        const xTopWindow = css.awt.XTopWindow.query(containerWindow);
        out.topWindowOk = !!xTopWindow;
        if (xTopWindow) xTopWindow.toFront();
        const xWindow2 = css.awt.XWindow.query(containerWindow);
        xWindow2.setVisible(true);
        xWindow2.setFocus();
      } catch (e) {
        out.err = String(e) + (e && e.stack ? ("\n" + e.stack) : "");
      }
      return out;
    }).catch(e => ({ top_err: String(e) }));
  });
  console.log("RESULT:", JSON.stringify(result, null, 2));
  await page.waitForTimeout(500);
  await page.screenshot({ path: "screenshots/probe-chrome3-tofront.png" });
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
