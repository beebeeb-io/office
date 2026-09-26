#!/usr/bin/env bash
# Beebeeb office — LibreOffice-core-to-WASM build recipe.
#
# Phase 1 spike (task 1567) status: `autogen.sh`/`configure` SUCCEEDS for the HEADLESS
# module build (--disable-gui, --with-wasm-module="writer calc impress") on a macOS
# host — see build/PROGRESS.md for the 8 real toolchain fixes that took (none of them
# WASM-specific), and the 3 macOS-cross-compile-host bugs that stopped `make` there.
#
# Phase 2 (task 1567, this revision): the INTERACTIVE Qt-based editing build, run on
# Guus's Legion (Arch Linux, WSL2, x86_64, 16 cores, ~50GB RAM to WSL) over SSH, per
# upstream `static/README.wasm.md`'s Qt-GUI section and allotropia's ZetaOffice forks.
# Linux-as-build-host was chosen specifically because Phase 1 found its 3 blockers to
# be macOS-build-host artifacts (see docs/PHASE1-FEASIBILITY.md) — none of the
# `emsdk`/`qt5`/`core` steps below reference Homebrew, pyenv, or any Darwin-only flag.
#
# This script documents the recipe as a reproducible sequence, not a magic one-shot —
# read build/PROGRESS.md for what has actually been verified vs. what is still to try.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$HERE/core"
EMSDK_DIR="$HERE/emsdk"
QT5_DIR="$HERE/qt5"
QT5_INSTALL_DIR="$HERE/qt5-install"
EMSDK_VERSION="3.1.46"       # headless build (Phase 1) — see PROGRESS.md attempt 1
EMSDK_VERSION_GUI="4.0.10"   # interactive Qt build (Phase 2) — static/README.wasm.md's stated version
QT5_BRANCH="5.15.2+wasm"     # allotropia's patched Qt5 fork branch
LO_COMMIT="$(grep '^commit=' "$HERE/PINNED_COMMIT" | cut -d= -f2)"

disk_guard() {
  local avail_gb
  avail_gb=$(df -g / | awk 'NR==2{print $4}')
  if [ "$avail_gb" -lt 20 ]; then
    echo "ABORT: only ${avail_gb}GB free on / — refusing to continue (budget: stop well before exhausting 129GB starting free space)." >&2
    exit 1
  fi
}

load_guard() {
  local load1
  load1=$(uptime | awk -F'load averages?: ' '{print $2}' | cut -d, -f1 | tr -d ' ')
  # integer compare via awk (load1 may be e.g. "8.42")
  if awk -v l="$load1" 'BEGIN{exit !(l>40)}'; then
    echo "PAUSE: load average $load1 > 40 — shared-machine guard, sleep 60s and re-check before any heavy step." >&2
    sleep 60
  fi
}

step_emsdk() {
  [ -d "$EMSDK_DIR" ] || git clone https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"
  cd "$EMSDK_DIR"
  ./emsdk install "$EMSDK_VERSION"
  ./emsdk activate "$EMSDK_VERSION"
}

