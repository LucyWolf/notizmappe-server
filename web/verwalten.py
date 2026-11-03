#!/usr/bin/env python3
"""Benutzer vom Server aus anpassen - per SSH, ohne Browser.

    docker exec -it notizmappe python3 /srv/web/verwalten.py liste
    docker exec -it notizmappe python3 /srv/web/verwalten.py passwort anna

Oder ohne Docker, direkt auf dem Datenordner:

    NOTIZMAPPE_DATEN=./daten python3 web/verwalten.py liste

Wofür das da ist: jemand hat sein Passwort vergessen und keine Mailadresse
hinterlegt, der zweite Schritt hängt an einem Telefon, das weg ist, oder der
letzte Verwalter kommt nicht mehr hinein. Über den Browser ist dann nichts
mehr zu machen - über die Platte schon.

Gerechnet wird mit denselben Funktionen wie im Server (`benutzer.py`), nicht
mit eigenen: die Sperren gelten damit auch hier. Den letzten Verwalter kann
auch dieses Werkzeug nicht entfernen - sonst wäre die Mappe zu, und das ist
kein Zustand, aus dem ein Werkzeug heraushilft.

Ein neues Passwort wirft nebenbei alle offenen Sitzungen dieses Benutzers weg:
die Sitzungsmarke wird aus dem Hash gerechnet.
"""
from __future__ import annotations

import argparse
import getpass
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import benutzer as nutzer                                   # noqa: E402


def _besitz_angleichen() -> None:
    """Die Datei dem Datenordner angleichen.

    Wer das hier als root laufen lässt (`sudo`, oder im Container als root),
    hinterlässt sonst eine benutzer.json, die root gehört - und der Server
    läuft unter einer anderen Nummer und kann sie danach nicht mehr
    schreiben. Das merkt man erst, wenn das nächste Mal jemand sein Passwort
    ändern will.
    """
    if not hasattr(os, "geteuid") or os.geteuid() != 0:
        return
    try:
        ordner = nutzer.datenordner().stat()
        ziel = nutzer.datei()
        if ziel.is_file() and ziel.stat().st_uid != ordner.st_uid:
            os.chown(ziel, ordner.st_uid, ordner.st_gid)
            print(f"(Eigentümer von {ziel.name} auf {ordner.st_uid}:{ordner.st_gid} gesetzt)")
    except OSError as f:
        print(f"Achtung: Eigentümer ließ sich nicht angleichen: {f}")


def _passwort_holen(gegeben: str) -> str:
    if gegeben:
        return gegeben
    eins = getpass.getpass("Neues Passwort: ")
    zwei = getpass.getpass("Noch einmal:    ")
    if eins != zwei:
        sys.exit("Die beiden sind nicht gleich.")
    return eins


def liste(_) -> None:
    leute = nutzer.liste()
    if not leute:
        print("Noch kein Zugang angelegt.")
        return
    breit = max(len(b["name"]) for b in leute)
    print(f"{'Name'.ljust(breit)}  {'Rolle'.ljust(12)}  2. Schritt  zuletzt")
    for b in leute:
        zwei = "ja" if nutzer.zwei_schritte_stand(b["name"]).get("an") else "nein"
        print(f"{b['name'].ljust(breit)}  {str(b.get('rolle') or '').ljust(12)}  "
              f"{zwei.ljust(10)}  {b.get('zuletzt') or '-'}")


def passwort(w) -> None:
    nutzer.passwort_setzen(w.name, _passwort_holen(w.passwort))
    _besitz_angleichen()
    print(f"Passwort von {w.name} gesetzt. Offene Sitzungen sind damit ungültig.")


def anlegen(w) -> None:
    nutzer.anlegen(w.name, _passwort_holen(w.passwort), rolle=w.rolle)
    _besitz_angleichen()
    print(f"{w.name} angelegt, Rolle {w.rolle}.")


def entfernen(w) -> None:
    nutzer.entfernen(w.name)
    _besitz_angleichen()
    print(f"{w.name} entfernt. Die Notizen bleiben liegen "
          f"({nutzer.notizordner(w.name)}).")


