const { chromium } = require("/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/repos/office/evidence/node_modules/playwright");
const fs = require("fs");

(async () => {
  const docxPath = "/Users/guuslangelaar/code/bb-worktrees/mobile-1565/e2e/fixtures/preview-matrix/office/sample.docx";
  const docxBytes = fs.readFileSync(docxPath);
  const pngBytes = fs.readFileSync("/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/repos/office/evidence/serve/test-image.png");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));

  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(20000);
  await page.addScriptTag({ path: "/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/repos/office/bridge/bb-office-api.js" });

  await page.evaluate(async (arr) => {
    await window.bbOffice.open(new Uint8Array(arr), "sample.docx");
  }, Array.from(docxBytes));
  await page.waitForTimeout(1500);

  const imgResult = await page.evaluate(async (arr) => {
    return await window.bbOffice.insertImage(new Uint8Array(arr), "image/png");
  }, Array.from(pngBytes));
  console.log("insertImage result:", JSON.stringify(imgResult));

  const linkResult = await page.evaluate(async () => {
    return await window.bbOffice.insertHyperlink("Beebeeb site", "https://beebeeb.io/");
  });
  console.log("insertHyperlink result:", JSON.stringify(linkResult));

  await page.waitForTimeout(1000);
  await page.screenshot({ path: "screenshots/image-hyperlink-inserted.png" });

  const savedArr = await page.evaluate(async () => Array.from(await window.bbOffice.save()));
  const outPath = "/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/repos/office/evidence/artifacts/roundtrip/sample-with-image-hyperlink.docx";
  fs.writeFileSync(outPath, Buffer.from(savedArr));
  console.log("wrote", outPath, savedArr.length, "bytes");
  console.log("OUT_PATH=" + outPath);

  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
