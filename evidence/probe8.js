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
        const xTextDocument = css.text.XTextDocument.query(xModel);
        const xText = xTextDocument.getText();
        const xCursor = xText.createTextCursor();
        const xCursorProps = css.beans.XPropertySet.query(xCursor);
        function setStyle(name) { xCursorProps.setPropertyValue("ParaStyleName", new Module.uno_Any(Module.uno_Type.String(), name)); }
        setStyle("Heading 1");
        xText.insertString(xCursor, "Chapter One", false);
        xText.insertControlCharacter(xCursor, css.text.ControlCharacter.PARAGRAPH_BREAK, false);
        setStyle("Text body");
        xText.insertString(xCursor, "Body under chapter one, quite long so we can tell if the cursor moved here or not.", false);
        xText.insertControlCharacter(xCursor, css.text.ControlCharacter.PARAGRAPH_BREAK, false);
        setStyle("Heading 2");
        xText.insertString(xCursor, "Section Target", false);
        xText.insertControlCharacter(xCursor, css.text.ControlCharacter.PARAGRAPH_BREAK, false);
        setStyle("Text body");
        xText.insertString(xCursor, "More body text after the target heading.", false);

        // Enumerate again and collect paragraph ranges themselves (not just text)
        const enumAccess = css.container.XEnumerationAccess.query(xText);
        const en = enumAccess.createEnumeration();
        const paras = [];
        while (en.hasMoreElements()) {
          const anyEl = en.nextElement();
          const parEl = anyEl.get ? anyEl.get() : anyEl;
          paras.push(parEl);
        }
        out.paraCount = paras.length;

        // goto heading at index 2 ("Section Target")
        const controller = css.frame.XModel.query(xModel).getCurrentController();
        const vcs = css.text.XTextViewCursorSupplier.query(controller);
        const viewCursor = vcs.getViewCursor();
        const targetPara = paras[2];
        const targetRange = css.text.XTextRange.query(targetPara);
        viewCursor.gotoRange(targetRange.getStart(), false);
        out.viewCursorTextAfterGoto = css.text.XTextRange.query(viewCursor).getString();
        // Confirm cursor's paragraph-start position by checking the whole-paragraph string it's inside via selecting to end and comparing to target text
        viewCursor.gotoRange(targetRange, true);
        out.selectedText = css.text.XTextRange.query(viewCursor).getString();
      } catch (e) {
        out.err = String(e) + (e && e.stack ? ("\n" + e.stack) : "");
      }
      return out;
    }).catch(e => ({ top_err: String(e) }));
  }), 20000, "probe8").catch(e => ({ timeout: e.message }));
  console.log("RESULT:", JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(0);
})().catch(e => { console.error("FAILED", e); process.exit(1); });
