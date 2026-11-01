"""Was passiert, wenn Unsinn hereinkommt?

    .venv/bin/python tests/test_unsinn.py

Die Oberfläche schickt immer saubere Aufrufe. Alles andere schickt, was es
will: ein abgebrochener Rumpf, eine Zahl statt eines Textes, eine Liste statt
eines Objekts, gar nichts. Darauf gehört eine Meldung — ein 500er sagt
niemandem etwas und sieht aus wie ein kaputter Server, obwohl nur der Aufruf
so nicht gemeint war.

Beim ersten Lauf waren es 17 Abstürze: `.strip()` auf einer Zahl, und ein
leerer Rumpf, den `await bitte.json()` nicht lesen konnte.

Die Routen holt sich der Test selbst aus der App. Kommt eine dazu, wird sie
ohne Zutun mitgeprüft — genau dafür steht das hier.
"""
import os
import sys
import tempfile
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
DESKTOP = WURZEL / "desktop"
if not (DESKTOP / "app").is_dir():
    sys.exit(f"Erst das Desktop-Programm holen: {WURZEL}/tools/desktop_holen.sh")

DATEN = Path(tempfile.mkdtemp(prefix="unsinn-"))
os.environ["NOTIZMAPPE_DATEN"] = str(DATEN)
os.environ["NOTIZMAPPE_DESKTOP"] = str(DESKTOP)
os.environ["NOTIZMAPPE_EINRICHTUNG"] = str(DATEN / "einrichtung")
os.environ.pop("NOTIZEN_ORDNER", None)
sys.path.insert(0, str(WURZEL / "web"))
sys.path.insert(0, str(DESKTOP / "app"))

import server                                                     # noqa: E402
from fastapi.testclient import TestClient                          # noqa: E402

fehler = []


def pruefe(was, bedingung, extra=""):
    print(("  ok  " if bedingung else "FEHLER") + "  " + was
          + (f"   {extra}" if extra and not bedingung else ""))
    if not bedingung:
        fehler.append(was)


k = TestClient(server.app, follow_redirects=False, raise_server_exceptions=False)
k.post("/einrichten", data={"name": "chefin", "passwort": "chefinpasswort1",
                            "passwort2": "chefinpasswort1"})
pruefe("Der Verwalter ist angemeldet", k.get("/").status_code == 200)

KOPF = {"X-Notizmappe": "1"}

# Nichts davon ist boesartig gemeint - es ist schlicht nicht das, was die
# Oberflaeche schickt. Genau daran sind die Routen gestorben.
UNSINN = [
    {}, [], "text", 5, None, True,
    {"was": None, "name": None, "rolle": None, "passwort": None},
    {"was": "anlegen", "name": {"a": 1}, "passwort": ["x"]},
    {"thema": ["eigene"], "farben": "nein"},
    {"thema": "eigene", "farben": {"--papier": 5}},
    {"an": "ja", "port": "achtundfünfzig", "sicherheit": 7, "stelle": None},
    {"an": True, "server": 5, "absender": [], "benutzer": {}, "passwort": 9},
    {"art": {"x": 1}, "pfad": 5, "wirt": ["nas"], "unterordner": 7},
    {"art": 5}, {"art": "smb", "wirt": 5, "freigabe": None, "benutzer": 7},
    {"email": 5}, {"alt": 5, "neu": 5}, {"bereich": ["x"]},
    {"was": "aus", "benutzer": 5}, {"marke": 5},
    {"rolle": 5, "minuten": "viele", "projekt": 7},
    {"a": {"b": {"c": {"d": {"e": {"f": {"g": 1}}}}}}},
    {"x": "ü" * 5000},
]

WEGE = []
for r in server.app.routes:
    weg = getattr(r, "path", "")
    if "{" in weg or weg.startswith("/openapi") or weg.startswith("/docs") \
            or weg.startswith("/redoc"):
        continue
    for art in sorted(getattr(r, "methods", []) or []):
        if art in ("GET", "POST"):
            WEGE.append((art, weg))
pruefe("Die Routen kommen aus der App selbst", len(WEGE) > 25, len(WEGE))

