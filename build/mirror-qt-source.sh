#!/usr/bin/env bash
# Beebeeb office — produce the Qt corresponding-source tarballs for the engine.
#
# Why: the shipped engine statically links Qt 5.15.2+wasm (allotropia's fork, qtbase
# module only) into soffice.wasm. LGPL-3.0 §4(d)(0) plus GPLv3 §6(d) require us to
# keep the Corresponding Source available for as long as we ship the engine. Pointing
# only at a third-party GitHub fork is weak (it can be force-pushed or deleted), so we
# host our own copy as release assets on github.com/beebeeb-io/office (see NOTICE).
#
# What it does: fetches EXACTLY the two commits build/wasm.sh pins (QT5_COMMIT and
# QTBASE_COMMIT, read from wasm.sh itself so the two can never drift), from
# allotropia's public GitHub forks, into a fresh scratch directory, and writes
#   qt5-<QT5_COMMIT>.tar.gz        (the qt5 super-repo at the pin, no submodules)
#   qtbase-<QTBASE_COMMIT>.tar.gz  (the qtbase module at the pin; the only Qt
#                                   module the engine builds or links)
#   SHA256SUMS
# `git archive` output depends only on the commit, so re-running this reproduces the
# same bytes and the same sha256 on any host with the same git version.
#
# Usage: build/mirror-qt-source.sh <empty-or-new-output-dir>
#   Needs git and network access to github.com. About 250 MB of transfer; run it on a
#   build host, not a laptop under load. It never touches build/qt5 or any existing
#   Qt checkout.
#
# Publish (lead, once the tarballs are checked):
#   gh release create qt-source-5.15.2-wasm-<QT5_COMMIT:0:7> --repo beebeeb-io/office \
#     --target <commit> --title "Qt corresponding source (engine build)" \
#     <out>/qt5-*.tar.gz <out>/qtbase-*.tar.gz <out>/SHA256SUMS
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${1:?usage: $0 <output-dir>}"

QT5_COMMIT="$(sed -n 's/^QT5_COMMIT="\([0-9a-f]\{40\}\)".*/\1/p' "$HERE/wasm.sh")"
QTBASE_COMMIT="$(sed -n 's/^QTBASE_COMMIT="\([0-9a-f]\{40\}\)".*/\1/p' "$HERE/wasm.sh")"
[ -n "$QT5_COMMIT" ] || { echo "FAILED: QT5_COMMIT not found in $HERE/wasm.sh" >&2; exit 1; }
[ -n "$QTBASE_COMMIT" ] || { echo "FAILED: QTBASE_COMMIT not found in $HERE/wasm.sh" >&2; exit 1; }

mkdir -p "$OUT"
if [ -n "$(ls -A "$OUT")" ]; then
  echo "FAILED: $OUT is not empty; give a fresh directory" >&2
  exit 1
fi
OUT="$(cd "$OUT" && pwd)"
WORK="$OUT/.work"
mkdir -p "$WORK"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

# fetch_pinned <name> <url> <commit>: shallow-fetch exactly one commit, verify it.
fetch_pinned() {
  local name="$1" url="$2" commit="$3" dir="$WORK/$1"
  git init -q "$dir"
  git -C "$dir" remote add origin "$url"
  git -C "$dir" fetch -q --depth 1 origin "$commit"
  local got
  got="$(git -C "$dir" rev-parse FETCH_HEAD)"
  [ "$got" = "$commit" ] || { echo "FAILED: $name fetched $got, expected $commit" >&2; exit 1; }
  git -C "$dir" archive --format=tar.gz --prefix="$name-$commit/" \
    -o "$OUT/$name-$commit.tar.gz" "$commit"
  echo "archived $name@$commit -> $OUT/$name-$commit.tar.gz"
}

fetch_pinned qt5 https://github.com/allotropia/qt5.git "$QT5_COMMIT"
fetch_pinned qtbase https://github.com/allotropia/qtbase.git "$QTBASE_COMMIT"
rm -rf "$WORK"

( cd "$OUT" && for f in qt5-*.tar.gz qtbase-*.tar.gz; do
    printf '%s  %s\n' "$(sha256_of "$f")" "$f"
  done ) > "$OUT/SHA256SUMS"
cat "$OUT/SHA256SUMS"
