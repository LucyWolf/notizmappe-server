"""Der Server am Stück: Anmeldung, Trennung der Benutzer, Positivliste.

    .venv/bin/python tests/test_server.py

Läuft gegen eine Wegwerf-Ablage unter /tmp und gegen das Desktop-Programm in
./desktop (tools/desktop_holen.sh holt es dorthin).

Worauf es ankommt:
* Ohne Anmeldung kommt nichts heraus - auch nicht über Umwege.
* Zwei Benutzer sehen einander nicht. Das ist die Eigenschaft, die man nicht
  nachträglich einbauen kann, wenn sie einmal falsch war.
* Methoden, die auf einem Server nichts zu suchen haben (Dateidialoge, Updates,
  Programme starten), sind gesperrt - und zwar über eine Positivliste, damit
  eine neue Methode im Desktop nicht versehentlich offen steht.
"""
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
DESKTOP = WURZEL / "desktop"
if not (DESKTOP / "app").is_dir():
    sys.exit(f"Erst das Desktop-Programm holen: DESKTOP_PFAD=../notizmappe {WURZEL}/tools/desktop_holen.sh")

DATEN = Path(tempfile.mkdtemp(prefix="notizserver-test-"))
os.environ["NOTIZMAPPE_DATEN"] = str(DATEN)
os.environ["NOTIZMAPPE_DESKTOP"] = str(DESKTOP)
os.environ["NOTIZMAPPE_QUELLE"] = "http://127.0.0.1:1"     # kein echtes GitHub
os.environ.pop("NOTIZEN_ORDNER", None)
sys.path.insert(0, str(WURZEL / "web"))

from fastapi.testclient import TestClient                   # noqa: E402

import server                                              # noqa: E402

fehler = []


def pruefe(was, bedingung, extra=""):
    print(("  ok  " if bedingung else "FEHLER") + "  " + was + (f"   {extra}" if extra and not bedingung else ""))
    if not bedingung:
        fehler.append(was)


def klient_roh(klient, methode, args):
    return klient.post(f"/bruecke/{methode}", json={"args": args},
                       headers={"X-Notizmappe": "1"})


def ruf(klient, methode, *args):
    a = klient.post(f"/bruecke/{methode}", json={"args": list(args)},
                    headers={"X-Notizmappe": "1"})
    try:
        return a.status_code, a.json()
    except ValueError:
        return a.status_code, {}


# --- Ersteinrichtung ---------------------------------------------------------
print("Einrichtung")
k = TestClient(server.app, follow_redirects=False)
a = k.get("/")
pruefe("Ohne Anmeldung keine Notizen", a.status_code == 303 and a.headers["location"] == "/anmelden")
a = k.get("/anmelden")
pruefe("Ohne Benutzer kommt die Einrichtungsseite", "einrichten" in a.text and "Verwalter" in a.text)
pruefe("stil.css gibt es ohne Anmeldung (sonst nacktes Formular)",
       k.get("/stil.css").status_code == 200)
pruefe("mappe.js ist dieselbe Datei wie im Desktop",
       k.get("/mappe.js").text == (DESKTOP / "app/oberflaeche/mappe.js").read_text(encoding="utf-8"))

a = k.post("/einrichten", data={"name": "lucy", "passwort": "kurz", "passwort2": "kurz"})
pruefe("Zu kurzes Passwort wird abgelehnt", server.nutzer.leer())
a = k.post("/einrichten", data={"name": "lucy", "passwort": "geheim1234", "passwort2": "anders1234"})
pruefe("Zwei verschiedene Passwörter werden abgelehnt", server.nutzer.leer())
a = k.post("/einrichten", data={"name": "Lucy", "passwort": "geheim1234", "passwort2": "geheim1234"})
pruefe("Erster Benutzer angelegt und gleich angemeldet",
       a.status_code == 303 and a.headers["location"] == "/" and not server.nutzer.leer())
pruefe("Name klein geschrieben", [b["name"] for b in server.nutzer.liste()] == ["lucy"])
pruefe("Der Erste ist Verwalter", server.nutzer.liste()[0]["verwalter"])
a = k.post("/einrichten", data={"name": "zweiter", "passwort": "geheim1234", "passwort2": "geheim1234"})
pruefe("Einrichten geht nur, solange es keinen Benutzer gibt",
       len(server.nutzer.liste()) == 1)

# --- Keks --------------------------------------------------------------------
print("\nAnmeldung")
keks = next((c for c in k.cookies.jar if c.name == server.KEKS), None)
pruefe("Sitzungs-Keks ist gesetzt", keks is not None)
rohkeks = k.get("/").headers.get("set-cookie", "")
k2 = TestClient(server.app, follow_redirects=False)
a = k2.post("/anmelden", data={"name": "lucy", "passwort": "falsch12345"})
pruefe("Falsches Passwort fuehrt zurueck zur Anmeldung",
       a.status_code == 303 and "fehler" in a.headers["location"])
pruefe("Und setzt keinen Keks", server.KEKS not in a.headers.get("set-cookie", ""))
a = k2.post("/anmelden", data={"name": "gibtsnicht", "passwort": "falsch12345"})
pruefe("Unbekannter Name sagt nicht, dass es ihn nicht gibt",
       "Name+oder+Passwort" in a.headers["location"])
