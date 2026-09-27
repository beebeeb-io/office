const { chromium } = require("/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/repos/office/evidence/node_modules/playwright");

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout:${label}`)), ms)),
  ]);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const workers = [];
  const names = [];
  page.on("worker", (w) => workers.push(w));
  page.on("console", (msg) => {
    const t = msg.text();
    if (t.startsWith("Thread name:")) names.push(t);
  });

  await page.goto("http://127.0.0.1:8743/qt_soffice.html", { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(20000);

  console.log("=== total workers:", workers.length, "names:", JSON.stringify(names));

  const results = [];
  for (let i = 0; i < workers.length; i++) {
    const w = workers[i];
    const probe = await withTimeout(
      w.evaluate((id) => {
        const out = { id };
        out.hasFS = typeof FS !== "undefined";
        try { out.hasModule = typeof Module !== "undefined"; } catch (e) { out.hasModule = "ERR:" + e.message; }
        try { out.hasUnoInit = typeof Module !== "undefined" && !!Module.uno_init; } catch (e) { out.hasUnoInit = "ERR:" + e.message; }
        try { out.isPthread = typeof ENVIRONMENT_IS_PTHREAD !== "undefined" ? ENVIRONMENT_IS_PTHREAD : "undef"; } catch (e) { out.isPthread = "ERR:" + e.message; }
        try {
          if (out.hasFS) {
            const marker = "marker-from-worker-" + id;
            FS.writeFile("/tmp/w" + id + ".txt", marker);
            out.writeOk = true;
            out.readbackOwn = new TextDecoder().decode(FS.readFile("/tmp/w" + id + ".txt"));
          }
        } catch (e) { out.writeOrReadErr = e && e.toString ? e.toString() : String(e); }
        return out;
      }, i),
      5000,
      "worker" + i
    ).catch((e) => ({ id: i, error: e.message }));
    console.log(`WORKER[${i}] (${w.url().slice(-8)}) probe:`, JSON.stringify(probe));
    results.push(probe);
  }

  // Cross-check: for each worker that successfully wrote its own marker, try to read
  // EVERY other worker's marker file from THIS worker's FS, to find shared visibility.
  console.log("=== cross-visibility matrix ===");
  for (let i = 0; i < workers.length; i++) {
    if (!results[i] || !results[i].hasFS) continue;
    const row = [];
    for (let j = 0; j < workers.length; j++) {
      if (i === j) { row.push("self"); continue; }
      const r = await withTimeout(
        workers[i].evaluate((jid) => {
          try {
            return new TextDecoder().decode(FS.readFile("/tmp/w" + jid + ".txt"));
          } catch (e) {
            return "ERR";
          }
        }, j),
        3000,
        `cross-${i}-${j}`
      ).catch(() => "TIMEOUT");
      row.push(r === `marker-from-worker-${j}` ? "SEE" : (r === "ERR" ? "no" : r));
    }
    console.log(`worker[${i}] sees:`, JSON.stringify(row));
  }

  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