print("\nJSON-Rümpfe")
abstuerze = []
for art, weg in WEGE:
    if art != "POST":
        continue
    for u in UNSINN:
        # Nicht abmelden mittendrin, sonst prueft der Rest nichts mehr.
        if weg in ("/abmelden",):
            continue
        a = k.post(weg, json=u, headers=KOPF)
        if a.status_code >= 500:
            abstuerze.append(f"{weg} <- {u!r}"[:90])
        if weg in ("/anmelden", "/einrichten", "/zweiter-schritt"):
            k.post("/anmelden", data={"name": "chefin", "passwort": "chefinpasswort1"})
pruefe("Kein einziger 500er bei einem JSON-Rumpf", not abstuerze,
       "; ".join(abstuerze[:4]))

# Und das, was kein JSON ist: abgebrochen, leer, Rohbytes. Das schickt kein
# Browser - aber jeder Scanner, der vorbeikommt.
KAPUTT = (b'{"a":', b'', b'\xff\xfe\x00', b'[1,2', b'nicht mal json',
          b'{"a": NaN}', b'\x00' * 20)
abstuerze = []
for art, weg in WEGE:
    if art != "POST" or weg == "/abmelden":
        continue
    for roh in KAPUTT:
        a = k.post(weg, content=roh,
                   headers={**KOPF, "Content-Type": "application/json"})
        if a.status_code >= 500:
            abstuerze.append(f"{weg} <- {roh!r}"[:90])
    k.post("/anmelden", data={"name": "chefin", "passwort": "chefinpasswort1"})
pruefe("Auch ein kaputter Rumpf ist kein Absturz", not abstuerze,
       "; ".join(abstuerze[:4]))

print("\nFormulare und Adressen")
abstuerze = []
for art, weg in WEGE:
    for d in ({}, {"name": "x" * 5000}, {"name": "ü" * 300, "passwort": "\x00"},
              {"marke": "../../etc", "passwort": "x"}, {"code": "\n\n"},
              {"wer": "a" * 300}):
        if weg == "/abmelden":
            continue
        a = k.post(weg, data=d) if art == "POST" else k.get(weg)
        if a.status_code >= 500:
            abstuerze.append(f"{art} {weg} <- {d!r}"[:90])
    k.post("/anmelden", data={"name": "chefin", "passwort": "chefinpasswort1"})
pruefe("Kein 500er bei einem Formular", not abstuerze, "; ".join(abstuerze[:4]))

abstuerze = []
for art, weg in WEGE:
    if art != "GET":
        continue
    for q in ("", "?fehler=<script>", "?marke=" + "a" * 5000, "?meldung=ü" * 50,
              "?notizbuch=../../etc&abschnitt=x&name=y&datei=z", "?frisch=1",
              "?thema=&farben=", "?bis=nein"):
        a = k.get(weg + q)
        if a.status_code >= 500:
            abstuerze.append(f"GET {weg}{q}"[:90])
pruefe("Kein 500er bei einer Adresse", not abstuerze, "; ".join(abstuerze[:4]))

# Und die Bruecke, die am meisten durchreicht.
print("\nDie Brücke")
abstuerze = []
for u in UNSINN + [{"args": "nicht-liste"}, {"args": [{"a": [1] * 3000}]},
                   {"args": [1, 2, 3, 4, 5, 6, 7, 8, 9]},
                   {"args": [None, None, None]}]:
    for methode in ("baum", "seite_lesen", "gibtsnicht", "version"):
        a = k.post(f"/bruecke/{methode}", json=u, headers=KOPF)
        if a.status_code >= 500:
            abstuerze.append(f"{methode} <- {u!r}"[:90])
pruefe("Kein 500er an der Brücke", not abstuerze, "; ".join(abstuerze[:4]))

import shutil                                                      # noqa: E402
shutil.rmtree(DATEN, ignore_errors=True)
print()
if fehler:
    print(f"{len(fehler)} Prüfungen gescheitert")
    sys.exit(1)
print("Unsinn kommt als Meldung zurück, nicht als Absturz")
