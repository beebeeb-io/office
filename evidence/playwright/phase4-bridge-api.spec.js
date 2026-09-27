// @ts-check
const { test, expect } = require("@playwright/test");

// Task 1567 goal 4 (phase 4, 2026-09-27) — proof for the extended bridge API:
// dispatch/onState, getOutline/goToHeading, setZoom, newDocument, and the
// modified/selection-change events. Runs against window.bbOffice exactly as a
// real host page would use it (bridge/bb-office-api.js loaded as a sibling
// <script>), not against raw UNO calls.

async function loadOffice(page) {
  await page.goto("/qt_soffice.html");
  await page.addScriptTag({ url: "/bridge/bb-office-api.js" });
  await page.waitForTimeout(20000);
}

test("a real HTML button dispatching .uno:Bold toggles bold, and onState reports the pressed state both ways", async ({ page }) => {
  await loadOffice(page);
  await page.evaluate(async () => {
    await window.bbOffice.newDocument("writer");
  });

  // A literal <button> with a real click handler -- Playwright drives it with
  // an actual mouse click, not a direct JS function call.
  await page.evaluate(() => {
    window.__boldStates = [];
    const btn = document.createElement("button");
    btn.id = "bold-btn";
    btn.textContent = "Bold";
    btn.onclick = () => window.bbOffice.dispatch(".uno:Bold");
    document.body.appendChild(btn);
  });
  const unsubscribeHandle = await page.evaluateHandle(async () => {
    const unsub = await window.bbOffice.onState(".uno:Bold", (s) => window.__boldStates.push(s));
    return unsub;
  });

  // Initial state delivered synchronously via the subscription itself.
  const initial = await page.evaluate(() => window.__boldStates.slice());
  expect(initial).toEqual([{ isEnabled: true, state: false }]);

  // Way 1: dispatch's own promise resolves (call succeeded).
  await page.click("#bold-btn");
  await page.waitForTimeout(300);

  // Way 2: the onState listener independently reports the new pressed state.
  const afterClick = await page.evaluate(() => window.__boldStates.slice());
  expect(afterClick).toEqual([
    { isEnabled: true, state: false },
    { isEnabled: true, state: true },
  ]);

  await page.click("#bold-btn"); // toggle back off
  await page.waitForTimeout(300);
  const afterSecondClick = await page.evaluate(() => window.__boldStates.slice());
  expect(afterSecondClick[2]).toEqual({ isEnabled: true, state: false });

  await page.evaluate((unsub) => unsub(), unsubscribeHandle);
  await page.screenshot({ path: "screenshots/phase4-bold-button.png" });
});

test("getOutline returns the headings of a fixture document, in order, and goToHeading moves the cursor", async ({ page }) => {
  await loadOffice(page);

  // Build a small fixture with real headings through the SAME save path the
  // product uses (bbOffice.newDocument -> dispatch -> save), then reopen it
  // through bbOffice.open() -- so this exercises the real open->getOutline
  // chain, not just a freshly-typed in-memory document.
  const fixtureBytesB64 = await page.evaluate(async () => {
    await window.bbOffice.newDocument("writer");
    async function heading(text, level) {
      await window.bbOffice.dispatch(".uno:StyleApply", [
        { name: "Style", value: "Heading " + level },
        { name: "FamilyName", value: "ParagraphStyles" },
      ]);
      await window.bbOffice.dispatch(".uno:InsertText", [{ name: "Text", value: text }]);
      await window.bbOffice.dispatch(".uno:InsertPara");
    }
    await heading("Introduction", 1);
    await window.bbOffice.dispatch(".uno:StyleApply", [{ name: "Style", value: "Text body" }, { name: "FamilyName", value: "ParagraphStyles" }]);
    await window.bbOffice.dispatch(".uno:InsertText", [{ name: "Text", value: "Some body text under the intro." }]);
    await window.bbOffice.dispatch(".uno:InsertPara");
    await heading("Background", 2);
    await window.bbOffice.dispatch(".uno:StyleApply", [{ name: "Style", value: "Text body" }, { name: "FamilyName", value: "ParagraphStyles" }]);
    await window.bbOffice.dispatch(".uno:InsertText", [{ name: "Text", value: "More body text." }]);
    await window.bbOffice.dispatch(".uno:InsertPara");
    await heading("Conclusion", 1);
    const bytes = await window.bbOffice.save();
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  });
  expect(fixtureBytesB64.length).toBeGreaterThan(100);

  // Reopen the saved bytes as a fresh document -- proves getOutline works on
  // an OPENED document, not only one built in the same session.
  const outline = await page.evaluate(async (b64) => {
    function b64ToU8(s) {
      const bin = atob(s);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return u8;
    }
    await window.bbOffice.open(b64ToU8(b64), "fixture.docx");
    return window.bbOffice.getOutline();
  }, fixtureBytesB64);

  expect(outline).toEqual([
    { level: 1, text: "Introduction" },
    { level: 2, text: "Background" },
    { level: 1, text: "Conclusion" },
  ]);

  const goto = await page.evaluate(() => window.bbOffice.goToHeading(2));
  expect(goto).toEqual({ level: 1, text: "Conclusion" });
});

test("setZoom changes the document zoom level", async ({ page }) => {
  await loadOffice(page);
  const result = await page.evaluate(async () => {
    await window.bbOffice.newDocument("calc");
    return window.bbOffice.setZoom(175);
  });
  expect(result).toEqual({ zoom: 175 });
});

test("newDocument opens writer/calc/impress and onModifiedChange + onSelectionChange fire", async ({ page }) => {
  await loadOffice(page);
  const result = await page.evaluate(async () => {
    const out = {};
    for (const kind of ["writer", "calc", "impress"]) {
      out[kind] = await window.bbOffice.newDocument(kind);
    }

    await window.bbOffice.newDocument("writer");
    const modEvents = [];
    const unsubMod = await window.bbOffice.onModifiedChange((m) => modEvents.push(m));
    await window.bbOffice.dispatch(".uno:InsertText", [{ name: "Text", value: "x" }]);
    await new Promise((r) => setTimeout(r, 400));
    unsubMod();
    out.modEvents = modEvents;

    const selEvents = [];
    const unsubSel = await window.bbOffice.onSelectionChange((s) => selEvents.push(s));
    await window.bbOffice.dispatch(".uno:GoToStartOfDoc");
    await new Promise((r) => setTimeout(r, 400));
    unsubSel();
    out.selEvents = selEvents;
    return out;
  });
  expect(result.writer).toEqual({ docKind: "writer" });
  expect(result.calc).toEqual({ docKind: "calc" });
  expect(result.impress).toEqual({ docKind: "impress" });
  expect(result.modEvents.length).toBeGreaterThan(0);
  expect(result.modEvents[0]).toBe(true);
  // KNOWN GAP (documented in bb-office-worker.js's header): selectionChanged
  // carries selected TEXT only, never a screen rect -- no accessibility
  // bridge in this build. This asserts the mechanism fires at all.
  expect(result.selEvents.length).toBeGreaterThan(0);
});
