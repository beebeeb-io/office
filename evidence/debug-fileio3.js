const { chromium } = require("@playwright/test");

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

  const result = await withTimeout(
    mainWorker.evaluate(() => {
      function describeErr(e) {
        try {
          if (Module.getExceptionMessage) return Module.getExceptionMessage(e);
        } catch (e2) {}
        return e && e.toString ? e.toString() : "unstringifiable";
      }
      const steps = [];
      // write a trivial plain-text file
      try {
        const enc = new TextEncoder();
        FS.writeFile("/home/web_user/plain.txt", enc.encode("hello world plain text"));
        steps.push("wrote plain.txt");
      } catch (e) {
        steps.push("write plain.txt failed: " + describeErr(e));
      }

      return Module.uno_init
        .then(function () {
          const css = Module.uno.com.sun.star;
          const desktop = css.frame.Desktop.create(Module.getUnoComponentContext());

          // Test A: open the plain text file
          try {
            const args = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(0, Module.uno_Sequence.FromSize);
            const xModel = css.frame.XComponentLoader.query(desktop).loadComponentFromURL(
              "file:///home/web_user/plain.txt",
              "_blank",
              0,
              args
            );
            args.delete();
            steps.push("open plain.txt null? " + (xModel === null));
          } catch (e) {
            steps.push("open plain.txt FAILED: " + describeErr(e));
          }

          // Test B: create+store+DISPOSE+reopen an odt, forcing a real disk read
          try {
            const args0 = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(0, Module.uno_Sequence.FromSize);
            const xModel = css.frame.XComponentLoader.query(desktop).loadComponentFromURL(
              "private:factory/swriter",
              "_blank",
              0,
              args0
            );
            args0.delete();
            const argsSave = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(0, Module.uno_Sequence.FromSize);
            css.frame.XStorable.query(xModel).storeToURL("file:///home/web_user/fresh.odt", argsSave);
            argsSave.delete();
            steps.push("stored fresh.odt, FS size=" + FS.readFile("/home/web_user/fresh.odt").length);
            css.util.XCloseable.query(xModel).close(false);
            steps.push("closed original model");
            const args2 = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(0, Module.uno_Sequence.FromSize);
            const xModel2 = css.frame.XComponentLoader.query(desktop).loadComponentFromURL(
              "file:///home/web_user/fresh.odt",
              "_blank",
              0,
              args2
            );
            args2.delete();
            steps.push("reopen fresh.odt AFTER close, null? " + (xModel2 === null));
          } catch (e) {
            steps.push("dispose+reopen test FAILED: " + describeErr(e));
          }

          return { steps, ok: true };
        })
        .catch(function (e) {
          return { steps, error: "outer: " + describeErr(e) };
        });
    }),
    30000,
    "test"
  ).catch((e) => ({ error: "TIMEOUT: " + e.message }));

  console.log("RESULT:", JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
