"""Was in einer Gruppe seit dem letzten Blick anders geworden ist.

In eigenen Notizen gibt es diese Frage nicht: dort ändert nur einer etwas,
und der weiß es. In einem Projekt arbeiten mehrere im selben Ordner — dort
ist „was hat sich getan, seit ich zuletzt hingesehen habe?" die einzige
Frage, die man beim Aufmachen hat. Hinter so einer Seite steht in der Leiste
ein **!**.

Gemerkt wird das **je Benutzer**, in seinem Konfigordner, und nicht in der
Seite. Zwei Gründe:

* Die Seiten eines Projekts gehören allen. Eine Leseliste in der Seite wäre
  eine Änderung an der Seite — jedes Aufmachen würde die Datei anfassen und
  bei allen anderen als neue Änderung auftauchen. Ein Zeichen, das sich
  selbst erzeugt.
* Wer ein Projekt verlässt, nimmt seine Liste mit. Im Projektordner bliebe
  sie liegen.

Verglichen wird mit `st_mtime` der Seitendatei — dieselbe Zahl, die der Baum
ohnehin mitschickt. Eine eigene Buchführung darüber, wer wann gespeichert
hat, gibt es nicht und müsste in die Seiten hinein.

**Beim ersten Blick in ein Projekt** wird alles stillschweigend als gesehen
abgelegt. Sonst stünde für jeden, der neu dazukommt, hinter jeder Seite ein
Ausrufezeichen — und ein Zeichen, das überall steht, sagt nichts. Danach ist
eine Seite, die noch nicht in der Liste steht, eine **neue** Seite und wird
gezeigt.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

DATEI = "gesehen.json"


def _pfad(konfig: Path) -> Path:
    return Path(konfig) / DATEI


def _lesen(konfig: Path) -> dict:
    try:
        roh = json.loads(_pfad(konfig).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(roh, dict):
        return {}
    # Nur das, was auch die Form hat: eine kaputte Datei darf hier nichts
    # umwerfen, sie kostet hoechstens einmal die Markierungen.
    return {k: v for k, v in roh.items() if isinstance(v, dict)}


def _schreiben(konfig: Path, daten: dict) -> None:
    ziel = _pfad(konfig)
    try:
        ziel.parent.mkdir(parents=True, exist_ok=True)
        vorlaeufig = ziel.with_suffix(".tmp")
        vorlaeufig.write_text(json.dumps(daten), encoding="utf-8")
        os.replace(vorlaeufig, ziel)
    except OSError:
        pass          # Kein Platz, keine Rechte: dann eben ohne Markierungen


def _seiten(antwort: dict):
    """(Schluessel, Seite) fuer jede Seite im Baum."""
    for buch in antwort.get("notizbuecher") or []:
        for abschnitt in buch.get("abschnitte") or []:
            for seite in abschnitt.get("seiten") or []:
                yield f"{buch.get('name')}/{abschnitt.get('name')}/{seite.get('name')}", seite


def markieren(konfig: Path, projekt: str, antwort: dict) -> dict:
    """Jeder Seite, die sich seit dem letzten Blick geändert hat, ein "neu" mit."""
    if not projekt or not isinstance(antwort, dict):
        return antwort
    daten = _lesen(konfig)
    erster_blick = projekt not in daten
    bekannt = dict(daten.get(projekt) or {})
    jetzt = {}
    for schluessel, seite in _seiten(antwort):
        geaendert = seite.get("geaendert")
        if not isinstance(geaendert, int):
            continue
        jetzt[schluessel] = bekannt.get(schluessel, geaendert)
        if erster_blick:
            continue
        if schluessel not in bekannt or geaendert > bekannt[schluessel]:
            seite["neu"] = True
    # Gelöschte Seiten fallen heraus, neue kommen nur beim ersten Blick
    # hinein: sonst wäre die Markierung schon wieder weg, bevor sie jemand
    # gesehen hat.
    gesichert = {k: v for k, v in bekannt.items() if k in jetzt}
    if erster_blick:
        gesichert = jetzt
    if gesichert != daten.get(projekt):
        daten[projekt] = gesichert
        _schreiben(konfig, daten)
    return antwort


def merken(konfig: Path, projekt: str, teile: list, zeit: int) -> None:
    """Diese Seite hat der Benutzer jetzt gesehen - mit diesem Stand."""
    if not projekt or len(teile) != 3 or not all(teile) or not isinstance(zeit, int):
        return
    daten = _lesen(konfig)
    unter = dict(daten.get(projekt) or {})
    unter["/".join(str(t) for t in teile)] = zeit
    daten[projekt] = unter
    _schreiben(konfig, daten)


def vergessen(konfig: Path, projekt: str) -> None:
    """Ein Projekt ganz aus der Liste nehmen (beim Austritt)."""
    daten = _lesen(konfig)
    if daten.pop(projekt, None) is not None:
        _schreiben(konfig, daten)
