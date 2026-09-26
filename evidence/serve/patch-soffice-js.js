#!/usr/bin/env node
// Beebeeb office — generates the harness's `soffice.js` override (task 1567
// phase 3).
//
// The real, permanent fix belongs at LO-WASM LINK TIME: add
//   --post-js=bridge/register-uno-scripts.js
// (a one-line file: `Module.uno_scripts = Module.uno_scripts || ["/bridge/bb-office-worker.js"];`)
// to the Emscripten link flags in build/wasm.sh's Phase 2 GUI build step, so it
// ships baked into the real artifact's soffice.js with no post-processing step.
// NOT YET APPLIED to a rebuilt artifact this phase (would need another Legion
// rebuild cycle) -- this script reproduces the exact same one-line effect
// against the ALREADY-BUILT Phase 2 artifact instead, so the evidence in this
// phase does not depend on a fresh build.
//
// WHY this line is needed at all: `Module["uno_scripts"]` (a URL list LO's own
// `desktop/source/app/initjsunoscripting.cxx` reads via `importScripts()`
// INSIDE the pthread that runs main()/UNO) must be visible to that PTHREAD's
// own `Module` object at spawn time. Emscripten's generated pthread-worker
// bootstrap only forwards a small fixed set of Module keys (`onExit`,
// `onAbort`, `print`, `printErr`, `wasmMemory`, `wasmModule`, `workerID`) to
// each new Worker -- setting `Module.uno_scripts` on the PAGE alone (e.g. via
// `page.addInitScript` or a `<script>` before the bootstrap) is silently
// ignored inside the pthread (confirmed empirically, 2026-09-27 -- see the
// task file's dated note). Injecting the line into `soffice.js` itself works
// because that exact script re-runs, from scratch, inside EVERY realm the
// bundle is loaded into (the page AND every pthread Worker), so the pthread's
// own copy of `Module` picks it up too.
//
// Usage: node patch-soffice-js.js
// Reads:  ../artifacts/emscripten/soffice.js  (the real Phase 2 artifact, gitignored)
// Writes: ./soffice.js                        (this harness's override, gitignored)
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "artifacts", "emscripten", "soffice.js");
const DEST = path.join(__dirname, "soffice.js");
const BRIDGE_WORKER_URL = "http://127.0.0.1:8743/bridge/bb-office-worker.js";

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`missing ${SRC} -- copy the Phase 2 build artifact there first (see docs/PHASE2-RESULTS.md).`);
    process.exit(1);
  }
  const src = fs.readFileSync(SRC, "utf8");
  const needle = 'var Module=typeof Module!="undefined"?Module:{};';
  const firstIdx = src.indexOf(needle);
  const secondIdx = src.indexOf(needle, firstIdx + 1);
  if (secondIdx === -1) {
    console.error("could not find the expected Module bootstrap line twice in soffice.js -- artifact format may have changed; update this script's `needle`.");
    process.exit(1);
  }
  const insertAt = secondIdx + needle.length;
  const snippet = `Module.uno_scripts=Module.uno_scripts||["${BRIDGE_WORKER_URL}"];`;
  const patched = src.slice(0, insertAt) + snippet + src.slice(insertAt);
  fs.writeFileSync(DEST, patched);
  console.log(`wrote ${DEST} (${patched.length} bytes, +${patched.length - src.length} over the original)`);
}

main();