a = k2.post("/anmelden", data={"name": "lucy", "passwort": "geheim1234"})
pruefe("Richtiges Passwort meldet an", a.status_code == 303 and a.headers["location"] == "/")
keks_kopf = a.headers.get("set-cookie", "")
pruefe("Keks ist HttpOnly", "httponly" in keks_kopf.lower())
pruefe("Keks hat SameSite", "samesite" in keks_kopf.lower())
pruefe("Ohne HTTPS kein Secure (sonst kaeme niemand im eigenen Netz hinein)",
       "secure" not in keks_kopf.lower())

gefaelscht = TestClient(server.app, follow_redirects=False)
gefaelscht.cookies.set(server.KEKS, "lucy:99999999999:dasistnichtunterschrieben")
pruefe("Gefaelschter Keks gilt nicht",
       gefaelscht.get("/").status_code == 303)
pruefe("Und auch nicht an der Bruecke", ruf(gefaelscht, "baum")[0] == 401)

# --- Die Bruecke -------------------------------------------------------------
print("\nBrücke")
pruefe("Ohne den eigenen Kopf kein Aufruf (gegen fremde Seiten)",
       k.post("/bruecke/baum", json={"args": []}).status_code == 400)
lage, antwort = ruf(k, "baum")
pruefe("Baum kommt", lage == 200 and "notizbuecher" in antwort, antwort)
for gesperrt in ("ordner_setzen", "ordner_waehlen", "update", "update_stand",
                 "anhang_oeffnen", "anhang_speichern_unter", "sperre_einrichten",
                 "entsperren", "sperren", "rettung_speichern", "optionen_setzen",
                 "_dialog_speichern", "__class__"):
    lage, _ = ruf(k, gesperrt)
    pruefe(f"{gesperrt} ist gesperrt", lage == 403)
pruefe("version wird ohne GitHub beantwortet",
       ruf(k, "version")[1].get("installiert") == server.DESKTOP_FASSUNG)
lage, e = ruf(k, "einstellungen")
pruefe("einstellungen sagt: nicht am selben Rechner", e.get("hier") is False, e)
pruefe("und der Ordner wird nicht als Serverpfad verraten",
       "/daten" not in str(e.get("ordner", "")), e)
lage, _ = ruf(k, "seite_lesen", {"boeses": "objekt"}, [1, 2], None)
pruefe("Unsinnige Werte geben einen Fehler, keinen Absturz", lage == 200)
lage, _ = ruf(k, "baum", *range(9))
pruefe("Zu viele Werte werden abgelehnt", lage == 200 and "fehler" in _, _)

# --- Zwei Benutzer -----------------------------------------------------------
print("\nZwei Benutzer sehen einander nicht")
a = k.post("/benutzer/anlegen", data={"name": "gast", "passwort": "gastpasswort"})
pruefe("Verwalter kann einen Benutzer anlegen",
       "gast" in [b["name"] for b in server.nutzer.liste()])
buch = ruf(k, "notizbuch_anlegen", "Privat")[1]["name"]
absch = ruf(k, "abschnitt_anlegen", buch, "Geheim")[1]["name"]
seite = ruf(k, "seite_anlegen", buch, absch, "Meine Seite")[1]["name"]

g = TestClient(server.app, follow_redirects=False)
g.post("/anmelden", data={"name": "gast", "passwort": "gastpasswort"})
lage, gastbaum = ruf(g, "baum")
pruefe("Der Gast sieht die Notizbuecher von lucy nicht",
       all(b["name"] != buch for b in gastbaum.get("notizbuecher", [])), gastbaum)
lage, versuch = ruf(g, "seite_lesen", buch, absch, seite)
pruefe("Und kann die Seite auch nicht gezielt lesen", "fehler" in versuch, versuch)
pruefe("Jeder Benutzer hat einen eigenen Ordner",
       (DATEN / "notizen/lucy").is_dir() and (DATEN / "notizen/gast").is_dir())
pruefe("Die Seite liegt im Ordner von lucy",
       (DATEN / f"notizen/lucy/{buch}/{absch}/{seite}.json").is_file())
pruefe("Der Gast darf keine Benutzer verwalten", g.get("/benutzer").status_code == 403)
pruefe("Und auch keinen anlegen",
       g.post("/benutzer/anlegen", data={"name": "noch1", "passwort": "geheim1234"}).status_code == 303
       and "noch1" not in [b["name"] for b in server.nutzer.liste()])

# --- Anhaenge ----------------------------------------------------------------
print("\nAnhänge")
import base64                                               # noqa: E402
bild = base64.b64encode(bytes.fromhex("89504e470d0a1a0a") + b"\x00" * 40 + b"INHALT").decode()
lage, ab = ruf(k, "anhang_ablegen", buch, absch, seite, "bild.png", bild)
pruefe("Anhang laesst sich ablegen", "fehler" not in ab, ab)
a = k.get("/anhang", params={"notizbuch": buch, "abschnitt": absch, "name": seite,
                             "datei": ab["datei"]})
