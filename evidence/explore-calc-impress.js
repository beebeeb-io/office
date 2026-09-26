const { chromium } = require("@playwright/test");

const MARKER = "beebeeb-1567-roundtrip-marker-2026-09-26";

(async () => {
  const browser = await chromium.launch({ headless: true });

  // Calc
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(20000);
    await page.mouse.click(130, 371); // Calc Spreadsheet
    await page.waitForTimeout(15000);
    await page.mouse.click(400, 300);
    await page.waitForTimeout(500);
    await page.keyboard.type(MARKER, { delay: 30 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "screenshots/calc-typed.png" });
    await page.close();
    console.log("calc done");
  }

  // Impress
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(20000);
    await page.mouse.click(148, 418); // Impress Presentation
    await page.waitForTimeout(15000);
    await page.screenshot({ path: "screenshots/impress-01-afteropen.png" });
    // Impress may show a template picker; try Escape then click into the slide area
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);
    await page.screenshot({ path: "screenshots/impress-02-afteresc.png" });
    await page.close();
    console.log("impress done");
  }

  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
