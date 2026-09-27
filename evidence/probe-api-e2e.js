// End-to-end probe of the real page API (window.bbOffice), phase 4 additions.
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
    out.newDocOk = true;

    // dispatch + onState assert-both-ways
    const boldEvents = [];
    const unsub = await window.bbOffice.onState(".uno:Bold", (s) => boldEvents.push(s));
    out.eventsAfterSubscribe = boldEvents.slice();
    const d1 = await window.bbOffice.dispatch(".uno:Bold");
    out.dispatchResult = d1;
    await new Promise((r) => setTimeout(r, 300));
    out.eventsAfterDispatch1 = boldEvents.slice();
    await window.bbOffice.dispatch(".uno:Bold");
    await new Promise((r) => setTimeout(r, 300));
    out.eventsAfterDispatch2 = boldEvents.slice();
    unsub();

    // outline
    // Build some headings via dispatch-free direct typing is complex; instead
    // exercise via a template-less newDocument + our own heading dispatch:
    // set paragraph style via dispatch(".uno:StyleApply", [{name:"Style", value:"Heading 1"}])
    await window.bbOffice.dispatch(".uno:StyleApply", [{ name: "Style", value: "Heading 1" }, { name: "FamilyName", value: "ParagraphStyles" }]);
    out.outlineBeforeType = await window.bbOffice.getOutline();

    return out;
  }), 20000, "api-e2e").catch((e) => ({ timeout: e.message }));

  console.log("RESULT:", JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
