const { chromium } = require("@playwright/test");
const fs = require("fs");

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout:${label}`)), ms)),
  ]);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let mainWorker = null;
  page.on("worker", (w) => {
    if (!mainWorker) mainWorker = w;
  });

  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(20000);

  const srcBytes = fs.readFileSync(
    "/Users/guuslangelaar/code/bb-worktrees/mobile-1565/e2e/fixtures/preview-matrix/office/sample.docx"
  );
  const srcB64 = srcBytes.toString("base64");

  await withTimeout(
    mainWorker.evaluate(({ srcB64 }) => {
      const bin = atob(srcB64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      try {
        FS.mkdir("/tmp");
      } catch (e) {}
      FS.writeFile("/tmp/in.docx", bytes);
      return FS.readFile("/tmp/in.docx").length;
    }, { srcB64 }),
    10000,
    "write"
  );

  const result = await withTimeout(
    mainWorker.evaluate(() => {
      function describeErr(e) {
        try {
          if (Module.getExceptionMessage) return Module.getExceptionMessage(e);
        } catch (e2) {}
        try {
          return e && e.toString ? e.toString() : JSON.stringify(e);
        } catch (e3) {
          return "unstringifiable";
        }
      }
      return Module.uno_init.then(function () {
        const steps = [];
        const css = Module.uno.com.sun.star;
        steps.push("got css");
        let desktop;
        try {
          desktop = css.frame.Desktop.create(Module.getUnoComponentContext());
          steps.push("desktop created");
        } catch (e) {
          return { steps, error: "desktop.create: " + describeErr(e) };
        }
        let xModel;
        try {
          const args = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(0, Module.uno_Sequence.FromSize);
          xModel = css.frame.XComponentLoader.query(desktop).loadComponentFromURL(
            "file:///tmp/in.docx",
            "_default",
            0,
            args
          );
          args.delete();
          steps.push("loadComponentFromURL returned, xModel null? " + (xModel === null));
        } catch (e) {
          return { steps, error: "loadComponentFromURL: " + describeErr(e) };
        }
        try {
          const xTextDocument = css.text.XTextDocument.query(xModel);
          steps.push("XTextDocument query ok? " + (xTextDocument !== null));
          const xText = xTextDocument.getText();
          steps.push("got xText");
          const xCursor = xText.createTextCursorByRange(xText.getEnd());
          steps.push("got cursor at end");
          xText.insertString(xCursor, "\nMARKERHERE", false);
          steps.push("inserted string");
        } catch (e) {
          return { steps, error: "insert: " + describeErr(e) };
        }
        try {
          const xStorable = css.frame.XStorable.query(xModel);
          xStorable.store();
          steps.push("stored");
        } catch (e) {
          return { steps, error: "store: " + describeErr(e) };
        }
        return { steps, ok: true };
      }).catch(function (e) {
        return { error: "outer: " + describeErr(e) };
      });
    }),
    20000,
    "uno"
  ).catch((e) => ({ error: "TIMEOUT: " + e.message }));

  console.log("RESULT:", JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
