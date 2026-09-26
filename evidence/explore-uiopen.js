const { chromium } = require("@playwright/test");
const fs = require("fs");

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout:${label}`)), ms)),
  ]);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let mainWorker = null;
  page.on("worker", (w) => {
    if (!mainWorker) mainWorker = w;
  });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));

  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(20000);

  const srcBytes = fs.readFileSync(
    "/Users/guuslangelaar/code/bb-worktrees/mobile-1565/e2e/fixtures/preview-matrix/office/sample.docx"
  );
  const srcB64 = srcBytes.toString("base64");
  await withTimeout(
    mainWorker.evaluate(({ srcB64 }) => {
      const bin = atob(srcB64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      FS.writeFile("/home/web_user/sample.docx", bytes);
      return FS.readFile("/home/web_user/sample.docx").length;
    }, { srcB64 }),
    5000,
    "write"
  );
  console.log("fixture written to /home/web_user/sample.docx");

  console.log("clicking Open File...");
  await page.mouse.click(95, 51);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "screenshots/uiopen-01-dialog.png" });

  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
