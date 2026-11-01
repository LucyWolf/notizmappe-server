"""Jede Änderung bleibt - ein Jahr lang. Die Server-Regel dafür.

Drüben im Desktop wird dreifach ausgedünnt: höchstens alle zehn Minuten eine
Fassung, nach einem Tag nur noch eine je Tag, nach einem Monat eine je Woche,
und nach 90 Tagen ist Schluss. Das ist für einen Rechner gedacht, auf dem eine
Platte voll werden kann und auf dem eine Seite einem Menschen gehört.

Hier gilt etwas anderes: **alles bleibt, ein Jahr lang.** Geändert wird dafür
nichts drüben - die beiden Funktionen werden beim Start ersetzt. Kopiert wird
auch nichts: was hier steht, sind zwanzig Zeilen eigene Regel und nicht eine
zweite Fassung der Ablage.

Zwei Sachen, die dabei zählen:

**Feiner als eine Sekunde geht es nicht.** Eine Fassung heißt nach ihrem
Zeitpunkt (`20261101-143052.json`), und die Oberfläche speichert 900 ms nach
der letzten Eingabe. "Jede Änderung" heißt hier also: jede Sekunde, in der
sich etwas geändert hat. Wer eine Stunde am Stück schreibt, bekommt bis zu
3600 Fassungen einer Seite - das ist gewollt, aber man sollte es wissen.

**Nicht bei jedem Speichern aufräumen.** Drüben liest das Wegräumen jedes Mal
den ganzen Ordner; bei zehn Fassungen ist das nichts, bei zehntausend hängt
daran jedes Speichern. Deshalb merkt sich jeder Ordner in `.geputzt`, wann er
zuletzt durchgesehen wurde, und das passiert höchstens einmal am Tag.
"""
from __future__ import annotations

import os
import time
from pathlib import Path

TAGE = 365
PUTZ_ABSTAND = 24 * 3600
PUTZMARKE = ".geputzt"

_speicher = [None]


def tage() -> int:
    """Wie lange der Verlauf hält. NOTIZMAPPE_VERLAUF_TAGE sticht."""
    roh = (os.environ.get("NOTIZMAPPE_VERLAUF_TAGE") or "").strip()
    if roh.isdigit() and 1 <= int(roh) <= 36500:
        return int(roh)
    return TAGE


def merken(datei: Path, erzwingen: bool = False) -> bool:
    """Den Stand einer Seite als Fassung ablegen - ohne Abstand, ohne Ausdünnen.

    `erzwingen` gibt es nur, weil die Stelle drüben es mitschickt (vor einem
    Konflikt); hier ist ohnehin immer gemeint.
    """
    speicher = _speicher[0]
    if speicher is None or not datei.is_file():
        return False
    ordner = speicher.verlauf_ordner(datei)
    try:
        ordner.mkdir(parents=True, exist_ok=True)
        ziel = ordner / (time.strftime("%Y%m%d-%H%M%S") + ".json")
        if ziel.exists():
            return False                    # in dieser Sekunde schon eine
        # Roh kopieren, nicht neu schreiben: so bleibt die Fassung genau das,
        # was auf der Platte stand.
        ziel.write_bytes(datei.read_bytes())
        aufraeumen(ordner)
        return True
    except OSError:
        return False                        # Verlauf ist nett, nicht wichtig


def aufraeumen(ordner: Path) -> int:
    """Nur wegwerfen, was älter ist als ein Jahr. Sonst nichts."""
    jetzt = time.time()
    marke = ordner / PUTZMARKE
    try:
        if jetzt - marke.stat().st_mtime < PUTZ_ABSTAND:
            return 0                        # heute schon durchgesehen
    except OSError:
        pass
    grenze = jetzt - tage() * 86400
    weg = 0
    for p in ordner.glob("*.json"):
        try:
            if p.stat().st_mtime < grenze:
                p.unlink()
                weg += 1
        except OSError:
            continue
    try:
        marke.write_text(str(int(jetzt)), encoding="utf-8")
    except OSError:
        pass                                # dann eben beim nächsten Mal wieder
    return weg


def einrichten(speicher) -> None:
    """Die Regel des Servers an die Stelle der Desktop-Regel setzen."""
    _speicher[0] = speicher
    speicher.VERLAUF_ABSTAND = 0
    speicher.VERLAUF_TAGE = tage()
    # Die Anzahl je Seite ist drüben die harte Grenze. Hier soll die Zeit
    # entscheiden und nicht eine Zahl.
    speicher.VERLAUF_ANZAHL = 10 ** 9
    speicher.verlauf_merken = merken
    speicher._ausduennen = aufraeumen
