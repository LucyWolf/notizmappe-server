"""Eigene Speicher je Benutzer: einrichten, abgleichen, verschieben, abhaengen.

    .venv/bin/python tests/test_speicherorte.py

Die NAS ist hier ein Ordner unter /tmp - fern() wird dafuer ersetzt. Alles
andere laeuft echt: rclone bisync, die Routen, die Bruecke. rclone muss im
PATH liegen oder wird wie am Server geholt (dann mit Pruefsumme).

Worauf es ankommt:
* Ohne eingerichteten Speicher aendert sich an der Leiste nichts.
* Das Passwort steht nirgends im Klartext und kommt nie zurueck.
* Verschieben kopiert erst, prueft, und legt dann das Original in den
  Papierkorb - Anhaenge und Verlauf gehen mit.
* Ein Konflikt hinterlaesst keine lose Datei, sondern einen Verlaufseintrag.
"""
import json
import os
import stat
import sys
import tempfile
import time
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
DESKTOP = WURZEL / "desktop"
if not (DESKTOP / "app").is_dir():
    sys.exit(f"Erst das Desktop-Programm holen: {WURZEL}/tools/desktop_holen.sh")

TMP = Path(tempfile.mkdtemp(prefix="notizspeicher-test-"))
os.environ["NOTIZMAPPE_DATEN"] = str(TMP / "daten")
os.environ["NOTIZMAPPE_EINRICHTUNG"] = str(TMP / "einrichtung")
os.environ["NOTIZMAPPE_DESKTOP"] = str(DESKTOP)
os.environ["NOTIZMAPPE_QUELLE"] = "http://127.0.0.1:1"
os.environ.pop("NOTIZEN_ORDNER", None)
sys.path.insert(0, str(WURZEL / "web"))

from fastapi.testclient import TestClient                   # noqa: E402

import server                                              # noqa: E402
import speicherorte                                        # noqa: E402

NAS = TMP / "nas"
NAS.mkdir()

_echt_fern = speicherorte.fern


def _fern(name, o):
    """Die "NAS" ist ein Ordner. Die Umgebung bleibt die echte - so wird auch
    geprueft, dass das Passwort darin ankommt."""
    _, umgebung = _echt_fern(name, o)
    ziel = NAS / o["freigabe"] / o["unterordner"]
    if o["wirt"] == "aus":
        ziel = Path("/gibtsnicht-" + o["kennung"]) / "x"      # NAS nicht erreichbar
    return str(ziel), umgebung


speicherorte.fern = _fern

fehler = []


def pruefe(was, bedingung, extra=""):
    print(("  ok  " if bedingung else "FEHLER") + "  " + was + (f"   {extra}" if extra and not bedingung else ""))
    if not bedingung:
        fehler.append(was)


H = {"X-Notizmappe": "1"}


def ruf(k, methode, *args):
    a = k.post(f"/bruecke/{methode}", json={"args": list(args)},
               headers={**H, "X-Notizmappe-Quellen": "1"})
    try:
        return a.status_code, a.json()
    except ValueError:
        return a.status_code, {}


k = TestClient(server.app, follow_redirects=False)
k.post("/einrichten", data={"name": "lucy", "passwort": "geheim1234", "passwort2": "geheim1234"})
pruefe("angemeldet", k.get("/").status_code == 200)

# --- Ohne Speicher bleibt alles, wie es war ---------------------------------
print("Ohne eigenen Speicher")
ruf(k, "notizbuch_anlegen", "Privat")
ruf(k, "abschnitt_anlegen", "Privat", "Allgemein")
_, s = ruf(k, "seite_anlegen", "Privat", "Allgemein", "Erste Seite")
seite = s.get("name")
_, b = ruf(k, "baum")
pruefe("Baum ohne Quellen", "quellen" not in b and all("quelle" not in x for x in b["notizbuecher"]), b)
c, a = ruf(k, "verschieben", {"art": "notizbuch"})
pruefe("Verschieben geht ohne Speicher nicht", c == 400, (c, a))

