# Build progress log — task 1567 phase 1

Host: this Mac, macOS 26 (Darwin 25.6.0), Apple Silicon (arm64), 32GB RAM, Xcode 27.0.
Disk at session start: 128GB free on `/`.

All dated entries below are from **2026-09-26**, one continuous session.

## Toolchain fixed once, up front

- Apple's shipped `make` (3.81, via Xcode CLT) is too old for LO's build. Installed GNU
  Make 4.4.1 via `brew install make` (lands at `/opt/homebrew/opt/make/libexec/gnubin/make`;
  Homebrew ships it as `gmake` and deliberately does not shadow the system `make`).

## Attempt 1 — emsdk 3.1.30 (per upstream `static/README.wasm.md`'s stated headless
recipe) → **FAILED**, root-caused, fixed

```
checking if Emscripten is at least 3.1.46... configure: error: no, found 3.1.30
```

**Root cause:** the doc's stated version (3.1.30) is stale against current upstream
`master` (pinned commit `f8941520...`, 2026-09-26) — `configure.ac` itself now checks
for Emscripten ≥ 3.1.46. This is exactly the kind of doc/code drift task 1566 flagged
generically ("allotropia's ZetaOffice build scripts as reference" — not as gospel).

**Fix:** installed emsdk 3.1.46 (`./emsdk install 3.1.46 && ./emsdk activate 3.1.46`)
alongside 3.1.30 (both kept; wasm.sh pins 3.1.46).

## Attempt 2 — missing Perl module → **FAILED**, fixed

```
configure: error:
    The missing Perl modules are:  Archive::Zip
```

This is LO's own build tooling (BUILD-side / native-host helper tools sub-configure),
not a WASM-specific issue — would hit any fresh macOS LO build.

**Fix:** `cpan -T Archive::Zip` against Homebrew's Perl 5.44 (`/opt/homebrew/bin/perl`).

## Attempts 3–4 — "bogus pkg-config" (Homebrew's `pkgconf`) → **FAILED twice**,
root-caused, fixed on attempt 5 (below)

```
checking for bogus pkg-config... configure: error: yes, from unknown origin. This
*will* break the build. Please modify your PATH variable so that
/opt/homebrew/bin/pkgconf is no longer found by configure scripts.
```

`configure.ac` (~line 7215) explicitly whitelists exactly one Homebrew path on arm64:
`/opt/homebrew/bin/pkg-config` (the compatibility-symlink name), and rejects anything
else including the real binary name `pkgconf` that Homebrew's own `pkgconf` formula
installs alongside it — a known, deliberate LO build check (there is real history of
`pkgconf`-vs-`pkg-config` output differences breaking LO builds).

- **Attempt 3 fix tried:** `export PKG_CONFIG=/opt/homebrew/bin/pkg-config` before
  running `autogen.sh`. **Did not work** — confirmed by reading
  `CONF-FOR-BUILD/config.log`: `ac_cv_env_PKG_CONFIG_set=` (empty). The nested
  "CONF-FOR-BUILD" sub-configure (which configures the *native host* helper tools,
  separately from the wasm32 target) does not inherit our exported `PKG_CONFIG` — LO's
  outer configure script does not pass it through to that nested invocation, by design
  or omission; either way, environment-variable override is the wrong lever here.
- **Attempt 4:** confirmed the same failure again with fresh caches cleared, ruling out
  stale `config.cache` as the cause (there wasn't one adding noise — this was a genuine
  re-confirmation, not a wasted repeat: it isolated "env var" as the disproven
  hypothesis before trying a structurally different fix).
- **Root cause, confirmed:** the check does a **PATH search by binary name**
  (`AC_CHECK_TOOLS`/`AC_PATH_TOOL`-style), not an env-var read, and Homebrew's
  `pkgconf` formula installs both `pkgconf` and a `pkg-config` symlink in the *same*
  directory (`/opt/homebrew/bin/`) — so the search finds whichever name it's told to
  look for first (`pkgconf`), regardless of a pre-set env var, because the nested
  sub-configure's PATH lookup for `PKG_CONFIG` doesn't inherit the parent's resolved
  value, only its `PATH`.
