"""Bleibt wirklich jede Änderung im Verlauf - und ein Jahr lang?

    .venv/bin/python tests/test_verlauf.py

Am Desktop wird ausgedünnt: höchstens alle zehn Minuten eine Fassung, nach
einem Tag eine je Tag, nach einem Monat eine je Woche, nach 90 Tagen nichts
mehr. Hier soll alles bleiben. Geprüft wird beides: die eigene Regel für sich,
und dass sie wirklich an die Stelle der alten getreten ist.
"""
import importlib
import os
import sys
import tempfile
import time
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
DESKTOP = WURZEL / "desktop"
if not (DESKTOP / "app").is_dir():
    sys.exit(f"Erst das Desktop-Programm holen: {WURZEL}/tools/desktop_holen.sh")

DATEN = Path(tempfile.mkdtemp(prefix="verlauf-"))
os.environ["NOTIZMAPPE_DATEN"] = str(DATEN)
os.environ["NOTIZMAPPE_DESKTOP"] = str(DESKTOP)
os.environ["NOTIZMAPPE_EINRICHTUNG"] = str(DATEN / "einrichtung")
os.environ.pop("NOTIZEN_ORDNER", None)
sys.path.insert(0, str(WURZEL / "web"))
sys.path.insert(0, str(DESKTOP / "app"))

import server                                                      # noqa: E402
import speicher                                                    # noqa: E402
import verlauf                                                     # noqa: E402
from fastapi.testclient import TestClient                           # noqa: E402

fehler = []


def pruefe(was, bedingung, extra=""):
    print(("  ok  " if bedingung else "FEHLER") + "  " + was
          + (f"   {extra}" if extra and not bedingung else ""))
    if not bedingung:
        fehler.append(was)


print("Die Regel ist eingesetzt")
pruefe("kein Abstand mehr zwischen zwei Fassungen", speicher.VERLAUF_ABSTAND == 0,
       speicher.VERLAUF_ABSTAND)
pruefe("ein Jahr statt 90 Tagen", speicher.VERLAUF_TAGE == 365, speicher.VERLAUF_TAGE)
pruefe("und keine Obergrenze je Seite", speicher.VERLAUF_ANZAHL > 10 ** 6,
       speicher.VERLAUF_ANZAHL)
pruefe("die Stelle zum Merken ist die eigene", speicher.verlauf_merken is verlauf.merken)
pruefe("und die zum Wegräumen auch", speicher._ausduennen is verlauf.aufraeumen)


# --- Wegräumen: nur was älter ist als ein Jahr -------------------------------
print("\nWegräumen")
ordner = DATEN / "probe"
ordner.mkdir(parents=True, exist_ok=True)


def fassung(name, alter_tage):
    p = ordner / f"{name}.json"
    p.write_text("{}", encoding="utf-8")
    wann = time.time() - alter_tage * 86400
    os.utime(p, (wann, wann))
    return p


heute = fassung("20261101-120000", 0)
gestern = fassung("20261031-120000", 1)
vorwoche = fassung("20261025-120000", 7)
vormonat = fassung("20261001-120000", 31)
alt300 = fassung("20260101-120000", 300)
alt364 = fassung("20251103-120000", 364)
alt366 = fassung("20251031-120000", 366)
alt900 = fassung("20240101-120000", 900)

weg = verlauf.aufraeumen(ordner)
pruefe("zwei Fassungen sind zu alt", weg == 2, weg)
for p, soll in ((heute, True), (gestern, True), (vorwoche, True), (vormonat, True),
                (alt300, True), (alt364, True), (alt366, False), (alt900, False)):
    pruefe(f"{p.stem}: {'bleibt' if soll else 'weg'}", p.exists() == soll)
# Das ist der Unterschied zur Regel drueben: dort waeren von gestern, vorige
# Woche und vorigem Monat nur noch einzelne uebrig - und nach 90 Tagen gar
# nichts.
pruefe("auch der Stand von vor zehn Monaten ist noch da", alt300.exists())

print("\nNicht bei jedem Speichern aufräumen")
nochmal = fassung("20250101-120000", 800)
pruefe("gleich danach wird nicht wieder durchgesehen",
       verlauf.aufraeumen(ordner) == 0 and nochmal.exists())
