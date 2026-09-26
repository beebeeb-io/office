# office

Beebeeb's own fork-and-build of LibreOffice core to WebAssembly, for zero-knowledge,
client-side editing of `.docx`/`.xlsx`/`.pptx` files in the browser (and later, Tauri
desktop). No plaintext document bytes and no editing session ever reach a Beebeeb
server or any third party — see [`docs/EGRESS.md`](docs/EGRESS.md) for exactly which
native network paths are removed and how that is enforced at build time.

**Why a fork, not the ZetaOffice CDN/SDK:** per decision
[1566](../../.claude/tasks/verified/1566-office-editing-options.md) — Guus, 2026-09-26:
*"i prefer to fork the actual code and always be sure no data goes external... we need
to be 100% sure it doesn't go out the door."* We build LibreOffice core to WASM
ourselves, from a pinned upstream commit, and self-host every asset. We do not pull
allotropia's ZetaOffice binaries or CDN at runtime; their build scripts and upstream's
own `static/README.wasm.md` are read as reference only (`docs/PHASE1-FEASIBILITY.md`
cites both).

## Status: Phase 3 (task 1567) — interactive editor + open/save byte API proven

Not shippable yet (licensing decision below still open; no beebeeb-core wiring; the
build's `--post-js` line documented in `evidence/serve/patch-soffice-js.js` is not yet
baked into a fresh artifact). But the core technical question is answered:

- **Phase 1** (`docs/PHASE1-FEASIBILITY.md`): can LO-core build to WASM at all? Partial
  go on macOS (`configure` yes, `make` no — 3 macOS-host-specific bugs).
- **Phase 2** (`docs/PHASE2-RESULTS.md`): the full interactive Qt/GUI build succeeds on
  a Linux host (the Legion), real keyboard/mouse editing proven in Writer/Calc/Impress,
  egress gate green. Open item: getting external bytes in/out (`file://` didn't work).
- **Phase 3** (this status, `docs/EGRESS.md`'s 2026-09-27 section): the file-I/O open
  item is closed — UNO's own `SequenceInputStream`/`SequenceOutputStream` API moves
  bytes in/out entirely in-memory, no `file://`, no MEMFS. A minimal page API
  (`bridge/bb-office-api.js` → `bbOffice.open(bytes, filename)` / `bbOffice.save()`)
  is built and proven end-to-end for `.docx`/`.xlsx`/`.pptx` (real Playwright keyboard
  typing, independent python-docx/openpyxl/python-pptx verification) and read-then-
  save-as-modern for legacy `.doc`/`.xls`/`.ppt`. Image insert from bytes and the
  hyperlink-safety mechanism are both proven with 0 egress; `crates/office-bridge` now
  has a real (not sketch) `DocumentHandle::open`/`.save()` shape with unit tests.

See the task file (`.claude/tasks/*/1567-*.md` in the workspace root repo) for the full
dated history and numbers.

## Layout

```
build/
  wasm.sh          — the scripted build recipe (emsdk install → clone/patch → configure → make)
  PINNED_COMMIT    — the exact LibreOffice/core commit this build targets, and why
  PROGRESS.md      — dated, attempt-by-attempt build log (what worked, what didn't, why)
  autogen.input    — the working (tested) configure recipe for the headless module build
  core/            — gitignored: the LibreOffice source checkout (fetched + patched by
                     wasm.sh, NOT vendored into this repo — see PINNED_COMMIT)
  emsdk/           — gitignored: the Emscripten SDK checkout
docs/
  EGRESS.md              — every native network path found (14), file:line, how it's disabled
  PHASE1-FEASIBILITY.md  — the go/no-go report for this spike
patches/
  0001-*.patch     — our fork's actual source changes to LibreOffice core, applied by
                     `build/wasm.sh clone` — the real, tracked fork content (build/core/
                     itself is gitignored, so patches/ is where our changes live in git)
crates/
  office-bridge/   — Rust glue crate: `DocumentHandle::open`/`.save()` wraps
                     `window.bbOffice.*` (wasm-bindgen + wasm-bindgen-futures); pure
                     logic (`DocumentFormat`, `fits_memory_budget`) is unit-tested
                     natively — see its lib.rs doc comment for the byte-handling
                     contract with beebeeb-core. Not wired into the web workspace build
                     yet.
bridge/
  bb-office-worker.js  — runs INSIDE the pthread that owns UNO (loaded via LO's own
                         "LOWA channel" `Module.uno_scripts` mechanism); does the
                         actual open/save/insertImage/insertHyperlink UNO calls
  bb-office-api.js     — page-side `window.bbOffice.open/save/...` API, talks to the
                         worker over `Module.uno_main`'s MessagePort
                         (see bb-office-worker.js's header comment for the full
                         mechanism and why file://+MEMFS does not work here)
```

## Licensing (open item, not decided in this phase)

LibreOffice core itself is MPL-2.0 (secondary GPLv3/LGPLv3+/Apache-2.0) — our fork's
source must ship publicly before this feature ships (MPL §3.2's source-availability
obligation), so this repo flips from private to public before launch, per task 1567's
own note. What license *our own* code (`office-bridge`, `build/`, `docs/`) ships under —
matching the other product-client repos' AGPL-3.0, or MPL-2.0 to sit naturally beside
the LibreOffice code it wraps — is not decided here; flag for Guus before phase 2 writes
real (non-sketch) code.
