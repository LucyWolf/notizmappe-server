#!/usr/bin/env bash
# Alle Tests des Servers.
#   tests/alle.sh
set -uo pipefail
WURZEL=$(cd "$(dirname "$0")/.." && pwd)
PY=${PY:-python3}
fehler=0
echo "=== Syntax ==="
"$PY" "$WURZEL/tools/pruefen.py" || fehler=$((fehler+1))
for t in test_api test_konten; do
  echo "=== $t ==="
  "$PY" "$WURZEL/tests/$t.py" 2>&1 | grep -v StarletteDeprecation | grep -v "from starlette.testclient" | tail -40
  [ "${PIPESTATUS[0]}" = 0 ] || fehler=$((fehler+1))
done
echo
[ $fehler -eq 0 ] && echo "ALLES GRUEN" || echo "$fehler Testgruppen mit Fehlern"
exit $fehler
