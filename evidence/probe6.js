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
      const out = {};
      try {
        // getCurrentComponent when nothing tracked via state.model
        const cur1 = css.frame.XDesktop.query(desktop).getCurrentComponent();
        out.currentComponentBeforeOpen = cur1 ? "non-null" : "null";

        const oargs = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(0, Module.uno_Sequence.FromSize);
        const xModel = css.frame.XComponentLoader.query(desktop).loadComponentFromURL("private:factory/swriter", "_blank", 0, oargs);
        oargs.delete();

        const cur2 = css.frame.XDesktop.query(desktop).getCurrentComponent();
        out.currentComponentAfterOpen = cur2 === xModel ? "same as xModel" : (cur2 ? "different non-null" : "null");

        // XModifyListener
        const events = [];
        const modListenerObj = {
          modified: function (evt) { events.push("modified"); },
          disposing: function () {},
        };
        const modRef = Module.unoObject(["com.sun.star.util.XModifyListener"], modListenerObj);
        const xModifyListener = css.util.XModifyListener.query(modRef);
        const xModifiable = css.util.XModifiable.query(xModel);
        xModifiable.addModifyListener(xModifyListener);
        out.isModifiedBefore = xModifiable.isModified();

        const xTextDocument = css.text.XTextDocument.query(xModel);
        const xText = xTextDocument.getText();
        xText.insertString(xText.createTextCursor(), "hello", false);
        out.eventsAfterEdit = events.slice();
        out.isModifiedAfter = xModifiable.isModified();
        xModifiable.removeModifyListener(xModifyListener);

        // AsTemplate + factory for calc
        const oargs2 = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(0, Module.uno_Sequence.FromSize);
        const calcModel = css.frame.XComponentLoader.query(desktop).loadComponentFromURL("private:factory/scalc", "_blank", 0, oargs2);
        oargs2.delete();
        out.calcOk = !!calcModel;
        css.util.XCloseable.query(calcModel).close(false);

        // selection listener + accessibility probe
        const controller = css.frame.XModel.query(xModel).getCurrentController();
        const selEvents = [];
        const selListenerObj = {
          selectionChanged: function (evt) { selEvents.push("sel"); },
          disposing: function () {},
        };
        const selRef = Module.unoObject(["com.sun.star.view.XSelectionChangeListener"], selListenerObj);
        const xSelListener = css.view.XSelectionChangeListener.query(selRef);
        const xSelSupplier = css.view.XSelectionSupplier.query(controller);
        out.selSupplierOk = !!xSelSupplier;
        xSelSupplier.addSelectionChangeListener(xSelListener);
        // trigger a selection change: select all text
        const vcs = css.text.XTextViewCursorSupplier.query(controller);
        const viewCursor = vcs.getViewCursor();
        viewCursor.gotoStart(false);
        viewCursor.gotoEnd(true);
        out.selEventsAfter = selEvents.slice();
        xSelSupplier.removeSelectionChangeListener(xSelListener);

        // Try accessibility bridge availability
        try {
          const xWindow = css.awt.XWindow.query(css.frame.XFrame.query(controller.getFrame()).getContainerWindow());
          out.windowOk = !!xWindow;
          const xAccessible = css.accessibility.XAccessible.query(xWindow);
          out.accessibleOk = !!xAccessible;
          if (xAccessible) {
            const ctxAcc = xAccessible.getAccessibleContext();
            out.accessibleContextOk = !!ctxAcc;
            out.accessibleDesc = ctxAcc ? ctxAcc.getAccessibleName() : null;
          }
        } catch (e) {
          out.accessibility_err = String(e);
        }
      } catch (e) {
        out.err = String(e) + (e && e.stack ? ("\n" + e.stack) : "");
      }
      return out;
    }).catch(e => ({ top_err: String(e) }));
  }), 20000, "probe6").catch(e => ({ timeout: e.message }));
  console.log("RESULT:", JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(0);
})().catch(e => { console.error("FAILED", e); process.exit(1); });