pruefe("Download kommt mit Dateinamen", a.status_code == 200 and ab["datei"] in a.headers.get("content-disposition", ""))
pruefe("Download wird nicht im Browser angezeigt",
       a.headers["content-type"] == "application/octet-stream"
       and a.headers.get("x-content-type-options") == "nosniff")
pruefe("Der Inhalt stimmt", b"INHALT" in a.content)
a = g.get("/anhang", params={"notizbuch": buch, "abschnitt": absch, "name": seite,
                             "datei": ab["datei"]})
pruefe("Der Gast bekommt den Anhang nicht", a.status_code == 404)
anonym = TestClient(server.app, follow_redirects=False)
pruefe("Ohne Anmeldung gar nichts", anonym.get("/anhang").status_code == 303)

# --- Unlesbare Benutzerdatei -------------------------------------------------
#
# Der Unterschied zwischen "noch kein Zugang" und "ich komme an die Datei nicht
# heran" entscheidet, ob hier die Ersteinrichtung steht. Steht sie falsch da,
# legt sich der Nächste einen Verwalter an und hat alles. Genau das ist
# passiert, als ein Befehl im Container als root lief.
print("\nUnlesbare Benutzerdatei")
import os as _os                                                    # noqa: E402

datei = server.nutzer.datei()
sicherung = datei.read_bytes()
datei.write_bytes(b"{kaputt")
anonym2 = TestClient(server.app, follow_redirects=False)
a = anonym2.get("/anmelden")
pruefe("Keine Ersteinrichtung bei beschädigter Datei",
       a.status_code == 503 and "einrichten" not in a.text.lower(), a.status_code)
a = anonym2.post("/einrichten", data={"name": "eindringling", "passwort": "uebernahme12",
                                      "passwort2": "uebernahme12"})
pruefe("Und einrichten geht auch nicht", a.headers.get("location") == "/anmelden", a.headers)
pruefe("Es entsteht kein neuer Zugang", b"eindringling" not in datei.read_bytes())
a = anonym2.post("/anmelden", data={"name": "lucy", "passwort": "geheim1234"})
pruefe("Anmelden sagt, was los ist", "fehler=" in a.headers.get("location", ""), a.headers)
datei.write_bytes(sicherung)
pruefe("Nach der Reparatur geht wieder alles",
       anonym2.get("/anmelden").status_code == 200)

# --- Kein Weg zweimal --------------------------------------------------------
#
# Steht eine Route doppelt im Server, gewinnt die erste und die zweite ist
# toter Code - wer daran etwas ändert, wundert sich, warum nichts passiert.
# Genau das war eine Zeitlang so: 152 Zeilen standen zweimal identisch drin.
import re as _re                                                    # noqa: E402

serverquelle = (WURZEL / "web/server.py").read_text(encoding="utf-8")
alle_wege = [f"{a.upper()} {b}" for a, b in
             _re.findall(r'@app\.(get|post)\("([^"]+)"', serverquelle)]
doppelte = sorted({w for w in alle_wege if alle_wege.count(w) > 1})
pruefe("kein Weg steht zweimal im Server", not doppelte, ", ".join(doppelte))
pruefe("es gibt ueberhaupt Wege", len(alle_wege) > 10, f"{len(alle_wege)}")

# --- Unsinn an der Brücke ----------------------------------------------------
print("\nUnsinn über das Netz")
lage, a = ruf(k, "versionen", 1, 2, 3, 4, 5, 6, 7, 8)
pruefe("Zu viele Werte: klare Meldung", "Ungültiger Aufruf" in a.get("fehler", ""), a)
pruefe("Und die Signatur wird nicht verraten", "Bruecke." not in str(a), a)
lage, a = ruf(k, "versionen")
pruefe("Zu wenige Werte: klare Meldung", "Ungültiger Aufruf" in a.get("fehler", ""), a)
schlimm = []
for methode in sorted(server.ERLAUBT):
    for wert in (None, 42, [[[1]]], {"a": 1}, "\x00", "../../etc/passwd", True, 1e308):
        for args in ([wert], [wert] * 3):
            antwort = klient_roh(k, methode, args)
            if antwort.status_code >= 500 or "wo" in (antwort.json() if antwort.headers.get("content-type","").startswith("application/json") else {}):
                schlimm.append(f"{methode} {str(args)[:30]}")
pruefe("Keine Methode fällt bei Unsinn um", not schlimm, ", ".join(schlimm[:5]))

# --- Bremse: der eigene Zugang darf nicht fremdverriegelt werden -------------
print("\nBremse")
server.nutzer.anlegen("bremse", "bremsepasswort")
fremder = TestClient(server.app, follow_redirects=False, client=("203.0.113.9", 1))
for _ in range(10):
    fremder.post("/anmelden", data={"name": "bremse", "passwort": "falsch"})
eigen = TestClient(server.app, follow_redirects=False, client=("192.168.1.5", 2))
a = eigen.post("/anmelden", data={"name": "bremse", "passwort": "bremsepasswort"})
pruefe("Ein Fremder kann niemanden aussperren", a.headers.get("location") == "/", a.headers.get("location"))
a = fremder.post("/anmelden", data={"name": "bremse", "passwort": "bremsepasswort"})
pruefe("Der Fremde selbst bleibt gebremst", "Versuche" in a.headers.get("location", ""))
for i in range(server.MAX_BREMSE + 500):
    server.fehlversuch(f"9.9.9.9|name{i}")
