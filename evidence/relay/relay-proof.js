#!/usr/bin/env bun
// Beebeeb office: proof for the postMessage relay (bridge/bb-office-relay.js) and the host
// page (bridge/bb-office-host.html), with a STUB engine (stub/), since this harness must run
// without a built engine. The host page, its boot script and the relay are the real files.
//
// Two origins, like the desktop app: the parent on http://127.0.0.1:<P>, the engine page on
// http://localhost:<P+1>. Both answer with COOP same-origin + COEP require-corp; the engine
// also with CORP cross-origin. The test's one change to the host page: it adds the parent's
// origin to `data-parent-origins` (except for `?deny=1`, which keeps the shipped list).
//
// Usage: bun relay/relay-proof.js [port]   (exit 0 only when every check passes)
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { chromium } = require("@playwright/test");

const P = Number(process.argv[2] || 8761);
const parentOrigin = `http://127.0.0.1:${P}`;
const engineOrigin = `http://localhost:${P + 1}`;
const bridge = path.join(__dirname, "..", "..", "bridge");
const here = __dirname;
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};
const types = { ".html": "text/html; charset=utf-8", ".js": "application/javascript" };

function file(p) {
  return new Response(fs.readFileSync(p), { headers: { ...isolation, "Content-Type": types[path.extname(p)] } });
}

Bun.serve({
  port: P,
  hostname: "127.0.0.1",
  fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/parent.html") return file(path.join(here, "parent.html"));
    if (u.pathname === "/parent.js") return file(path.join(here, "parent.js"));
    return new Response("not found", { status: 404 });
  },
});
Bun.serve({
  port: P + 1,
  hostname: "localhost",
  fetch(req) {
    const u = new URL(req.url);
    const engineHeaders = { ...isolation, "Cross-Origin-Resource-Policy": "cross-origin" };
    let body;
    let type = types[".js"];
    if (u.pathname === "/bb-office-host.html") {
      body = fs.readFileSync(path.join(bridge, "bb-office-host.html"), "utf8");
      if (!u.searchParams.get("deny")) body = body.replace('data-parent-origins="', `data-parent-origins="${parentOrigin} `);
      type = types[".html"];
    } else if (["/bb-office-boot.js", "/bb-office-relay.js"].includes(u.pathname)) {
      body = fs.readFileSync(path.join(bridge, u.pathname.slice(1)));
    } else if (["/qtloader.js", "/bb-office-api.js"].includes(u.pathname)) {
      body = fs.readFileSync(path.join(here, "stub", u.pathname.slice(1)));
    } else {
      return new Response("not found", { status: 404 });
    }
    return new Response(body, { headers: { ...engineHeaders, "Content-Type": type } });
  },
});

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

(async () => {
  // BB_CHROMIUM: an installed Chromium to use when the pinned Playwright build is not downloaded.
  const browser = await chromium.launch(process.env.BB_CHROMIUM ? { executablePath: process.env.BB_CHROMIUM } : {});
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${parentOrigin}/parent.html?engine=${encodeURIComponent(engineOrigin)}`);

  // Ready: poll until the stub engine's port is up.
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    ready = await page.evaluate(() => window.relayCall("ready").catch(() => false));
    if (!ready) await page.waitForTimeout(100);
  }
  check("ready answers true once the engine is up", ready === true);
  check("parent window is crossOriginIsolated", await page.evaluate(() => window.crossOriginIsolated));
  const frame = page.frames().find((f) => f.url().startsWith(engineOrigin));
  const iso = await frame.evaluate(() => window.bbOffice._isolation());
  check("engine frame is crossOriginIsolated", iso.crossOriginIsolated === true, JSON.stringify(iso));
  check("engine frame has SharedArrayBuffer", iso.sab === "function");

  // Round trip: open a real .docx, save, compare.
  const docx = fs.readFileSync(path.join(here, "..", "playwright", "fixtures", "sample.docx"));
  const sha = crypto.createHash("sha256").update(docx).digest("hex");
  const out = await page.evaluate(async (arr) => {
    const bytes = new Uint8Array(arr);
    const buf = bytes.buffer;
    const opened = await window.relayCall("open", [buf, "sample.docx"], [buf]);
    const detached = buf.byteLength === 0;
    const saved = await window.relayCall("save");
    const isBuffer = saved instanceof ArrayBuffer;
    const digest = await crypto.subtle.digest("SHA-256", saved);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return { opened, detached, isBuffer, length: saved.byteLength, hex };
  }, [...docx]);
  check("open answers the stub's ext", out.opened && out.opened.ext === "docx", JSON.stringify(out.opened));
  check("open transferred the ArrayBuffer (sender's copy detached)", out.detached);
  check("save returns an ArrayBuffer", out.isBuffer);
  check(`save returns the same ${docx.length} bytes`, out.length === docx.length && out.hex === sha, `${out.length} bytes, sha256 ${out.hex.slice(0, 12)}`);

  // A subscription delivers its event.
  await page.evaluate(() => window.relayCall("onModifiedChange", ["sub-1"]));
  await page.waitForTimeout(200);
  const events = await page.evaluate(() => window.relayEvents.filter((e) => e.event === "sub-1").map((e) => e.payload));
  check("onModifiedChange delivered 1 event (true)", events.length === 1 && events[0] === true, JSON.stringify(events));

  // Unknown methods are refused with an error, not run.
  const unknown = await page.evaluate(() => window.relayCall("constructor").then(() => "ran", (e) => e.message));
  check("an unknown method is refused", unknown.startsWith("unknown method"), unknown);

  // A parent whose origin is not in the list gets no answer at all, and the relay counts it.
  const denied = await browser.newPage();
  await denied.goto(`${parentOrigin}/parent.html?deny=1&engine=${encodeURIComponent(engineOrigin)}`);
  await denied.waitForTimeout(600);
  const deniedAnswer = await denied.evaluate(() => window.relayCall("ready", [], [], 800).then((v) => `answered ${v}`, (e) => e.message));
  const deniedFrame = denied.frames().find((f) => f.url().startsWith(engineOrigin));
  const refused = await deniedFrame.evaluate(() => window.bbOfficeRelay.refused());
  check("a parent on an unlisted origin gets no answer", deniedAnswer === "timeout", deniedAnswer);
  check("the relay counted 1 refused message", refused === 1, `refused=${refused}`);

  check("0 page errors", errors.length === 0, errors.join("; "));
  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`relay-proof: ${passed} of ${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
