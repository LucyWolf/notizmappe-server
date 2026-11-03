"""Das Werkzeug für die Kommandozeile: Zugänge per SSH anpassen.

    .venv/bin/python tests/test_verwalten.py

Dieses Werkzeug fasst man genau dann an, wenn über den Browser nichts mehr
geht: jemand hat sein Passwort vergessen, der zweite Schritt hängt an einem
verlorenen Telefon, oder der letzte Verwalter kommt nicht mehr hinein. Dann
muss es beim ersten Versuch stimmen — und es darf vor allem nicht die eine
Sperre umgehen, die den Server offen hält: den letzten Verwalter.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
DATEN = Path(tempfile.mkdtemp(prefix="notizverwalten-test-"))
sys.path.insert(0, str(WURZEL / "web"))
os.environ["NOTIZMAPPE_DATEN"] = str(DATEN)

import benutzer as nutzer                                   # noqa: E402

fehler = []


def pruefe(was, bedingung, extra=""):
    print(("  ok  " if bedingung else "FEHLER") + "  " + was
          + (f"   {extra}" if extra and not bedingung else ""))
    if not bedingung:
        fehler.append(was)


def ruf(*teile):
    lauf = subprocess.run([sys.executable, str(WURZEL / "web/verwalten.py"),
                           "--daten", str(DATEN), *teile],
                          capture_output=True, text=True)
    return lauf.returncode, lauf.stdout + lauf.stderr


print("Zugänge anlegen und ansehen")
lage, text = ruf("anlegen", "chefin", "--rolle", "Verwalter", "--passwort", "chefinpasswort1")
pruefe("Einen Verwalter anlegen", lage == 0, text)
lage, text = ruf("anlegen", "anna", "--passwort", "annapasswort1")
pruefe("Und einen Benutzer", lage == 0, text)
lage, text = ruf("liste")
pruefe("Beide stehen in der Liste",
       lage == 0 and "chefin" in text and "anna" in text, text)
pruefe("Mit Rolle und zweitem Schritt", "Verwalter" in text and "nein" in text, text)

print("\nEin vergessenes Passwort")
pruefe("Das alte Passwort gilt", bool(nutzer.pruefen("anna", "annapasswort1")))
lage, text = ruf("passwort", "anna", "--passwort", "ganzneuespasswort")
pruefe("Neues Passwort gesetzt", lage == 0, text)
pruefe("Das alte gilt nicht mehr", not nutzer.pruefen("anna", "annapasswort1"))
pruefe("Das neue gilt", bool(nutzer.pruefen("anna", "ganzneuespasswort")))
pruefe("Der Hinweis auf die Sitzungen steht da", "Sitzungen" in text, text)

# Die Sitzungsmarke haengt am Hash: ein neues Passwort wirft offene
# Anmeldungen weg. Ohne das koennte sich jemand mit einem alten Keks
# weiter umsehen, obwohl das Passwort laengst getauscht ist.
marke = nutzer.sitzungsmarke("anna")
ruf("passwort", "anna", "--passwort", "nochmalanders1")
pruefe("Jedes neue Passwort macht offene Sitzungen ungültig",
       nutzer.sitzungsmarke("anna") != marke)

print("\nZweiter Schritt und Rollen")
nutzer.zwei_schritte_vorbereiten("anna")
daten = json.loads((DATEN / "benutzer.json").read_text(encoding="utf-8"))
daten["benutzer"]["anna"]["zwei"] = {"an": True, "geheim": "ABCDEFGHIJKLMNOP"}
(DATEN / "benutzer.json").write_text(json.dumps(daten), encoding="utf-8")
pruefe("Anna hat den zweiten Schritt an", nutzer.zwei_schritte_stand("anna")["an"] is True)
lage, text = ruf("zweischritt-aus", "anna")
pruefe("Er lässt sich abschalten",
       lage == 0 and not nutzer.zwei_schritte_stand("anna").get("an"), text)
lage, text = ruf("rolle", "anna", "Verwalter")
pruefe("Eine Rolle lässt sich zuweisen", lage == 0 and "benutzer" in nutzer.rechte_von("anna"), text)
lage, text = ruf("rolle", "anna", "Erfunden")
pruefe("Eine erfundene Rolle nicht", lage == 1 and "Geht nicht" in text, text)

print("\nWas auch dieses Werkzeug nicht darf")
lage, text = ruf("entfernen", "anna")
pruefe("Einen von zwei Verwaltern entfernen geht", lage == 0, text)
lage, text = ruf("entfernen", "chefin")
pruefe("Den letzten Verwalter nicht",
       lage == 1 and "letzte" in text, text)
pruefe("Und sie ist noch da", bool(nutzer.pruefen("chefin", "chefinpasswort1")))
lage, text = ruf("entfernen", "gibtsnicht")
pruefe("Einen Unbekannten entfernen meldet sich", lage == 1, text)

print("\nProjekte")
nutzer.projekt_anlegen("Hausbau", "chefin")
lage, text = ruf("anlegen", "bert", "--passwort", "bertpasswort12")
lage, text = ruf("mitglied", "Hausbau", "bert", "schreiben")
pruefe("Jemanden in ein Projekt setzen",
       lage == 0 and nutzer.projekt_recht("bert", "Hausbau") == "schreiben", text)
lage, text = ruf("projekte")
pruefe("Das Projekt steht mit seinen Leuten da",
       lage == 0 and "Hausbau" in text and "bert" in text, text)
lage, text = ruf("mitglied-raus", "Hausbau", "bert")
pruefe("Und wieder heraus", lage == 0 and not nutzer.projekt_recht("bert", "Hausbau"), text)
lage, text = ruf("mitglied", "Hausbau", "bert", "alles")
pruefe("Ein erfundenes Recht nimmt es nicht an", lage != 0, text)

shutil.rmtree(DATEN, ignore_errors=True)
print()
if fehler:
    print(f"{len(fehler)} Prüfungen gescheitert")
    sys.exit(1)
print("Das Werkzeug tut, was es soll - und nicht mehr")