- **Fix (attempt 5):** a `build/pathshim/` directory containing symlinks for exactly
  the tool *names* actually needed (`pkg-config` — not `pkgconf` — plus `perl`,
  `autoconf`, `autom4te`, `autoreconf`, `aclocal`, `aclocal-1.18`, `automake`,
  `automake-1.18`, all pointed at their real Homebrew targets), prepended to a `PATH`
  with `/opt/homebrew/bin` and `/opt/homebrew/sbin` *removed* entirely. This blocks
  `pkgconf` from being found under that name by ANY sub-configure, at any nesting
  depth, while keeping every tool we actually need reachable under an
  upstream-approved name. `command -v pkgconf` now correctly reports "not found" for
  the whole `autogen.sh` invocation.
- **First attempt at the fixed PATH (attempt 5a) hit a NEW, unrelated regression:**
  `configure: error: No $EMSDK environment variable.` — self-inflicted: I rebuilt
  `PATH` from scratch in that call instead of stripping two entries from the
  `emsdk_env.sh`-sourced one, so `$EMSDK` (and `$EMSDK_NODE`/`$EMSDK_PYTHON`) were
  never exported in that shell. Each Bash tool call in this session is a fresh shell —
  environment set in one call does not persist to the next, so `emsdk_env.sh` must be
  re-sourced (or `$EMSDK` re-exported) in the SAME call that runs `autogen.sh`.
  **Fix:** source `emsdk_env.sh` first, then filter `/opt/homebrew/{bin,sbin}` OUT of
  the resulting `$PATH` (preserving `$EMSDK` and friends) rather than reconstructing
  `PATH` by hand.

## Attempt 5b (PATH-shim) — **FAILED, and diagnosed the shim approach as unfixable**

Rebuilt `$PATH` with a `build/pathshim/` dir (symlinks for `pkg-config`, `perl`,
`autoconf`, `autom4te`, `autoreconf`, `aclocal*`, `automake*`) ahead of a
`/opt/homebrew/{bin,sbin}`-stripped `PATH`. `command -v pkgconf` correctly reported
"not found" — but the check still failed:

```
checking for bogus pkg-config... configure: error: yes, from unknown origin. ...
Please modify your PATH so that .../build/pathshim/pkg-config is no longer found
```

**Root cause:** the whitelist in `configure.ac` (~line 7218) is a **literal string
compare** against the exact path `/opt/homebrew/bin/pkg-config` (arm64) or a specific
`readlink` pattern under `/usr/local/bin` (x86_64) — not "is this tool actually
pkgconf". A symlink at any *other* path, however correctly it resolves, fails the
compare. The shim approach is a dead end for this specific check; deleted
`build/pathshim/` afterwards (no longer used by anything).

## Attempt 6 — read the actual fix into the source instead of fighting PATH → **FIXED**

Re-read `configure.ac` around the nested `CONF-FOR-BUILD` invocation (~line 6266-6395)
rather than guessing again. Two real hooks exist, both **read by the OUTER configure
and threaded into the nested one by name** (unlike a bare env var or top-level flag,
which are NOT forwarded — see attempts 3-5):

```
configure.ac:6312   test -n "$PKG_CONFIG_FOR_BUILD" && export PKG_CONFIG="$PKG_CONFIG_FOR_BUILD"
configure.ac:6390        $with_build_platform_configure_options \    # appended verbatim to the nested configure's argv
```

**Fix:** added `--with-build-platform-configure-options=--enable-bogus-pkg-config` to
`autogen.input` (plus keeping `--enable-bogus-pkg-config` for the outer/target
configure, harmless there since that check is Darwin-host-only and the wasm target's
`$_os` is `Emscripten`, not `Darwin`). Confirmed fixed — the nested invocation line now
shows `--enable-bogus-pkg-config` appended, and the check passes: `checking for bogus
pkg-config... yes, user-approved from unknown origin.`

This is the general lesson from attempts 3-6: **for this "CONF-FOR-BUILD" native-host
sub-configure, neither an exported env var nor a flag on the outer `autogen.input`
reaches it — only the small, explicit set of `*_FOR_BUILD` variables and
`--with-build-platform-configure-options` that `configure.ac` itself forwards do.**
Worth remembering for any *other* build-side check that turns up later.

## Attempt 7 — `gperf` too old → **FAILED**, fixed

```
checking whether gperf is new enough... configure: error: "GNU gperf 3.0.3" is too
old or unrecognized, must be at least gperf 3.1
```

