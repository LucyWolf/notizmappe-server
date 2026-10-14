#!/usr/bin/env bash
# Holt das Desktop-Programm in einer festen Fassung nach ./desktop.
#
# Das ist der Kern der ganzen Bauweise: Oberflaeche und Ablage gibt es nur
# einmal, naemlich im Desktop-Repo. Hier wird nichts kopiert und nichts
# nachgepflegt - es wird geholt. Damit koennen die beiden Fassungen optisch
# nicht auseinanderlaufen.
set -euo pipefail
WURZEL=$(cd "$(dirname "$0")/.." && pwd)
FASSUNG=${1:-$(tr -d ' \n' < "$WURZEL/DESKTOP_VERSION")}
ZIEL=$WURZEL/desktop

if [ -n "${DESKTOP_PFAD:-}" ]; then
  # Entwickeln: gegen den Arbeitsordner nebenan statt gegen ein Release.
  echo "Desktop aus $DESKTOP_PFAD (nicht aus einem Release)"
  rm -rf "$ZIEL"; mkdir -p "$ZIEL"
  cp -r "$DESKTOP_PFAD/app" "$ZIEL/app"
  exit 0
fi

echo "Desktop v$FASSUNG holen …"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "https://github.com/LucyWolf/notizmappe/archive/refs/tags/v$FASSUNG.tar.gz" \
  | tar -xz -C "$TMP"
QUELLE=$TMP/notizmappe-$FASSUNG
[ -d "$QUELLE/app" ] || { echo "Im Archiv liegt kein app/ - falsche Fassung?" >&2; exit 1; }
DRIN=$(tr -d ' \n' < "$QUELLE/app/VERSION")
[ "$DRIN" = "$FASSUNG" ] || { echo "Archiv sagt $DRIN, erwartet war $FASSUNG" >&2; exit 1; }
rm -rf "$ZIEL"; mkdir -p "$ZIEL"
cp -r "$QUELLE/app" "$ZIEL/app"
echo "  -> desktop/app (v$DRIN)"
