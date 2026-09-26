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

## Status: Phase 1 feasibility spike (task 1567) — DONE, PARTIAL GO

Not shippable. This phase answered one question: **can we build LibreOffice-core-to-WASM
from source, on this Mac, in a reasonable amount of time and disk?**

**Result:** `configure` succeeds (8 generic macOS toolchain gaps found and fixed, none
WASM-specific). `make` does not complete on this Mac — after fixing one real,
host-independent LO bug (`uui` module unconditionally required curl), it hit two more
in a row, each in a different subsystem, each a genuine macOS-build-host artifact
(gbuild's for_build library naming, then OpenSSL's own `Configure` cross-compile
detection). Stopped by decision at that pattern, not by a single unresolvable blocker.
Disk and time were never the constraint (7GB, ~50 minutes, budget was 80GB).

See [`docs/PHASE1-FEASIBILITY.md`](docs/PHASE1-FEASIBILITY.md) for the full go/no-go
with numbers, and [`build/PROGRESS.md`](build/PROGRESS.md) for the attempt-by-attempt
log (12 attempts, each with root cause and evidence, not guesses).

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
  office-bridge/   — Rust glue crate SKETCH (not built/wired yet) — see its lib.rs doc
                     comment for the exact byte-handling contract with beebeeb-core
```

## Licensing (open item, not decided in this phase)

LibreOffice core itself is MPL-2.0 (secondary GPLv3/LGPLv3+/Apache-2.0) — our fork's
source must ship publicly before this feature ships (MPL §3.2's source-availability
obligation), so this repo flips from private to public before launch, per task 1567's
own note. What license *our own* code (`office-bridge`, `build/`, `docs/`) ships under —
matching the other product-client repos' AGPL-3.0, or MPL-2.0 to sit naturally beside
the LibreOffice code it wraps — is not decided here; flag for Guus before phase 2 writes
real (non-sketch) code.
