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
pruefe("Die mitgelieferten Rollen sind da",
       {r["name"] for r in v["rollen"]} >= {"Verwalter", "Benutzer", "Gast"}, v["rollen"])
pruefe("Mitgelieferte Rollen sind als fest gekennzeichnet",
       all(r["fest"] for r in v["rollen"] if r["name"] in ("Verwalter", "Benutzer", "Gast")))

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

# Eigene Rolle
a = verwalte(k, "/verwaltung/rolle", {"name": "Schreiber", "rechte": ["lesen", "schreiben"]})
pruefe("Eigene Rolle anlegen", a.status_code == 200, a.text[:80])
pruefe("Rolle ohne Rechte wird abgelehnt",
       verwalte(k, "/verwaltung/rolle", {"name": "Nichts", "rechte": []}).status_code == 400)
pruefe("Mitgelieferte Rolle lässt sich nicht ändern",
       verwalte(k, "/verwaltung/rolle", {"name": "Gast", "rechte": ["lesen", "schreiben"]}).status_code == 400)
verwalte(k, "/verwaltung/benutzer", {"was": "rolle", "name": "nurlesen", "rolle": "Schreiber"})
lage, _ = ruf(gast2, "notizbuch_anlegen", "Jetzt erlaubt")
pruefe("Mit der neuen Rolle darf er schreiben", lage == 200 and "fehler" not in _, (lage, _))
lage, _ = ruf(gast2, "loeschen", "notizbuch", [_["name"]])
pruefe("Löschen bleibt ihm verwehrt", lage == 403, (lage, _))
pruefe("Rolle in Benutzung lässt sich nicht löschen",
       verwalte(k, "/verwaltung/rolle", {"was": "entfernen", "name": "Schreiber"}).status_code == 400)

# Den letzten Verwalter darf niemand entmachten
pruefe("Letzten Verwalter nicht entmachten",
       verwalte(k, "/verwaltung/benutzer", {"was": "rolle", "name": "lucy", "rolle": "Gast"}).status_code == 400)
pruefe("Und nicht entfernen",
       verwalte(k, "/verwaltung/benutzer", {"was": "entfernen", "name": "lucy"}).status_code == 400)
pruefe("lucy ist noch Verwalter", "benutzer" in server.nutzer.rechte_von("lucy"))

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
