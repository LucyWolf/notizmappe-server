"""Benutzer des Servers: Name, Passwort, eigener Notizordner.

Eine JSON-Datei, kein Datenbankserver. Es sind ein paar Leute, nicht ein paar
tausend - und eine Datei kann man lesen, sichern und im Zweifel mit dem Editor
reparieren.

Passwoerter stehen als scrypt-Hash drin, nie im Klartext. Dieselbe Rechnung wie
im Tresor des Desktop-Programms (N=2^16, etwa 130 ms): langsam genug, dass
Durchprobieren nicht lohnt, schnell genug fuer eine Anmeldung.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import secrets
import threading
import time
from pathlib import Path

N = 2 ** 16
R = 8
P = 1
MAXMEM = 160 * 1024 * 1024
NAME_MUSTER = re.compile(r"^[a-z0-9][a-z0-9._-]{1,30}$")
ROLLEN_MUSTER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._-]{1,30}$")

# Die Rechte, die es gibt. Jedes steht fuer einen Satz von Methoden, die der
# Server durchlaesst - sie sind also erzwungen und nicht nur angezeigt. Ein
# Recht, das die Oberflaeche nur ausgraut, waere keins.
RECHTE = {
    "lesen":     "Notizen lesen",
    "schreiben": "Notizen schreiben und anlegen",
    "anhaenge":  "Bilder und Dateien anhängen",
    "loeschen":  "Löschen und Papierkorb leeren",
    "verlauf":   "Frühere Fassungen und Papierkorb",
    "benutzer":  "Benutzer und Rollen verwalten",
}

# Mitgeliefert und nicht loeschbar - sonst koennte man sich selbst aussperren.
FESTE_ROLLEN = {
    "Verwalter": list(RECHTE),
    "Benutzer":  ["lesen", "schreiben", "anhaenge", "loeschen", "verlauf"],
    "Gast":      ["lesen"],
}

_sperre = threading.RLock()


class BenutzerFehler(Exception):
    """Name schon vergeben, Passwort zu kurz, Benutzer gibt es nicht."""


def datenordner() -> Path:
    p = Path(os.environ.get("NOTIZMAPPE_DATEN", "/daten")).expanduser()
    p.mkdir(parents=True, exist_ok=True)
    return p


def datei() -> Path:
    return datenordner() / "benutzer.json"


def notizordner(name: str) -> Path:
    """Jeder Benutzer hat seinen eigenen Ordner - darin dieselbe Ablage wie auf
    dem Desktop (Notizbuch = Ordner, Seite = JSON)."""
    p = datenordner() / "notizen" / name
    p.mkdir(parents=True, exist_ok=True)
    return p


def konfigordner(name: str) -> Path:
    """Die Einstellungen, die auf dem Desktop "dieser Rechner" waeren: hier pro
    Benutzer, sonst teilen sich alle die Schriftfavoriten."""
    p = datenordner() / "konfig" / name
    p.mkdir(parents=True, exist_ok=True)
    return p


def _lesen() -> dict:
    try:
        roh = json.loads(datei().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        roh = {}
    if not isinstance(roh, dict) or not isinstance(roh.get("benutzer"), dict):
        roh = {"benutzer": {}}
    rollen = roh.get("rollen")
    if not isinstance(rollen, dict):
        rollen = {}
    # Die festen Rollen gibt es immer, mit ihren festen Rechten. Sonst koennte
    # ein verungluecktes Bearbeiten den letzten Verwalter entmachten.
    for name, rechte in FESTE_ROLLEN.items():
        rollen[name] = {"rechte": list(rechte), "fest": True}
    for name, r in list(rollen.items()):
        if not isinstance(r, dict) or not isinstance(r.get("rechte"), list):
            rollen.pop(name, None)
    roh["rollen"] = rollen
    # Aeltere Dateien kennen nur "verwalter": ja/nein.
    for name, b in roh["benutzer"].items():
        if not b.get("rolle"):
            b["rolle"] = "Verwalter" if b.get("verwalter") else "Benutzer"
    return roh


def _schreiben(daten: dict) -> None:
    ziel = datei()
    tmp = ziel.with_name(f".{ziel.name}.neu")
    with _sperre:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(daten, f, ensure_ascii=False, indent=1)
        os.replace(tmp, ziel)


def _hash(passwort: str, salz: bytes) -> str:
    roh = hashlib.scrypt(passwort.encode("utf-8"), salt=salz, n=N, r=R, p=P,
                         dklen=32, maxmem=MAXMEM)
    return base64.b64encode(roh).decode("ascii")


def rollen() -> dict:
    """Alle Rollen mit ihren Rechten."""
    return _lesen()["rollen"]


def rolle_setzen(name: str, rechte: list) -> None:
    """Rolle anlegen oder aendern."""
    name = (name or "").strip()
    if not ROLLEN_MUSTER.match(name):
        raise BenutzerFehler("Der Rollenname darf 2 bis 31 Zeichen haben, "
                             "Buchstaben, Zahlen, Leerzeichen, Punkt, Minus, Unterstrich")
    if name in FESTE_ROLLEN:
        raise BenutzerFehler(f"„{name}“ ist eine mitgelieferte Rolle und lässt sich nicht ändern")
    sauber = [r for r in (rechte or []) if r in RECHTE]
    if not sauber:
        raise BenutzerFehler("Eine Rolle ohne Rechte wäre sinnlos - mindestens eines anhaken")
    with _sperre:
        daten = _lesen()
        daten["rollen"][name] = {"rechte": sauber, "fest": False}
        _schreiben(daten)


def rolle_entfernen(name: str) -> None:
    with _sperre:
        daten = _lesen()
        if name in FESTE_ROLLEN:
            raise BenutzerFehler(f"„{name}“ ist mitgeliefert und bleibt")
        if name not in daten["rollen"]:
            raise BenutzerFehler("Die Rolle gibt es nicht")
        benutzt = [n for n, b in daten["benutzer"].items() if b.get("rolle") == name]
        if benutzt:
            raise BenutzerFehler(
                f"Die Rolle haben noch: {', '.join(benutzt)}. Erst umstellen, dann löschen.")
        daten["rollen"].pop(name, None)
        _schreiben(daten)


def rechte_von(name: str) -> set:
    """Was dieser Benutzer darf."""
    daten = _lesen()
    b = daten["benutzer"].get((name or "").strip().lower())
    if not b:
        return set()
    rolle = daten["rollen"].get(b.get("rolle") or "")
    return set(rolle["rechte"]) if rolle else set()


def _verwalter_uebrig(daten: dict, ausser: str = "") -> int:
    """Wie viele koennen noch Benutzer verwalten?"""
    zahl = 0
    for n, b in daten["benutzer"].items():
        if n == ausser:
            continue
        rolle = daten["rollen"].get(b.get("rolle") or "")
        if rolle and "benutzer" in rolle["rechte"]:
            zahl += 1
    return zahl


def rolle_zuweisen(name: str, rolle: str) -> None:
    name = (name or "").strip().lower()
    with _sperre:
        daten = _lesen()
        if name not in daten["benutzer"]:
            raise BenutzerFehler("Den Benutzer gibt es nicht")
        if rolle not in daten["rollen"]:
            raise BenutzerFehler("Die Rolle gibt es nicht")
        # Niemand darf den letzten Verwalter entmachten - sonst kommt an die
        # Benutzerverwaltung nie wieder jemand heran.
        verliert = "benutzer" not in daten["rollen"][rolle]["rechte"]
        if verliert and _verwalter_uebrig(daten, ausser=name) == 0:
            raise BenutzerFehler("Das ist der letzte Zugang, der Benutzer verwalten darf")
        daten["benutzer"][name]["rolle"] = rolle
        daten["benutzer"][name]["verwalter"] = "benutzer" in daten["rollen"][rolle]["rechte"]
        _schreiben(daten)


def leer() -> bool:
    """Noch kein Benutzer da? Dann fuehrt der Server zur Ersteinrichtung."""
    return not _lesen()["benutzer"]


def liste() -> list[dict]:
    aus = []
    for name, b in sorted(_lesen()["benutzer"].items()):
        aus.append({"name": name, "verwalter": bool(b.get("verwalter")),
                    "rolle": b.get("rolle") or "Benutzer",
                    "angelegt": b.get("angelegt", ""), "zuletzt": b.get("zuletzt", "")})
    return aus


def anlegen(name: str, passwort: str, verwalter: bool = False, rolle: str = "") -> None:
    name = (name or "").strip().lower()
    if not NAME_MUSTER.match(name):
        raise BenutzerFehler("Der Name darf nur Kleinbuchstaben, Zahlen, Punkt, "
                             "Minus und Unterstrich haben (2 bis 31 Zeichen)")
    if len(passwort or "") < 8:
        raise BenutzerFehler("Das Passwort braucht mindestens 8 Zeichen")
    with _sperre:
        daten = _lesen()
        if name in daten["benutzer"]:
            raise BenutzerFehler("Den Namen gibt es schon")
        gewuenscht = (rolle or "").strip() or ("Verwalter" if verwalter else "Benutzer")
        if gewuenscht not in daten["rollen"]:
            raise BenutzerFehler(f"Die Rolle „{gewuenscht}“ gibt es nicht")
        salz = os.urandom(16)
        daten["benutzer"][name] = {
            "salz": base64.b64encode(salz).decode("ascii"),
            "hash": _hash(passwort, salz),
            "rolle": gewuenscht,
            "verwalter": "benutzer" in daten["rollen"][gewuenscht]["rechte"],
            "angelegt": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        _schreiben(daten)
    notizordner(name)
    konfigordner(name)


def pruefen(name: str, passwort: str) -> dict | None:
    """Gibt den Benutzer zurueck, wenn das Passwort stimmt - sonst None.

    Auch bei einem unbekannten Namen wird gerechnet. Sonst waere an der
    Antwortzeit zu sehen, welche Namen es gibt."""
    name = (name or "").strip().lower()
    b = _lesen()["benutzer"].get(name)
    salz = base64.b64decode(b["salz"]) if b else os.urandom(16)
    versuch = _hash(passwort or "", salz)
    if not b or not secrets.compare_digest(versuch, b["hash"]):
        return None
    return {"name": name, "verwalter": bool(b.get("verwalter"))}


def gesehen(name: str) -> None:
    with _sperre:
        daten = _lesen()
        if name in daten["benutzer"]:
            daten["benutzer"][name]["zuletzt"] = time.strftime("%Y-%m-%d %H:%M:%S")
            _schreiben(daten)


def passwort_setzen(name: str, passwort: str) -> None:
    if len(passwort or "") < 8:
        raise BenutzerFehler("Das Passwort braucht mindestens 8 Zeichen")
    with _sperre:
        daten = _lesen()
        if name not in daten["benutzer"]:
            raise BenutzerFehler("Den Benutzer gibt es nicht")
        salz = os.urandom(16)
        daten["benutzer"][name]["salz"] = base64.b64encode(salz).decode("ascii")
        daten["benutzer"][name]["hash"] = _hash(passwort, salz)
        _schreiben(daten)


def entfernen(name: str) -> None:
    """Nimmt den Zugang weg. Die Notizen bleiben liegen - Loeschen von Daten
    gehoert nicht in einen Knopf, der "Benutzer entfernen" heisst."""
    with _sperre:
        daten = _lesen()
        if name not in daten["benutzer"]:
            raise BenutzerFehler("Den Benutzer gibt es nicht")
        if _verwalter_uebrig(daten, ausser=name) == 0:
            raise BenutzerFehler("Das ist der letzte Zugang, der Benutzer verwalten darf")
        del daten["benutzer"][name]
        _schreiben(daten)


def sitzungsmarke(name: str) -> str:
    """Kurzes Kennzeichen des aktuellen Passworts eines Benutzers.

    Steht mit im Sitzungs-Keks. Aendert sich das Passwort, aendert sich die
    Marke - und alle offenen Sitzungen gelten nicht mehr. Ohne das bliebe
    jemand, der hineingekommen ist, auch nach dem Passwortwechsel drin; und
    genau dann wechselt man es ja.

    Der Hash selbst steht nicht im Keks, nur ein davon abgeleitetes Kuerzel.
    """
    b = _lesen()["benutzer"].get((name or "").strip().lower())
    if not b:
        return ""
    roh = hashlib.sha256((b.get("hash", "") + b.get("salz", "")).encode("utf-8")).hexdigest()
    return roh[:10]


def geheimnis() -> bytes:
    """Der Schluessel, mit dem Sitzungs-Kekse unterschrieben werden. Liegt im
    Datenordner, damit eine Anmeldung einen Neustart ueberlebt."""
    p = datenordner() / ".sitzungsschluessel"
    with _sperre:
        if not p.is_file():
            fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(secrets.token_bytes(32))
        return p.read_bytes()
