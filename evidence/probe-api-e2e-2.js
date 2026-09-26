const { chromium } = require("@playwright/test");
function withTimeout(p, ms, l) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout:" + l)), ms))]); }
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.addScriptTag({ url: "/bridge/bb-office-api.js" });
  await page.waitForTimeout(20000);

  const result = await withTimeout(page.evaluate(async () => {
    const out = {};
    await window.bbOffice.newDocument("writer");

    // modified-state
    const modEvents = [];
    const unsubMod = await window.bbOffice.onModifiedChange((m) => modEvents.push(m));
    await window.bbOffice.dispatch(".uno:StyleApply", [{ name: "Style", value: "Heading 1" }, { name: "FamilyName", value: "ParagraphStyles" }]);
    await new Promise((r) => setTimeout(r, 300));
    out.modEventsAfterStyleChange = modEvents.slice();
    unsubMod();

    // selection change
    const selEvents = [];
    const unsubSel = await window.bbOffice.onSelectionChange((s) => selEvents.push(s));
    const d1 = await window.bbOffice.dispatch(".uno:SelectAll");
    out.selectAllDispatch = d1;
    await new Promise((r) => setTimeout(r, 1000));
    out.selEventsAfterSelectAll = selEvents.slice();
    const d2 = await window.bbOffice.dispatch(".uno:GoToStartOfDoc");
    await new Promise((r) => setTimeout(r, 1000));
    out.selEventsAfterGotoStart = selEvents.slice();
    unsubSel();

    // zoom
    const z1 = await window.bbOffice.setZoom(175);
    out.zoomResult = z1;

    // fresh outline + goToHeading round trip via a real save/reopen isn't
    // needed; use dispatch-built headings directly on THIS doc.
    await window.bbOffice.dispatch(".uno:GoToEndOfDoc");
    await window.bbOffice.dispatch(".uno:InsertPara");
    await window.bbOffice.dispatch(".uno:StyleApply", [{ name: "Style", value: "Heading 2" }, { name: "FamilyName", value: "ParagraphStyles" }]);
    const outline = await window.bbOffice.getOutline();
    out.outline = outline;
    const goto = await window.bbOffice.goToHeading(0);
    out.gotoResult = goto;

    return out;
  }), 25000, "api-e2e-2").catch((e) => ({ timeout: e.message }));

  console.log("RESULT:", JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
