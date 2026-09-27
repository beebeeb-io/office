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
        try {
          return e && e.toString ? e.toString() : JSON.stringify(e);
        } catch (e3) {
          return "unstringifiable";
        }
      }
      return Module.uno_init
        .then(function () {
          const steps = [];
          const css = Module.uno.com.sun.star;
          const desktop = css.frame.Desktop.create(Module.getUnoComponentContext());

          // 1. create blank doc
          let xModel;
          try {
            const args0 = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(0, Module.uno_Sequence.FromSize);
            xModel = css.frame.XComponentLoader.query(desktop).loadComponentFromURL(
              "private:factory/swriter",
              "_blank",
              0,
              args0
            );
            args0.delete();
            steps.push("blank doc created, null? " + (xModel === null));
          } catch (e) {
            return { steps, error: "create blank: " + describeErr(e) };
          }

          // 2. store to file:// as ODT, NO explicit filter (let URL extension decide)
          try {
            const argsSave = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(0, Module.uno_Sequence.FromSize);
            const xStorable = css.frame.XStorable.query(xModel);
            xStorable.storeToURL("file:///tmp/test.odt", argsSave);
            argsSave.delete();
            steps.push("stored to file:///tmp/test.odt (no explicit filter)");
          } catch (e) {
            return { steps, error: "storeToURL odt: " + describeErr(e) };
          }

          // 3. check bytes exist via FS
          try {
            steps.push("/tmp listing: " + JSON.stringify(FS.readdir("/tmp")));
          } catch (e) {
            steps.push("/tmp readdir failed: " + describeErr(e));
          }
          try {
            steps.push("/ listing: " + JSON.stringify(FS.readdir("/")));
          } catch (e) {
            steps.push("/ readdir failed: " + describeErr(e));
          }
          try {
            const sz = FS.readFile("/tmp/test.odt").length;
            steps.push("FS confirms /tmp/test.odt exists, size=" + sz);
          } catch (e) {
            steps.push("FS.readFile after store failed: " + describeErr(e));
          }

          // 4. try to load OUR OWN saved file back
          try {
            const args1 = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(0, Module.uno_Sequence.FromSize);
            const xModel2 = css.frame.XComponentLoader.query(desktop).loadComponentFromURL(
              "file:///tmp/test.odt",
              "_blank",
              0,
              args1
            );
            args1.delete();
            steps.push("re-opened own odt, null? " + (xModel2 === null));
          } catch (e) {
            return { steps, error: "reopen own odt: " + describeErr(e) };
          }

          return { steps, ok: true };
        })
        .catch(function (e) {
          return { error: "outer: " + describeErr(e) };
        });
    }),
    25000,
    "fileio"
  ).catch((e) => ({ error: "TIMEOUT: " + e.message }));

  console.log("RESULT:", JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