pruefe("Die Bremse wächst nicht unbegrenzt", len(server._fehlversuche) <= server.MAX_BREMSE,
       len(server._fehlversuche))

# --- Passwortwechsel beendet offene Sitzungen --------------------------------
print("\nPasswortwechsel")
server.nutzer.anlegen("wechsel", "erstespasswort")
drin = TestClient(server.app, follow_redirects=False)
drin.post("/anmelden", data={"name": "wechsel", "passwort": "erstespasswort"})
pruefe("Vorher drin", drin.get("/").status_code == 200)
server.nutzer.passwort_setzen("wechsel", "zweitespasswort")
pruefe("Nach dem Wechsel draußen", drin.get("/").status_code == 303)
pruefe("Und auch nicht mehr an der Brücke", ruf(drin, "baum")[0] == 401)
wieder = TestClient(server.app, follow_redirects=False)
wieder.post("/anmelden", data={"name": "wechsel", "passwort": "zweitespasswort"})
pruefe("Mit dem neuen Passwort geht es wieder", wieder.get("/").status_code == 200)

# --- Der Stellvertreter springt nicht weg ------------------------------------
shim = (WURZEL / "web/shim.js").read_text(encoding="utf-8")
ohne_kommentare = "\n".join(z for z in shim.splitlines() if not z.strip().startswith("//"))
pruefe("Downloads springen nicht auf die Fehlerseite",
       "location.assign" not in ohne_kommentare and "fetch('/anhang" in shim)

# --- Verlauf und Papierkorb am Server ----------------------------------------
print("\nVerlauf und Papierkorb")
fehlen = server._fehlende_methoden()
pruefe("Die eingefrorene Fassung kennt alle freigegebenen Methoden", not fehlen,
       f"fehlt in Notizmappe {server.DESKTOP_FASSUNG}: {', '.join(fehlen)}")
lage, v = ruf(k, "versionen", buch, absch, seite)
pruefe("Versionen lassen sich abfragen", lage == 200 and "versionen" in v, v)
lage, korb = ruf(k, "papierkorb")
pruefe("Papierkorb lässt sich abfragen", lage == 200 and "eintraege" in korb, korb)
lage, _ = ruf(k, "onenote_einlesen", {})
pruefe("OneNote-Einlesen bleibt gesperrt (bräuchte einen Dateidialog)", lage == 403)

# Und die Trennung gilt auch hier: der Gast sieht den Papierkorb von lucy nicht.
ruf(k, "loeschen", "seite", [buch, absch, seite])
lage, meiner = ruf(k, "papierkorb")
lage, gastkorb = ruf(g, "papierkorb")
pruefe("Der Gast sieht den Papierkorb von lucy nicht",
       len(gastkorb.get("eintraege", [])) == 0 and len(meiner.get("eintraege", [])) > 0,
       (meiner, gastkorb))
lage, _ = ruf(k, "papierkorb_zurueck", {"eintrag": meiner["eintraege"][0]["eintrag"]})
pruefe("Zurückholen geht am Server", lage == 200 and "fehler" not in _, _)

# --- Rollen und Rechte -------------------------------------------------------
#
# Der Punkt ist nicht, dass die Oberfläche Knöpfe ausgraut, sondern dass der
# Server es durchsetzt. Ein Recht, das man mit einem eigenen Aufruf umgehen
# kann, ist keins.
print("\nRollen und Rechte")
v = k.get("/verwaltung").json()
pruefe("Verwalter sieht die Verwaltung", v.get("darf") is True, v)
pruefe("Es gibt genau drei Rollen",
       [r["name"] for r in v["rollen"]] == ["Verwalter", "Benutzer", "Gast"], v["rollen"])
pruefe("Und jede sagt, wofür sie da ist",
       all(r.get("erklaerung") for r in v["rollen"]), v["rollen"])

def verwalte(klient, weg, rumpf):
    return klient.post(weg, json=rumpf, headers={"X-Notizmappe": "1"})

a = verwalte(k, "/verwaltung/benutzer", {"was": "anlegen", "name": "nurlesen",
                                         "passwort": "gastpasswort1", "rolle": "Gast"})
pruefe("Benutzer mit Rolle anlegen", a.status_code == 200, a.text[:80])
gast2 = TestClient(server.app, follow_redirects=False)
gast2.post("/anmelden", data={"name": "nurlesen", "passwort": "gastpasswort1"})
lage, _ = ruf(gast2, "baum")
pruefe("Gast darf lesen", lage == 200, _)
lage, _ = ruf(gast2, "notizbuch_anlegen", "Heimlich")
pruefe("Gast darf NICHT anlegen", lage == 403, (lage, _))
lage, _ = ruf(gast2, "seite_speichern", {"notizbuch": "x", "abschnitt": "y", "name": "z",
                                         "rev": 1, "titel": "t", "elemente": []})
