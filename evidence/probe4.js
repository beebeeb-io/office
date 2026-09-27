const { chromium } = require("@playwright/test");
function withTimeout(p, ms, l) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout:" + l)), ms))]); }
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let mainWorker = null;
  page.on("worker", (w) => { if (!mainWorker) mainWorker = w; });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(20000);
  const result = await withTimeout(mainWorker.evaluate(() => {
    return Module.uno_init.then(function () {
      const css = Module.uno.com.sun.star;
      const ctx = Module.getUnoComponentContext();
      const desktop = css.frame.Desktop.create(ctx);
      const oargs = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(0, Module.uno_Sequence.FromSize);
      const xModel = css.frame.XComponentLoader.query(desktop).loadComponentFromURL("private:factory/swriter", "_blank", 0, oargs);
      oargs.delete();
      const out = {};

      function parseUrl(cmd) {
        const InOut = Module["uno_InOutParam_com$sun$star$util$URL"];
        const inst = new InOut({
          Complete: cmd, Main: "", Protocol: "", User: "", Password: "",
          Server: "", Port: 0, Path: "", Name: "", Arguments: "", Mark: "",
        });
        const trans = css.util.URLTransformer.create(ctx);
        trans.parseStrict(inst);
        return inst.val;
      }

      try {
        const xModelIfc = css.frame.XModel.query(xModel);
        const controller = xModelIfc.getCurrentController();
        const frame = controller.getFrame();
        const dp = css.frame.XDispatchProvider.query(frame);
        const url = parseUrl(".uno:Bold");
        const disp = dp.queryDispatch(url, "", 0);

        const events = [];
        const listenerObj = {
          statusChanged: function (evt) {
            let stateVal;
            try { stateVal = evt.State.get(); } catch (e) { stateVal = "ERR:" + e; }
            events.push({ IsEnabled: evt.IsEnabled, State: stateVal });
          },
          disposing: function () {},
        };
        const listenerRef = Module.unoObject(["com.sun.star.frame.XStatusListener"], listenerObj);
        const xStatusListener = css.frame.XStatusListener.query(listenerRef);
        disp.addStatusListener(xStatusListener, url); // fires once immediately (initial state)

        const emptyArgs = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(0, Module.uno_Sequence.FromSize);
        disp.dispatch(url, emptyArgs); // toggle bold -> should fire statusChanged again
        emptyArgs.delete();

        out.eventsAfterToggle1 = events.slice();

        const emptyArgs2 = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(0, Module.uno_Sequence.FromSize);
        disp.dispatch(url, emptyArgs2); // toggle back off
        emptyArgs2.delete();
        out.eventsAfterToggle2 = events.slice();

        disp.removeStatusListener(xStatusListener, url);
      } catch (e) {
        out.err = String(e) + (e && e.stack ? ("\n" + e.stack) : "");
      }
      return out;
    }).catch(e => ({ top_err: String(e) }));
  }), 20000, "probe4").catch(e => ({ timeout: e.message }));
  console.log("RESULT:", JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(0);
})().catch(e => { console.error("FAILED", e); process.exit(1); });
