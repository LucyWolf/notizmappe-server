"""Sieht die Serverfassung noch genauso aus wie der Desktop?

    .venv/bin/python tests/test_gleich.py

Das ist der Test, der die eigentliche Zusage hält: **eine** Oberfläche, nicht
zwei. Geprüft wird deshalb nicht "sieht ähnlich aus", sondern:

1. In diesem Repo liegt **keine Kopie** von index.html, mappe.js oder stil.css.
   Eine Kopie wäre der Anfang des Auseinanderlaufens, und niemand merkt es.
2. Was der Server ausliefert, ist Byte für Byte die Datei aus dem Desktop.
3. An index.html ist genau **eine** Zeile eingesetzt (das shim.js) und sonst
   nichts.
4. Die geholte Fassung ist die, die in DESKTOP_VERSION steht.
"""
import hashlib
import os
import re
import sys
import tempfile
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
DESKTOP = WURZEL / "desktop"
fehler = []


def pruefe(was, bedingung, extra=""):
    print(("  ok  " if bedingung else "FEHLER") + "  " + was + (f"   {extra}" if extra and not bedingung else ""))
    if not bedingung:
        fehler.append(was)


if not (DESKTOP / "app").is_dir():
    sys.exit(f"Erst holen: DESKTOP_PFAD=../notizmappe {WURZEL}/tools/desktop_holen.sh")

# --- 1. Keine Kopien in diesem Repo -----------------------------------------
EIGEN = {"shim.js", "anmelden.html", "einrichten.html", "benutzer.html"}
kopien = []
for p in WURZEL.rglob("*"):
    if not p.is_file():
        continue
    teile = set(p.parts)
    if {".git", ".venv", "desktop", "daten", "__pycache__"} & teile:
        continue
    if p.name in ("index.html", "mappe.js", "stil.css") and p.name not in EIGEN:
        kopien.append(str(p.relative_to(WURZEL)))
pruefe("keine Kopie der Oberflaeche in diesem Repo", not kopien, ", ".join(kopien))

# Auch kein nachgebauter Stil: eigene CSS-Dateien gibt es hier nicht.
eigenes_css = [str(p.relative_to(WURZEL)) for p in WURZEL.rglob("*.css")
               if not {".git", ".venv", "desktop", "daten"} & set(p.parts)]
pruefe("kein eigenes CSS - der Stil kommt aus dem Desktop", not eigenes_css, ", ".join(eigenes_css))

# --- 2./3. Was ausgeliefert wird -------------------------------------------
DATEN = Path(tempfile.mkdtemp(prefix="notizserver-gleich-"))
os.environ["NOTIZMAPPE_DATEN"] = str(DATEN)
os.environ["NOTIZMAPPE_DESKTOP"] = str(DESKTOP)
os.environ["NOTIZMAPPE_QUELLE"] = "http://127.0.0.1:1"
sys.path.insert(0, str(WURZEL / "web"))

from fastapi.testclient import TestClient                   # noqa: E402

import server                                               # noqa: E402

server.nutzer.anlegen("pruefer", "pruefpasswort", verwalter=True)
k = TestClient(server.app, follow_redirects=False)
k.post("/anmelden", data={"name": "pruefer", "passwort": "pruefpasswort"})


def summe(roh: bytes) -> str:
    return hashlib.sha256(roh).hexdigest()[:16]


for datei in ("mappe.js", "stil.css", "icon.png", "icon-128.png"):
    geliefert = k.get("/" + datei).content
    original = (DESKTOP / "app/oberflaeche" / datei).read_bytes()
    pruefe(f"{datei} ist Byte fuer Byte die Desktop-Datei", geliefert == original,
           f"{summe(geliefert)} statt {summe(original)}")

geliefert = k.get("/").text
original = (DESKTOP / "app/oberflaeche/index.html").read_text(encoding="utf-8")
zusatz = [z for z in geliefert.splitlines() if z not in original.splitlines()]
pruefe("an index.html ist genau eine Zeile eingesetzt", len(zusatz) == 1, str(zusatz))
pruefe("und zwar das shim.js", len(zusatz) == 1 and "shim.js" in zusatz[0], str(zusatz))
pruefe("sonst ist index.html unveraendert",
       geliefert.replace(zusatz[0] + "\n", "") == original if len(zusatz) == 1 else False)

# --- 4. Die Fassung stimmt ---------------------------------------------------
soll = (WURZEL / "DESKTOP_VERSION").read_text(encoding="utf-8").strip()
drin = (DESKTOP / "app/VERSION").read_text(encoding="utf-8").strip()
if os.environ.get("DESKTOP_PFAD"):
    print(f"  --  Fassungsvergleich uebersprungen (aus dem Arbeitsordner: {drin})")
else:
    pruefe(f"geholt wurde die Fassung aus DESKTOP_VERSION ({soll})", soll == drin, drin)

# Und die Oberflaeche redet wirklich nur ueber die eine Schnittstelle - sonst
# haette der Stellvertreter Luecken.
js = (DESKTOP / "app/oberflaeche/mappe.js").read_text(encoding="utf-8")
anders = set(re.findall(r"window\.pywebview\.(\w+)", js)) - {"api"}
pruefe("die Oberflaeche benutzt nur window.pywebview.api", not anders, str(anders))

print()
print("Desktop und Server sind dieselbe Oberflaeche" if not fehler
      else f"{len(fehler)} FEHLER:\n - " + "\n - ".join(fehler))
import shutil                                               # noqa: E402
shutil.rmtree(DATEN, ignore_errors=True)
sys.exit(1 if fehler else 0)
