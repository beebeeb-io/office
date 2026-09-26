// @ts-check
const { test, expect } = require("@playwright/test");

// Task 1567 goal 2 — for each of .docx/.xlsx/.pptx: open, type a marker string, save,
// read the saved bytes back from the Emscripten FS (via the worker thread the UNO
// Embind API actually runs on — static/README.wasm.md's own examples must be entered
// into "the console of the first web worker thread", not the main thread; this file
// uses Playwright's page.on('worker') + worker.evaluate() for the same reason), then
// confirm the round trip by re-opening the saved bytes with the Legion's own native
// `soffice --headless --convert-to txt` (script: ../scripts/verify-roundtrip.sh).
//
// PLACEHOLDER as committed: this file's exact worker-bridge calls and UI coordinates
// were NOT guessed — they are filled in from a live, screenshotted exploration pass
// against the actual built artifact (see the task file's dated notes and
// screenshots/ for that pass). Until that pass has run, this file documents the
// intended shape and is not claimed as passing evidence.

const MARKER = "beebeeb-1567-roundtrip-marker-2026-09-26";

for (const fmt of ["docx", "xlsx", "pptx"]) {
  test.skip(`${fmt}: open, type marker, save, round-trip (pending live calibration)`, async ({ page }) => {
    // 1. await page.goto(`/editor.html?doc=fixtures/sample.${fmt}`);
    // 2. await page.waitForEvent("worker") to get the LOWA worker, confirm
    //    Module.uno_init resolved inside it (worker.evaluate polling a flag our
    //    bridge script sets).
    // 3. Real click-to-focus + page.keyboard.type(MARKER) into the document body.
    // 4. Ctrl+S (or the UNO .uno:Save dispatch via the bridge), handle any
    //    "keep current format" dialog.
    // 5. worker.evaluate() reading Module.FS.readFile(<save path>) back as bytes,
    //    base64-encoded across the CDP boundary, decoded on the Node side.
    // 6. Write the decoded bytes to evidence/artifacts/roundtrip.${fmt} and shell out
    //    to scripts/verify-roundtrip.sh (native soffice --headless --convert-to txt
    //    on the Legion, or a local check) to confirm the marker string is present
    //    and the file is not corrupt.
    expect(true).toBe(true);
  });
}
