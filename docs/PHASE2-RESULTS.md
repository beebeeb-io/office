# Task 1567, Phase 2 — interactive Qt/GUI build: results

**Date:** 2026-09-26. **Build host:** Guus's Legion (Arch Linux, WSL2, x86_64, 16 cores,
~50GB RAM to WSL, ~790GB free disk), over `ssh legion`, per decision 1566/1567's
build-host question ("Go with a" / "The legion has 64gb mem").

## Go/no-go

**GO for the build itself, real artifact, real interactive editing in a browser —
Writer, Calc and Impress all confirmed working via genuine keyboard/mouse events,
screenshotted, with a passing Playwright test suite.**

**Open item, not resolved in this phase:** automating "open one of the named external
fixture files, save, read the saved bytes back from the Emscripten FS" specifically —
loading a real *file on disk* (any file, not just `.docx`) via the UNO
`loadComponentFromURL` API fails, and `storeToURL`'s writes are not visible back on the
Emscripten FS. In-memory documents (`private:factory/*`, created either via the Start
Center UI or via the UNO API) work perfectly for both reading and writing. See
"Open item" below for the full evidence trail — six independent real attempts, per the
workspace's own stop-after-3-attempts rule.

## Build numbers (all real measurements, `/usr/bin/time -v` on the Legion)

| Step | Result | Wall time | Peak RSS |
|---|---|---|---|
| emsdk 4.0.10 install | OK, first try | — | — |
| allotropia `qt5` (`5.15.2+wasm`, qtbase only) clone | OK, first try | — | — |
| Qt5 `qtbase` configure | OK, zero fixes | — | — |
| Qt5 `qtbase` build (`make -j12`) | OK | 1:23.78 | 464 MB |
| Qt5 `qtbase` install | OK | — | — |
| LO `configure` (`--with-distro=LibreOfficeWASM32`, GUI on) | OK, zero fixes | — | — |
| LO `make -j12`, attempt 1 | FAILED — patch 0003 missing `#include` | 12:58.14 | 4.94 GB |
| LO `make -j12`, attempt 2 | FAILED — undefined `FT_*` symbols at link (real gbuild gap) | 11:22.13 | 2.50 GB |
| LO `make -j12`, attempt 3 | FAILED — wrong gbuild macro in first fix attempt | 0:06.26 | 0.22 GB |
| LO `make -j12`, attempt 4 | FAILED — `\x27` escape breaks generated JS (wasm-ld itself succeeded) | 4:37.96 | 7.33 GB |
| LO `make -j12`, attempt 5 | **SUCCESS** | 3:21.12 | 7.32 GB |
| **Total (sum of 5 make invocations)** | | **32:25.61** | **7.33 GB peak, any attempt** |

Real wall-clock from first `make -j12` start to artifact existing: **~40 minutes**
(21:12–21:52 CEST), including diagnosis and patch-writing time between attempts.
**Peak RSS never exceeded 7.33GB** — well under upstream's own "possibly needs 64GB
RAM" warning for the link step (see `docs/PHASE1-FEASIBILITY.md`); that number is
likely for a debug/example/source-map configuration, not this release-style `-O3` build.

**Zero of Phase 1's three macOS-build-host bugs recurred on Linux** — confirms Phase
1's own hypothesis. Two *new*, real, Linux-host-independent bugs were found and fixed
(patches 0002/0004, both would affect any build of this exact commit + config, on any
host), taking the total real, distinct build blockers found across both phases to 6.

## Artifacts

Built to `workdir/installation/LibreOffice/emscripten/` (the `--with-package-format=emscripten`
deployable bundle), copied to the Mac at `repos/office/evidence/artifacts/emscripten/`
(gitignored — large binaries are never committed; sha256 + sizes are in
`evidence/artifacts/MANIFEST.sha256`):

| File | Size | sha256 |
|---|---|---|
| `soffice.wasm` | 171,729,371 B (164 MiB) | `8a4ecdf3c7aaebd997c50caaca72a861e9e956e0685e543805e5e1446e58b989` |
| `soffice.data` | 96,316,943 B (92 MiB) | `cb3fcfa5861c0c799fd587273a46b629590f7deca64189e49cfa0b9374e1290d` |
| `soffice.js` | 840,288 B | `ff38ef01972ab96871240c3f9d2f49483efbc1636f985305aa385cd07cb5fd92` |
| `soffice.data.js.metadata` | 213,445 B | `6390f38f756010c219f4293247c07817c1cfb9c4db27da01783cbb3393438117` |
| `qt_soffice.html` | 3,229 B | `379ae1ec89c7b126913dd4b77f4167a5f0ce24edb80a11004fe07bfd2ab1c7b3` |

Total bundle: **257 MB**, 9 files (+ `favicon.ico`, `qtloader.js`, `qtlogo.svg`, static
Qt/browser assets).

## Browser proof — real interactive editing, all three formats

