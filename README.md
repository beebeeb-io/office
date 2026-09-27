# office

Beebeeb's own fork-and-build of LibreOffice core to WebAssembly, for zero-knowledge,
client-side editing of `.docx`/`.xlsx`/`.pptx` files in the browser (and later, Tauri
desktop). No plaintext document bytes and no editing session ever reach a Beebeeb
server or any third party — see [`docs/EGRESS.md`](docs/EGRESS.md) for exactly which
native network paths are removed and how that is enforced at build time.

**Why a fork, not the ZetaOffice CDN/SDK:** per Beebeeb's internal decision 1566
(Guus, 2026-09-26):
*"i prefer to fork the actual code and always be sure no data goes external... we need
to be 100% sure it doesn't go out the door."* We build LibreOffice core to WASM
ourselves, from a pinned upstream commit, and self-host every asset. We do not pull
allotropia's ZetaOffice binaries or CDN at runtime; their build scripts and upstream's
own `static/README.wasm.md` are read as reference only (`docs/PHASE1-FEASIBILITY.md`
cites both).

## Status: Phase 4 (task 1567) — chrome hidden, UNO dispatch/state API, engine ready for our own chrome

This section records the engine as of phase 4 (no beebeeb-core wiring in this repo; two
open engine gaps below). Licensing is settled: see Licensing at the end. Core technical
questions keep getting answered:

- **Phase 1** (`docs/PHASE1-FEASIBILITY.md`): can LO-core build to WASM at all? Partial
  go on macOS (`configure` yes, `make` no — 3 macOS-host-specific bugs).
- **Phase 2** (`docs/PHASE2-RESULTS.md`): the full interactive Qt/GUI build succeeds on
  a Linux host (the Legion), real keyboard/mouse editing proven in Writer/Calc/Impress,
  egress gate green. Open item: getting external bytes in/out (`file://` didn't work).
- **Phase 3** (`docs/EGRESS.md`'s 2026-09-27 section): the file-I/O open item is closed
  — UNO's own `SequenceInputStream`/`SequenceOutputStream` API moves bytes in/out
  entirely in-memory, no `file://`, no MEMFS. A minimal page API (`bridge/bb-office-api.js`
  → `bbOffice.open(bytes, filename)` / `bbOffice.save()`) is built and proven end-to-end
  for `.docx`/`.xlsx`/`.pptx`. `crates/office-bridge` has a real `DocumentHandle::open`/
  `.save()` shape with unit tests.
- **Phase 4** (this status, task file's 2026-09-27 phase-4 note): the `--post-js`
  `Module.uno_scripts` fix is now BAKED INTO THE BUILD (`static/emscripten/bb-uno-scripts-
  default.js` + `desktop/Executable_soffice_bin.mk`) — `evidence/serve/patch-soffice-js.js`'s
  runtime text-patch is no longer needed and was removed from the serving pipeline
  (confirmed: `window.bbOffice.open/save` works against the raw, unpatched artifact).
  `applyDocumentChrome()` (in `bb-office-worker.js`) hides the menubar/toolbars/statusbar/
  sidebar/rulers and closes the Start Center on every document open — screenshots and a
  durable `layoutManagerVisible` assertion in `evidence/playwright/phase4-chrome.spec.js`.
  The bridge API gained `dispatch`/`onState`/`getOutline`/`goToHeading`/`setZoom`/
  `newDocument`/`onModifiedChange`/`onSelectionChange` — see `bridge/bb-office-api.js`'s
  JSDoc for exact signatures, all proven against the real artifact in
  `evidence/playwright/phase4-bridge-api.spec.js`.
  **Two open engine gaps, each with 3 real documented attempts:** (1) the native Qt
  window title bar cannot be hidden without breaking document-switching entirely — see
  `patches/0005-emscripten-frameless-window-REVERTED.patch`; (2) `bbOffice.setTheme()`'s
  config write succeeds and persists but does not cause a live repaint in this build —
  see `doSetTheme`'s comment in `bb-office-worker.js`. Also open: no screen-rect for
  selection changes (no accessibility bridge in this build — see `onSelectionChange`'s
  doc comment), and Inter-as-UI-font / icon-theme dark variant are not yet bundled into
  `soffice.data` (would need a build-time VFS package change, not attempted this phase).

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

## Licensing

- **Beebeeb's own code** (`bridge/`, `crates/`, `build/`, `docs/`, `evidence/`) is
  **AGPL-3.0-or-later**, the same as Beebeeb's other public clients (core, cli, web,
  mobile, desktop). Full text: [`LICENSE`](LICENSE).
- **`patches/*`** are Modifications of LibreOffice core and stay **MPL-2.0**, file by
  file, like the LibreOffice code they change. New files they add carry the MPL-2.0
  header.
- **Third-party components** the build fetches at pinned commits (LibreOffice core,
  allotropia's Qt 5.15.2+wasm, Emscripten) and the vendored OFL-1.1 fonts are listed,
  with their licenses and where their source is, in [`NOTICE`](NOTICE). Verbatim
  license texts are in [`notices/`](notices/); the fonts' notice is
  [`build/tarballs/OFL.txt`](build/tarballs/OFL.txt).
- **What ships to browsers:** [`bridge/THIRD_PARTY_NOTICES.txt`](bridge/THIRD_PARTY_NOTICES.txt)
  is served inside the engine bundle next to `soffice.wasm`. It is generated by
  `build/make-third-party-notices.sh` (`--check` fails if it is stale).
- **Qt corresponding source:** we host the two pinned Qt commits as release assets
  (tag `qt-source-5.15.2-wasm-3d440b7`); `build/mirror-qt-source.sh` reproduces them
  byte for byte.
