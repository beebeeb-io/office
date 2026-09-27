# Task 1567 phases 2+3 — evidence directory

See `../docs/PHASE2-RESULTS.md` and `../docs/EGRESS.md`'s 2026-09-27 section for the
full write-up (go/no-go, numbers, what's proven, what's open). This directory:

- `serve/` — local COOP/COEP + CSP static server (`server.js`) and the sandboxed
  iframe host page (`host.html`) used by `playwright/egress.spec.js`. `server.js`
  serves `/bridge/*` directly from the repo-root `../bridge/` (canonical source, no
  copy). `patch-soffice-js.js` generates the gitignored `soffice.js` override that
  makes the real built artifact load `bridge/bb-office-worker.js` — see that script's
  own header comment for why this is needed and what the real (not-yet-applied)
  build-time fix is. `qt_soffice.html` is a small override (adds one `<script>` tag
  for `bridge/bb-office-api.js`) of the real artifact's own file.
- `playwright/` — the committed, passing test suite: `editing.spec.js` (real
  interactive editing, Writer/Calc/Impress) and `egress.spec.js` (zero-egress gate,
  including image-insert + hyperlink-click steps, with a red-proof mode via
  `BB_EGRESS_INJECT_FETCH=1`).
- `scripts/verify-roundtrip.py` — independent (no LibreOffice) marker-string checker
  for a saved `.docx`/`.xlsx`/`.pptx`, via python-docx/openpyxl/python-pptx.
- `roundtrip-docx.js`, `roundtrip-xlsx.js`, `roundtrip-pptx.js` — phase 3: open a real
  fixture via `bbOffice.open()`, type a unique marker via real Playwright keyboard
  events, `bbOffice.save()`, write the bytes to `artifacts/roundtrip/`, reopen them in
  the same browser session. Pair with `scripts/verify-roundtrip.py` for the
  independent check.
- `legacy-test.js` — phase 3: open `.doc`/`.xls`/`.ppt` (read), save as the modern
  equivalent, per task 1567 goal 3's own allowance.
- `image-hyperlink.js` — phase 3: insert a real image from bytes
  (`GraphicProvider`/`TextGraphicObject`, no `file://`) and a real hyperlink
  (`HyperLinkURL` character property) into an open document.
- `probe-fs-mismatch.js` — phase 3: the from-scratch evidence for the
  MEMFS/UCB-thread-pool mismatch that blocked phase 2's file-I/O open item (see
  `docs/EGRESS.md`'s 2026-09-27 section).
- `measure-perf.js` — phase 3: cold/warm time-to-interactive, peak JS heap, and
  Chromium process RSS (numbers in `docs/EGRESS.md`).
- `artifacts/MANIFEST.sha256` — sha256 + sizes for the built WASM bundle (the bundle
  itself is gitignored; re-download from the Legion or rebuild with `build/wasm.sh`).
- `logs/` — gzipped real build logs from the Legion (`build-gui*.log.gz`,
  `qt5-*.log.gz`, `autogen-gui.log.gz`).
- `screenshots/` — every screenshot referenced in `docs/PHASE2-RESULTS.md`.
- `explore*.js`, `debug-*.js`, `roundtrip.js` — one-off investigation scripts (not a
  test suite) that trace the "external file open/save" open item's 6 real attempts;
  kept for reproducibility of that investigation, not meant to be run as CI.

## Running the proof yourself

```sh
# 1. Get the artifact onto this Mac (see docs/PHASE2-RESULTS.md for sha256), then:
bun run serve/server.js /path/to/emscripten 8743 &

# 2. Playwright tests
bun install
bunx playwright install chromium
npx playwright test playwright/editing.spec.js --reporter=list
npx playwright test playwright/egress.spec.js --reporter=list                 # GREEN
BB_SERVE_NO_CSP=1 BB_EGRESS_INJECT_FETCH=1 npx playwright test playwright/egress.spec.js --reporter=list  # RED-PROOF (also restart the server with BB_SERVE_NO_CSP=1)
```
