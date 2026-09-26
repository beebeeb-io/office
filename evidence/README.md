# Task 1567 phase 2 — evidence directory

See `../docs/PHASE2-RESULTS.md` for the full write-up (go/no-go, numbers, what's proven,
what's open). This directory:

- `serve/` — local COOP/COEP + CSP static server (`server.js`) and the sandboxed
  iframe host page (`host.html`) used by `playwright/egress.spec.js`.
- `playwright/` — the committed, passing test suite: `editing.spec.js` (real
  interactive editing, Writer/Calc/Impress) and `egress.spec.js` (zero-egress gate,
  with a red-proof mode via `BB_EGRESS_INJECT_FETCH=1`).
- `scripts/verify-roundtrip.py` — independent (no LibreOffice) marker-string checker
  for a saved `.docx`/`.xlsx`/`.pptx`, via python-docx/openpyxl/python-pptx.
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