# --- Einrichten ----------------------------------------------------------------
print("Einrichten")
for falsch, warum in (({"wirt": "nas; rm -rf /"}, "Shell-Zeichen im Rechner"),
                      ({"unterordner": "../.."}, "Unterordner heraus"),
                      ({"freigabe": "a,b"}, "Komma in der Freigabe"),
                      ({"passwort": ""}, "ohne Passwort")):
    rumpf = {"art": "smb", "name": "NAS", "wirt": "nas.fritz.box", "freigabe": "daten",
             "benutzer": "lucy", "passwort": "pw,mit=zeichen", **falsch}
    a = k.post("/speicher", json=rumpf, headers=H)
    pruefe(f"abgelehnt: {warum}", a.status_code == 400, a.text)
pruefe("ohne eigenen Kopf abgelehnt",
       k.post("/speicher", json={"art": "smb"}).status_code == 400)

a = k.post("/speicher", json={"art": "smb", "name": "NAS", "wirt": "aus", "freigabe": "daten",
                              "benutzer": "lucy", "passwort": "x"}, headers=H)
pruefe("nicht erreichbare NAS wird gar nicht erst gespeichert",
       a.status_code == 400 and not speicherorte.lesen("lucy")["orte"], a.text)

(NAS / "daten" / "Notizmappe" / "Vorher" / "Ab").mkdir(parents=True)
(NAS / "daten" / "Notizmappe" / "Vorher" / "Ab" / "alt.json").write_text(
    json.dumps({"format": 1, "titel": "Alt", "elemente": [], "rev": 1}))
a = k.post("/speicher", json={"art": "smb", "name": "Meine NAS", "wirt": "nas.fritz.box",
                              "freigabe": "daten", "benutzer": "lucy",
                              "passwort": "pw,mit=zeichen"}, headers=H)
pruefe("NAS verbunden", a.status_code == 200, a.text)
stand = a.json()
ort = stand["orte"][0]["kennung"]
pruefe("Standard-Unterordner ist Notizmappe", stand["orte"][0]["unterordner"] == "Notizmappe")
pruefe("Passwort kommt nicht zurück", "pw,mit" not in a.text and "pass" not in a.text)
geheim = TMP / "einrichtung" / "speicher" / "lucy" / f"{ort}.json"
pruefe("Passwortdatei hat 0600", geheim.is_file() and stat.S_IMODE(geheim.stat().st_mode) == 0o600)
pruefe("und dort nicht im Klartext", "pw,mit=zeichen" not in geheim.read_text())
pruefe("auch nicht in der Speicherliste",
       "pw,mit" not in (TMP / "daten" / "konfig" / "lucy" / "speicher.json").read_text())
_, umgebung = _echt_fern("lucy", speicherorte.ort("lucy", ort))
pruefe("rclone bekommt es über die Umgebung", bool(umgebung.get("RCLONE_SMB_PASS")))

z = speicherorte.abgleichen("lucy", ort)
pruefe("erster Abgleich klappt", z["stand"] == "ok", z)
pruefe("was auf der NAS lag, ist jetzt am Server",
       (speicherorte.arbeitskopie("lucy", ort) / "Vorher" / "Ab" / "alt.json").is_file())

_, b = ruf(k, "baum")
pruefe("Baum hat jetzt zwei Quellen",
       [q["kennung"] for q in b.get("quellen", [])] == ["standard", ort], b.get("quellen"))
pruefe("jedes Notizbuch weiß, woher es kommt",
       {(x["name"], x["quelle"]) for x in b["notizbuecher"]} == {("Privat", "standard"),
                                                                 ("Vorher", ort)})
pruefe("geschrieben wird noch im Standard", b["jetzt"] == "standard")
a = k.post("/bruecke/baum", json={"args": []}, headers=H).json()
pruefe("das Desktop-Fenster (ohne Kopf) sieht weiter nur einen Speicher",
       "quellen" not in a and [x["name"] for x in a["notizbuecher"]] == ["Privat"], a)

