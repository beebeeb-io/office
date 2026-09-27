// Real round-trip proof (task 1567 goal 2): for each of docx/xlsx/pptx, write the
// fixture into the Emscripten virtual FS, open it via the UNO API (the same worker
// thread the app's own event loop and canvas rendering run on -- confirmed reachable
// via Playwright's page.on('worker'), see explore4-6.js), insert a marker string,
// save, read the bytes back out of the virtual FS, and verify on the Node side with
// scripts/verify-roundtrip.py (python-docx/openpyxl/python-pptx -- independent of LO
// itself, per the brief's named alternative to a native `soffice`).
const { chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const MARKER = "beebeeb-1567-roundtrip-marker-2026-09-26";
const FIXTURE_DIR = "/Users/guuslangelaar/code/bb-worktrees/mobile-1565/e2e/fixtures/preview-matrix/office";
const OUT_DIR = path.join(__dirname, "artifacts", "roundtrip");
const VERIFY_PY = "/home/guus/bb-office/venv/bin/python3"; // run remotely via ssh, or locally if venv mirrored
fs.mkdirSync(OUT_DIR, { recursive: true });

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout:${label}`)), ms)),
  ]);
}

const FORMATS = [
  {
    ext: "docx",
    insert: `
      const xTextDocument = css.text.XTextDocument.query(xModel);
      const xText = xTextDocument.getText();
      const xCursor = xText.createTextCursorByRange(xText.getEnd());
      xText.insertString(xCursor, "\\n" + MARKER, false);
    `,
  },
  {
    ext: "xlsx",
    insert: `
      const xSheetDoc = css.sheet.XSpreadsheetDocument.query(xModel);
      const xSheets = xSheetDoc.getSheets();
      const xIndexed = css.container.XIndexAccess.query(xSheets);
      const xSheet = css.sheet.XSpreadsheet.query(xIndexed.getByIndex(0));
      const xCell = xSheet.getCellByPosition(0, 5); // A6, below the fixture's 3 data rows
      xCell.setString(MARKER);
    `,
  },
  {
    ext: "pptx",
    insert: `
      const xPagesSupplier = css.drawing.XDrawPagesSupplier.query(xModel);
      const xPages = xPagesSupplier.getDrawPages();
      const xIndexed = css.container.XIndexAccess.query(xPages);
      const xPage = css.drawing.XDrawPage.query(xIndexed.getByIndex(0));
      const xPageIndexed = css.container.XIndexAccess.query(xPage);
      const xShape = css.drawing.XShape.query(xPageIndexed.getByIndex(0));
      const xShapeText = css.text.XText.query(xShape);
      const xCursor = xShapeText.createTextCursorByRange(xShapeText.getEnd());
      xShapeText.insertString(xCursor, "\\n" + MARKER, false);
    `,
  },
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const { ext, insert } of FORMATS) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    let mainWorker = null;
    page.on("worker", (w) => {
      if (!mainWorker) mainWorker = w;
    });
    page.on("pageerror", (err) => console.log(`[${ext}] [pageerror]`, err.message));

    console.log(`[${ext}] loading app...`);
    await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(20000);

    const srcBytes = fs.readFileSync(path.join(FIXTURE_DIR, `sample.${ext}`));
    const srcB64 = srcBytes.toString("base64");
    const vfsIn = `/tmp/in.${ext}`;
    const vfsOut = `/tmp/in.${ext}`; // store() overwrites the same path/format

    console.log(`[${ext}] writing fixture into virtual FS (${srcBytes.length} bytes)...`);
    await withTimeout(
      mainWorker.evaluate(
        ({ vfsIn, srcB64 }) => {
          const bin = atob(srcB64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          try {
            FS.mkdir("/tmp");
          } catch (e) {
            /* already exists */
          }
          FS.writeFile(vfsIn, bytes);
          return FS.readFile(vfsIn).length;
        },
        { vfsIn, srcB64 }
      ),
      10000,
      "writeFixture"
    );

    console.log(`[${ext}] opening via UNO loadComponentFromURL...`);
    const openResult = await withTimeout(
      mainWorker.evaluate(
        ({ vfsIn, MARKER, insertCode }) => {
          return Module.uno_init
            .then(function () {
              const css = Module.uno.com.sun.star;
              const desktop = css.frame.Desktop.create(Module.getUnoComponentContext());
              const args = new Module.uno_Sequence_com$sun$star$beans$PropertyValue(0, Module.uno_Sequence.FromSize);
              const xModel = css.frame.XComponentLoader.query(desktop).loadComponentFromURL(
                "file://" + vfsIn,
                "_blank",
                0,
                args
              );
              args.delete();
              if (xModel === null) return "OPEN_FAILED: null model";
              // eslint-disable-next-line no-eval
              eval(insertCode);
              const xModifiable = css.util.XModifiable.query(xModel);
              const xStorable = css.frame.XStorable.query(xModel);
              xStorable.store();
              return "OPEN_INSERT_SAVE_OK modified=" + (xModifiable ? xModifiable.isModified() : "?");
            })
            .catch(function (e) {
              return "UNO_ERR: " + (e && e.toString ? e.toString() : JSON.stringify(e));
            });
        },
        { vfsIn, MARKER, insertCode: insert.replace(/MARKER/g, JSON.stringify(MARKER)) }
      ),
      20000,
      "openInsertSave"
    ).catch((e) => "TIMEOUT: " + e.message);
    console.log(`[${ext}] result:`, openResult);

    await page.screenshot({ path: path.join(__dirname, "screenshots", `roundtrip-${ext}.png`) });

    console.log(`[${ext}] reading saved bytes back from virtual FS...`);
    const outB64 = await withTimeout(
      mainWorker.evaluate((vfsOut) => {
        const bytes = FS.readFile(vfsOut);
        let bin = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(bin);
      }, vfsOut),
      10000,
      "readBack"
    ).catch((e) => null);

    let verifyResult = "SKIPPED (no bytes read back)";
    if (outB64) {
      const outPath = path.join(OUT_DIR, `roundtrip.${ext}`);
      fs.writeFileSync(outPath, Buffer.from(outB64, "base64"));
      console.log(`[${ext}] wrote ${outPath} (${fs.statSync(outPath).size} bytes)`);
      try {
        verifyResult = execFileSync(path.join(__dirname, ".venv", "bin", "python3"), [path.join(__dirname, "scripts", "verify-roundtrip.py"), outPath, MARKER])
          .toString()
          .trim();
      } catch (e) {
        verifyResult = "VERIFY_FAILED: " + (e.stdout ? e.stdout.toString() : e.message);
      }
    }
    console.log(`[${ext}] verify:`, verifyResult);

    results.push({ ext, openResult, verifyResult, savedBytes: outB64 ? Buffer.from(outB64, "base64").length : 0 });
    await page.close();
  }

  await browser.close();
  console.log("=== SUMMARY ===");
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