pruefe("Gast darf NICHT schreiben", lage == 403, (lage, _))
lage, _ = ruf(gast2, "loeschen", "seite", ["a", "b", "c"])
pruefe("Gast darf NICHT löschen", lage == 403, (lage, _))
lage, _ = ruf(gast2, "papierkorb")
pruefe("Gast kommt nicht an den Papierkorb", lage == 403, (lage, _))
pruefe("Gast sieht die Verwaltung nicht", gast2.get("/verwaltung").json().get("darf") is False)
pruefe("Und kann auch keinen anlegen",
       verwalte(gast2, "/verwaltung/benutzer",
                {"was": "anlegen", "name": "schmuggel", "passwort": "egalegal1"}).status_code == 403)

pruefe("Eigene Rollen gibt es nicht mehr",
       verwalte(k, "/verwaltung/rolle", {"name": "Schreiber", "rechte": ["lesen"]}).status_code == 404)
pruefe("Eine erfundene Rolle wird abgelehnt",
       verwalte(k, "/verwaltung/benutzer",
                {"was": "rolle", "name": "nurlesen", "rolle": "Schreiber"}).status_code == 400)
verwalte(k, "/verwaltung/benutzer", {"was": "rolle", "name": "nurlesen", "rolle": "Benutzer"})
lage, _ = ruf(gast2, "notizbuch_anlegen", "Jetzt erlaubt")
pruefe("Als Benutzer darf er schreiben", lage == 200 and "fehler" not in _, (lage, _))

# Den letzten Verwalter darf niemand entmachten
pruefe("Letzten Verwalter nicht entmachten",
       verwalte(k, "/verwaltung/benutzer", {"was": "rolle", "name": "lucy", "rolle": "Gast"}).status_code == 400)
pruefe("Und nicht entfernen",
       verwalte(k, "/verwaltung/benutzer", {"was": "entfernen", "name": "lucy"}).status_code == 400)
pruefe("lucy ist noch Verwalter", "benutzer" in server.nutzer.rechte_von("lucy"))

# --- Fassung: was läuft, und gibt es Neueres ---------------------------------
print("\nFassung")
pruefe("Ohne Anmeldung keine Auskunft", anonym.get("/fassung").status_code == 401)
f = k.get("/fassung").json()
pruefe("Sagt, was läuft", f.get("laeuft") == server.DESKTOP_FASSUNG, f)
pruefe("Und kommt ohne GitHub nicht ins Stolpern",
       "neuer" in f and isinstance(f["neuer"], bool), f)
pruefe("Die Antwort wird wiederverwendet (kein Anklopfen je Aufruf)",
       k.get("/fassung").json() == f)
pruefe("Der Stellvertreter zeigt die Befehle zum Aktualisieren",
       "docker compose pull" in (WURZEL / "web/shim.js").read_text(encoding="utf-8"))

# --- Keine alte Oberfläche aus dem Zwischenspeicher --------------------------
print("\nZwischenspeicher")
a = k.get("/mappe.js")
pruefe("mappe.js wird vor dem Benutzen nachgefragt",
       "no-cache" in a.headers.get("cache-control", ""), a.headers.get("cache-control"))
pruefe("Und bringt eine Kennung mit, damit das billig bleibt",
       bool(a.headers.get("etag") or a.headers.get("last-modified")), dict(a.headers))
b2 = k.get("/mappe.js", headers={"If-None-Match": a.headers.get("etag", "")})
pruefe("Unveraendert kommt nur ein kurzes 'passt schon'",
       b2.status_code in (200, 304), b2.status_code)
pruefe("Die Seite selbst wird nie zwischengespeichert",
       "no-store" in k.get("/").headers.get("cache-control", ""))

# --- Die Einstellungen passen zum Server -------------------------------------
print("\nEinstellungen")
d = gast2.get("/verwaltung").json()
pruefe("Auch wer nichts verwalten darf, erfährt wer er ist",
       d.get("ich") == "nurlesen" and isinstance(d.get("meine_rechte"), list), d)
shimtext = (WURZEL / "web/shim.js").read_text(encoding="utf-8")
pruefe("Benutzer und Rollen stehen unter Konto, nicht in den Optionen",
       "kontoseite()" in shimtext and "konto.append(abschnitt)" in shimtext)
pruefe("Die Desktop-Sachen auf der Kontoseite verschwinden dort",
       "kind.hidden = true" in shimtext)
pruefe("Aber sie bleiben im Gerüst stehen",
       "kind.remove()" not in shimtext.split("function einstellungenAnpassen")[1].split("function abschnittBauen")[0])
for was in ("Aus OneNote übernehmen", "Sperre", "Version", "Schriften"):
    pruefe("Behandelt: " + was, ("'" + was + "'") in shimtext, was)
pruefe("Es gibt einen Abmeldeknopf", "Abmelden" in shimtext and "/abmelden" in shimtext)
# Eigener Klient: ein Abmelden hier würde sonst alle folgenden Prüfungen
# mitreißen - genau das ist beim ersten Versuch passiert.
abmelder = TestClient(server.app, follow_redirects=False)
abmelder.post("/anmelden", data={"name": "lucy", "passwort": "geheim1234"})
pruefe("Vorher drin", abmelder.get("/").status_code == 200)
pruefe("Abmelden funktioniert", abmelder.get("/abmelden").status_code == 303)
pruefe("Und danach draußen", abmelder.get("/").status_code == 303)