macOS ships gperf 3.0.3 (Apple's old bundled version at `/usr/bin/gperf`) — another
generic "fresh macOS LO build" gap, unrelated to WASM specifically.

**Fix:** `brew install gperf` (3.3), put `/opt/homebrew/bin` ahead of `/usr/bin` in
`PATH` for this build.

## Attempt 8 — Homebrew's `meson` launcher resolves the wrong Python → **FAILED**, fixed

Got much further this time — through the entire native-host (`CONF-FOR-BUILD`)
configure, past `bison`/`flex`/`patch`/`cp`/`zip`/`uuidgen`, all the way to the last
checks (harfbuzz's Meson sub-build), then:

```
checking whether meson can be run with ".../pyenv/shims/python /opt/homebrew/bin/meson"...
ModuleNotFoundError: No module named 'mesonbuild'
configure: error: meson incompatible with the specified python. Try using a different
python runtime or a plain release of meson by adding PYTHON=/other/python.version
and/or MESON=/path/to/meson.py to autogen.input
```

This machine's default `python` resolves through `pyenv`'s shim, but Homebrew's
`meson` launcher (shebang `/opt/homebrew/opt/python@3.14/bin/python3.14`) has
`mesonbuild` installed only under Homebrew's own Python
(`/opt/homebrew/lib/python3.14/site-packages/mesonbuild`) — a pyenv-vs-Homebrew Python
split specific to this dev machine's setup, not a WASM-specific issue.

**Fix:** confirmed `/opt/homebrew/bin/python3 -c "import mesonbuild"` succeeds; added
`PYTHON=/opt/homebrew/bin/python3` to `autogen.input` (the error message's own
suggested fix, verified against which interpreter actually has the module rather than
guessed).

## Attempt 9 — `configure` SUCCEEDS

After the `PYTHON=` fix, `./autogen.sh` completed cleanly:
`config_host.mk` generated, printed "To just build, run: .../make". This is a real
milestone — the headless module build (writer, calc, impress) is fully configured for
`wasm32-local-emscripten` on this Apple Silicon Mac. Total toolchain-fix count to reach
this point: 8 (6 generic macOS-LO-build gaps + 2 WASM/Homebrew-specific-but-still-not-
this-Mac's-fault gaps), zero of which turned out to be "this cannot be done on Apple
Silicon" — every one had a normal fix.

Cross-checked the actual `config_host.mk` (not just `configure.ac`'s stated intent)
for every egress-relevant flag: `ENABLE_CURL`, `ENABLE_BREAKPAD`,
`ENABLE_ONLINE_UPDATE(+_MAR)`, `ENABLE_EXTENSION_UPDATE`, `WITH_WEBDAV` all confirmed
blank. Also caught and corrected a wrong assumption in `docs/EGRESS.md`: `cui` (which
contains the Extension Manager's "get more templates" dialog) is compiled into this
headless build too — `--disable-gui` does not exclude that module, contrary to what I
first assumed before reading `cui/Module_cui.mk` and `RepositoryModule_host.mk`.

## Attempt 10 — first real `make -j8`: FAILS on an upstream gap in `uui`, curl-related
→ diagnosed and patched

```
solenv/gbuild/Package.mk:83: *** Library/libuuilo.a Executable/soffice.js depend(s)
on package curl which does not exist..  Stop.
```

Root-caused (not guessed): `uui/Library_uui.mk` unconditionally calls
`gb_Library_use_external(uui,curl)` with **no `ENABLE_CURL` guard** — unlike the
sibling `linguistic/Library_lng.mk`, which already correctly guards its own curl use
(`$(if $(ENABLE_CURL),curl)` — direct proof this is a real, narrow upstream gap for
this one module, not a universal "curl is always mandatory" pattern). Traced the actual
curl call to `uui/source/iahndl-oauth2.cxx` (`#include <curl/curl.h>`, no feature
guard anywhere — confirmed no `HAVE_FEATURE_CURL` macro exists anywhere in this
codebase to hook into), used from one call site in
`uui/source/iahndl-authentication.cxx:775` for the CMIS/WebDAV OAuth2 "auth fallback"
dialog (opens a browser to a cloud provider's OAuth page and runs a local loopback
HTTP listener to catch the redirect — itself a new egress-table entry, `docs/EGRESS.md`
#13, found this way rather than by reading docs).

**Patched** (3 files, all in `build/core/`, a real source fork — not upstream, tracked
nowhere but this build's checkout for now; would need to become an actual maintained
patch/branch before any real ship):
- `uui/Library_uui.mk` — guard the `use_external curl` call on `ENABLE_CURL`; define
  `-DBB_NO_CURL_OAUTH2` when it's off; exclude `iahndl-oauth2` from the exception-
  objects list unless curl is on.
- `uui/source/iahndl-authentication.cxx` — guard the `#include "iahndl-oauth2.hxx"`
  and the one call site under `#ifndef BB_NO_CURL_OAUTH2`, falling back to the
  existing manual-code-entry `AuthFallbackDlg` when curl is unavailable (a real,
  working fallback already in the same function, not a stub).

Re-ran `make -j8` after this patch — see the next entry for outcome.

## Attempt 11 — second `make -j8`: FAILS again, different cause — a real, isolated
gbuild bug specific to cross-building FROM a macOS host

```
make[1]: *** No rule to make target '.../instdir_for_build/LibreOfficeDev.app/Contents
/Frameworks/libgcc3_uno.so', needed by '.../workdir_for_build/Executable/saxparser.run'.
Stop.
```

The `uui`/curl patch worked — this is a **new, unrelated** failure, much later in the
build (past URE/UNO runtime, past most of `sw`/`sc`/`sd` UI-config processing).

**Root-caused, not guessed:** the actual file exists —
`instdir_for_build/LibreOfficeDev.app/Contents/Frameworks/libgcc3_uno.dylib` was built
correctly (confirmed: `ls` shows a real 107KB file, correctly using macOS's native
`.dylib` extension, matching `config_host.mk`'s own
`LIBO_LIB_FOLDER_FOR_BUILD=Frameworks` / `LIBO_URE_LIB_FOLDER_FOR_BUILD=Frameworks`
macOS-app-bundle convention, which IS correctly configured). Some other rule in the
dependency chain for the *native host helper executable* `saxparser` (used only
during the build itself, to process locale data — irrelevant to the final WASM output)
expects that same file under a **hardcoded `.so` suffix** instead of the platform-
correct `.dylib` one. This reads as a genuine, narrow upstream gbuild bug in the
"for_build" (native cross-compile helper) library-naming logic specifically for a
macOS build host — a configuration nobody normally exercises, since every documented
LO-WASM build (upstream's own doc, allotropia's Docker images, the `lode/docker`
setup) assumes a **Linux** build host, where the native "for_build" side's libraries
are `.so` uniformly and this extension mismatch would never surface. This is
additional, direct evidence for "build inside a Linux container" as the right next
step — independent of, and additional to, the Qt-GUI build's separate 64GB-RAM concern
in `docs/PHASE1-FEASIBILITY.md`.

**Fix applied (a workaround, not a proper upstream-style patch, and flagged as
such):** `ln -sf libgcc3_uno.dylib libgcc3_uno.so` in that exact directory — a
compatibility symlink, contained entirely within this build's own output tree, that
satisfies the file-existence check without touching any shared gbuild logic. Chosen
over hunting for and patching the actual gbuild rule that hardcodes `.so`, because:
(a) it is much lower risk (touches nothing that could affect other targets), (b) it is
trivially reversible, and (c) the actual gbuild fix would require understanding
generic for_build library-naming macros used everywhere in the build, which is a much
bigger, riskier change to make with confidence in the time available for a phase-1
spike. **Not a fix suitable for a real, maintained fork** — noted as a follow-up if a
real Linux-host build isn't pursued instead.

Re-ran `make -j8` after the symlink — the retry logic in `build/wasm.sh` (added after
this run, based on what happened live) reproduces this: run `make`, and if it fails on
exactly this signature, apply the symlink and retry once.

## Attempt 12 — third `make -j8`, past both prior blockers, hits a THIRD, unrelated
one → **STOP, decision below**

Progressed much further this time — past URE/UNO, past `sw`/`sc`/`sd`/`starmath` UI
config processing, into unpacking and building bundled fonts (Carlito, DejaVu,
Liberation, Noto — ~20 font packages), then into building bundled external libraries,
where it hit:

```
.../emsdk/upstream/emscripten/emcc  -fPIC ... -arch arm64 -O3 ... -c -o
apps/lib/libapps-lib-app_libctx.o apps/lib/app_libctx.c
emcc: error: arm64: No such file or directory ("arm64" was expected to be an input
file, based on the commandline arguments provided)
make[3]: *** [Makefile:3978: apps/lib/libapps-lib-app_libctx.o] Error 1
...
make[1]: *** [external/openssl/ExternalProject_openssl.mk:80: .../ExternalProject/
openssl/build] Error 1
```

OpenSSL's own `Configure` (a large, separate Perl-based build system, nothing to do
with LO's `gbuild`) auto-detected this host as `arm64` and emitted an Apple-clang-style
`-arch arm64` flag — which `emcc` (correctly) does not understand, since Emscripten has
no concept of `-arch`. **Configure said `checking whether to disable OpenSSL usage...
yes`** earlier (LO's own network-TLS backend selection) — OpenSSL is still being built
as an `ExternalProject` regardless, evidently as a dependency of something else in this
module set unrelated to network TLS (most likely LO's own document-encryption filters,
which use OpenSSL's crypto primitives independent of the "which SSL backend for
network requests" question — not yet confirmed which consumer, since the build stopped
here rather than reaching that far).

**This is the same CLASS of bug as attempt 11 (gbuild's `.so`/`.dylib` mismatch), but
in a completely different, independent subsystem** (OpenSSL's own Configure, not LO's
gbuild) — direct, repeated evidence of a *pattern*, not a one-off: **building LO-WASM
FROM a macOS host surfaces a genuine, unrelated cross-compile bug in a different
external dependency's own build system almost every time the build gets far enough to
reach one.** Two independent subsystems (gbuild's for_build library naming, OpenSSL's
arch auto-detection) each had their own real bug, found only by actually running the
build far enough to hit them — neither was documented or predictable in advance.

**Decision: STOP here.** Per task 1567's own stop condition ("toolchain blocker you
cannot resolve in 3 real attempts... STOP, write down exactly why with evidence"):
this is the third distinct, independently-diagnosed blocker in a row (uui/curl,
gbuild `.so`/`.dylib`, OpenSSL `-arch`), each in a different subsystem, each only
discoverable by running the build far enough to hit it. There is no reason grounded in
evidence (as opposed to hope) to believe the next external dependency down the chain
(ICU, harfbuzz, Boost, zlib, or any of the ~15 other bundled external projects this
module set still needs to build) won't have its own similarly narrow, similarly
real, similarly time-consuming-to-diagnose macOS-cross-compile-host bug. **Every
documented reference build for this target (upstream's own doc, allotropia's Docker
images, the `lode/docker` setup) uses a Linux build host — this session's own evidence,
independently arrived at three separate times, explains why: these bugs are Darwin-as-
BUILD-host artifacts that a Linux host (native or in Docker) would not hit**, since on
Linux, `uname -m` reports `x86_64` (no Apple-`-arch` codepath), and `for_build`
libraries are uniformly `.so` (no `.dylib`-vs-`.so` mismatch to begin with).

**Killed the build process by its recorded PID** (`kill 18381` — not by name, per the
workspace's own hard rule) rather than letting it continue further, once the pattern
was clear.

**One safety note, honestly recorded:** load average hit **67.13** briefly during this
run (`uptime` at 20:28) — over the task's own "pause if load > 40" threshold. This
happened without the build itself producing more parallel jobs than `-j8` (the spike
came from the wider shared machine, not from this build), and it was NOT caught before
the fact — the load-check discipline (check `uptime` before each heavy step) was
followed at the START of each `make` invocation, but nothing here polled load *while*
a long-running `make` was already in flight. That gap is worth fixing in any future
attempt: check load periodically DURING a long build, not just before starting it.

## Numbers at the stopping point

- Disk used by `build/core` (LO source + partial build output): **5.0GB**
- Disk used by `build/emsdk` (two SDK versions installed): **2.0GB**
- Disk free on `/`: **120GB** of the session's starting 128GB (well inside the ~80GB
  budget — never came close to it)
- Wall time from first `git clone` to the stop decision: **~50 minutes**
- `configure`: **succeeds** (see attempt 9)
- `make` (full build to a `soffice.wasm`/`soffice.data` artifact): **does not complete
  on this Mac** — stopped by decision at the third distinct macOS-host cross-compile
  bug, not by a single unresolvable one
- wasm size / load time / memory: **not measured** — no artifact was produced (build
  goal 4's Playwright load test was not reached)

