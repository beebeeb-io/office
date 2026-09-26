// Verifies whether the build-time --post-js fix (no runtime soffice.js patch)
// actually makes Module.uno_scripts visible inside the pthread that owns UNO,
// by checking whether the bbOffice bridge's own MessagePort resolves and a
// real open()/save() round trip works -- using window.bbOffice exactly as a
// real page would (bridge/bb-office-api.js), zero manual UNO/embind calls.
const { chromium } = require("@playwright/test");
const fs = require("fs");
function withTimeout(p, ms, l) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout:" + l)), ms))]); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  page.on("console", (msg) => {
    const t = msg.text();
    if (t.indexOf("bb-office-worker") !== -1 || t.indexOf("uno_scripts") !== -1) console.log("[console]", t);
  });

  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  // Inject the bbOffice page-side bridge script exactly as a real host page would.
  await page.addScriptTag({ url: "/bridge/bb-office-api.js" });
  await page.waitForTimeout(20000);

  const fixture = fs.readFileSync(
    "/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/repos/office/evidence/artifacts/roundtrip/roundtrip.docx"
  );
  const b64 = fixture.toString("base64");

  const result = await withTimeout(page.evaluate(async (b64in) => {
    function b64ToU8(b64s) {
      const bin = atob(b64s);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return u8;
    }
    try {
      const openResult = await window.bbOffice.open(b64ToU8(b64in), "fixture.docx");
      const saved = await window.bbOffice.save();
      return { ok: true, openResult, savedBytes: saved.length };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }, b64), 30000, "bbOffice-roundtrip").catch(e => ({ timeout: e.message }));

  console.log("RESULT:", JSON.stringify(result, null, 2));
  await page.screenshot({ path: "screenshots/probe-postjs-check.png" });
  await browser.close();
  process.exit(0);
})().catch(e => { console.error("FAILED", e); process.exit(1); });
