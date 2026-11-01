#!/usr/bin/env python3
"""Sich selbst aktualisieren - und vor allem: der Weg zurueck.

Der Server laedt Code nach und fuehrt ihn beim naechsten Start aus. Die
gefaehrliche Stelle ist dabei nicht das Holen, sondern was passiert, wenn das
Geholte nicht laeuft: ohne Oberflaeche gibt es keinen Knopf mehr, mit dem man
es zuruecknimmt. Deshalb steht hier der Rueckfall im Mittelpunkt und nicht der
Erfolgsfall.

Geholt wird in diesen Tests nichts - die Archive werden ortlich gebaut.
"""
import io
import os
import sys
import tarfile
import tempfile
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="notizmappe-selbst-"))
sys.path.insert(0, str(WURZEL / "web"))

import selbst                                                      # noqa: E402

fehler = []


def pruefe(was, bedingung, zusatz=""):
    print(("  ok    " if bedingung else "  FEHLER ") + was
          + ("" if bedingung else f"  [{zusatz}]"))
    if not bedingung:
        fehler.append(was)


def archiv(dateien: dict) -> bytes:
    """Ein tar.gz im Speicher, wie GitHub es liefert (ein Ordner obendrueber)."""
    roh = io.BytesIO()
    with tarfile.open(fileobj=roh, mode="w:gz") as t:
        for name, inhalt in dateien.items():
            b = inhalt.encode("utf-8")
            info = tarfile.TarInfo(f"repo-haupt/{name}")
            info.size = len(b)
            t.addfile(info, io.BytesIO(b))
    return roh.getvalue()


print("Was beim Auspacken nicht passieren darf")
# Ein Archiv, das aus dem Zielordner herausschreiben will. filter="data" muss
# das abfangen - sonst schreibt ein Update irgendwohin.
boese = io.BytesIO()
with tarfile.open(fileobj=boese, mode="w:gz") as t:
    b = b"weg damit"
    info = tarfile.TarInfo("repo/../../entkommen.txt")
    info.size = len(b)
    t.addfile(info, io.BytesIO(b))
ziel = TMP / "auspacken"
try:
    selbst._entpacken(boese.getvalue(), ziel, "web")
except selbst.SelbstFehler:
    pass
pruefe("ein Archiv kommt nicht aus dem Zielordner heraus",
       not (TMP / "entkommen.txt").exists() and not (ziel.parent / "entkommen.txt").exists())

print()
print("Welche Fassung gilt")
daten = TMP / "daten"
(daten / ".programm").mkdir(parents=True)
pruefe("ohne Marke gilt das Image", selbst.aktive_fassung(daten) == "")

(daten / ".programm" / "aktiv").write_text("1.2.0")
pruefe("eine Marke ohne Ordner gilt nicht", selbst.aktive_fassung(daten) == "")

echt = daten / ".programm" / "1.2.0" / "web"
echt.mkdir(parents=True)
(echt / "server.py").write_text("# da")
pruefe("mit Ordner gilt sie", selbst.aktive_fassung(daten) == "1.2.0")

for fies in ("../etc", "/etc", ".heimlich"):
    (daten / ".programm" / "aktiv").write_text(fies)
    pruefe(f"ein Pfadwechsel in der Marke zaehlt nicht: {fies!r}",
           selbst.aktive_fassung(daten) == "")
(daten / ".programm" / "aktiv").write_text("1.2.0")

print()
print("Der Rueckfall - eine Fassung, die nicht hochkommt")
pruefe("erster Anlauf wird gezaehlt", selbst.versuch_merken(daten, "1.2.0") == 1)
pruefe("zweiter auch", selbst.versuch_merken(daten, "1.2.0") == 2)
pruefe("dritter auch", selbst.versuch_merken(daten, "1.2.0") == 3)
selbst.versuch_gelungen(daten)
pruefe("nach einem geglueckten Start faengt die Zaehlung von vorn an",
       selbst.versuch_merken(daten, "1.2.0") == 1)
selbst.versuch_gelungen(daten)
pruefe("eine andere Fassung zaehlt getrennt", selbst.versuch_merken(daten, "1.3.0") == 1)

