const { chromium } = require("/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/repos/office/evidence/node_modules/playwright");
const fs = require("fs");

const MARKER = "BB-XLSX-ROUNDTRIP-" + Date.now();

(async () => {
  const p = "/Users/guuslangelaar/code/bb-worktrees/mobile-1565/e2e/fixtures/preview-matrix/office/sample.xlsx";
  const bytes = fs.readFileSync(p);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));

  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(20000);
  await page.addScriptTag({ path: "/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/repos/office/bridge/bb-office-api.js" });

  const openResult = await page.evaluate(async (arr) => {
    const bytes = new Uint8Array(arr);
    return await window.bbOffice.open(bytes, "sample.xlsx");
  }, Array.from(bytes));
  console.log("open() result:", JSON.stringify(openResult));
  await page.waitForTimeout(2000);

  // Click on empty cell D1, type the marker, Enter to commit it (real keyboard).
  await page.mouse.click(260, 198);
  await page.waitForTimeout(300);
  await page.keyboard.type(MARKER, { delay: 20 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "screenshots/roundtrip-xlsx-02-typed.png" });

  const savedBytesArr = await page.evaluate(async () => Array.from(await window.bbOffice.save()));
  console.log("save() returned", savedBytesArr.length, "bytes");

  const outPath = "/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/repos/office/evidence/artifacts/roundtrip/sample-roundtrip.xlsx";
  fs.writeFileSync(outPath, Buffer.from(savedBytesArr));
  console.log("wrote", outPath);

  const reopenResult = await page.evaluate(async (arr) => {
    const bytes = new Uint8Array(arr);
    return await window.bbOffice.open(bytes, "sample.xlsx");
  }, savedBytesArr);
  console.log("reopen() result:", JSON.stringify(reopenResult));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "screenshots/roundtrip-xlsx-03-reopened.png" });

  console.log("MARKER=" + MARKER);
  console.log("OUT_PATH=" + outPath);

  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
