#!/usr/bin/env bash
# Alle Tests der Serverfassung.
#   tests/alle.sh                     gegen die Fassung aus DESKTOP_VERSION
#   DESKTOP_PFAD=../notizmappe tests/alle.sh   gegen den Arbeitsordner nebenan
set -uo pipefail
WURZEL=$(cd "$(dirname "$0")/.." && pwd)
PY=$WURZEL/.venv/bin/python
[ -x "$PY" ] || PY=python3
fehler=0

echo "=== Desktop holen ==="
"$WURZEL/tools/desktop_holen.sh" || exit 1

for t in test_gleich test_server test_ablage test_selbst test_zerren test_glaetten test_balken test_post test_reiter; do
  echo "=== $t ==="
  "$PY" "$WURZEL/tests/$t.py" 2>&1 | tail -60
  [ "${PIPESTATUS[0]}" = 0 ] || fehler=$((fehler+1))
done

echo
[ $fehler -eq 0 ] && echo "ALLES GRUEN" || echo "$fehler Testgruppen mit Fehlern"
exit $fehler
