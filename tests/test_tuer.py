"""Kommt jemand von außen hinein, der nicht darf?

    .venv/bin/python tests/test_tuer.py

Die Trennung der Benutzer prüft `test_server.py`. Hier geht es um die Stufe
davor: **ohne Anmeldung überhaupt nichts.** Das ist keine Eigenschaft, die man
einmal hinschreibt — sie muss für *jede* Route gelten, auch für die, die
nächsten Monat dazukommt. Genau das ist der wahrscheinliche Fehler: nicht eine
kaputte Prüfung, sondern eine vergessene.

Deshalb holt sich dieser Test die Routen **aus der App selbst** und verlangt
für jede eine von zwei Antworten: entweder sie steht mit Begründung auf der
Liste der öffentlichen Türen, oder sie weist einen Unangemeldeten ab. Eine
neue Route ohne Prüfung fällt hier durch, ohne dass jemand daran denken muss.

Dazu die Kekse: ein Sitzungskeks ist unterschrieben, trägt einen Ablauf und
eine Marke des Passworts. Jedes einzelne Stück davon wird hier angefasst.
"""
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
DESKTOP = WURZEL / "desktop"
if not (DESKTOP / "app").is_dir():
    sys.exit(f"Erst das Desktop-Programm holen: {WURZEL}/tools/desktop_holen.sh")

DATEN = Path(tempfile.mkdtemp(prefix="notiztuer-test-"))
os.environ["NOTIZMAPPE_DATEN"] = str(DATEN)
os.environ["NOTIZMAPPE_DESKTOP"] = str(DESKTOP)
os.environ["NOTIZMAPPE_EINRICHTUNG"] = str(DATEN / "einrichtung")
os.environ["NOTIZMAPPE_QUELLE"] = "http://127.0.0.1:1"
os.environ.pop("NOTIZEN_ORDNER", None)
sys.path.insert(0, str(WURZEL / "web"))

from fastapi.testclient import TestClient                   # noqa: E402

import benutzer as nutzer                                   # noqa: E402
import server                                               # noqa: E402

fehler = []


def pruefe(was, bedingung, extra=""):
    print(("  ok  " if bedingung else "FEHLER") + "  " + was
          + (f"   {extra}" if extra and not bedingung else ""))
    if not bedingung:
        fehler.append(was)


# Jede dieser Türen steht offen, und zwar aus einem Grund. Wer eine dazunimmt,
# schreibt den Grund dazu - sonst ist die Liste in einem halben Jahr eine
# Sammlung von Ausnahmen, an die sich niemand mehr erinnert.
OFFEN = {
    ("GET", "/anmelden"): "die Anmeldeseite selbst",
    ("POST", "/anmelden"): "hier meldet man sich ja gerade an",
    ("POST", "/einrichten"): "nur solange es keinen einzigen Zugang gibt",
    ("GET", "/passwort-vergessen"): "wer nicht hineinkommt, ist nicht angemeldet",
    ("POST", "/passwort-vergessen"): "dito - schickt nur eine Mail an die hinterlegte Adresse",
    ("GET", "/neues-passwort"): "gilt über eine Marke aus der Mail, nicht über eine Sitzung",
    ("POST", "/neues-passwort"): "dito",
    ("GET", "/zweiter-schritt"): "zwischen Passwort und Code - mit halbem Keks",
    ("POST", "/zweiter-schritt"): "dito",
    ("GET", "/einladung/{marke}"): "eine Einladung ist für jemanden, den es noch nicht gibt",
    ("POST", "/einladung/{marke}"): "dito",
    ("GET", "/abmelden"): "abmelden darf immer jeder",
    ("POST", "/abmelden"): "dito",
    ("GET", "/shim.js"): "die Anmeldeseite lädt ihn mit; dieselbe Datei liegt öffentlich im Repo",
    ("GET", "/{datei}"): "stil.css und Icon für die Anmeldeseite, Positivliste MITGELIEFERT",
}

WEGE = []
for r in server.app.routes:
    weg = getattr(r, "path", "")
    if not weg or weg.startswith(("/openapi", "/docs", "/redoc")):
        continue
    for art in sorted(getattr(r, "methods", []) or []):
        if art in ("GET", "POST"):
            WEGE.append((art, weg))

print("Die Routen kommen aus der App selbst")
pruefe("Es sind alle da", len(WEGE) > 40, len(WEGE))
pruefe("Keine Tür auf der Liste, die es nicht mehr gibt",
       not (set(OFFEN) - set(WEGE)), sorted(set(OFFEN) - set(WEGE)))

# Ein frischer Server ohne Zugang fuehrt zur Einrichtung - erst mit einem
# Zugang ist "unangemeldet" ueberhaupt ein Zustand.
k = TestClient(server.app, follow_redirects=False)
k.post("/einrichten", data={"name": "chefin", "passwort": "chefinpasswort1",
                            "passwort2": "chefinpasswort1"})
pruefe("Die Chefin ist drin", k.get("/").status_code == 200)

fremd = TestClient(server.app, follow_redirects=False)      # ohne jeden Keks


def anklopfen(art, weg):
    echt = weg.replace("{marke}", "probe").replace("{datei}", "stil.css") \
              .replace("{methode}", "baum")
    if art == "GET":
        return fremd.get(echt)
    return fremd.post(echt, json={}, headers={"X-Notizmappe": "1"})


