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

  const result = await withTimeout(
    mainWorker.evaluate(({ srcB64 }) => {
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
      const steps = [];
      try {
        steps.push("/home listing: " + JSON.stringify(FS.readdir("/home")));
      } catch (e) {
        steps.push("/home readdir failed: " + describeErr(e));
      }
      try {
        steps.push("/home/web_user listing: " + JSON.stringify(FS.readdir("/home/web_user")));
      } catch (e) {
        steps.push("/home/web_user readdir failed: " + describeErr(e));
      }
      // write fixture into /home/web_user this time
      try {
        const bin = atob(srcB64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        FS.writeFile("/home/web_user/sample.docx", bytes);
        steps.push("wrote /home/web_user/sample.docx, readback size=" + FS.readFile("/home/web_user/sample.docx").length);
      } catch (e) {
        return { steps, error: "write to home: " + describeErr(e) };
      }

      return Module.uno_init
        .then(function () {
          const css = Module.uno.com.sun.star;
          const desktop = css.frame.Desktop.create(Module.getUnoComponentContext());
          try {
            const args = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(0, Module.uno_Sequence.FromSize);
            const xModel = css.frame.XComponentLoader.query(desktop).loadComponentFromURL(
              "file:///home/web_user/sample.docx",
              "_blank",
              0,
              args
            );
            args.delete();
            steps.push("loadComponentFromURL(/home/web_user/sample.docx) null? " + (xModel === null));
            if (xModel !== null) {
              const xTextDocument = css.text.XTextDocument.query(xModel);
              steps.push("is text doc? " + (xTextDocument !== null));
              if (xTextDocument !== null) {
                steps.push("text content: " + JSON.stringify(xTextDocument.getText().getString()).slice(0, 200));
              }
            }
          } catch (e) {
            return { steps, error: "load from home: " + describeErr(e) };
          }
          return { steps, ok: true };
        })
        .catch(function (e) {
          return { steps, error: "outer: " + describeErr(e) };
        });
    }, { srcB64 }),
    25000,
    "test"
  ).catch((e) => ({ error: "TIMEOUT: " + e.message }));

  console.log("RESULT:", JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
