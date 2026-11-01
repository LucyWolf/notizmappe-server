#!/usr/bin/env python3
"""Die Fassungsnummer eine Stelle hochzaehlen.

Gebraucht wird das vom taeglichen Nachziehen: holt es eine neue Oberflaeche,
entsteht ein neues Image - und das muss eine eigene Nummer haben. Sonst liegt
unter derselben Nummer ein anderer Inhalt, und vor allem: `/fassung`
vergleicht die Nummer bei GitHub mit der laufenden. Bleibt sie gleich, erfaehrt
keine laufende Installation je, dass es etwas Neues gibt - der ganze
Update-Hinweis haengt daran.

Gezaehlt wird die letzte Stelle bis 99, dann die davor. Nie rueckwaerts, und
eine schon vergebene Nummer kommt nie wieder.

    tools/fassung_hoch.py            VERSION lesen, hochzaehlen, zurueckschreiben
    tools/fassung_hoch.py 1.2.18     nur ausrechnen und ausgeben
"""
import sys
from pathlib import Path

GRENZE = 99


def naechste(wert: str) -> str:
    teile = (wert or "").strip().split(".")
    if not teile or not all(t.isdigit() for t in teile):
        raise ValueError(f"Das ist keine Fassungsnummer: {wert!r}")
    zahlen = [int(t) for t in teile]
    zahlen[-1] += 1
    # Von hinten nach vorn uebertragen. Bei einer einstelligen Nummer gibt es
    # nichts zu uebertragen - dann zaehlt sie eben weiter.
    for i in range(len(zahlen) - 1, 0, -1):
        if zahlen[i] > GRENZE:
            zahlen[i] = 0
            zahlen[i - 1] += 1
    return ".".join(str(z) for z in zahlen)


if __name__ == "__main__":
    if len(sys.argv) > 1:
        print(naechste(sys.argv[1]))
    else:
        p = Path(__file__).resolve().parent.parent / "VERSION"
        neu = naechste(p.read_text(encoding="utf-8"))
        p.write_text(neu + "\n", encoding="utf-8")
        print(neu)
