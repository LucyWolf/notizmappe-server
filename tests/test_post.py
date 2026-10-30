"""Passwort zurücksetzen per E-Mail - der einzige Weg ohne Passwort hinein.

    .venv/bin/python tests/test_post.py

Deshalb hängt hier mehr dran als an einem gewöhnlichen Formular:

* Die Antwort muss **immer dieselbe** sein. Sagt die Seite „diesen Namen gibt
  es nicht", ist sie eine Auskunft darüber, welche Zugänge es gibt.
* Die Marke darf **nicht im Klartext** in der Benutzerdatei stehen. Sonst baut
  sich jeder, der die Datei liest, einen gültigen Link.
* Sie muss **genau einmal** gelten und nach 30 Minuten verfallen.
* Der Link zeigt auf die **eingetragene** Adresse, nicht auf den Host-Kopf der
  Anfrage - sonst schickt der Server auf Zuruf einen Link zum Angreifer.

Verschickt wird dabei nichts: der SMTP-Teil wird ersetzt, geprüft wird, was
hineingegeben wurde.
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
DATEN = Path(tempfile.mkdtemp(prefix="notizserver-post-"))
os.environ["NOTIZMAPPE_DATEN"] = str(DATEN)
os.environ["NOTIZMAPPE_DESKTOP"] = str(DESKTOP)
os.environ["NOTIZMAPPE_QUELLE"] = "http://127.0.0.1:1"
sys.path.insert(0, str(WURZEL / "web"))

import benutzer as nutzer                                   # noqa: E402
import post                                                 # noqa: E402

fehler = []
verschickt = []


def pruefe(was, bedingung, extra=""):
    print(("  ok  " if bedingung else "FEHLER") + "  " + was + (f"   {extra}" if extra and not bedingung else ""))
    if not bedingung:
        fehler.append(was)


# --- Einstellungen ----------------------------------------------------------
for name, args in (
        ("ein Mailserver, der keiner ist", dict(server="nicht hier!", port=587)),
        ("ein Port jenseits von 65535", dict(server="mail.example.de", port=70000)),
        ("eine Absenderadresse ohne @", dict(server="mail.example.de", port=587,
                                             absender="kaputt")),
        ("eine Serveradresse mit Pfad", dict(server="mail.example.de", port=587,
                                             absender="a@example.de",
                                             stelle="https://example.de/unterwegs")),
        ("eine Serveradresse ohne Schema", dict(server="mail.example.de", port=587,
                                                absender="a@example.de",
                                                stelle="example.de")),
):
    werte = dict(an=True, server="", port=587, sicherheit="starttls", benutzer="",
                 passwort="geheim", absender="a@example.de", stelle="https://example.de")
    werte.update(args)
    try:
        post.setzen(**werte)
        pruefe(f"abgelehnt: {name}", False)
    except post.PostFehler:
        pruefe(f"abgelehnt: {name}", True)

post.setzen(an=True, server="mail.example.de", port=587, sicherheit="starttls",
            benutzer="notizmappe", passwort="geheim123",
            absender="notizmappe@example.de", stelle="https://notizen.example.de/")
stand = post.stand()
pruefe("das Passwort kommt nicht mit heraus",
       "passwort" not in stand and stand.get("passwort_da") is True, str(stand))
pruefe("der Schrägstrich am Ende der Adresse fällt weg",
       stand["stelle"] == "https://notizen.example.de", stand["stelle"])
datei = DATEN / post.DATEI
pruefe("die Datei gehört nur dem Server (0600)",
       stat.S_IMODE(datei.stat().st_mode) == 0o600,
       oct(stat.S_IMODE(datei.stat().st_mode)))

# Nur den Absender ändern darf das Passwort nicht verlieren.
post.setzen(an=True, server="mail.example.de", port=587, sicherheit="starttls",
            benutzer="notizmappe", passwort=None,
            absender="anders@example.de", stelle="https://notizen.example.de")
pruefe("ohne neues Passwort bleibt das alte stehen",
       json.loads(datei.read_text(encoding="utf-8"))["passwort"] == "geheim123")
pruefe("der Versand gilt als eingerichtet", post.eingerichtet())

# --- Nichts hinausschmuggeln ------------------------------------------------
try:
    post.senden("wer@example.de", "Betreff\nBcc: still@woanders.de", "egal")
    pruefe("ein Zeilenumbruch im Betreff wird abgelehnt", False)
except post.PostFehler:
    pruefe("ein Zeilenumbruch im Betreff wird abgelehnt", True)
try:
    post.senden("kein-empfaenger", "Betreff", "egal")
    pruefe("eine kaputte Empfängeradresse wird abgelehnt", False)
except post.PostFehler:
    pruefe("eine kaputte Empfängeradresse wird abgelehnt", True)

# Ab hier wird nichts mehr wirklich verschickt.
post.senden = lambda empfaenger, betreff, text: verschickt.append(
    {"an": empfaenger, "betreff": betreff, "text": text})

# --- Adressen ---------------------------------------------------------------
nutzer.anlegen("lucy", "geheim12345", verwalter=True)
nutzer.anlegen("gast", "geheim12345")
try:
    nutzer.email_setzen("lucy", "keine adresse")
    pruefe("eine kaputte Adresse wird abgelehnt", False)
except nutzer.BenutzerFehler:
    pruefe("eine kaputte Adresse wird abgelehnt", True)

nutzer.email_setzen("lucy", "lucy@example.de")
pruefe("die Adresse steht im Profil", nutzer.email_von("lucy") == "lucy@example.de")
try:
    nutzer.email_setzen("gast", "LUCY@example.de")
    pruefe("dieselbe Adresse zweimal wird abgelehnt", False)
except nutzer.BenutzerFehler:
    pruefe("dieselbe Adresse zweimal wird abgelehnt", True)

# --- Marken -----------------------------------------------------------------
pruefe("ein unbekannter Name bekommt keine Marke",
       nutzer.rueckstellung_anlegen("gibtsnicht") is None)
pruefe("ohne hinterlegte Adresse gibt es keine Marke",
       nutzer.rueckstellung_anlegen("gast") is None)

auftrag = nutzer.rueckstellung_anlegen("LUCY@Example.de")
pruefe("die E-Mail findet den Zugang", auftrag and auftrag["name"] == "lucy", str(auftrag))
marke = auftrag["marke"]
roh = (DATEN / "benutzer.json").read_text(encoding="utf-8")
pruefe("die Marke steht nicht im Klartext in der Datei", marke not in roh)
pruefe("sie gehört zum richtigen Zugang", nutzer.rueckstellung_name(marke) == "lucy")
pruefe("eine erfundene Marke gilt nicht", nutzer.rueckstellung_name("abc" * 12) == "")

post.ruecksetzmail(auftrag["email"], auftrag["name"], marke)
pruefe("die Mail ging an die hinterlegte Adresse",
       verschickt and verschickt[-1]["an"] == "lucy@example.de")
pruefe("der Link zeigt auf die eingetragene Adresse",
       "https://notizen.example.de/neues-passwort?marke=" + marke in verschickt[-1]["text"],
       verschickt[-1]["text"])

# Bremse: drei je Stunde, dann ist Schluss.
zweite = nutzer.rueckstellung_anlegen("lucy")
dritte = nutzer.rueckstellung_anlegen("lucy")
vierte = nutzer.rueckstellung_anlegen("lucy")
pruefe("nach drei Anforderungen je Stunde ist Schluss",
       zweite and dritte and vierte is None)
pruefe("die neueste Marke gilt", nutzer.rueckstellung_name(dritte["marke"]) == "lucy")
pruefe("eine ältere Marke gilt nicht mehr", nutzer.rueckstellung_name(marke) == "")

# Ablauf: die Zeit in der Datei zurückdrehen.
roh = json.loads((DATEN / "benutzer.json").read_text(encoding="utf-8"))
roh["benutzer"]["lucy"]["rueck"]["bis"] = time.time() - 1
(DATEN / "benutzer.json").write_text(json.dumps(roh), encoding="utf-8")
pruefe("eine abgelaufene Marke gilt nicht",
       nutzer.rueckstellung_name(dritte["marke"]) == "")

# --- Einlösen ---------------------------------------------------------------
roh["benutzer"]["lucy"]["rueck"]["bis"] = time.time() + 600
roh["benutzer"]["lucy"]["rueck"]["wann"] = []
(DATEN / "benutzer.json").write_text(json.dumps(roh), encoding="utf-8")
vorher = nutzer.sitzungsmarke("lucy")
try:
    nutzer.rueckstellung_einloesen(dritte["marke"], "kurz")
    pruefe("ein zu kurzes Passwort wird abgelehnt", False)
except nutzer.BenutzerFehler:
    pruefe("ein zu kurzes Passwort wird abgelehnt", True)

name = nutzer.rueckstellung_einloesen(dritte["marke"], "ganzneu12345")
pruefe("das Zurücksetzen trifft den richtigen Zugang", name == "lucy")
pruefe("das neue Passwort gilt", bool(nutzer.pruefen("lucy", "ganzneu12345")))
pruefe("das alte gilt nicht mehr", nutzer.pruefen("lucy", "geheim12345") is None)
pruefe("offene Sitzungen fliegen raus", nutzer.sitzungsmarke("lucy") != vorher)
try:
    nutzer.rueckstellung_einloesen(dritte["marke"], "nochmal12345")
    pruefe("dieselbe Marke ein zweites Mal wird abgelehnt", False)
except nutzer.BenutzerFehler:
    pruefe("dieselbe Marke ein zweites Mal wird abgelehnt", True)

# Eine neue Adresse macht alte Marken wertlos - sonst hängt ein Link an einem
# Postfach, das längst jemand anderem gehört.
neu = nutzer.rueckstellung_anlegen("lucy")
nutzer.email_setzen("lucy", "andere@example.de")
pruefe("beim Adresswechsel verfallen offene Marken",
       nutzer.rueckstellung_name(neu["marke"]) == "")

# --- Nachricht bei Anmeldeversuchen -----------------------------------------
#
# Die Bremse ist hier kein Beiwerk: ohne sie schickt ein Zugang bei einem
# Durchprobieren im Minutentakt Mail, und wer so etwas einmal erlebt hat,
# schaltet es ab - dann merkt er auch den echten Einbruch nicht.
nutzer.email_setzen("gast", "gast@example.de")
pruefe("mit Adresse ist 'nur fehlgeschlagene' voreingestellt",
       nutzer.meldung_von("gast") == "fehler", nutzer.meldung_von("gast"))
nutzer.anlegen("ohnemail", "geheim12345")
pruefe("ohne Adresse kommt nichts", nutzer.meldung_von("ohnemail") == "aus")
pruefe("ohne Adresse gibt es auch nichts zu melden",
       nutzer.meldung_faellig("ohnemail", False) is None)

pruefe("eine geglueckte Anmeldung meldet 'fehler' nicht",
       nutzer.meldung_faellig("gast", True) is None)
erste = nutzer.meldung_faellig("gast", False)
pruefe("der erste Fehlversuch wird gemeldet",
       erste and erste["email"] == "gast@example.de" and erste["verschluckt"] == 0,
       str(erste))
pruefe("der zweite kurz danach nicht mehr",
       nutzer.meldung_faellig("gast", False) is None)
pruefe("der dritte auch nicht", nutzer.meldung_faellig("gast", False) is None)

# Die Pause zurückdrehen: die nächste Nachricht muss die verschluckten
# nachtragen, sonst sieht ein Dauerangriff aus wie ein einzelner Vertipper.
roh = json.loads((DATEN / "benutzer.json").read_text(encoding="utf-8"))
roh["benutzer"]["gast"]["melde"]["zuletzt"] = time.time() - nutzer.MELDE_PAUSE - 1
(DATEN / "benutzer.json").write_text(json.dumps(roh), encoding="utf-8")
naechste = nutzer.meldung_faellig("gast", False)
pruefe("nach der Pause kommt eine Nachricht mit Nachtrag",
       naechste and naechste["verschluckt"] == 2, str(naechste))

nutzer.meldung_setzen("gast", "alle")
roh = json.loads((DATEN / "benutzer.json").read_text(encoding="utf-8"))
roh["benutzer"]["gast"]["melde"]["zuletzt"] = 0
(DATEN / "benutzer.json").write_text(json.dumps(roh), encoding="utf-8")
pruefe("bei 'alle' wird auch die geglueckte Anmeldung gemeldet",
       nutzer.meldung_faellig("gast", True) is not None)

nutzer.meldung_setzen("gast", "aus")
roh = json.loads((DATEN / "benutzer.json").read_text(encoding="utf-8"))
roh["benutzer"]["gast"]["melde"]["zuletzt"] = 0
(DATEN / "benutzer.json").write_text(json.dumps(roh), encoding="utf-8")
pruefe("bei 'aus' kommt gar nichts", nutzer.meldung_faellig("gast", False) is None)
try:
    nutzer.meldung_setzen("gast", "vielleicht")
    pruefe("eine erfundene Stufe wird abgelehnt", False)
except nutzer.BenutzerFehler:
    pruefe("eine erfundene Stufe wird abgelehnt", True)

verschickt.clear()
post.anmeldemail("gast@example.de", "gast", False, "10.0.0.9", 4)
text = verschickt[-1]["text"]
pruefe("in der Nachricht steht, woher der Versuch kam", "10.0.0.9" in text, text)
pruefe("und wie viele Versuche verschluckt wurden", "4 weitere" in text, text)

import shutil                                               # noqa: E402
shutil.rmtree(DATEN, ignore_errors=True)
print()
print("Der Mailweg ist in Ordnung" if not fehler else f"{len(fehler)} Fehler")
sys.exit(1 if fehler else 0)
