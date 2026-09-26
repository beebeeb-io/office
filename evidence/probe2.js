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
      const keys = Object.keys(Module).filter(k => k.indexOf("InOutParam") !== -1 || (k.indexOf("util$URL") !== -1));
      const out = { matchingKeys: keys };
      try {
        const InOut = Module["uno_InOutParam_com$sun$star$util$URL"];
        out.hasCtor = typeof InOut;
        const inst = new InOut({
          Complete: ".uno:Bold", Main: "", Protocol: "", User: "", Password: "",
          Server: "", Port: 0, Path: "", Name: "", Arguments: "", Mark: "",
        });
        out.instKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(inst)).join(",");
        const css = Module.uno.com.sun.star;
        const ctx = Module.getUnoComponentContext();
        const trans = css.util.URLTransformer.create(ctx);
        const ok = trans.parseStrict(inst);
        out.parseOk = ok;
        out.valueAfter = inst.get ? JSON.stringify(inst.get()) : "no .get()";
      } catch (e) {
        out.err = String(e);
      }
      return out;
    }).catch(e => ({ top_err: String(e) }));
  }), 15000, "probe2").catch(e => ({ timeout: e.message }));
  console.log("RESULT:", JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(0);
})().catch(e => { console.error("FAILED", e); process.exit(1); });