# --- Zwei Schritte beim Anmelden ---------------------------------------------
#
# Worauf es ankommt: der Zwischenzustand oeffnet nichts, die Notfallcodes gelten
# genau einmal, und eingeschaltet wird erst, wenn ein Code aus der App stimmt -
# sonst sperrt sich jemand aus, dessen App das Geheimnis nie bekommen hat.
print("\nZwei Schritte")
server.nutzer.anlegen("zwei", "zweipasswort1", rolle="Benutzer")
Z2 = TestClient(server.app, follow_redirects=False)
Z2.post("/anmelden", data={"name": "zwei", "passwort": "zweipasswort1"})
v = Z2.post("/zwei-schritte", json={"was": "vorbereiten"},
            headers={"X-Notizmappe": "1"}).json()
pruefe("Vorbereiten liefert QR, Geheimnis und Codes",
       v.get("qr", "").startswith("<svg") and len(v.get("codes", [])) == 10 and v.get("geheim"),
       list(v))
pruefe("Die Notfallcodes kommen VOR dem Einschalten",
       Z2.get("/zwei-schritte").json()["an"] is False)
pruefe("Mit falschem Code wird nicht eingeschaltet",
       Z2.post("/zwei-schritte", json={"was": "einschalten", "code": "000000"},
               headers={"X-Notizmappe": "1"}).status_code == 400
       and Z2.get("/zwei-schritte").json()["an"] is False)

