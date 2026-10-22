"""Wo die Notizen liegen - einstellbar aus der Oberflaeche.

Der Container laeuft ohne Sonderrechte, und `mount` braucht welche. Deshalb
teilt sich die Sache in zwei Haelften:

  * Hier wird die Einstellung **erfasst, geprueft und abgelegt** - das geht
    ohne jedes Recht und passiert im laufenden Server.
  * Eingehaengt wird beim naechsten Start von `start.py`, und zwar in dem
    kurzen Moment, in dem der noch root ist. Danach legt er die Rechte ab wie
    bisher.

Damit das klappt, braucht der Container die Faehigkeit SYS_ADMIN. Die steht
**nicht** von allein in der compose-Datei: sie erlaubt Mounts und ist ein
ordentlicher Hebel. Fehlt sie, sagt die Oberflaeche genau das, statt stumm
nichts zu tun - und die Notizen liegen weiter im Volume.

Die Einrichtung liegt bewusst NICHT in /daten: dorthin wird ja die Freigabe
gehaengt, und dann waere die eigene Einstellung darunter verschwunden.

-- Zur Vorsicht beim Lesen --------------------------------------------------

Was hier zusammengebaut wird, landet spaeter in den Argumenten eines
mount-Aufrufs, der als root laeuft. Deshalb:

  * jedes Feld wird gegen ein Muster geprueft, nicht nur "irgendwie bereinigt",
  * das Passwort geht ueber eine Datei mit 0600, nie ueber die Kommandozeile
    (dort stuende es sonst in der Prozessliste),
  * die Optionen werden aus festen Bausteinen gebaut, nicht aus Eingaben
    durchgereicht,
  * und aufgerufen wird ohne Shell, als Liste von Argumenten.

Ein Verwalter, der hier etwas eintraegt, darf ohnehin viel - aber "darf viel"
ist kein Grund, ihm aus Versehen eine Zeile Shell zu schenken.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

# Die Einrichtung liegt getrennt von den Notizen - siehe oben.
EINRICHTUNG = Path(os.environ.get("NOTIZMAPPE_EINRICHTUNG", "/einrichtung"))
ZIEL = Path(os.environ.get("NOTIZMAPPE_DATEN", "/daten"))

# Eine Freigabe wird NICHT direkt auf den Datenordner gehaengt, sondern hierher.
# Der Grund ist der Unterordner: wer eine Freigabe "platte" hat, auf der schon
# anderes liegt, will seine Notizen in "platte/notizmappe" und nicht mitten
# hinein. Also: Freigabe einhaengen, und der Datenordner ist ein Ort darin.
EINHAENGEPUNKT = Path(os.environ.get("NOTIZMAPPE_FREIGABE", "/mnt/ablage"))

ARTEN = ("lokal", "ordner", "smb", "nfs")

# "ordner" ist der Sonderfall, der ohne jedes Recht auskommt: statt etwas
# einzuhaengen, startet der Server einfach mit einem anderen Datenordner.
# Voraussetzung ist nur, dass der Container ihn ueberhaupt sieht - ein Pfad,
# der nur auf dem Wirt existiert, ist hier drin nicht da. Deshalb wird er
# geprueft, bevor er gespeichert wird, statt den Server damit hochfahren zu
# lassen und auf das Beste zu hoffen.

# Rechnername oder IP. Absichtlich eng: hier kommt nichts durch, was spaeter in
# einer Option etwas anderes bedeuten koennte.
MUSTER_WIRT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$")
MUSTER_FREIGABE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._$-]{0,80}$")
MUSTER_BENUTZER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._@\\-]{0,80}$")
MUSTER_PFAD = re.compile(r"^/[A-Za-z0-9/._-]{0,200}$")
MUSTER_FASSUNG = re.compile(r"^[123](\.[0-9])?$")
# Relativ, ohne fuehrenden Schraegstrich und ohne "..": der Unterordner soll
# innerhalb der Freigabe bleiben und nicht wieder heraus.
MUSTER_UNTER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,120}$")


class AblageFehler(Exception):
    pass


def _pruefe(muster: re.Pattern, wert: str, feld: str, pflicht: bool = True) -> str:
    wert = (wert or "").strip()
    if not wert:
        if pflicht:
            raise AblageFehler(f"{feld} fehlt.")
        return ""
    if not muster.match(wert):
        raise AblageFehler(f"{feld} enthält Zeichen, die dort nicht hingehören: {wert!r}")
    return wert


def datei() -> Path:
    return EINRICHTUNG / "ablage.json"


def zugangsdatei() -> Path:
    return EINRICHTUNG / "smb-zugang"


def lesen() -> dict:
    """Die abgelegte Einstellung. Ohne Datei: die Notizen liegen im Volume."""
    try:
        roh = json.loads(datei().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"art": "lokal"}
    if not isinstance(roh, dict) or roh.get("art") not in ARTEN:
        return {"art": "lokal"}
    roh.pop("passwort", None)          # steht in der Zugangsdatei, nicht hier
    return roh


def pruefen(rumpf: dict) -> dict:
    """Aus dem Formular eine Einstellung machen - oder sagen, was fehlt."""
    art = (rumpf.get("art") or "lokal").strip()
    if art not in ARTEN:
        raise AblageFehler(f"Unbekannte Art: {art!r}")
    if art == "lokal":
        return {"art": "lokal"}

    # Der Unterordner gilt fuer jede Art ausser "lokal" - und er wird hier
    # oben geprueft, nicht unten. Beim ersten Versuch stand er am Ende der
    # Funktion, waehrend "ordner" schon vorher zurueckkehrte: der Wert kam nie
    # an, und "../../etc" lief anstandslos durch, weil die Pruefung gar nicht
    # erst stattfand.
    unter = (rumpf.get("unterordner") or "").strip().strip("/")
    if unter:
        if ".." in unter.split("/"):
            raise AblageFehler("Der Unterordner darf nicht aus der Freigabe herausführen.")
        unter = _pruefe(MUSTER_UNTER, unter, "Der Unterordner")

    if art == "ordner":
        pfad = _pruefe(MUSTER_PFAD, rumpf.get("pfad"), "Der Ordner")
        gut, text = ordner_pruefen(pfad)
        if not gut:
            raise AblageFehler(text)
        fertig = {"art": "ordner", "pfad": pfad}
        if unter:
            fertig["unterordner"] = unter
        return fertig

    neu = {
        "art": art,
        "wirt": _pruefe(MUSTER_WIRT, rumpf.get("wirt"), "Der Name der NAS"),
    }
    if art == "smb":
        neu["freigabe"] = _pruefe(MUSTER_FREIGABE, rumpf.get("freigabe"), "Die Freigabe")
        neu["benutzer"] = _pruefe(MUSTER_BENUTZER, rumpf.get("benutzer"), "Der Benutzername")
        neu["fassung"] = _pruefe(MUSTER_FASSUNG, rumpf.get("fassung") or "3.0",
                                 "Die SMB-Fassung", pflicht=False) or "3.0"
    else:
        neu["pfad"] = _pruefe(MUSTER_PFAD, rumpf.get("pfad"), "Der Pfad auf der NAS")

    if unter:
        neu["unterordner"] = unter
    return neu


def ordner_pruefen(pfad: str) -> tuple[bool, str]:
    """Taugt dieser Ordner als Ablage - aus Sicht des Containers?

    Der haeufigste Irrtum dabei ist kein Tippfehler: der Pfad existiert auf dem
    Wirt, aber nicht hier drin. Dann ist er schlicht nicht da, und die Meldung
    muss das sagen, statt "nicht gefunden" zu raunen.
    """
    p = Path(pfad)
    if p == ZIEL:
        return True, f"{pfad} ist der Ordner, in dem der Server ohnehin schreibt."
    if not p.exists():
        return False, (f"{pfad} gibt es im Container nicht. Ein Ordner des Wirts muss "
                       "in der docker-compose.yml als Volume eingehängt sein, sonst "
                       "ist er hier drinnen nicht vorhanden.")
    if not p.is_dir():
        return False, f"{pfad} ist kein Ordner."
    probe = p / ".schreibprobe"
    try:
        fd = os.open(probe, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        os.close(fd)
        rechte = probe.stat().st_mode & 0o777
        probe.unlink()
    except OSError as f:
        return False, (f"In {pfad} lässt sich nicht schreiben ({f.strerror}). "
                       f"Der Server läuft als {os.getuid()}:{os.getgid()}.")
    if rechte != 0o600:
        return True, (f"{pfad} nimmt Schreibrechte entgegen, setzt 0600 aber als "
                      f"{rechte:04o} um - dort greifen die Rechte nicht (typisch für "
                      "SMB). benutzer.json und der Sitzungsschlüssel lägen offen.")
    return True, f"{pfad} ist da und beschreibbar."


def schreiben(neu: dict, passwort: str = "") -> None:
    """Einstellung ablegen. Das Passwort kommt in eine eigene Datei mit 0600."""
    EINRICHTUNG.mkdir(parents=True, exist_ok=True)
    if neu.get("art") == "smb":
        if "\n" in (passwort or "") or "\n" in neu.get("benutzer", ""):
            raise AblageFehler("Zeilenumbrüche gehen hier nicht.")
        if passwort:
            z = zugangsdatei()
            fd = os.open(z, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(f"username={neu['benutzer']}\npassword={passwort}\n")
        elif not zugangsdatei().is_file():
            raise AblageFehler("Für eine neue Freigabe wird das Passwort gebraucht.")
    p = datei()
    vorlaeufig = p.with_name(".ablage.neu")
    fd = os.open(vorlaeufig, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(neu, f, ensure_ascii=False, indent=1)
    os.replace(vorlaeufig, p)


def mitnehmen(alt: str, neu: str) -> str:
    """Die vorhandenen Zugaenge und Notizen in den neuen Ordner holen.

    Nur wenn der neue leer ist und im alten wirklich etwas liegt. Sonst wuerde
    ein Umstellen auf einen Ordner, in dem schon Notizen sind, die dortigen
    ueberschreiben - und das waere genau einmal verzeihlich.

    Kopiert wird, nicht verschoben: geht beim naechsten Start etwas schief,
    liegt der alte Stand noch da. Aufgeraeumt wird von Hand, mit Absicht.
    """
    aus, hin = Path(alt), Path(neu)
    if aus == hin or not aus.is_dir() or not hin.is_dir():
        return ""
    if any(hin.iterdir()):
        return ""
    mitgenommen = []
    for name in ("benutzer.json", ".sitzungsschluessel", "notizen", "konfig"):
        quelle = aus / name
        if not quelle.exists():
            continue
        try:
            if quelle.is_dir():
                shutil.copytree(quelle, hin / name)
            else:
                shutil.copy2(quelle, hin / name)
            mitgenommen.append(name)
        except OSError as f:
            return f"Konnte {name} nicht mitnehmen: {f.strerror}"
    if not mitgenommen:
        return ""
    return (f"Aus {alt} mitgenommen: {', '.join(mitgenommen)}. "
            f"Der alte Stand bleibt dort liegen.")


def datenordner_fuer(eingestellt: dict) -> Path:
    """Wo die Notizen bei dieser Einstellung liegen.

    Bei einer Freigabe ist das der Einhaengepunkt plus Unterordner - deshalb
    wird die Freigabe auch nicht direkt auf den Datenordner gehaengt.
    """
    art = eingestellt.get("art")
    unter = (eingestellt.get("unterordner") or "").strip("/")
    if art == "ordner":
        grund = Path(eingestellt.get("pfad") or ZIEL)
    elif art in ("smb", "nfs"):
        grund = EINHAENGEPUNKT
    else:
        grund = ZIEL
    return grund / unter if unter else grund


def darf_einhaengen() -> bool:
    """Hat dieser Container ueberhaupt das Recht zu mounten?

    Nachgesehen wird in den eigenen Faehigkeiten, nicht geraten. CapEff ist die
    Maske der gerade wirksamen - Bit 21 ist CAP_SYS_ADMIN.
    """
    if not shutil.which("mount"):
        return False
    try:
        with open("/proc/self/status", encoding="utf-8") as f:
            for zeile in f:
                if zeile.startswith("CapEff:"):
                    return bool(int(zeile.split()[1], 16) & (1 << 21))
    except (OSError, ValueError):
        pass
    return False


def befehl(stand: dict) -> list[str]:
    """Den mount-Aufruf bauen - als Liste, nie als Zeile fuer eine Shell.

    Die Optionen entstehen hier aus festen Bausteinen. Aus der Eingabe kommen
    nur Werte, die oben gegen ein Muster gelaufen sind.
    """
    art = stand.get("art")
    if art == "smb":
        optionen = [
            f"credentials={zugangsdatei()}",
            f"vers={stand.get('fassung', '3.0')}",
            f"uid={stand.get('uid', 1000)}", f"gid={stand.get('gid', 1000)}",
            # Nicht verhandelbar: auf einer SMB-Freigabe bestimmen diese beiden
            # die Rechte, chmod im Programm laeuft ins Leere. Ohne sie laegen
            # benutzer.json und der Sitzungsschluessel offen.
            "file_mode=0600", "dir_mode=0700",
            "nobrl", "noserverino",
        ]
        quelle = f"//{stand['wirt']}/{stand['freigabe']}"
        return ["mount", "-t", "cifs", "-o", ",".join(optionen), quelle,
                str(EINHAENGEPUNKT)]
    if art == "nfs":
        optionen = ["hard", "noatime", f"nfsvers={stand.get('nfsvers', '4')}"]
        quelle = f"{stand['wirt']}:{stand['pfad']}"
        return ["mount", "-t", "nfs", "-o", ",".join(optionen), quelle,
                str(EINHAENGEPUNKT)]
    raise AblageFehler(f"Für {art!r} gibt es nichts einzuhängen.")


def einhaengen(stand: dict, uid: int, gid: int) -> tuple[bool, str]:
    """Wird von start.py gerufen, solange der noch root ist."""
    if stand.get("art") == "lokal":
        return True, "Die Notizen liegen im Volume."
    if stand.get("art") == "ordner":
        # Hier wird nichts eingehaengt - start.py startet den Server einfach
        # mit diesem Ordner als Datenordner. Deshalb braucht dieser Weg auch
        # kein SYS_ADMIN.
        gut, text = ordner_pruefen(stand.get("pfad", ""))
        return gut, text
    if not darf_einhaengen():
        return False, ("Dem Container fehlt die Fähigkeit SYS_ADMIN - ohne die darf "
                       "er nichts einhängen. In die docker-compose.yml gehört dafür "
                       "cap_add: [SYS_ADMIN].")
    stand = {**stand, "uid": uid, "gid": gid}
    try:
        EINHAENGEPUNKT.mkdir(parents=True, exist_ok=True)
    except OSError as f:
        return False, f"{EINHAENGEPUNKT} ließ sich nicht anlegen: {f.strerror}"
    try:
        fertig = subprocess.run(befehl(stand), capture_output=True, text=True, timeout=45)
    except (OSError, subprocess.SubprocessError) as f:
        return False, f"Das Einhängen ließ sich nicht starten: {f}"
    if fertig.returncode == 0:
        ordner = datenordner_fuer(stand)
        if ordner != EINHAENGEPUNKT:
            try:
                ordner.mkdir(parents=True, exist_ok=True)
            except OSError as f:
                return False, (f"{stand['wirt']} ist eingehängt, aber {ordner} ließ sich "
                               f"nicht anlegen ({f.strerror}).")
        return True, f"{stand['wirt']} ist eingehängt, die Notizen liegen in {ordner}."
    meldung = (fertig.stderr or fertig.stdout or "").strip().splitlines()
    return False, "Einhängen fehlgeschlagen: " + (meldung[-1] if meldung else
                                                  f"Rückgabewert {fertig.returncode}")


def eingehaengt() -> bool:
    """Liegt auf dem Zielordner gerade eine Freigabe?"""
    try:
        with open("/proc/mounts", encoding="utf-8") as f:
            for zeile in f:
                teile = zeile.split()
                if len(teile) > 2 and teile[1] == str(EINHAENGEPUNKT) \
                        and teile[2] in ("cifs", "smb3", "nfs", "nfs4"):
                    return True
    except OSError:
        pass
    return False


def datenordner_jetzt() -> str:
    """Der Ordner, in dem dieser Prozess gerade wirklich schreibt."""
    return os.environ.get("NOTIZMAPPE_DATEN", str(ZIEL))


def stand() -> dict:
    """Was die Oberflaeche anzeigt."""
    jetzt = lesen()
    if jetzt.get("art") == "ordner":
        benutzt = datenordner_jetzt() == jetzt.get("pfad")
        return {**jetzt, "eingehaengt": benutzt, "darf": True,
                "ziel": datenordner_jetzt(), "meldung": _letzte_meldung()}
    return {
        **jetzt,
        "eingehaengt": eingehaengt(),
        "darf": darf_einhaengen(),
        "ziel": str(datenordner_fuer(jetzt)),
        "meldung": _letzte_meldung(),
    }


def meldung_merken(text: str) -> None:
    """Was beim letzten Start passiert ist - damit es in der Oberflaeche steht
    und nicht nur im Protokoll, das niemand aufmacht."""
    try:
        EINRICHTUNG.mkdir(parents=True, exist_ok=True)
        (EINRICHTUNG / "letzter-start.txt").write_text(text, encoding="utf-8")
    except OSError:
        pass


def _letzte_meldung() -> str:
    try:
        return (EINRICHTUNG / "letzter-start.txt").read_text(encoding="utf-8").strip()
    except OSError:
        return ""
