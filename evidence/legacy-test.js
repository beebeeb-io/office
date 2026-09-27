const { chromium } = require("/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/repos/office/evidence/node_modules/playwright");
const fs = require("fs");

const filename = process.argv[2]; // sample.doc / sample.xls / sample.ppt

(async () => {
  const p = "/Users/guuslangelaar/code/bb-worktrees/mobile-1565/e2e/fixtures/preview-matrix/office/" + filename;
  const bytes = fs.readFileSync(p);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));

  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(20000);
  await page.addScriptTag({ path: "/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/repos/office/bridge/bb-office-api.js" });

  const openResult = await page.evaluate(async ({ arr, fname }) => {
    const bytes = new Uint8Array(arr);
    return await window.bbOffice.open(bytes, fname);
  }, { arr: Array.from(bytes), fname: filename });
  console.log("open() result:", JSON.stringify(openResult));
  await page.waitForTimeout(2500);
  const base = filename.replace(/\.[^.]+$/, "");
  await page.screenshot({ path: "screenshots/legacy-" + base + "-open.png" });

  const savedBytesArr = await page.evaluate(async () => Array.from(await window.bbOffice.save()));
  console.log("save() returned", savedBytesArr.length, "bytes, saveExt=", openResult.saveExt);

  const outPath = "/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/repos/office/evidence/artifacts/roundtrip/" + base + "-saved-as." + openResult.saveExt;
  fs.writeFileSync(outPath, Buffer.from(savedBytesArr));
  console.log("wrote", outPath);
  console.log("OUT_PATH=" + outPath);

  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