# --- Verschieben ----------------------------------------------------------------
print("Verschieben")
c, a = ruf(k, "anhang_ablegen", "Privat", "Allgemein", seite, "bild.png", "aGFsbG8=")
ruf(k, "seite_speichern", {"notizbuch": "Privat", "abschnitt": "Allgemein", "name": seite,
                           "rev": 0, "titel": "Erste Seite", "elemente": []})
c, a = ruf(k, "verschieben", {"art": "seite",
                              "von": {"quelle": "standard", "pfad": ["Privat", "Allgemein", seite]},
                              "nach": {"quelle": ort, "pfad": []}})
pruefe("Seite auf die Überschrift gezogen", c == 200 and a.get("ok"), a)
dort = speicherorte.arbeitskopie("lucy", ort) / "Privat" / "Allgemein"
pruefe("landet in Notizbuch/Abschnitt gleichen Namens", (dort / f"{seite}.json").is_file())
pruefe("Anhang ging mit", any((dort / f"{seite}.anhang").glob("*")) if (dort / f"{seite}.anhang").is_dir() else False)
std = TMP / "daten" / "notizen" / "lucy"
pruefe("Original ist weg", not (std / "Privat" / "Allgemein" / f"{seite}.json").exists())
pruefe("und liegt im Papierkorb", any((std / ".papierkorb").glob(f"*{seite}.json")))
c, a = ruf(k, "verschieben", {"art": "notizbuch",
                              "von": {"quelle": ort, "pfad": ["Privat"]},
                              "nach": {"quelle": ort, "pfad": []}})
pruefe("an dieselbe Stelle geht nicht", c == 200 and "schon" in a.get("fehler", ""), a)
c, a = ruf(k, "verschieben", {"art": "seite",
                              "von": {"quelle": ort, "pfad": ["Privat", "..", seite]},
                              "nach": {"quelle": "standard", "pfad": []}})
pruefe("'..' im Pfad prallt ab", "fehler" in a, a)
c, a = ruf(k, "verschieben", {"art": "notizbuch",
                              "von": {"quelle": "fremd", "pfad": ["Privat"]},
                              "nach": {"quelle": ort, "pfad": []}})
pruefe("unbekannter Speicher prallt ab", "fehler" in a, a)

# --- Schreiben im Speicher und Abgleich -----------------------------------------
print("Abgleich")
c, a = ruf(k, "quelle_wechseln", {"quelle": ort})
pruefe("in den Speicher gewechselt", a.get("jetzt") == ort, a)
ruf(k, "abschnitt_anlegen", "Vorher", "Neu")
ruf(k, "abschnitt_anlegen", "Vorher", "Leer")
_, s2 = ruf(k, "seite_anlegen", "Vorher", "Neu", "Am Server geschrieben")
pruefe("Änderung stößt den Abgleich an", ("lucy", ort) in speicherorte._anstoesse)
z = speicherorte.abgleichen("lucy", ort)
pruefe("Abgleich danach klappt", z["stand"] == "ok", z)
pruefe("neue Seite liegt auf der NAS",
       (NAS / "daten" / "Notizmappe" / "Vorher" / "Neu" / f"{s2['name']}.json").is_file())
pruefe("leerer Abschnitt kommt auch an", (NAS / "daten" / "Notizmappe" / "Vorher" / "Leer").is_dir())

# Konflikt: dieselbe Seite hier und dort geaendert
hier = speicherorte.arbeitskopie("lucy", ort) / "Vorher" / "Ab" / "alt.json"
fern_ = NAS / "daten" / "Notizmappe" / "Vorher" / "Ab" / "alt.json"
hier.write_text(json.dumps({"format": 1, "titel": "Hier", "elemente": [], "rev": 2}))
time.sleep(1.1)
fern_.write_text(json.dumps({"format": 1, "titel": "Dort", "elemente": [], "rev": 2}))
z = speicherorte.abgleichen("lucy", ort)
pruefe("Konflikt-Abgleich läuft durch", z["stand"] == "ok", z)
pruefe("die neuere Fassung gewinnt", json.loads(hier.read_text())["titel"] == "Dort")
lose = list(speicherorte.arbeitskopie("lucy", ort).rglob("*konflikt*"))
pruefe("keine lose Konfliktdatei", not [p for p in lose if ".verlauf" not in p.parts], lose)
verl = list((hier.parent / ".verlauf" / "alt").glob("*.json"))
pruefe("die andere liegt im Verlauf",
       any(json.loads(p.read_text()).get("titel") == "Hier" for p in verl), verl)
