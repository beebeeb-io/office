const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let mainWorker = null;
  page.on("worker", (w) => { if (!mainWorker) mainWorker = w; });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(20000);
  await page.screenshot({ path: "screenshots/probe-chrome-startcenter.png" });

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
        const lmAny = ps.getPropertyValue("LayoutManager");
        const lm = css.frame.XLayoutManager.query(lmAny.get());
        out.lmOk = !!lm;
        if (lm) {
          const elems = lm.getElements();
          const resourceUrls = [];
          for (let i = 0; i < elems.size(); i++) {
            const el = elems.get(i);
            try {
              const xui = css.ui.XUIElement.query(el);
              resourceUrls.push(xui.getResourceURL());
            } catch (e) {
              resourceUrls.push("ERR:" + e);
            }
          }
          out.resourceUrls = resourceUrls;
        }
        // Ruler default state
        const InOutURL = Module["uno_InOutParam_com$sun$star$util$URL"];
        function parseUrl(cmd) {
          const inst = new InOutURL({ Complete: cmd, Main: "", Protocol: "", User: "", Password: "", Server: "", Port: 0, Path: "", Name: "", Arguments: "", Mark: "" });
          const trans = css.util.URLTransformer.create(ctx);
          trans.parseStrict(inst);
          return inst.val;
        }
        const dp = css.frame.XDispatchProvider.query(frame);
        const rulerUrl = parseUrl(".uno:ShowRuler");
        const rulerDisp = dp.queryDispatch(rulerUrl, "", 0);
        if (rulerDisp) {
          let rulerState = null;
          const l = { statusChanged: (evt) => { try { rulerState = evt.State.get(); } catch (e) { rulerState = "ERR"; } }, disposing: () => {} };
          const ref = Module.unoObject(["com.sun.star.frame.XStatusListener"], l);
          const xl = css.frame.XStatusListener.query(ref);
          rulerDisp.addStatusListener(xl, rulerUrl);
          rulerDisp.removeStatusListener(xl, rulerUrl);
          out.rulerDefaultState = rulerState;
        }

        // Sidebar state
        const sidebarUrl = parseUrl(".uno:Sidebar");
        const sidebarDisp = dp.queryDispatch(sidebarUrl, "", 0);
        if (sidebarDisp) {
          let sidebarState = null;
          const l2 = { statusChanged: (evt) => { try { sidebarState = evt.State.get(); } catch (e) { sidebarState = "ERR:" + e; } }, disposing: () => {} };
          const ref2 = Module.unoObject(["com.sun.star.frame.XStatusListener"], l2);
          const xl2 = css.frame.XStatusListener.query(ref2);
          sidebarDisp.addStatusListener(xl2, sidebarUrl);
          sidebarDisp.removeStatusListener(xl2, sidebarUrl);
          out.sidebarDefaultState = sidebarState;
        } else {
          out.sidebarDispatch = "none";
        }
      } catch (e) {
        out.err = String(e) + (e && e.stack ? ("\n" + e.stack) : "");
      }
      return out;
    }).catch(e => ({ top_err: String(e) }));
  });
  console.log("RESULT:", JSON.stringify(result, null, 2));
  await page.screenshot({ path: "screenshots/probe-chrome-after-open.png" });
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
