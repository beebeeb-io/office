const { chromium } = require("/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/repos/office/evidence/node_modules/playwright");
const fs = require("fs");

const MARKER = "BB-KEYBOARD-ROUNDTRIP-" + Date.now();

(async () => {
  const docxPath = "/Users/guuslangelaar/code/bb-worktrees/mobile-1565/e2e/fixtures/preview-matrix/office/sample.docx";
  const bytes = fs.readFileSync(docxPath);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  page.on("console", (m) => {
    const t = m.text();
    if (t.startsWith("bb-office")) console.log("[console]", t);
  });

  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(20000);

  await page.addScriptTag({ path: "/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/repos/office/bridge/bb-office-api.js" });

  const hasApi = await page.evaluate(() => typeof window.bbOffice !== "undefined");
  console.log("bbOffice API present on page:", hasApi);

  const openResult = await page.evaluate(async (arr) => {
    const bytes = new Uint8Array(arr);
    return await window.bbOffice.open(bytes, "sample.docx");
  }, Array.from(bytes));
  console.log("open() result:", JSON.stringify(openResult));

  await page.waitForTimeout(2000);
  await page.screenshot({ path: "screenshots/roundtrip2-01-after-open.png" });

  // Click into the document body and type a marker via REAL keyboard events.
  await page.mouse.click(400, 300);
  await page.waitForTimeout(300);
  // Move to the very start of the document first (Ctrl+Home) so the marker lands
  // at a deterministic, easy-to-verify position.
  await page.keyboard.press("Control+Home");
  await page.keyboard.type(MARKER + " ", { delay: 25 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "screenshots/roundtrip2-02-after-type.png" });

  const savedBytesArr = await page.evaluate(async () => {
    const bytes = await window.bbOffice.save();
    return Array.from(bytes);
  });
  console.log("save() returned", savedBytesArr.length, "bytes");

  const outPath = "/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/repos/office/evidence/artifacts/roundtrip/sample-roundtrip.docx";
  fs.mkdirSync(require("path").dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(savedBytesArr));
  console.log("wrote", outPath);

  // Re-open the JUST-SAVED bytes in the SAME browser session (fresh stream, no
  // cache) to prove the marker survived a real save, not just an in-memory edit.
  const reopenResult = await page.evaluate(async (arr) => {
    const bytes = new Uint8Array(arr);
    return await window.bbOffice.open(bytes, "sample.docx");
  }, savedBytesArr);
  console.log("reopen() result:", JSON.stringify(reopenResult));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "screenshots/roundtrip2-03-reopened.png" });

  console.log("MARKER=" + MARKER);
  console.log("OUT_PATH=" + outPath);

  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
