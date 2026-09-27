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
      try {
        const xTextDocument = css.text.XTextDocument.query(xModel);
        const xText = xTextDocument.getText();
        const xCursor = xText.createTextCursor();
        // Set some paragraphs with heading styles
        const xCursorProps = css.beans.XPropertySet.query(xCursor);
        function setStyle(name) {
          try {
            xCursorProps.setPropertyValue("ParaStyleName", new Module.uno_Any(Module.uno_Type.String(), name));
            out["setStyle_" + name] = "OK";
          } catch (e) {
            out["setStyle_" + name] = "ERR:" + e;
          }
        }
        setStyle("Heading 1");
        xText.insertString(xCursor, "Chapter One", false);
        xText.insertControlCharacter(xCursor, css.text.ControlCharacter.PARAGRAPH_BREAK, false);
        setStyle("Text Body");
        xText.insertString(xCursor, "Some body text.", false);
        xText.insertControlCharacter(xCursor, css.text.ControlCharacter.PARAGRAPH_BREAK, false);
        setStyle("Heading 2");
        xText.insertString(xCursor, "Section A", false);

        // Enumerate paragraphs
        const enumAccess = css.container.XEnumerationAccess.query(xText);
        const en = enumAccess.createEnumeration();
        const outline = [];
        while (en.hasMoreElements()) {
          const anyEl = en.nextElement();
          const parEl = anyEl.get ? anyEl.get() : anyEl;
          const parProps = css.beans.XPropertySet.query(parEl);
          let styleName = "?";
          try { styleName = parProps.getPropertyValue("ParaStyleName").get(); } catch (e) {}
          const parText = css.text.XTextRange.query(parEl);
          let txt = "";
          try { txt = parText.getString(); } catch (e) {}
          outline.push({ style: styleName, text: txt });
        }
        out.outline = outline;

        // zoom via XViewSettingsSupplier
        const controller = css.frame.XModel.query(xModel).getCurrentController();
        const vss = css.view.XViewSettingsSupplier.query(controller);
        out.vssOk = !!vss;
        if (vss) {
          const viewSettings = vss.getViewSettings();
          const before = viewSettings.getPropertyValue("ZoomValue").get();
          viewSettings.setPropertyValue("ZoomValue", new Module.uno_Any(Module.uno_Type.Short ? Module.uno_Type.Short() : Module.uno_Type.of ? Module.uno_Type.of("short") : Module.uno_Type.String(), 150));
          let after;
          try { after = viewSettings.getPropertyValue("ZoomValue").get(); } catch (e) { after = "ERR:" + e; }
          out.zoomBefore = before;
          out.zoomAfter = after;
        }
      } catch (e) {
        out.err = String(e) + (e && e.stack ? ("\n" + e.stack) : "");
      }
      return out;
    }).catch(e => ({ top_err: String(e) }));
  }), 20000, "probe5").catch(e => ({ timeout: e.message }));
  console.log("RESULT:", JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(0);
})().catch(e => { console.error("FAILED", e); process.exit(1); });
