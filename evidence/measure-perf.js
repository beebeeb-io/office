const { chromium } = require("/Users/guuslangelaar/Development/Beebeeb/beebeeb.io/repos/office/evidence/node_modules/playwright");
const { execSync } = require("child_process");

function rssForPidTree(pid) {
  try {
    // Sum RSS (KB) for the given pid and its descendants (macOS ps).
    const out = execSync(`ps -A -o pid,ppid,rss`).toString();
    const lines = out.trim().split("\n").slice(1);
    const rows = lines.map((l) => l.trim().split(/\s+/).map(Number));
    const children = {};
    for (const [p, ppid, rss] of rows) {
      children[ppid] = children[ppid] || [];
      children[ppid].push([p, rss]);
    }
    let total = 0;
    const stack = [pid];
    const rssByPid = Object.fromEntries(rows.map(([p, , rss]) => [p, rss]));
    const visited = new Set();
    while (stack.length) {
      const p = stack.pop();
      if (visited.has(p)) continue;
      visited.add(p);
      total += rssByPid[p] || 0;
      for (const [cp] of children[p] || []) stack.push(cp);
    }
    return total; // KB
  } catch (e) {
    return -1;
  }
}

async function measureOnce(label, userDataDir) {
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    viewport: { width: 1280, height: 900 },
  });
  // Find this session's real Chromium process via its unique profile dir in
  // the command line (launchPersistentContext doesn't expose .process()).
  let browserPid = -1;
  try {
    const psOut = execSync(`ps -Ao pid,command`).toString();
    const line = psOut.split("\n").find((l) => l.includes(userDataDir) && l.includes("--type=") === false);
    if (line) browserPid = parseInt(line.trim().split(/\s+/)[0], 10);
  } catch (e) {}
  const page = context.pages()[0] || (await context.newPage());
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");

  const t0 = Date.now();
  let mainWorker = null;
  page.on("worker", (w) => { if (!mainWorker) mainWorker = w; });

  await page.goto("http://127.0.0.1:8743/qt_soffice.html", {
    waitUntil: "load",
    timeout: 60000,
  });
  const tLoad = Date.now();

  for (let i = 0; i < 100 && !mainWorker; i++) await page.waitForTimeout(50);

  // "Interactive" = Module.uno_init resolves on the pthread (UNO ready) AND the
  // Start Center canvas is visually painted (approximated by a fixed settle
  // wait, consistent with editing.spec.js's own calibration).
  await mainWorker.evaluate(() => Module.uno_init).catch(() => {});
  const tUnoInit = Date.now();

  await page.waitForTimeout(2000); // let the canvas finish painting
  const tSettled = Date.now();

  let peakHeap = 0;
  for (let i = 0; i < 5; i++) {
    const metrics = await cdp.send("Performance.getMetrics");
    const heap = metrics.metrics.find((m) => m.name === "JSHeapUsedSize");
    if (heap && heap.value > peakHeap) peakHeap = heap.value;
    await page.waitForTimeout(300);
  }

  const rssKB = rssForPidTree(browserPid);

  console.log(`[${label}] nav-to-load: ${tLoad - t0}ms, load-to-uno_init: ${tUnoInit - tLoad}ms, total-to-interactive(+settle): ${tSettled - t0}ms`);
  console.log(`[${label}] peak JS heap (this page/context, sampled 5x): ${(peakHeap / 1024 / 1024).toFixed(1)} MB`);
  console.log(`[${label}] chromium process-tree RSS at settle: ${(rssKB / 1024).toFixed(1)} MB`);

  await context.close();
}

(async () => {
  const fs = require("fs");
  const dir = "/private/tmp/claude-501/-Users-guuslangelaar-Development-Beebeeb-beebeeb-io/cc7eef98-55fc-4493-9ff2-638c99aac79f/scratchpad/chrome-profile";
  fs.rmSync(dir, { recursive: true, force: true }); // ensure truly cold for run 1
  await measureOnce("cold (fresh profile dir)", dir);
  await measureOnce("warm (same profile dir, 2nd launch)", dir);
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
