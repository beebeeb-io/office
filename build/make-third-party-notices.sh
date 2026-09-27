#!/usr/bin/env bash
# Beebeeb office — assemble bridge/THIRD_PARTY_NOTICES.txt.
#
# That file ships INSIDE the served engine bundle: web's scripts/office-dev-assets.sh
# copies it from this repo's bridge/ directory next to the engine files, the same way
# it copies bb-office-api.js. It is generated, never hand-edited: the parts live in
# notices/ (verbatim license texts plus our own HEADER.txt) and build/tarballs/OFL.txt.
#
# Usage:
#   build/make-third-party-notices.sh           regenerate bridge/THIRD_PARTY_NOTICES.txt
#   build/make-third-party-notices.sh --check   exit 1 if the committed file is stale
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
OUT="$ROOT/bridge/THIRD_PARTY_NOTICES.txt"

# appendix <letter> <title> <file>
appendix() {
  local f="$ROOT/$3"
  [ -s "$f" ] || { echo "FAILED: $3 is missing or empty" >&2; exit 1; }
  printf '\n\n'
  printf '%.0s=' $(seq 1 78); printf '\n'
  printf 'Appendix %s. %s\n' "$1" "$2"
  printf '(source file in https://github.com/beebeeb-io/office: %s)\n' "$3"
  printf '%.0s=' $(seq 1 78); printf '\n\n'
  cat "$f"
}

render() {
  [ -s "$ROOT/notices/HEADER.txt" ] || { echo "FAILED: notices/HEADER.txt missing" >&2; exit 1; }
  cat "$ROOT/notices/HEADER.txt"
  appendix A "Mozilla Public License 2.0" notices/MPL-2.0.txt
  appendix B "GNU Lesser General Public License 3.0 (Qt's copy)" notices/Qt-LGPL-3.0.txt
  appendix C "GNU General Public License 3.0 (Qt's copy)" notices/Qt-GPL-3.0.txt
  appendix D "Emscripten license (emscripten 4.0.10)" notices/Emscripten-LICENSE.txt
  appendix E "Fonts: SIL Open Font License 1.1" build/tarballs/OFL.txt
  appendix F "LibreOffice license file for this build" notices/LibreOffice-LICENSE.txt
  appendix G "LibreOffice NOTICE (Apache-2.0 attributions)" notices/LibreOffice-NOTICE.txt
}

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
render > "$TMP"

# The checks below prove the render did something before we trust it.
for marker in "Mozilla Public License Version 2.0" "GNU LESSER GENERAL PUBLIC LICENSE" \
              "GNU GENERAL PUBLIC LICENSE" "SIL OPEN FONT LICENSE Version 1.1" \
              "University of Illinois/NCSA" "This product uses Qt." \
              "f8941520720922033948ca14081dbb3dabbbe6b7"; do
  grep -qF "$marker" "$TMP" || { echo "FAILED: rendered notices lack: $marker" >&2; exit 1; }
done

case "${1:-}" in
  --check)
    if cmp -s "$TMP" "$OUT"; then
      echo "OK: $OUT is current ($(wc -c < "$OUT" | tr -d ' ') bytes)"
    else
      echo "STALE: $OUT differs from a fresh render; run $0 and commit the result" >&2
      exit 1
    fi
    ;;
  "")
    cp "$TMP" "$OUT"
    echo "wrote $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
    ;;
  *) echo "usage: $0 [--check]" >&2; exit 1 ;;
esac