# Die Nummer aus dem Archiv wird zu einem Ordnernamen und zu einem Stueck
# URL. Ungeprueft liefe sie aus /daten/.programm heraus - und ausgerechnet in
# der Datei, die Code nachlaedt.
# Das taegliche Nachziehen baut ein neues Image - und muss ihm eine eigene
# Nummer geben. Bliebe sie stehen, laege unter derselben Nummer ein anderer
# Inhalt, und /fassung haette nichts zu vergleichen: keine laufende
# Installation erfuehre je davon.
# Der Zaehler ist der ganze Weg zurueck. Laesst er sich nicht schreiben, darf
# die nachgeladene Fassung gar nicht erst gelten - sonst wird sie endlos wieder
# versucht, und ohne Oberflaeche gibt es keinen Knopf, der sie zuruecknimmt.
print()
print("Wenn sich der Startversuch nicht merken laesst")
import start as startmodul                                      # noqa: E402

echt_write = Path.write_text


def _geht_nicht(selbst_, *a, **b):
    if selbst_.name == "startversuch":
        raise OSError(30, "Read-only file system")
    return echt_write(selbst_, *a, **b)


Path.write_text = _geht_nicht
try:
    zahl = selbst.versuch_merken(daten, "9.9.9")
    startmodul.DATEN = str(daten)
    gewaehlt = startmodul.programm_waehlen()
finally:
    Path.write_text = echt_write
pruefe("versuch_merken sagt: verlass dich nicht darauf", zahl == -1, zahl)
pruefe("und gestartet wird aus dem Image",
       gewaehlt[0] == "/srv/web", gewaehlt)

print()
print("Die Nummer hochzaehlen")
sys.path.insert(0, str(WURZEL / "tools"))
import fassung_hoch                                              # noqa: E402

for vorher, erwartet in (("1.2.18", "1.2.19"), ("1.2.9", "1.2.10"),
                         ("1.2.99", "1.3.0"), ("1.99.99", "2.0.0"),
                         ("0.9", "0.10"), ("7", "8")):
    raus = fassung_hoch.naechste(vorher)
    pruefe(f"{vorher} -> {erwartet}", raus == erwartet, raus)
# Die letzte Stelle zaehlt bis 99 - 1.2.9 wird 1.2.10 und nicht 1.3.0.
pruefe("neun ist kein Ueberlauf", fassung_hoch.naechste("1.2.9") == "1.2.10")
for schlecht in ("", "v1.2", "1.2.x", "1..2"):
    try:
        fassung_hoch.naechste(schlecht)
        gut = False
    except ValueError:
        gut = True
    pruefe(f"abgelehnt: {schlecht!r}", gut)
# Und das Entscheidende: die neue Nummer muss gegen die alte als neuer gelten,
# sonst bleibt der Hinweis aus.
for vorher in ("1.2.18", "1.2.99", "1.99.99", "0.9"):
    pruefe(f"{vorher} gilt als aelter als {fassung_hoch.naechste(vorher)}",
           selbst.neuer_als(fassung_hoch.naechste(vorher), vorher))

print()
print("Was als Fassungsnummer durchgeht")
for schlecht in ("1./../../tmp/x", "../1.2.3", "1.2.3/..", "1.2.3; rm -rf /",
                 "v1.2.3", "", "latest", "1.2.3\n4"):
    try:
        selbst.fassung_sauber(schlecht)
        gut = False
    except selbst.SelbstFehler:
        gut = True
    pruefe(f"abgelehnt: {schlecht!r}", gut)
pruefe("1.2.17 geht durch", selbst.fassung_sauber("1.2.17") == "1.2.17")
pruefe("und 2.0 auch", selbst.fassung_sauber(" 2.0 ") == "2.0")
# _zahlen allein haette den Pfadwechsel nicht gesehen - genau deshalb steht
# jetzt ein Muster daneben.
pruefe("_zahlen allein haette das durchgelassen", bool(selbst._zahlen("1./../../tmp/x")))