step_clone_core() {
  disk_guard
  if [ ! -d "$CORE_DIR" ]; then
    git clone --filter=blob:none --depth 1 https://github.com/LibreOffice/core.git "$CORE_DIR"
  fi
  cd "$CORE_DIR"
  # A --depth 1 clone can't `git checkout <sha>` if the sha isn't the tip commit we
  # fetched — this pins by fetching that exact commit if it differs from HEAD.
  if [ "$(git rev-parse HEAD)" != "$LO_COMMIT" ]; then
    git fetch --depth 1 origin "$LO_COMMIT"
    git checkout "$LO_COMMIT"
  fi
  # Apply our fork's patches (see PROGRESS.md attempt 10 — a real upstream gap, not a
  # config oversight on our side: uui/Library_uui.mk unconditionally required curl).
  # Idempotent: skip a patch that's already applied (re-running this step twice).
  for p in "$HERE"/../patches/*.patch; do
    [ -e "$p" ] || continue
    if ! git apply --check "$p" 2>/dev/null; then
      if git apply --reverse --check "$p" 2>/dev/null; then
        echo "already applied, skipping: $p"
        continue
      fi
      echo "FAILED to apply $p — upstream may have moved past our pin, or drifted incompatibly. Investigate before continuing." >&2
      exit 1
    fi
    git apply "$p"
    echo "applied: $p"
  done
}

# Extra host tools this build needs beyond Xcode CLT, all generic (not WASM-specific)
# gaps found in build/PROGRESS.md attempts 1-8. `brew install make gperf` once; the
# Perl module and PATH ordering are handled per-invocation below.
#   brew install make gperf
#   cpan -T Archive::Zip     # against Homebrew's perl (/opt/homebrew/bin/perl)

step_configure_headless() {
  disk_guard
  load_guard
  cd "$CORE_DIR"
  cp "$HERE/autogen.input" "$CORE_DIR/autogen.input"
  # shellcheck disable=SC1091
  source "$EMSDK_DIR/emsdk_env.sh"
  # gnubin make (Apple's 3.81 is too old) and /opt/homebrew/bin ahead of /usr/bin
  # (Apple's bundled gperf 3.0.3 is too old; PROGRESS.md attempt 7) — but see
  # PROGRESS.md attempts 3-6: do NOT try to fix the "bogus pkg-config" Homebrew-pkgconf
  # issue via PATH tricks, it's a dead end (literal-path whitelist check) — the
  # `--enable-bogus-pkg-config` / `--with-build-platform-configure-options=` flags in
  # autogen.input already handle it.
  export PATH="/opt/homebrew/opt/make/libexec/gnubin:/opt/homebrew/bin:$PATH"
  rm -rf CONF-FOR-BUILD config.cache config.log autom4te.cache 2>/dev/null || true
  nohup ./autogen.sh > "$HERE/autogen.log" 2>&1 &
  echo $! > "$HERE/BUILD_PID"
  echo "autogen/configure started, PID $(cat "$HERE/BUILD_PID"), log at $HERE/autogen.log"
}

step_build() {
  disk_guard
  load_guard
  cd "$CORE_DIR"
  # shellcheck disable=SC1091
  source "$EMSDK_DIR/emsdk_env.sh"
  export PATH="/opt/homebrew/opt/make/libexec/gnubin:/opt/homebrew/bin:$PATH"
  # Apply the .so/.dylib symlink workaround now if a prior run already produced the
  # real file (PROGRESS.md attempt 11) — a no-op on a truly fresh checkout, where the
  # retry loop below is what actually catches it the first time.
  bb_symlink_gcc3_uno_workaround() {
    local fb="$CORE_DIR/instdir_for_build/LibreOfficeDev.app/Contents/Frameworks"
    if [ -f "$fb/libgcc3_uno.dylib" ] && [ ! -e "$fb/libgcc3_uno.so" ]; then
      ln -sf libgcc3_uno.dylib "$fb/libgcc3_uno.so"
      echo "workaround applied: $fb/libgcc3_uno.so -> libgcc3_uno.dylib (PROGRESS.md attempt 11)"
      return 0
    fi
    return 1
  }
  bb_symlink_gcc3_uno_workaround || true

  # -j8, not all cores — shared-machine rule (task 1567 goal 2). On a FRESH checkout
  # the libgcc3_uno.dylib/.so mismatch (attempt 11) won't exist to symlink yet at this
  # point — this runs make, and if it dies on exactly that known signature, applies
  # the workaround and resumes (gbuild is incremental) ONCE, rather than looping
  # blindly. Any other failure is left alone and reported, not silently retried.
  run_make() {
    make -j8 > "$HERE/build.log" 2>&1
  }
  if ! run_make; then
    if grep -q "needed by.*saxparser.run" "$HERE/build.log" && bb_symlink_gcc3_uno_workaround; then
      echo "retrying make once after applying the known workaround..."
      run_make
    fi
  fi
  echo "build.log at $HERE/build.log — check its tail / exit status for the real outcome (this step runs to completion, not backgrounded, unlike configure)."
}

### Phase 2 — interactive Qt build (Linux host, e.g. the Legion over SSH) ###

step_emsdk_gui() {
  [ -d "$EMSDK_DIR" ] || git clone https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"
  cd "$EMSDK_DIR"
  ./emsdk install "$EMSDK_VERSION_GUI"
  ./emsdk activate "$EMSDK_VERSION_GUI"
}

step_qt5_clone() {
  disk_guard
  if [ ! -d "$QT5_DIR" ]; then
    git clone https://github.com/allotropia/qt5.git "$QT5_DIR"
  fi
  cd "$QT5_DIR"
  git checkout "$QT5_BRANCH"
  ./init-repository --module-subset=qtbase
}

# NOTE (found running this on the Legion, 2026-09-26): upstream's doc shows
# `./configure ...; make -j<CORES> module-qtbase` run from the `qt5` super-repo
# checkout. `qtbase` is ALSO a standalone, independently-buildable Qt module repo with
# its own `configure`/`Makefile` — running configure from *inside* `qt5/qtbase`
# (rather than `qt5/`) succeeds identically, but then `make module-qtbase` fails
# (`No rule to make target 'module-qtbase'` — that target only exists in the
# super-repo's generated Makefile). From inside `qtbase/` directly, the equivalent is
# plain `make` (no target). Both configure and make below run from `$QT5_DIR/qtbase`.
step_qt5_configure() {
  disk_guard
  load_guard
  cd "$QT5_DIR/qtbase"
  # shellcheck disable=SC1091
  source "$EMSDK_DIR/emsdk_env.sh"
  ./configure -opensource -confirm-license -xplatform wasm-emscripten -feature-thread \
    -prefix "$QT5_INSTALL_DIR" \
    QMAKE_CFLAGS+=-sSUPPORT_LONGJMP=wasm QMAKE_CXXFLAGS+=-sSUPPORT_LONGJMP=wasm \
    -nomake tests -nomake examples
}

step_qt5_build() {
  disk_guard
  load_guard
  cd "$QT5_DIR/qtbase"
  # shellcheck disable=SC1091
  source "$EMSDK_DIR/emsdk_env.sh"
  # -j12, capped per the Legion's own instructions (16 cores total, leave headroom).
  make -j12 > "$HERE/qt5-make.log" 2>&1
  echo "qt5-make.log at $HERE/qt5-make.log"
}

step_qt5_install() {
  cd "$QT5_DIR/qtbase"
  # shellcheck disable=SC1091
  source "$EMSDK_DIR/emsdk_env.sh"
  make -j12 install > "$HERE/qt5-install.log" 2>&1
}

step_clone_core_gui() {
  disk_guard
  if [ ! -d "$CORE_DIR" ]; then
    git clone --filter=blob:none --depth 1 https://github.com/LibreOffice/core.git "$CORE_DIR"
  fi
  cd "$CORE_DIR"
  if [ "$(git rev-parse HEAD)" != "$LO_COMMIT" ]; then
    git fetch --depth 1 origin "$LO_COMMIT"
    git checkout "$LO_COMMIT"
  fi
  # Apply ALL of our fork's patches, including the two added for the interactive
  # build: 0002 (hyperlink click must never window.open/navigate — docs/EGRESS.md #10)
  # and 0003 (Additions dialog must never auto-fetch — docs/EGRESS.md #3/#4), on top
  # of 0001 (uui/curl, Phase 1). Idempotent: skips a patch already applied.
  for p in "$HERE"/../patches/*.patch; do
    [ -e "$p" ] || continue
    if ! git apply --check "$p" 2>/dev/null; then
      if git apply --reverse --check "$p" 2>/dev/null; then
        echo "already applied, skipping: $p"
        continue
      fi
      echo "FAILED to apply $p — investigate before continuing." >&2
      exit 1
    fi
    git apply "$p"
    echo "applied: $p"
  done
}

step_configure_gui() {
  disk_guard
  load_guard
  cd "$CORE_DIR"
  cp "$HERE/autogen-gui.input" "$CORE_DIR/autogen.input"
  # shellcheck disable=SC1091
  source "$EMSDK_DIR/emsdk_env.sh"
  rm -rf CONF-FOR-BUILD config.cache config.log autom4te.cache 2>/dev/null || true
  ./autogen.sh > "$HERE/autogen-gui.log" 2>&1
  echo "autogen-gui.log at $HERE/autogen-gui.log"
}

step_build_gui() {
  disk_guard
  load_guard
  cd "$CORE_DIR"
  # shellcheck disable=SC1091
  source "$EMSDK_DIR/emsdk_env.sh"
  make -j12 > "$HERE/build-gui.log" 2>&1
  echo "build-gui.log at $HERE/build-gui.log"
}

case "${1:-}" in
  emsdk) step_emsdk ;;
  clone) step_clone_core ;;
  configure) step_configure_headless ;;
  build) step_build ;;
  emsdk-gui) step_emsdk_gui ;;
  qt5-clone) step_qt5_clone ;;
  qt5-configure) step_qt5_configure ;;
  qt5-build) step_qt5_build ;;
  qt5-install) step_qt5_install ;;
  clone-gui) step_clone_core_gui ;;
  configure-gui) step_configure_gui ;;
  build-gui) step_build_gui ;;
  *)
    echo "Usage: $0 {emsdk|clone|configure|build} (Phase 1, headless, macOS spike)" >&2
    echo "   or: $0 {emsdk-gui|qt5-clone|qt5-configure|qt5-build|qt5-install|clone-gui|configure-gui|build-gui}" >&2
    echo "       (Phase 2, interactive Qt build, Linux host — run in that order)" >&2
    echo "Long steps (qt5-build, build-gui) can take hours — wrap in nohup/tmux yourself:" >&2
    echo "  nohup $0 qt5-build > build/qt5-build-wrapper.log 2>&1 &" >&2
    exit 1
    ;;
esac
