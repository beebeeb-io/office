#!/usr/bin/env bash
# Beebeeb office — LibreOffice-core-to-WASM build recipe.
#
# Phase 1 spike (task 1567) status: `autogen.sh`/`configure` SUCCEEDS for the HEADLESS
# module build (--disable-gui, --with-wasm-module="writer calc impress") on this Mac
# (macOS 26, Apple Silicon arm64) — see build/PROGRESS.md for the 8 real toolchain
# fixes this took (none of them WASM-specific — all generic "first LO build on this
# Mac's Homebrew+pyenv mix" gaps). Does NOT attempt the interactive Qt/GUI build in
# this phase (see docs/PHASE1-FEASIBILITY.md — that needs allotropia's patched Qt5
# fork and a documented "possibly needs 64GB RAM" link step; this Mac has 32GB).
#
# This script documents the recipe as a reproducible sequence, not a magic one-shot —
# read build/PROGRESS.md for what has actually been verified vs. what is still to try.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$HERE/core"
EMSDK_DIR="$HERE/emsdk"
EMSDK_VERSION="3.1.46"   # bumped from the doc's stated 3.1.30 — see PROGRESS.md attempt 1
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

case "${1:-}" in
  emsdk) step_emsdk ;;
  clone) step_clone_core ;;
  configure) step_configure_headless ;;
  build) step_build ;;
  *)
    echo "Usage: $0 {emsdk|clone|configure|build}" >&2
    echo "Run in order. 'configure' backgrounds itself (nohup) and writes build/BUILD_PID" >&2
    echo "immediately — poll build/autogen.log. 'build' runs make -j8 to completion in" >&2
    echo "THIS process (it needs to inspect the log to decide on a known-failure retry)" >&2
    echo "and can take a very long time — wrap the whole invocation yourself if you want" >&2
    echo "it backgrounded: nohup $0 build > build/build-wrapper.log 2>&1 &" >&2
    exit 1
    ;;
esac
