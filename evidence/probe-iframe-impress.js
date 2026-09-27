const { chromium } = require("@playwright/test");
const fs = require("fs");
(async () => {
  const bytes = fs.readFileSync("/Users/guuslangelaar/code/bb-worktrees/web-1567-editor/e2e/fixtures/office/sample.pptx");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  await page.goto("http://127.0.0.1:8743/probe-iframe-host.html", { waitUntil: "load", timeout: 30000 });
  const frame = page.frameLocator("#office");
  await page.waitForFunction(() => {
    const f = document.getElementById("office");
    return f && f.contentWindow && typeof f.contentWindow.bbOffice !== "undefined";
  }, null, { timeout: 30000 });

  const b64 = bytes.toString("base64");
  const result = await page.evaluate(async (b64) => {
    const bbOffice = document.getElementById("office").contentWindow.bbOffice;
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const out = {};
    out.open = await bbOffice.open(u8, "sample.pptx");
    out.setColor = await bbOffice.setWorkspaceColor(0xff0000);
    // Mimic the REAL app's own extra subscriptions made right after open(),
    // Impress-specific ones included (.uno:PageStatus via useImpressChrome),
    // to test whether ONE of these has a side effect that reverts the color.
    for (const cmd of [".uno:Bold", ".uno:Italic", ".uno:Underline", ".uno:CenterPara", ".uno:PageStatus"]) {
      try { await bbOffice.onState(cmd, () => {}); } catch (e) { out["onStateErr_" + cmd] = String(e); }
    }
    try { await bbOffice.onModifiedChange(() => {}); } catch (e) {}
    try { await bbOffice.onSelectionChange(() => {}); } catch (e) {}
    try { out.outline = await bbOffice.getOutline(); } catch (e) {}
    try { out.docStats = await bbOffice.getDocStats(); } catch (e) {}
    out.debugState = await bbOffice.__debugChromeState();
    return out;
  }, b64);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "/tmp/impress-iframe-nested.png" });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