speicherorte.abgleichen("lucy", ort)
pruefe("und nach dem nächsten Abgleich auch auf der NAS keine lose",
       not [p for p in (NAS / "daten").rglob("*konflikt*") if ".verlauf" not in p.parts])

# NAS weg: Fehler sichtbar, Arbeit geht weiter
alt_fern = speicherorte.fern
speicherorte.fern = lambda n, o: (str(Path("/gibtsnicht") / "x"), _echt_fern(n, o)[1])
z = speicherorte.abgleichen("lucy", ort)
pruefe("NAS weg: Fehler wird gemeldet", z["stand"] == "fehler" and z["fehler"] and z["seit"], z)
c, a = ruf(k, "seite_anlegen", "Vorher", "Neu", "Ohne NAS")
pruefe("und geschrieben wird trotzdem", c == 200 and a.get("name"), a)
speicherorte.fern = alt_fern
z = speicherorte.abgleichen("lucy", ort)
pruefe("NAS wieder da: nachgeholt", z["stand"] == "ok" and
       (NAS / "daten" / "Notizmappe" / "Vorher" / "Neu" / f"{a['name']}.json").is_file(), z)

# --- Übertragen und Standard abschalten ----------------------------------------
print("Übertragen")
ruf(k, "quelle_wechseln", {"quelle": "standard"})
ruf(k, "notizbuch_anlegen", "Noch eins")
a = k.post("/speicher/standard", json={"aus": True}, headers=H)
pruefe("Standard abschalten geht nicht, solange etwas drin ist", a.status_code == 400, a.text)
a = k.post("/speicher/uebertragen", json={"kennung": ort}, headers=H)
pruefe("alles übertragen", a.status_code == 200 and "2 von 2" in a.json().get("hinweis", ""), a.text)
a = k.post("/speicher/standard", json={"aus": True}, headers=H)
pruefe("jetzt lässt er sich abschalten", a.status_code == 200 and a.json()["standard_aus"], a.text)
_, b = ruf(k, "baum")
pruefe("Standard steht nicht mehr in der Leiste",
       [q["kennung"] for q in b["quellen"]] == [ort] and b["jetzt"] == ort, b.get("quellen"))
pruefe("Privat (doppelt) wurde nicht überschrieben",
       {x["name"] for x in b["notizbuecher"]} >= {"Privat", "Privat (2)", "Noch eins", "Vorher"},
       [x["name"] for x in b["notizbuecher"]])

# --- Andere Benutzer -------------------------------------------------------------
print("Trennung")
pruefe("ein anderer Benutzer sieht lucys Speicher nicht", speicherorte.lesen("bob")["orte"] == []
       and speicherorte.ordner("bob", ort) == server.nutzer.notizordner("bob"))

# --- Abhängen --------------------------------------------------------------------
print("Abhängen")
a = k.post("/speicher/entfernen", json={"kennung": ort}, headers=H)
pruefe("abgehängt", a.status_code == 200 and not a.json()["orte"], a.text)
pruefe("Passwortdatei ist weg", not geheim.exists())
pruefe("Standard ist wieder an", not a.json()["standard_aus"])
pruefe("Kopie am Server liegt zur Seite",
       any(p.name.startswith(".entfernt-") for p in (TMP / "daten" / "speicher" / "lucy").iterdir()))
pruefe("auf der NAS ist nichts gelöscht", (NAS / "daten" / "Notizmappe" / "Vorher").is_dir())
_, b = ruf(k, "baum")
pruefe("Baum ist wieder der alte", "quellen" not in b)

print()
print("ALLES GRUEN" if not fehler else f"{len(fehler)} Fehler: {fehler}")
sys.exit(1 if fehler else 0)