Served locally from `repos/office/evidence/serve/server.js` (COOP/COEP required by
upstream + `Content-Security-Policy: connect-src 'self'`) at `http://127.0.0.1:8743`.
Playwright (real Chromium, not a stub) drove genuine mouse clicks and keyboard events —
not a UNO/JS API call — against the real rendered canvas. All three pass as a committed
test suite: `evidence/playwright/editing.spec.js` (`npx playwright test
playwright/editing.spec.js`, 3 passed, 1.9 min).

- **Writer**: Start Center → "Writer Document" → click into the page → typed the
  marker string → status bar shows "1 word, 40 characters". Screenshot:
  `evidence/screenshots/explore3-01-typed.png` (exploration) /
  `editing-writer.png` (committed spec run).
- **Calc**: Start Center → "Calc Spreadsheet" → typed the marker into a cell → Enter
  committed it, cursor moved to the next cell (real spreadsheet behavior). Screenshot:
  `evidence/screenshots/calc-typed.png`.
- **Impress**: Start Center → "Impress Presentation" → double-click the title
  placeholder → typed the marker → it appears on both the slide canvas AND the slide
  thumbnail panel. Screenshot: `evidence/screenshots/impress-03-typed.png`.

Load time: the Start Center is interactive within ~20–33s of first navigation on this
Mac (cold WASM init, not yet optimized/measured precisely — see "Not yet measured"
below).

## Egress gate — real session, red/green proof

`evidence/playwright/egress.spec.js`, run against the sandboxed host page
(`evidence/serve/host.html`: `<iframe sandbox="allow-scripts allow-same-origin">`, no
`allow-popups`/`allow-top-navigation`) with `connect-src 'self'`. The scripted session:
open a Writer doc, type, click through **all 11 top-level menus** (File through Help),
`Ctrl+S`, dismiss the resulting dialog.

- **GREEN** (real session, unmodified): `BB_EGRESS_OUTSIDE_REQUEST_COUNT=0`,
  `BB_EGRESS_POPUP_COUNT=0`. 1 passed, 41.6s.
- **RED-PROOF** (`BB_EGRESS_INJECT_FETCH=1`, server's CSP header temporarily removed
  via `BB_SERVE_NO_CSP=1` so the CSP header itself isn't what stops the request —
  proving the *Playwright-side capture*, not just the CSP, can catch a violation): a
  deliberate external `fetch()` to a non-routable address is captured,
  `BB_EGRESS_OUTSIDE_REQUEST_COUNT=1`, the assertion correctly flips outcome. 1 passed
  (the red-proof branch asserts a violation IS present), 42.6s.

No `beebeeb:hyperlink` events fired during this session (no hyperlink was present to
click) — see "Not yet done" below for the hyperlink-patch live-click verification.

## Patches applied (all four, confirmed compiling into this exact successful build)

