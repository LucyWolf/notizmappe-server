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


def wer_dazu(ordner: Path, antwort: dict, namen: set) -> dict:
    """An jede markierte Seite schreiben, wer sie zuletzt gespeichert hat.

    Der Name steht im Feld `geraet` der Seite - dort, wo am eigenen Rechner
    die Zufallskennung des Browsers steht. Im Projekt traegt der Server den
    Benutzernamen ein, siehe server.py.

    Nachgesehen wird nur bei Seiten, die ohnehin ein Zeichen bekommen haben.
    Steht im Feld etwas, das kein Zugang ist (eine alte Fassung, eine
    Kennung vom Desktop), bleibt es weg: lieber nichts als eine Zahlenreihe.
    """
    if not isinstance(antwort, dict):
        return antwort
    for schluessel, seite in _seiten(antwort):
        if not seite.get("neu"):
            continue
        teile = schluessel.split("/")
        if len(teile) != 3 or any(t in ("", ".", "..") for t in teile):
            continue
        try:
            roh = json.loads((Path(ordner) / teile[0] / teile[1]
                              / (teile[2] + ".json")).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        wer = str(roh.get("geraet") or "") if isinstance(roh, dict) else ""
        if wer in namen:
            seite["wer"] = wer
    return antwort


def alles_gesehen(konfig: Path, projekt: str, antwort: dict,
                  buch: str = "", abschnitt: str = "") -> int:
    """Alles als gesehen ablegen - der Reiter Verlauf, "Als gelesen markieren".

    Ohne das bleibt ein Zeichen so lange stehen, bis man jede einzelne Seite
    aufgemacht hat. Wer aus dem Urlaub kommt und dreissig Zeichen vorfindet,
    will nicht dreissig Seiten anklicken, nur damit sie verschwinden.

    `buch` und `abschnitt` schraenken ein: leer heisst alles. Zurueck kommt,
    wie viele Seiten dadurch ihr Zeichen verlieren - null heisst, es war
    schon alles gelesen, und der Aufrufer kann das sagen, statt "fertig" zu
    melden, wo nichts war.
    """
    if not projekt or not isinstance(antwort, dict):
        return 0
    daten = _lesen(konfig)
    unter = dict(daten.get(projekt) or {})
    wieviele = 0
    for schluessel, seite in _seiten(antwort):
        geaendert = seite.get("geaendert")
        if not isinstance(geaendert, int):
            continue
        teile = schluessel.split("/")
        if buch and (len(teile) < 1 or teile[0] != buch):
            continue
        if abschnitt and (len(teile) < 2 or teile[1] != abschnitt):
            continue
        if unter.get(schluessel) != geaendert:
            wieviele += 1
        unter[schluessel] = geaendert
    if unter != daten.get(projekt):
        daten[projekt] = unter
        _schreiben(konfig, daten)
    return wieviele


MAX_DURCHSEHEN = 2000


def autoren(ordner: Path, antwort: dict, namen: set) -> dict:
    """Wer hat welche Seite zuletzt gespeichert - für den ganzen Baum.

    `wer_dazu` sieht absichtlich nur bei den markierten Seiten nach: das sind
    ein paar, und der Baum wird bei jedem Klick geladen. Hier wird jede Seite
    aufgemacht, dafür aber nur, wenn jemand ausdrücklich danach fragt.

    Über `MAX_DURCHSEHEN` hinaus wird abgebrochen und das gesagt, statt bei
    zehntausend Seiten minutenlang zu lesen und dabei zu schweigen.
    """
    aus = {"autoren": [], "seiten": [], "vollstaendig": True}
    if not isinstance(antwort, dict):
        return aus
    gefunden = {}
    gesehen = 0
    for schluessel, seite in _seiten(antwort):
        teile = schluessel.split("/")
        if len(teile) != 3 or any(t in ("", ".", "..") for t in teile):
            continue
        if gesehen >= MAX_DURCHSEHEN:
            aus["vollstaendig"] = False
            break
        gesehen += 1
        try:
            roh = json.loads((Path(ordner) / teile[0] / teile[1]
                              / (teile[2] + ".json")).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        wer = str(roh.get("geraet") or "") if isinstance(roh, dict) else ""
        # Nur echte Zugaenge. Steht dort eine Geraetekennung vom Desktop, ist
        # das kein Autor, sondern eine Zahlenreihe - die hilft niemandem.
        if wer not in namen:
            continue
        gefunden[wer] = gefunden.get(wer, 0) + 1
        aus["seiten"].append({
            "notizbuch": teile[0], "abschnitt": teile[1], "name": teile[2],
            "titel": str(seite.get("titel") or teile[2]),
            "wer": wer,
            "geaendert": seite.get("geaendert") if isinstance(seite.get("geaendert"), int) else 0,
        })
    aus["autoren"] = [{"name": k, "seiten": v}
                      for k, v in sorted(gefunden.items(), key=lambda z: (-z[1], z[0]))]
    return aus


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
