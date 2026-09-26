const { chromium } = require("/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/repos/office/evidence/node_modules/playwright");
const fs = require("fs");

const MARKER = "BB-PPTX-ROUNDTRIP-" + Date.now();

(async () => {
  const p = "/Users/guuslangelaar/code/bb-worktrees/mobile-1565/e2e/fixtures/preview-matrix/office/sample.pptx";
  const bytes = fs.readFileSync(p);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));

  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(20000);
  await page.addScriptTag({ path: "/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/repos/office/bridge/bb-office-api.js" });

  const openResult = await page.evaluate(async (arr) => {
    const bytes = new Uint8Array(arr);
    return await window.bbOffice.open(bytes, "sample.pptx");
  }, Array.from(bytes));
  console.log("open() result:", JSON.stringify(openResult));
  await page.waitForTimeout(2000);

  // The fixture's own Title placeholder inherits position/size from the slide
  // LAYOUT (not set on the slide itself) and this LO-WASM build resolves it to
  // 0x0 (confirmed via the Properties panel after Tab-selecting it) -- a real,
  // separate interop quirk unrelated to the open/save mechanism. Insert a NEW
  // text box instead (Insert > Text Box, F2 shortcut shown in the menu), drawn
  // at an explicit, guaranteed-visible position -- still entirely real mouse +
  // keyboard, still proves the same open/edit/save mechanism.
  await page.mouse.click(170, 37); // Insert menu
  await page.waitForTimeout(400);
  await page.mouse.click(207, 283); // "Text Box" item
  await page.waitForTimeout(400);
  await page.mouse.move(300, 420);
  await page.mouse.down();
  await page.mouse.move(700, 470, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "screenshots/roundtrip-pptx-01a-boxdrawn.png" });
  await page.mouse.click(500, 445); // ensure cursor focus inside the new box
  await page.waitForTimeout(500);
  await page.keyboard.type(MARKER, { delay: 40 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "screenshots/roundtrip-pptx-01b-typed.png" });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "screenshots/roundtrip-pptx-02-typed.png" });

  const savedBytesArr = await page.evaluate(async () => Array.from(await window.bbOffice.save()));
  console.log("save() returned", savedBytesArr.length, "bytes");

  const outPath = "/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/repos/office/evidence/artifacts/roundtrip/sample-roundtrip.pptx";
  fs.writeFileSync(outPath, Buffer.from(savedBytesArr));
  console.log("wrote", outPath);

  const reopenResult = await page.evaluate(async (arr) => {
    const bytes = new Uint8Array(arr);
    return await window.bbOffice.open(bytes, "sample.pptx");
  }, savedBytesArr);
  console.log("reopen() result:", JSON.stringify(reopenResult));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "screenshots/roundtrip-pptx-03-reopened.png" });

  console.log("MARKER=" + MARKER);
  console.log("OUT_PATH=" + outPath);

  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
