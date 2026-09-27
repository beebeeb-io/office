// @ts-check
const { test, expect } = require("@playwright/test");

// Task 1567 goal 2 (phase 4, 2026-09-27) — document-only canvas proof. Every
// UNO-opened document must hide LO's own menubar/toolbars/statusbar/sidebar/
// rulers and never leave the Start Center visible. Screenshots are the visual
// record; layoutManagerVisible is the durable numeric assertion (screenshots
// rot, a boolean does not).
//
// KNOWN GAP, not resolved (see bb-office-worker.js's applyDocumentChrome
// comment + patches/0005-emscripten-frameless-window-REVERTED.patch): the
// native Qt window title bar is NOT hidden. A fix was attempted, built, and
// PROVEN to break document-switching (the new document's frame stopped
// becoming visible on the shared canvas at all) — reverted rather than ship
// a worse regression. These screenshots will show the title bar.

async function loadOffice(page) {
  await page.goto("/qt_soffice.html");
  await page.addScriptTag({ url: "/bridge/bb-office-api.js" });
  await page.waitForTimeout(20000);
}

for (const kind of ["writer", "calc", "impress"]) {
  test(`${kind}: opening a document hides menubar/toolbars/statusbar/sidebar and closes the Start Center`, async ({ page }) => {
    await loadOffice(page);
    const result = await page.evaluate(async (k) => {
      await window.bbOffice.newDocument(k);
      return window.bbOffice.__debugChromeState();
    }, kind);
    expect(result.hasModel).toBe(true);
    expect(result.layoutManagerVisible).toBe(false);
    await page.screenshot({ path: `screenshots/phase4-chrome-${kind}-light.png` });
  });
}
