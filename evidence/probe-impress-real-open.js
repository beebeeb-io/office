const { chromium } = require("@playwright/test");
const fs = require("fs");
(async () => {
  const bytes = fs.readFileSync("/Users/guuslangelaar/code/bb-worktrees/web-1567-editor/e2e/fixtures/office/sample.pptx");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => typeof window.bbOffice !== "undefined", null, { timeout: 30000 });

  const b64 = bytes.toString("base64");
  const result = await page.evaluate(async (b64) => {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const out = {};
    out.open = await window.bbOffice.open(u8, "sample.pptx");
    out.setColor = await window.bbOffice.setWorkspaceColor(0xff0000);
    // Mimic real app: also set zoom fit again explicitly via dispatch, like applyDocumentChrome does internally already
    out.debugState = await window.bbOffice.__debugChromeState();
    return out;
  }, b64);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "/tmp/impress-real-open.png" });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
