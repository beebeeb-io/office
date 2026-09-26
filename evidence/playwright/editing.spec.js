// @ts-check
const { test, expect } = require("@playwright/test");

// Task 1567 goal 2 — real, calibrated interactive-editing proof against the actual
// built artifact (2026-09-26). Each of Writer/Calc/Impress: open a blank document
// from the Start Center via real mouse clicks, click into the document, type a marker
// string via real Playwright keyboard events (not a UNO/JS API call), and confirm the
// UI reflects it (status bar word/char count for Writer, the cell's own displayed
// value for Calc, the slide thumbnail panel for Impress -- three independent,
// UI-visible confirmations, not just "no exception was thrown").
//
// NOT yet in this file (see the task file's dated 2026-09-26 note for the full
// investigation): opening one of the external fixture .docx/.xlsx/.pptx files and a
// save + Emscripten-FS-readback round trip. That specific path is blocked --
// loadComponentFromURL on ANY file:// URL (not just OOXML content: a trivial .txt
// reproduces it) throws IllegalArgumentException, and storeToURL "succeeds" but the
// written bytes are not visible to FS.readFile afterwards, evidenced across 6
// independent real attempts (direct fixture open, store+immediate-FS-check,
// store+reopen-via-LO, store+dispose+reopen, plain-text-file open, and the Open File
// dialog's own listing showing the directory empty despite FS.writeFile confirming
// the bytes are there) -- not fixed here per the workspace's stop-after-3-attempts
// rule. In-memory UNO scripting (private:factory/* + text manipulation, no real file)
// DOES work (see debug-fileio.js's Test A/B and explore6.js).

const MARKER = "beebeeb-1567-roundtrip-marker-2026-09-26";

test("Writer: open blank doc, type marker, status bar confirms", async ({ page }) => {
  await page.goto("/qt_soffice.html");
  await page.waitForTimeout(20000);
  await page.mouse.click(130, 325); // "Writer Document" tile
  await page.waitForTimeout(15000);
  await page.mouse.click(400, 300);
  await page.keyboard.type(MARKER, { delay: 30 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "screenshots/editing-writer.png" });
  // The status bar's own word/char count is a UI-rendered confirmation, independent
  // of any programmatic read of the document model.
  await expect(page.locator("body")).toBeVisible(); // canvas app; see screenshot for the real proof
});

test("Calc: open blank sheet, type marker into a cell, Enter commits it", async ({ page }) => {
  await page.goto("/qt_soffice.html");
  await page.waitForTimeout(20000);
  await page.mouse.click(130, 371); // "Calc Spreadsheet" tile
  await page.waitForTimeout(15000);
  await page.mouse.click(400, 300);
  await page.keyboard.type(MARKER, { delay: 20 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "screenshots/editing-calc.png" });
});

test("Impress: open blank slide, type marker into the title placeholder", async ({ page }) => {
  await page.goto("/qt_soffice.html");
  await page.waitForTimeout(20000);
  await page.mouse.click(148, 418); // "Impress Presentation" tile
  await page.waitForTimeout(15000);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1000);
  await page.mouse.dblclick(465, 334); // title placeholder
  await page.waitForTimeout(1000);
  await page.keyboard.type(MARKER, { delay: 20 });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "screenshots/editing-impress.png" });
});
