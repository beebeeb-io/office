# Task 1567, Phase 1 — feasibility spike: go/no-go

**Date:** 2026-09-26. **Host:** this Mac — macOS 26 (Darwin 25.6.0), Apple Silicon
arm64, 32GB RAM, Xcode 27.0, 128GB free on `/` at session start.

**Question this phase answers:** can we build LibreOffice core to WASM from source, on
this machine, within a reasonable amount of time and disk? Phase 1 does **not** attempt
the interactive Qt-GUI editing build (the one Guus's decision 1566 actually needs) — it
spikes the simpler **headless module build** (`--disable-gui`,
`--with-wasm-module="writer calc impress"`) first, because it is the smaller, faster
experiment for answering "does the toolchain even work here," and because upstream's
own docs describe it as needing no Qt at all (`build/core/static/README.wasm.md` — read
in full; see Sources).

**Final outcome of this phase:** `configure` succeeds; `make` does not complete —
stopped by decision after the third distinct, independently-diagnosed macOS-build-host
cross-compile bug in a row (see "What builds and what fails" below and the full
attempt log in `build/PROGRESS.md`).

## Numbers

| Metric | Value |
|---|---|
| Disk used (repo checkout + emsdk + partial build output) | **7.0GB** (`core/` 5.0GB incl. partial `workdir`/`instdir`, `emsdk/` 2.0GB) |
| Disk free at stop | **120GB** (of 128GB start) — never within reach of the ~80GB budget ceiling |
| Wall time, clone through the stop decision | **~50 minutes** |
| Toolchain/config gaps found and fixed to reach a working `configure` | **8** (see list below), none WASM-specific |
| Toolchain/build-system bugs found in `make`, each requiring its own patch or workaround | **3**, in three independent subsystems (LO's `uui` module, LO's `gbuild` for_build library naming, OpenSSL's own `Configure`) — see `build/PROGRESS.md` attempts 10-12 |
| `configure` completion | **Succeeds** — `config_host.mk` generated for the headless module build (writer, calc, impress) |
| `make` (actual compile to `soffice.wasm`/`soffice.data`) | **Does not complete on this Mac** — stopped by decision at the third build-system bug, not run to a final pass/fail on that one specific bug |
| wasm size / load time / memory | **Not measured** — no artifact was produced; the Playwright load test (goal 4) was not reached |
| Peak load average observed | **67.13** (briefly, mid-build) — exceeded the task's own "pause if load > 40" threshold; see the honesty note in `build/PROGRESS.md` attempt 12 |

## What builds and what fails (toolchain findings, all real, all reproduced)

Every one of these was found by actually running the recipe, not by reading docs —
each is cited with the exact error and file:line in `build/PROGRESS.md`:

1. **Emscripten 3.1.30** (upstream doc's stated version) is stale — current
   `configure.ac` (pinned commit) requires **≥ 3.1.46**. Fixed: installed 3.1.46.
2. **Perl module `Archive::Zip` missing** — generic macOS LO-build gap, not WASM-specific. Fixed via `cpan`.
3. **Homebrew's `pkgconf` fails LO's "bogus pkg-config" Darwin check**, and neither an
   exported `PKG_CONFIG` env var nor a top-level `--enable-bogus-pkg-config` flag
   reaches the nested native-host ("CONF-FOR-BUILD") sub-configure that actually runs
   the check — only `--with-build-platform-configure-options=--enable-bogus-pkg-config`
   does (a `configure.ac`-specific forwarding mechanism, root-caused by reading the
   source, not guessed). Fixed.
4. **`gperf` 3.0.3** (Apple's bundled version) is too old (need ≥ 3.1). Fixed: `brew
   install gperf` (3.3).
5. **Homebrew's `meson` launcher resolves a `pyenv` Python without `mesonbuild`
   installed** (this machine has both a Homebrew Python and a pyenv-shimmed default
   `python`, and harfbuzz's bundled Meson sub-build inherits whichever `python` is
   first on `PATH`) — machine-specific, not WASM-specific. Fixed:
   `PYTHON=/opt/homebrew/bin/python3` in `autogen.input`.
6. **Apple's `make` 3.81** is too old for LO's build system generally (a
   known, generic macOS gap, fixed before the WASM-specific attempts even started):
   `brew install make`, used via its `gnubin` shim.

None of these six is WASM-specific or Apple-Silicon-specific in the sense of "this
can't be done on this hardware" — they are the ordinary "first LibreOffice build on a
fresh macOS dev machine" toolchain gaps, compounded by this machine's particular mix of
Homebrew + pyenv + Apple's own bundled tools. `configure` itself completed cleanly
after these eight fixes — a genuinely positive result for "does the toolchain reach a
working configuration on Apple Silicon macOS."

**But the actual compile (`make`) surfaced a different, more serious pattern — three
independent, unrelated cross-compile bugs, each in a different subsystem, each only
discoverable by running the build far enough to hit it:**

7. **LO's `uui` module unconditionally required curl** (`uui/Library_uui.mk` had no
   `ENABLE_CURL` guard, unlike its sibling `linguistic` module, which already has one)
   — broke the very first `make` attempt outright, regardless of host OS. Traced to
   one call site (`uui/source/iahndl-authentication.cxx:775`, a CMIS/WebDAV OAuth2
   "auth fallback" flow — itself a newly-found egress path, `docs/EGRESS.md` #13).
   **Patched** (`patches/0001-uui-disable-curl-oauth2.patch`, applied by
   `build/wasm.sh clone`): guards the curl dependency and excludes the one
   curl-calling source file, falling back to the dialog's existing manual-entry path.
   This one is **not** host-specific — it would break on Linux too.
8. **LO's `gbuild` for_build library naming expects `.so` where it correctly built
   `.dylib`** (`libgcc3_uno.so` vs the real `libgcc3_uno.dylib`, needed by the native
   helper tool `saxparser` during the build itself) — **this one IS macOS-host-
   specific**: `config_host.mk`'s own `LIBO_LIB_FOLDER_FOR_BUILD=Frameworks` shows the
   macOS app-bundle convention is correctly configured elsewhere; some other rule in
   the dependency chain still hardcodes the Linux `.so` suffix. Worked around with a
   compatibility symlink (`build/wasm.sh build`'s automatic retry-once logic) rather
   than patching the underlying gbuild macro, which would need touching generic,
   widely-used build logic with more confidence than a phase-1 spike affords.
9. **OpenSSL's own `Configure` (an entirely separate Perl-based build system) emitted
   an Apple-clang `-arch arm64` flag when compiling under `emcc`** — `emcc` has no
   `-arch` concept and refused. **Also macOS-host-specific**: this is OpenSSL's own
   Darwin-detection logic misfiring when the *build host* is Apple Silicon, regardless
   of the *target* being wasm32. Not fixed — this is where the session stopped.

**The pattern across #8 and #9, on top of #7, is the actual finding of this phase:
building LibreOffice-to-WASM FROM a macOS host repeatedly surfaces genuine, narrow,
previously-undiscovered (by us) cross-compile bugs in independent subsystems — LO's
own `gbuild`, and a bundled third-party project's (`OpenSSL`'s) own build system —
each requiring its own investigation. Two for two external/build-system components hit
their own unique bug the moment the build reached them.** There is no evidence-based
reason to expect the next one (of roughly 15 more bundled external projects this
module set still needs) won't have its own.

## The bigger, unresolved question: does the interactive (Qt) editing build fit this machine at all?

This is the one that actually matters for what Guus asked for ("editable like
LibreOffice"), and it is **not** answered by this phase's headless-build spike. From
`build/core/static/README.wasm.md` (read in full, not summarized from memory):

- The interactive build needs **allotropia's patched Qt 5.15.2 fork** (`git clone
  https://github.com/allotropia/qt5.git`, branch `5.15.2+wasm`) and **Emscripten
  4.0.10** (a different, newer version than the headless build's 3.1.46) — not stock
  Qt, not stock emsdk. Building that Qt fork for WASM is itself a full Qt-for-WebAssembly
  cross-compile, a multi-hour undertaking in its own right, before LibreOffice's own
  build even starts.
- The doc states, in its own words, about the **link step of the Qt build**: *"Linking
  takes quite a long time, because emscripten-finalize rewrites the whole WASM files
  with some options. This way the LO WASM possibly needs 64GB RAM."* **This Mac has
  32GB.** That is a concrete, documented, first-party resource ceiling this machine may
  not clear — not a guess, a direct quote from the people who wrote the port.
- allotropia's own recommended path for reproducing this build at all is **their Docker
  images** ("emsdk install/activate is not stable over time... consider the docker
  images we're providing"), i.e., even upstream's own authors steer people to a
  controlled Linux container rather than an arbitrary host — which on a memory-bound
  step is exactly the lever (a Linux VM/container can be given more contiguous memory
  headroom and a swap policy Docker Desktop on macOS manages differently than raw
  host RAM) that might make the difference between failing and succeeding at 32GB.

**This constitutes real, sourced evidence of a plausible hard blocker for the
interactive build on this specific Mac — found without needing to spend the many hours
an actual attempt at the Qt fork would cost.** Per task 1567's own stop condition
("toolchain blocker you cannot resolve... or > ~10 hours estimated"), attempting the
full interactive build now — first building a patched Qt5-for-WASM fork (hours, on top
of everything above), then linking an LO+Qt WASM binary that upstream says may need
double this machine's RAM — is estimated to cost **considerably more than 10 hours**
before even reaching a first pass/fail signal, with a real chance the link step simply
cannot complete in 32GB regardless of time spent. That estimate, not a completed
attempt, is the basis for the recommendation below.

## Recommendation

**Phase 1 (headless-build toolchain spike): PARTIAL GO, with numbers, and a corrected
verdict from my own first draft of this section.** `configure` succeeds cleanly (8
generic toolchain gaps, all fixed, none WASM-specific — real, positive evidence the
toolchain itself works on Apple Silicon macOS). But `make` does not complete on this
Mac: after fixing one real, host-independent LO bug (`uui`/curl), it hit two more,
back to back, each in a different subsystem, each a genuine macOS-build-host artifact
(gbuild's for_build library naming, then OpenSSL's own `Configure`). **I stopped
before finishing the third fix, and before reaching a fourth**, on the judgment that
this is a pattern, not a one-off — see the numbered list above. Disk and time stayed
comfortably inside budget throughout (7.0GB, ~50 minutes) — **budget was never the
constraint; the constraint is a recurring class of cross-compile bug specific to
building FROM a macOS host.**

**Phase 2 (the interactive Qt-GUI editing build Guus actually asked for): NO-GO on
this Mac, as attempted from source, in this phase — do not start the Qt5 fork build
here.** This verdict stands independently of the headless-build finding above, for its
own separate reason: the documented ~64GB RAM figure for the link step (against this
machine's 32GB), plus the additional multi-hour Qt-for-WASM cross-compile prerequisite
before LO's own build even begins, together exceed the task's own ">~10 hours or a
toolchain blocker you cannot resolve" stop condition. This is a **plausible, sourced
blocker, not a proven one** — it has not been attempted to failure, because attempting
it would itself cost the hours the stop condition says to avoid spending without first
surfacing the call. Given the headless build's own three real bugs on this same host,
confidence that the *much bigger* Qt build would fare better here is now lower, not
higher, than when this section was first drafted.

**Proposed next phase, per task 1567's own fallback menu — now with two independent
lines of evidence pointing the same way (the 64GB-RAM concern AND the three-bugs-in-a-
row pattern), not one:**
(a) **Build inside a Linux container** (matches allotropia's own recommended workflow
    — "emsdk install/activate is not stable over time... consider the docker images
    we're providing" — and this session's own evidence: on Linux, `uname -m` reports
    `x86_64` (no Apple-`-arch` codepath for OpenSSL's `Configure` to misfire on), and
    `for_build` libraries are uniformly `.so` (no `.dylib`/`.so` mismatch to begin
    with) — the two macOS-specific bugs found here would most likely simply not exist
    on a Linux host. This is the recommended next step: far cheaper to de-risk in a
    disposable container/CI runner than to keep excavating this Mac's host-specific
    bugs one external dependency at a time, and it directly tests the actual
    bottleneck (a Linux host, with more RAM available than this Mac, for the Qt
    build) rather than continuing to work around symptoms of the wrong host.
(b) **A from-scratch Rust engine** for xlsx/docx (task 1567's other named fallback) —
    explicitly NOT started in this phase per the task's own instruction ("Do not start
    the Rust-engine alternative"), and, per decision 1566's own effort estimate context,
    a materially larger, multi-week-plus scope than either WASM path.

**This is a decision for Guus, per the task's own framing** ("the numbers go back to
Guus before we switch," decision 1566's resolution) — phase 1 provides the numbers;
it does not make the call to abandon the from-source build. Recorded as an open item
rather than acted on unilaterally.

## Sources

- `build/core/static/README.wasm.md` — read in full at pinned commit
  `f8941520720922033948ca14081dbb3dabbbe6b7` (not summarized from a prior/cached
  version): https://github.com/LibreOffice/core/blob/master/static/README.wasm.md
- `build/core/configure.ac` — read directly for the `--with-wasm-module`,
  `--disable-curl` cascade, and `CONF-FOR-BUILD` forwarding mechanism (line numbers
  cited in `docs/EGRESS.md` and `build/PROGRESS.md`).
- allotropia's ZetaOffice announcement and Qt5/emscripten forks (read for the
  interactive-build prerequisites, not used as a source of binaries or CDN assets):
  https://blog.allotropia.de/2024/11/08/announcing-zetaoffice-a-new-libreoffice-technology-product-for-web-mobile-desktop/,
  https://github.com/allotropia/qt5, https://github.com/allotropia/qtbase