print("\nAn jede Tür klopfen, ohne Anmeldung")
offen_geblieben = []
for art, weg in sorted(WEGE):
    if (art, weg) in OFFEN:
        continue
    a = anklopfen(art, weg)
    # Recht ist alles ausser 200: weggeschickt (303 auf /anmelden), 401, 403,
    # 400 bei einem falschen Aufruf, 404.
    if a.status_code == 200:
        offen_geblieben.append(f"{art} {weg}")
pruefe("Keine Tür ohne Anmeldung offen", not offen_geblieben,
       ", ".join(offen_geblieben))

pruefe("Die Mappe selbst schickt zur Anmeldung",
       fremd.get("/").status_code == 303
       and fremd.get("/").headers["location"] == "/anmelden")
pruefe("Die Brücke sagt klar, was fehlt",
       fremd.post("/bruecke/baum", json={"args": []},
                  headers={"X-Notizmappe": "1"}).status_code == 401)
_anhang = fremd.get("/anhang?notizbuch=a&abschnitt=b&name=c&datei=d")
pruefe("Ein Anhang ohne Anmeldung kommt nicht heraus",
       _anhang.status_code != 200 and not _anhang.content.startswith(b"%PDF"),
       _anhang.status_code)
pruefe("Und die Benutzerverwaltung auch nicht",
       fremd.get("/benutzer").status_code != 200
       and fremd.post("/benutzer/passwort", json={"name": "chefin", "passwort": "x"},
                      headers={"X-Notizmappe": "1"}).status_code != 200)

print("\nAm Keks herumbiegen")
echt = k.cookies.get(server.KEKS)
name, ablauf, marke, unterschrift = echt.split(":")


def mit(keks):
    einer = TestClient(server.app, follow_redirects=False)
    einer.cookies.set(server.KEKS, keks)
    return einer.get("/").status_code


pruefe("Der echte Keks öffnet", mit(echt) == 200)
pruefe("Eine geänderte Unterschrift nicht",
       mit(f"{name}:{ablauf}:{marke}:{unterschrift[:-2]}xy") == 303)
pruefe("Ein anderer Name mit derselben Unterschrift nicht",
       mit(f"jemand:{ablauf}:{marke}:{unterschrift}") == 303)
pruefe("Ein längerer Ablauf mit derselben Unterschrift nicht",
       mit(f"{name}:{int(ablauf) + 99999}:{marke}:{unterschrift}") == 303)
pruefe("Ein abgelaufener Keks nicht", mit(server.keks_bauen("chefin")
                                          .replace(str(ablauf), "1000000000")) == 303)
pruefe("Gar kein Keks nicht", mit("") == 303)
pruefe("Und auch nichts Zusammengereimtes", mit("chefin") == 303 and mit("a:b:c:d") == 303)

# Der halbe Keks steht zwischen Passwort und Code. Oeffnete er die Mappe,
# waere der zweite Schritt eine Anzeige und keine Schranke.
halb = TestClient(server.app, follow_redirects=False)
halb.cookies.set(server.HALBKEKS, server.halbkeks_bauen("chefin"))
pruefe("Der halbe Keks öffnet die Mappe nicht", halb.get("/").status_code == 303)
halb2 = TestClient(server.app, follow_redirects=False)
halb2.cookies.set(server.KEKS, server.halbkeks_bauen("chefin"))
pruefe("Auch nicht, wenn man ihn als den richtigen hinlegt",
       halb2.get("/").status_code == 303)

# Ein neues Passwort muss offene Sitzungen beenden - sonst sieht sich jemand
# mit einem alten Keks weiter um, obwohl das Passwort laengst getauscht ist.
nutzer.passwort_setzen("chefin", "ganzneueschefin1")
pruefe("Nach einem neuen Passwort ist der alte Keks tot", mit(echt) == 303)

print("\nDie Brücke")
neu = TestClient(server.app, follow_redirects=False)
neu.post("/anmelden", data={"name": "chefin", "passwort": "ganzneueschefin1"})
pruefe("Angemeldet geht die Brücke",
       neu.post("/bruecke/baum", json={"args": []},
                headers={"X-Notizmappe": "1"}).status_code == 200)
pruefe("Ohne den eigenen Kopf nicht - eine fremde Seite kann ihn nicht setzen",
       neu.post("/bruecke/baum", json={"args": []}).status_code == 400)
pruefe("Was nicht auf der Positivliste steht, auch nicht",
       neu.post("/bruecke/ordner_waehlen", json={"args": []},
                headers={"X-Notizmappe": "1"}).status_code == 403)

# Und die Einrichtung: sie ist die einzige Tuer, durch die jemand ohne
# Anmeldung einen Verwalter anlegen koennte.
print("\nDie Einrichtungstür")
a = fremd.post("/einrichten", data={"name": "fremder", "passwort": "fremderpw123",
                                    "passwort2": "fremderpw123"})
pruefe("Zweimal einrichten geht nicht",
       a.status_code == 303 and not nutzer.pruefen("fremder", "fremderpw123"),
       a.status_code)
(DATEN / "benutzer.json").unlink()
a = fremd.post("/einrichten", data={"name": "fremder", "passwort": "fremderpw123",
                                    "passwort2": "fremderpw123"})
pruefe("Auch nicht, wenn die Benutzerdatei verschwindet - die Marke bleibt",
       a.status_code == 303 and not nutzer.pruefen("fremder", "fremderpw123"),
       a.status_code)

shutil.rmtree(DATEN, ignore_errors=True)
print()
if fehler:
    print(f"{len(fehler)} Prüfungen gescheitert")
    sys.exit(1)
print("Ohne Anmeldung kommt niemand hinein")