def rolle(w) -> None:
    nutzer.rolle_zuweisen(w.name, w.rolle)
    _besitz_angleichen()
    print(f"{w.name} ist jetzt {w.rolle}.")


def rollen(_) -> None:
    for name, r in sorted(nutzer.rollen().items()):
        print(f"{name.ljust(14)} {', '.join(sorted(r.get('rechte') or []))}")


def zweischritt_aus(w) -> None:
    nutzer.zwei_schritte_aus(w.name)
    _besitz_angleichen()
    print(f"Zweiter Schritt bei {w.name} ausgeschaltet.")


def projekte(_) -> None:
    alle = nutzer.projekte()
    if not alle:
        print("Kein Projekt angelegt.")
        return
    for name, p in sorted(alle.items()):
        leute = ", ".join(f"{b} ({r})" for b, r in sorted((p.get("mitglieder") or {}).items()))
        print(f"{name}: {leute or 'niemand drin'}")


def mitglied(w) -> None:
    nutzer.mitglied_setzen(w.projekt, w.name, w.recht)
    _besitz_angleichen()
    print(f"{w.name} ist in {w.projekt} jetzt „{w.recht}“.")


def mitglied_raus(w) -> None:
    nutzer.mitglied_entfernen(w.projekt, w.name)
    _besitz_angleichen()
    print(f"{w.name} ist nicht mehr in {w.projekt}.")


def bauen() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Benutzer und Projekte der Notizmappe vom Server aus anpassen.")
    p.add_argument("--daten", help="Datenordner (sonst NOTIZMAPPE_DATEN oder /daten)")
    unter = p.add_subparsers(dest="befehl", required=True)

    unter.add_parser("liste", help="Wer ist angelegt").set_defaults(tun=liste)
    unter.add_parser("rollen", help="Welche Rollen es gibt").set_defaults(tun=rollen)
    unter.add_parser("projekte", help="Projekte und ihre Mitglieder").set_defaults(tun=projekte)

    a = unter.add_parser("passwort", help="Neues Passwort setzen")
    a.add_argument("name")
    a.add_argument("--passwort", default="", help="sonst wird danach gefragt "
                                                  "(steht sonst im Verlauf der Shell)")
    a.set_defaults(tun=passwort)

    a = unter.add_parser("anlegen", help="Neuen Zugang anlegen")
    a.add_argument("name")
    a.add_argument("--rolle", default="Benutzer")
    a.add_argument("--passwort", default="")
    a.set_defaults(tun=anlegen)

    a = unter.add_parser("entfernen", help="Zugang entfernen (Notizen bleiben)")
    a.add_argument("name")
    a.set_defaults(tun=entfernen)

    a = unter.add_parser("rolle", help="Rolle zuweisen")
    a.add_argument("name")
    a.add_argument("rolle")
    a.set_defaults(tun=rolle)

    a = unter.add_parser("zweischritt-aus", help="Zweiten Schritt abschalten")
    a.add_argument("name")
    a.set_defaults(tun=zweischritt_aus)

    a = unter.add_parser("mitglied", help="Jemanden in ein Projekt setzen")
    a.add_argument("projekt")
    a.add_argument("name")
    a.add_argument("recht", choices=sorted(nutzer.PROJEKTRECHTE))
    a.set_defaults(tun=mitglied)

    a = unter.add_parser("mitglied-raus", help="Jemanden aus einem Projekt nehmen")
    a.add_argument("projekt")
    a.add_argument("name")
    a.set_defaults(tun=mitglied_raus)
    return p


def main(argv=None) -> int:
    w = bauen().parse_args(argv)
    if w.daten:
        os.environ["NOTIZMAPPE_DATEN"] = w.daten
    try:
        w.tun(w)
    except nutzer.BenutzerFehler as f:
        print(f"Geht nicht: {f}", file=sys.stderr)
        return 1
    except OSError as f:
        print(f"Datei: {f}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