print()
erst = selbst.zuruecknehmen(daten)
pruefe("zuruecknehmen loescht die Marke", selbst.aktive_fassung(daten) == "")
pruefe("und sagt, dass es etwas zurueckzunehmen gab", erst.get("getan") is True, erst)
# Nur dann startet der Server neu. Vorher flog bei jedem Druck auf den Knopf
# jeder aus seiner Sitzung - auch wenn hier laengst die Fassung aus dem Image
# lief.
nochmal = selbst.zuruecknehmen(daten)
pruefe("beim zweiten Mal gab es nichts mehr zurueckzunehmen",
       nochmal.get("getan") is False, nochmal)
pruefe("und es steht ein Satz dabei, der das sagt",
       "nichts" in nochmal.get("hinweis", "").lower(), nochmal)
pruefe("der Ordner bleibt aber liegen", (daten / ".programm" / "1.2.0").is_dir())

print()
print("Fassungen vergleichen")
pruefe("1.1.85 ist neuer als 1.1.84", selbst.neuer_als("1.1.85", "1.1.84"))
pruefe("1.1.84 ist nicht neuer als sich selbst", not selbst.neuer_als("1.1.84", "1.1.84"))
pruefe("1.1.9 ist aelter als 1.1.84 (Zahlen, nicht Text)",
       not selbst.neuer_als("1.1.9", "1.1.84"))
pruefe("Unsinn ist nie neuer", not selbst.neuer_als("latest", "1.1.84"))

print()
print("Aufraeumen")
for f in ("1.0.0", "1.0.1", "1.0.2"):
    (daten / ".programm" / f).mkdir(exist_ok=True)
selbst.aufraeumen(daten, behalten="1.2.0")
uebrig = sorted(p.name for p in (daten / ".programm").iterdir() if p.is_dir())
pruefe("eine alte Fassung bleibt als Weg zurueck", "1.2.0" in uebrig and len(uebrig) == 2,
       str(uebrig))

print()
print("Geholt wird nur von den eigenen Repos")
for adresse in ("http://codeload.github.com/LucyWolf/x/tar.gz/y",
                "https://example.invalid/boese.tar.gz",
                "https://codeload.github.com/jemand-anders/x/tar.gz/y"):
    try:
        selbst._holen(adresse)
        pruefe(f"abgelehnt: {adresse[:46]}", False, "durchgelassen")
    except selbst.SelbstFehler:
        pruefe(f"abgelehnt: {adresse[:46]}", True)
    except Exception as f:                                          # noqa: BLE001
        pruefe(f"abgelehnt: {adresse[:46]}", False, f"anderer Fehler: {f}")

print()
print("Eine Fassung, die nicht uebersetzt, wird nicht scharf gestellt")
kaputt = TMP / "kaputt"
(kaputt / "web").mkdir(parents=True)
(kaputt / "web" / "server.py").write_text("def (:\n")
try:
    selbst._syntax_pruefen(kaputt)
    pruefe("kaputtes Python faellt auf", False, "durchgelassen")
except selbst.SelbstFehler as f:
    pruefe("kaputtes Python faellt auf", "server.py" in str(f))

print()
print("Die Fassung kommt aus VERSION, nicht aus DESKTOP_VERSION")
quelle = TMP / "repo"
(quelle / "web").mkdir(parents=True)
(quelle / "VERSION").write_text("1.3.0")
(quelle / "DESKTOP_VERSION").write_text("1.1.84")
pruefe("der Server zaehlt eigenstaendig",
       selbst.neuer_als((quelle / "VERSION").read_text().strip(), "1.2.0"))
pruefe("die Oberflaeche darf dabei stehenbleiben",
       not selbst.neuer_als((quelle / "DESKTOP_VERSION").read_text().strip(), "1.1.84"))
pruefe("VERSION gehoert zu den Pflichtdateien", "VERSION" in selbst.PFLICHT)

print()
print("Das Selbst-Update ist in Ordnung" if not fehler
      else f"{len(fehler)} FEHLER:\n - " + "\n - ".join(fehler))
import shutil                                                      # noqa: E402
shutil.rmtree(TMP, ignore_errors=True)
sys.exit(1 if fehler else 0)