echt = server.nutzer._totp(v["geheim"], int(time.time() // 30))
pruefe("Mit echtem Code geht es an",
       Z2.post("/zwei-schritte", json={"was": "einschalten", "code": echt},
               headers={"X-Notizmappe": "1"}).json().get("an") is True)

neu_an = TestClient(server.app, follow_redirects=False)
a = neu_an.post("/anmelden", data={"name": "zwei", "passwort": "zweipasswort1"})
pruefe("Anmelden führt zum zweiten Schritt", a.headers.get("location") == "/zweiter-schritt")
pruefe("Und öffnet noch gar nichts", neu_an.get("/").status_code == 303)
pruefe("Auch die Brücke bleibt zu", ruf(neu_an, "baum")[0] == 401)
a = neu_an.post("/zweiter-schritt", data={"code": "000000"})
pruefe("Falscher Code bringt nichts", "fehler=" in a.headers.get("location", ""))
a = neu_an.post("/zweiter-schritt",
                data={"code": server.nutzer._totp(v["geheim"], int(time.time() // 30))})
pruefe("Richtiger Code lässt hinein",
       a.headers.get("location") == "/" and neu_an.get("/").status_code == 200)

mit_code = TestClient(server.app, follow_redirects=False)
mit_code.post("/anmelden", data={"name": "zwei", "passwort": "zweipasswort1"})
a = mit_code.post("/zweiter-schritt", data={"code": v["codes"][0]})
pruefe("Ein Notfallcode geht auch", a.headers.get("location") == "/")
pruefe("Und ist danach verbraucht",
       Z2.get("/zwei-schritte").json()["codes_uebrig"] == 9)
nochmal = TestClient(server.app, follow_redirects=False)
nochmal.post("/anmelden", data={"name": "zwei", "passwort": "zweipasswort1"})
pruefe("Derselbe Notfallcode kein zweites Mal",
       "fehler=" in nochmal.post("/zweiter-schritt",
                                 data={"code": v["codes"][0]}).headers.get("location", ""))

pruefe("Ohne Zwischenschritt kommt man nicht an die Seite",
       TestClient(server.app, follow_redirects=False).get("/zweiter-schritt").status_code == 303)
pruefe("Einrichten für jemand anderen geht nicht - auch nicht als Verwalter",
       k.post("/zwei-schritte", json={"was": "vorbereiten", "benutzer": "zwei"},
              headers={"X-Notizmappe": "1"}).status_code == 403)
pruefe("Abschalten für jemand anderen darf ein Verwalter",
       k.post("/zwei-schritte", json={"was": "aus", "benutzer": "zwei"},
              headers={"X-Notizmappe": "1"}).status_code == 200)
pruefe("Danach genügt wieder das Passwort",
       TestClient(server.app, follow_redirects=False).post(
           "/anmelden", data={"name": "zwei", "passwort": "zweipasswort1"}
       ).headers.get("location") == "/")
pruefe("Ein Benutzer darf das nicht bei anderen",
       gast2.post("/zwei-schritte", json={"was": "aus", "benutzer": "lucy"},
                  headers={"X-Notizmappe": "1"}).status_code == 403)

# --- Einladungen -------------------------------------------------------------
#
# Der Link ist das Geheimnis. Also: jedes Mal ein anderer, nur kurz gueltig,
# genau einmal einloesbar - und was danach noch damit versucht wird, darf
# nichts bewirken.
print("\nEinladungen")
a = verwalte(k, "/verwaltung/einladung", {"rolle": "Benutzer", "minuten": 5})
pruefe("Verwalter bekommt einen Link", a.status_code == 200 and "/einladung/" in a.json().get("link", ""),
       a.text[:120])
erste = a.json()
zweite = verwalte(k, "/verwaltung/einladung", {"rolle": "Benutzer"}).json()
pruefe("Jeder Link ist ein anderer", erste["marke"] != zweite["marke"])
pruefe("Und lang genug, um nicht geraten zu werden", len(erste["marke"]) >= 30, len(erste["marke"]))
pruefe("Wer nichts verwalten darf, bekommt keinen",
       verwalte(gast2, "/verwaltung/einladung", {"rolle": "Verwalter"}).status_code == 403)

anonym3 = TestClient(server.app, follow_redirects=False)
seite = anonym3.get(f"/einladung/{erste['marke']}")
pruefe("Die Seite kommt ohne Anmeldung", seite.status_code == 200 and "Zugang anlegen" in seite.text)
pruefe("Ein erfundener Link bringt nichts",
       anonym3.get("/einladung/ausgedacht").status_code == 410)

a = anonym3.post(f"/einladung/{erste['marke']}",
                 data={"name": "neuling", "passwort": "kurz", "passwort2": "kurz"})
pruefe("Zu kurzes Passwort wird abgelehnt",
       "fehler=" in a.headers.get("location", "")
       and all(b["name"] != "neuling" for b in server.nutzer.liste()))
pruefe("Und die Einladung ist dabei NICHT verbraucht",
       server.nutzer.einladung_lesen(erste["marke"]) is not None)

a = anonym3.post(f"/einladung/{erste['marke']}",
                 data={"name": "neuling", "passwort": "neulingpw1", "passwort2": "neulingpw1"})
pruefe("Mit richtigen Angaben entsteht der Zugang",
       a.headers.get("location") == "/" and any(b["name"] == "neuling" for b in server.nutzer.liste()))
pruefe("Mit der vorgesehenen Rolle",
       [b["rolle"] for b in server.nutzer.liste() if b["name"] == "neuling"] == ["Benutzer"])
pruefe("Und man ist gleich angemeldet", anonym3.get("/").status_code == 200)
pruefe("Derselbe Link geht kein zweites Mal",
       anonym3.get(f"/einladung/{erste['marke']}").status_code == 410)

# Ablauf: die Zeit vorstellen statt zu warten
server.nutzer.einladung_anlegen("lucy", "Benutzer", minuten=5)
alle = server.nutzer.einladungen()
abgelaufen = alle[-1]["marke"]
daten = server.nutzer._lesen()
daten["einladungen"][abgelaufen]["bis"] = time.time() - 1
server.nutzer._schreiben(daten)
pruefe("Nach Ablauf gilt der Link nicht mehr",
       anonym3.get(f"/einladung/{abgelaufen}").status_code == 410)
pruefe("Und er verschwindet aus der Liste",
       all(e["marke"] != abgelaufen for e in server.nutzer.einladungen()))

# Einladung in ein Projekt
verwalte(k, "/verwaltung/projekt", {"was": "anlegen", "name": "Einladungsprojekt"})
ein = verwalte(k, "/verwaltung/einladung",
               {"rolle": "Benutzer", "projekt": "Einladungsprojekt", "recht": "lesen"}).json()
anonym4 = TestClient(server.app, follow_redirects=False)
anonym4.post(f"/einladung/{ein['marke']}",
             data={"name": "gastimprojekt", "passwort": "projektpw12", "passwort2": "projektpw12"})
pruefe("Eingeladene landen gleich im Projekt",
       server.nutzer.projekt_recht("gastimprojekt", "Einladungsprojekt") == "lesen",
       server.nutzer.projekte_von("gastimprojekt"))

# --- Projekte: geteilte Bereiche ---------------------------------------------
#
# Rollen sagen, *was* jemand darf - Projekte, *wo*. Beides muss zusammen
# greifen, und zwar immer das Schwaechere von beidem.
print("\nProjekte")
server.nutzer.anlegen("mod", "modpasswort1", rolle="Verwalter")
server.nutzer.anlegen("anna", "annapasswort1", rolle="Benutzer")
server.nutzer.anlegen("zuschauer", "zuschauerpw1", rolle="Gast")
M = TestClient(server.app, follow_redirects=False)
M.post("/anmelden", data={"name": "mod", "passwort": "modpasswort1"})
A = TestClient(server.app, follow_redirects=False)
A.post("/anmelden", data={"name": "anna", "passwort": "annapasswort1"})
Z = TestClient(server.app, follow_redirects=False)
Z.post("/anmelden", data={"name": "zuschauer", "passwort": "zuschauerpw1"})


def verw(klient, weg, rumpf):
    return klient.post(weg, json=rumpf, headers={"X-Notizmappe": "1"})


pruefe("Ein Verwalter darf Projekte anlegen",
       verw(M, "/verwaltung/projekt", {"was": "anlegen", "name": "Hausbau"}).status_code == 200)
pruefe("Ein Benutzer darf das nicht",
       verw(A, "/verwaltung/projekt", {"was": "anlegen", "name": "Heimlich"}).status_code == 403)
verw(M, "/verwaltung/projekt", {"was": "mitglied", "projekt": "Hausbau",
                                "benutzer": "anna", "recht": "schreiben"})
verw(M, "/verwaltung/projekt", {"was": "mitglied", "projekt": "Hausbau",
                                "benutzer": "zuschauer", "recht": "verwalten"})
pruefe("Anna sieht ihr Projekt",
       A.get("/bereiche").json()["projekte"] == [{"name": "Hausbau", "recht": "schreiben"}],
       A.get("/bereiche").json())

ruf(A, "notizbuch_anlegen", "Ganz privat")
A.post("/bereich", json={"bereich": "Hausbau"}, headers={"X-Notizmappe": "1"})
lage, _ = ruf(A, "notizbuch_anlegen", "Grundriss")
pruefe("Im Projekt darf sie schreiben", lage == 200 and "fehler" not in _, _)
pruefe("Aber nicht loeschen - ihr Projektrecht ist nur schreiben",
       ruf(A, "loeschen", "notizbuch", ["Grundriss"])[0] == 403)
pruefe("Der Serverpfad steht nicht in der Antwort",
       "/daten" not in str(ruf(A, "baum")[1]) and "tmp" not in str(ruf(A, "baum")[1].get("ordner", "")),
       ruf(A, "baum")[1])

Z.post("/bereich", json={"bereich": "Hausbau"}, headers={"X-Notizmappe": "1"})
pruefe("Der Gast sieht das Projekt",
       any(b["name"] == "Grundriss" for b in ruf(Z, "baum")[1].get("notizbuecher", [])))
pruefe("Darf dort nichts schreiben, obwohl er im Projekt verwalten hat - "
       "seine Rolle ist schwächer", ruf(Z, "notizbuch_anlegen", "Vom Gast")[0] == 403)

pruefe("In ein fremdes Projekt kommt auch der Verwalter nicht",
       k.post("/bereich", json={"bereich": "Hausbau"},
              headers={"X-Notizmappe": "1"}).status_code == 400)
pruefe("Und Annas private Notizen sieht er auch nicht",
       all(b["name"] != "Ganz privat" for b in ruf(k, "baum")[1].get("notizbuecher", [])))

A.post("/bereich", json={"bereich": ""}, headers={"X-Notizmappe": "1"})
pruefe("Anna kommt zu ihren eigenen Notizen zurück",
       any(b["name"] == "Ganz privat" for b in ruf(A, "baum")[1].get("notizbuecher", [])))
pruefe("Ein erfundenes Projekt lässt sich nicht wählen",
       A.post("/bereich", json={"bereich": "Gibtsnicht"},
              headers={"X-Notizmappe": "1"}).status_code == 400)
# Der Zuschauer hat im Projekt auch "verwalten" - also erst herunterstufen,
# sonst ist "mod" gar nicht der letzte.
pruefe("Solange es zwei Projektverwalter gibt, darf einer gehen",
       verw(M, "/verwaltung/projekt", {"was": "mitglied-raus", "projekt": "Hausbau",
                                       "benutzer": "mod"}).status_code == 200)
pruefe("Den letzten aber nicht",
       verw(Z, "/verwaltung/projekt", {"was": "mitglied-raus", "projekt": "Hausbau",
                                       "benutzer": "zuschauer"}).status_code == 400)
pruefe("Ein Projektverwalter darf Mitglieder setzen, auch ohne das Recht „Projekte\"",
       verw(Z, "/verwaltung/projekt", {"was": "mitglied", "projekt": "Hausbau",
                                       "benutzer": "anna", "recht": "verwalten"}).status_code == 200)

# --- Eine verschluesselte Mappe ---------------------------------------------
print("\nVerschlüsselte Mappe (Sperre vom Desktop)")
sys.path.insert(0, str(DESKTOP / "app"))
import tresor                                               # noqa: E402

tresor.einrichten(DATEN / "notizen/gast", "nurfuerdiesentest")
tresor.sperren()
lage, antwort = ruf(g, "baum")
pruefe("Der Server sagt, dass die Mappe verschlüsselt ist",
       lage == 200 and "verschlüsselt" in antwort.get("fehler", ""), antwort)
pruefe("Und schickt kein \"art\": \"zu\" - das liesse die Seite endlos neu laden",
       antwort.get("art") is None, antwort)
(DATEN / "notizen/gast/.tresor.json").unlink()

# --- Die Seite selbst --------------------------------------------------------
print("\nOberfläche")
a = k.get("/")
pruefe("Die Mappe kommt", a.status_code == 200)
pruefe("shim.js wird vor mappe.js geladen",
       a.text.index("shim.js") < a.text.index('src="mappe.js"'))
roh = (DESKTOP / "app/oberflaeche/index.html").read_text(encoding="utf-8")
pruefe("Sonst ist es dieselbe index.html",
       a.text.replace('<script src="shim.js"></script>\n', "") == roh)

print()
print("alles gruen" if not fehler else f"{len(fehler)} FEHLER:\n - " + "\n - ".join(fehler))
shutil.rmtree(DATEN, ignore_errors=True)
sys.exit(1 if fehler else 0)