- `0001-uui-disable-curl-oauth2.patch` (Phase 1) — unchanged.
- `0002-hyperlink-no-navigate.patch` — `shell/source/unix/exec/shellexec_em.cxx`'s
  `execute_browser()` dispatches a `beebeeb:hyperlink` DOM `CustomEvent` instead of
  `window.open()`. Fixed once in this phase (a `\x27` C-string escape survived
  EM_ASM's preprocessor-stringification unresolved, breaking the generated JS's own
  parse — real build failure, real fix, see the task file's dated note).
- `0003-additions-dialog-disable.patch` — `sfx2::AdditionsDialogHelper::RunAdditionsDialog`
  shows a static message instead of ever constructing the network-fetching
  `AdditionsDialog`. Fixed once in this phase (missing `#include <vcl/vclenum.hxx>`).
- `0004-vcl-emscripten-freetype-link.patch` — `vcl/Library_vcl.mk` links `freetype`
  explicitly for the Emscripten target (mirroring the existing WNT-only fix for the
  same underlying gap: cairo is a bundled static external on both platforms, and
  neither propagates its own `freetype` external-use to its LO-side consumer). Fixed
  once in this phase (wrong gbuild macro on the first attempt —
  `gb_Library_use_static_libraries` needs an LO-internal `StaticLibrary_X` target,
  which only exists for `$(COM)=MSC`; the correct macro for an `ExternalProject`-built
  library on any other compiler is `gb_Library_use_externals`).

## Open item — external file `file://` open/save (not resolved; stop-after-3-attempts)

**What works:** any document created via `private:factory/swriter` (or `scalc`,
`simpress`) — whether from the Start Center UI or via
`css.frame.XComponentLoader.loadComponentFromURL("private:factory/...", ...)` — reads
and writes correctly, including full in-memory UNO text manipulation
(`xText.insertString`, `xCell.setString`, etc. — confirmed in `evidence/debug-fileio.js`
Test A and `evidence/explore6.js`).

**What does not work, evidenced across 6 independent real attempts (2026-09-26,
`evidence/debug-fileio.js`, `evidence/debug-fileio2.js`, `evidence/debug-fileio3.js`,
`evidence/explore-uiopen.js`):**

1. Writing one of the named fixtures into the Emscripten virtual FS via
   `FS.writeFile()` (confirmed present via `FS.readFile()` immediately after), then
   `loadComponentFromURL("file:///path", ...)` → throws
   `com::sun::star::lang::IllegalArgumentException` (via
   `framework/source/loadenv/loadenv.cxx`'s `ID_UNSUPPORTED_CONTENT`, "type detection
   failed").
2. The SAME failure reproduces for a **trivial plain-text file** written the same way
   — this is not docx/OOXML-specific; it is generic to any externally-written file.
3. `css.frame.XStorable.storeToURL("file:///path", ...)` from an in-memory document
   returns **without throwing**, but the bytes are **not visible** to
   `FS.readFile()` immediately afterward (`ErrnoError: No such type or directory`).
4. Re-opening that SAME just-"stored" URL in the SAME session via
   `loadComponentFromURL` **does** return a non-null model — but this is most likely
   LO's own "already-open document" cache returning the existing in-memory instance,
   not a genuine disk round-trip (consistent with finding 3: the bytes were never
   really on disk to re-read).
5. Explicitly `close()`-ing the document before re-opening its "stored" URL: the
   `FS.readFile()` check fails the same way as (3) — confirms (4) was a cache hit, not
   a real round trip.
6. The **UI's own "Open File" dialog** (LO's internal Qt file picker, not a native
   browser `<input type=file>` — confirmed no `filechooser` event fires,
   `evidence/explore-openfile.js`), pointed at `/home/web_user` (its own default
   directory) with a fixture already written there via `FS.writeFile`, shows an
   **empty file listing** — the dialog's own directory browse can't see it either,
   ruling out a `loadComponentFromURL`-specific bug in favor of a broader UCB/`file://`
   content-provider issue for content written from outside LO's own write path.

**Working hypothesis (not confirmed):** the actual pthread that runs LO's `main()`/UNO
logic under `-sPROXY_TO_PTHREAD=1` has a real filesystem view that is not the same one
the JS `FS` global exposes on the specific Worker Playwright's `page.on('worker')`
reports first (and that `Module.uno_init` resolves on) — `Module.uno_init` resolving
there and returning correct results for pure in-memory operations does not prove that
worker's `FS` is the same MEMFS instance LO's own C++ file I/O actually reads/writes.
Not chased further per the workspace's stop-after-3-attempts rule (this already used
6). **Next step, if resumed:** find which of the other 6 Workers Emscripten spawns
(`PTHREAD_POOL_SIZE=4` plus the proxy) is the one whose `FS` LO's C++ code actually
uses, or instrument the C++ side directly (a debug log in `ucb/source/ucp/file`) rather
than continuing to guess from JS.

**This does not block decision 1566's core ask** (an interactive, in-browser editor —
proven working) but **does block** the specific "open this named fixture file, edit,
save, confirm the bytes round-tripped" form of task 1567's own goal 2 verification
language, and the "insert an image" / hyperlink-click steps of goal 4's egress session
(both need a way to get bytes in/out that isn't yet closed here — image insertion via
copy-paste or drag-drop was not attempted this phase; a real hyperlink was not created
in a document to click, since creating one via the UI's own Insert > Hyperlink dialog
was not reached this phase).

## Not yet done (explicitly, not silently dropped)

- Round-trip proof for the three NAMED fixtures specifically (`sample.docx/.xlsx/.pptx`)
  with a save + independent (`python-docx`/`openpyxl`/`python-pptx`) verification —
  blocked by the open item above. `evidence/scripts/verify-roundtrip.py` is written
  and tested to work correctly (confirms/rejects a marker string in a real file); it
  has not yet verified a real save from this app, because no real save has produced a
  reopenable file yet.
- Insert-an-image and click-a-hyperlink steps of the egress session (no working
  file-based image insert path found yet; no hyperlink was created to click).
- Precise load-time and browser memory measurement (only observed qualitatively —
  interactive within 20–33s; DevTools Performance/memory profiling not run this
  phase).
- Fidelity round-trip via the Legion's own native LibreOffice or the venv's
  python-docx/openpyxl/python-pptx tooling against a REAL save (tooling is ready;
  nothing to verify yet per the open item).

## Sources

- `build/core/static/README.wasm.md` at the pinned commit (Qt-GUI section).
- allotropia's `qt5`/`qtbase` forks: https://github.com/allotropia/qt5,
  https://github.com/allotropia/qtbase (branch `5.15.2+wasm`).
- This session's own build logs, copied from the Legion and gzipped:
  `evidence/logs/build-gui{,-2,-3,-4,-5}.log.gz`, `evidence/logs/autogen-gui.log.gz`,
  `evidence/logs/qt5-{configure,make}.log.gz` — the numbers above are transcribed from
  their `/usr/bin/time -v` output.
