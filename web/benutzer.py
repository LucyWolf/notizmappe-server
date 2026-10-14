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
        return {"benutzer": {}}
    if not isinstance(roh, dict) or not isinstance(roh.get("benutzer"), dict):
        return {"benutzer": {}}
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


def leer() -> bool:
    """Noch kein Benutzer da? Dann fuehrt der Server zur Ersteinrichtung."""
    return not _lesen()["benutzer"]


def liste() -> list[dict]:
    aus = []
    for name, b in sorted(_lesen()["benutzer"].items()):
        aus.append({"name": name, "verwalter": bool(b.get("verwalter")),
                    "angelegt": b.get("angelegt", ""), "zuletzt": b.get("zuletzt", "")})
    return aus


def anlegen(name: str, passwort: str, verwalter: bool = False) -> None:
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
        salz = os.urandom(16)
        daten["benutzer"][name] = {
            "salz": base64.b64encode(salz).decode("ascii"),
            "hash": _hash(passwort, salz),
            "verwalter": bool(verwalter),
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
        if daten["benutzer"][name].get("verwalter") and \
                sum(1 for b in daten["benutzer"].values() if b.get("verwalter")) <= 1:
            raise BenutzerFehler("Das ist der letzte Verwalter - dann käme niemand mehr rein")
        del daten["benutzer"][name]
        _schreiben(daten)


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