(ordner / verlauf.PUTZMARKE).unlink()
pruefe("ohne Marke schon", verlauf.aufraeumen(ordner) == 1 and not nochmal.exists())


# --- Merken: jede Sekunde eine -----------------------------------------------
print("\nJede Änderung")


class Uhr:
    """Die Uhr vorstellen, statt im Test zu warten."""

    def __init__(self):
        self.sekunde = 0

    def strftime(self, muster):
        self.sekunde += 1
        return f"20261101-0000{self.sekunde:02d}"

    def time(self):
        return time.time()


seite = DATEN / "seite.json"
seite.write_text('{"rev": 1}', encoding="utf-8")
echte_zeit = verlauf.time
verlauf.time = Uhr()
try:
    for i in range(5):
        seite.write_text('{"rev": %d}' % i, encoding="utf-8")
        verlauf.merken(seite)
finally:
    verlauf.time = echte_zeit
fassungen = sorted((DATEN / ".verlauf" / "seite").glob("*.json"))
pruefe("fünf Änderungen, fünf Fassungen", len(fassungen) == 5, len(fassungen))
pruefe("und jede hat ihren eigenen Stand",
       sorted(p.read_text() for p in fassungen)
       == sorted('{"rev": %d}' % i for i in range(5)))
# Zweimal in derselben Sekunde gibt es nur eine - feiner als eine Sekunde ist
# der Name einer Fassung nicht.
verlauf.merken(seite)
vorher = len(list((DATEN / ".verlauf" / "seite").glob("*.json")))
verlauf.merken(seite)
pruefe("zweimal in derselben Sekunde ergibt eine",
       len(list((DATEN / ".verlauf" / "seite").glob("*.json"))) == vorher)


# --- Und durch die echte Brücke ----------------------------------------------
print("\nDurch die Brücke")
k = TestClient(server.app, follow_redirects=False)
k.post("/einrichten", data={"name": "lucy", "passwort": "lucypasswort1",
                            "passwort2": "lucypasswort1"})
KOPF = {"X-Notizmappe": "1"}


def ruf(methode, *args):
    a = k.post(f"/bruecke/{methode}", json={"args": list(args)}, headers=KOPF)
    return a.status_code, a.json()


ruf("notizbuch_anlegen", "B")
ruf("abschnitt_anlegen", "B", "A")
ruf("seite_anlegen", "B", "A", "S")
rev = 1
for i in range(3):
    lage, d = ruf("seite_speichern", {"notizbuch": "B", "abschnitt": "A", "name": "S",
                                      "rev": rev, "titel": "S",
                                      "elemente": [{"id": "x", "typ": "text", "x": 0,
                                                    "y": 0, "b": 100,
                                                    "html": f"Fassung {i}"}]})
    rev = int(d.get("rev", rev + 1))
    time.sleep(1.1)                 # eine Fassung je Sekunde, nicht feiner
lage, liste = ruf("versionen", "B", "A", "S")
pruefe("drei Änderungen hintereinander ergeben drei Fassungen",
       len(liste.get("versionen") or []) >= 3, liste)

# Gegenprobe: mit der Regel von drueben waere daraus eine geworden - dort
# liegen zehn Minuten zwischen zwei Fassungen.
importlib.reload(speicher)
pruefe("drüben sind es wieder zehn Minuten Abstand", speicher.VERLAUF_ABSTAND == 600)
alt_ordner = DATEN / "notizen/lucy/B/A/.verlauf/S"
vorher = len(list(alt_ordner.glob("*.json")))
datei = DATEN / "notizen/lucy/B/A/S.json"
time.sleep(1.1)
speicher.verlauf_merken(datei)
pruefe("und sie legt deshalb keine neue an",
       len(list(alt_ordner.glob("*.json"))) == vorher, alt_ordner)
verlauf.einrichten(speicher)
time.sleep(1.1)
speicher.verlauf_merken(datei)
pruefe("mit unserer schon",
       len(list(alt_ordner.glob("*.json"))) == vorher + 1)

import shutil                                                      # noqa: E402
shutil.rmtree(DATEN, ignore_errors=True)
print()
if fehler:
    print(f"{len(fehler)} Prüfungen gescheitert")
    sys.exit(1)
print("Der Verlauf hält jede Änderung, ein Jahr lang")
