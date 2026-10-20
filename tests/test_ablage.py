#!/usr/bin/env python3
"""Die Ablage-Einstellung - und was davon in einen mount-Aufruf als root geht.

Hier wird eine Eingabe aus der Oberflaeche zu Argumenten eines Befehls, den
start.py mit vollen Rechten ausfuehrt. Das ist die eine Stelle im Server, an
der ein durchgerutschtes Komma kein Schoenheitsfehler waere: in
Mount-Optionen trennt es, und "file_mode=0777" hinter einem Freigabenamen
wuerde die Rechte aushebeln, auf die sich alles andere verlaesst.

Deshalb prueft diese Datei nicht die Zahl der Funktionen, sondern genau das:
was prallt ab, und steht das Passwort hinterher irgendwo, wo es nicht hingehoert.
"""
import os
import sys
import tempfile

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp(prefix="notizmappe-ablage-")
os.environ["NOTIZMAPPE_EINRICHTUNG"] = TMP
os.environ["NOTIZMAPPE_DATEN"] = os.path.join(TMP, "daten")
sys.path.insert(0, os.path.join(WURZEL, "web"))

import ablage                                                      # noqa: E402

fehler = []


def pruefe(was, bedingung, zusatz=""):
    print(("  ok    " if bedingung else "  FEHLER ") + was
          + ("" if bedingung else f"  [{zusatz}]"))
    if not bedingung:
        fehler.append(was)


print("Was in einem mount-Aufruf etwas anderes bedeuten koennte")
BOESE = [
    ("Komma im Rechnernamen", {"art": "smb", "wirt": "nas,file_mode=0777",
                               "freigabe": "f", "benutzer": "b"}),
    ("Option in der Freigabe", {"art": "smb", "wirt": "nas", "freigabe": "f,uid=0",
                                "benutzer": "b"}),
    ("Option im Benutzernamen", {"art": "smb", "wirt": "nas", "freigabe": "f",
                                 "benutzer": "b,gid=0"}),
    ("Pfadwechsel", {"art": "smb", "wirt": "../etc", "freigabe": "f", "benutzer": "b"}),
    ("Shell-Zeichen", {"art": "smb", "wirt": "nas; rm -rf /", "freigabe": "f",
                       "benutzer": "b"}),
    ("Zeilenumbruch", {"art": "smb", "wirt": "nas\nzweite", "freigabe": "f",
                       "benutzer": "b"}),
    ("Option im NFS-Pfad", {"art": "nfs", "wirt": "nas", "pfad": "/v1,rw"}),
    ("NFS-Pfad ohne /", {"art": "nfs", "wirt": "nas", "pfad": "nicht-absolut"}),
    ("erfundene Art", {"art": "ftp", "wirt": "nas"}),
]
for name, rumpf in BOESE:
    try:
        ablage.pruefen(rumpf)
        pruefe(f"abgelehnt: {name}", False, "durchgelassen")
    except ablage.AblageFehler:
        pruefe(f"abgelehnt: {name}", True)

gut = ablage.pruefen({"art": "smb", "wirt": "nas.fritz.box", "freigabe": "notiz mappe",
                      "benutzer": "lucy@nas"})
pruefe("eine normale Angabe geht durch", gut["wirt"] == "nas.fritz.box")
pruefe("lokal braucht keine Felder", ablage.pruefen({"art": "lokal"})["art"] == "lokal")

print()
print("Der Aufruf selbst")
ablage.schreiben(gut, "ge,hei=m")
b = ablage.befehl({**gut, "uid": 1000, "gid": 1000})
pruefe("eine Liste, keine Zeile fuer eine Shell", isinstance(b, list) and b[0] == "mount")
pruefe("file_mode und dir_mode sind nicht verhandelbar",
       "file_mode=0600" in b[4] and "dir_mode=0700" in b[4])
pruefe("das Passwort steht nicht im Aufruf", not any("hei=m" in t for t in b), str(b))
pruefe("sondern in der Zugangsdatei", "ge,hei=m" in ablage.zugangsdatei().read_text())
pruefe("die nur dem Server gehoert",
       oct(ablage.zugangsdatei().stat().st_mode & 0o777) == "0o600")
pruefe("und die Einstellung haelt es nicht fest", "passwort" not in ablage.lesen())
pruefe("die Einstellung selbst ist auch 0600",
       oct(ablage.datei().stat().st_mode & 0o777) == "0o600")

print()
print("Ohne Rechte wird nichts geraten")
konnte, text = ablage.einhaengen({"art": "smb", "wirt": "x", "freigabe": "y",
                                  "benutzer": "z"}, 1000, 1000)
pruefe("ohne SYS_ADMIN sagt es, was fehlt", (not konnte) and "SYS_ADMIN" in text, text)
pruefe("lokal braucht gar nichts", ablage.einhaengen({"art": "lokal"}, 1000, 1000)[0])
pruefe("und der Stand laesst sich immer lesen", ablage.stand()["art"] == "smb")

print()
print("Die Ablage ist in Ordnung" if not fehler
      else f"{len(fehler)} FEHLER:\n - " + "\n - ".join(fehler))
import shutil                                                      # noqa: E402
shutil.rmtree(TMP, ignore_errors=True)
sys.exit(1 if fehler else 0)
