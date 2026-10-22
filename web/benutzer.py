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
import urllib.parse
import struct
import hmac
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

# Drei Rollen, fertig. Eine Rechtetabelle mit Haken zum Selberbauen waere das,
# was grosse Firmen brauchen; hier hat jeder seine eigenen Notizen und
# arbeitet manchmal zusammen. Wer einspringen koennen soll, wenn der eine nicht
# da ist, wird einfach auch Verwalter - davon darf es mehrere geben.
#
# Die Rechte darunter bleiben, weil der Server damit wirklich prueft. Sie sind
# nur nichts mehr, was jemand zusammenklicken muss.
RECHTE = {
    "lesen":     "Notizen lesen",
    "schreiben": "Notizen schreiben und anlegen",
    "anhaenge":  "Bilder und Dateien anhängen",
    "loeschen":  "Löschen und Papierkorb leeren",
    "verlauf":   "Frühere Fassungen und Papierkorb",
    "benutzer":  "Benutzer, Einladungen und Projekte verwalten",
}

ROLLEN = {
    "Verwalter": {
        "rechte": list(RECHTE),
        "erklaerung": "Alles: eigene Notizen, Benutzer anlegen, einladen, Projekte. "
                      "Davon darf es mehrere geben - so kann jemand einspringen.",
    },
    "Benutzer": {
        "rechte": ["lesen", "schreiben", "anhaenge", "loeschen", "verlauf"],
        "erklaerung": "Eigene Notizen vollständig; in Projekten so viel, wie dort "
                      "für ihn eingestellt ist.",
    },
    "Gast": {
        "rechte": ["lesen"],
        "erklaerung": "Darf nur mitlesen - nichts schreiben, nichts löschen.",
    },
}
FESTE_ROLLEN = {name: r["rechte"] for name, r in ROLLEN.items()}

# Was ein Mitglied in einem Projekt darf. Gilt zusaetzlich zur Rolle - und zwar
# das Schwaechere von beidem: wer als Gast angemeldet ist, darf auch in einem
# Projekt nichts schreiben, in dem er "verwalten" hat.
PROJEKTRECHTE = {
    "lesen":     ["lesen"],
    "schreiben": ["lesen", "schreiben", "anhaenge"],
    "verwalten": ["lesen", "schreiben", "anhaenge", "loeschen", "verlauf"],
}
PROJEKT_MUSTER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._-]{1,40}$")

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
    """Die Zugaenge von der Platte.

    Der Unterschied zwischen "es gibt noch keine Datei" und "die Datei ist da,
    aber ich komme nicht heran" ist hier lebenswichtig: im ersten Fall gehoert
    die Ersteinrichtung hin, im zweiten waere sie eine offene Tuer. Wer dann
    vorbeikommt, legt sich einen Verwalter an und hat alles.

    Genau das ist passiert, als ein Befehl im Container als root lief und die
    Datei danach root gehoerte - der Server lief als 1000, konnte sie nicht mehr
    lesen und bot freundlich die Einrichtung an.
    """
    p = datei()
    if p.exists():
        try:
            roh = json.loads(p.read_text(encoding="utf-8"))
        except OSError as f:
            raise BenutzerFehler(
                f"Die Benutzerdatei {p} ist da, lässt sich aber nicht lesen ({f.strerror}). "
                "Wem gehört sie? Der Server läuft als "
                f"{os.getuid()}:{os.getgid()}.")
        except ValueError:
            raise BenutzerFehler(
                f"Die Benutzerdatei {p} ist beschädigt. Aus Sicherheitsgründen wird "
                "hier nichts angeboten - die Datei prüfen oder aus einer Sicherung holen.")
    else:
        roh = {}
    if not isinstance(roh, dict) or not isinstance(roh.get("benutzer"), dict):
        roh = {"benutzer": {}}
    rollen = roh.get("rollen")
    if not isinstance(rollen, dict):
        rollen = {}
    # Es gibt genau die drei Rollen - selbstgebaute aus frueheren Fassungen
    # verschwinden hier, und wer eine davon hatte, bekommt unten eine der drei.
    rollen = {name: {"rechte": list(rechte), "fest": True}
              for name, rechte in FESTE_ROLLEN.items()}
    roh["rollen"] = rollen
    if not isinstance(roh.get("projekte"), dict):
        roh["projekte"] = {}
    for name, pr in list(roh["projekte"].items()):
        if not isinstance(pr, dict) or not isinstance(pr.get("mitglieder"), dict):
            roh["projekte"].pop(name, None)
    # Aeltere Dateien kennen nur "verwalter": ja/nein - und Fassungen dazwischen
    # kennen Moderator oder selbstgebaute Rollen. Niemand darf dabei seinen
    # Zugang verlieren: wer verwalten durfte, bleibt Verwalter, alle anderen
    # werden Benutzer.
    for name, b in roh["benutzer"].items():
        if b.get("rolle") not in rollen:
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


# --- Zwei Schritte beim Anmelden ---------------------------------------------
#
# TOTP nach RFC 6238, selbst geschrieben: das sind dreissig Zeilen hmac und
# struct, und dafuer braucht es keine weitere Abhaengigkeit. Was die Apps
# erwarten, ist seit Jahren dasselbe - sechs Ziffern, alle 30 Sekunden neu,
# abgeleitet aus einem gemeinsamen Geheimnis.
TOTP_STELLEN = 6
TOTP_TAKT = 30
TOTP_FENSTER = 1                    # eine Stufe vor und zurueck: Uhren gehen auseinander
NOTFALLCODES = 10


def _totp(geheim_b32: str, zaehler: int) -> str:
    roh = base64.b32decode(geheim_b32 + "=" * (-len(geheim_b32) % 8), casefold=True)
    h = hmac.new(roh, struct.pack(">Q", zaehler), hashlib.sha1).digest()
    versatz = h[-1] & 0x0F
    zahl = struct.unpack(">I", h[versatz:versatz + 4])[0] & 0x7FFFFFFF
    return str(zahl % (10 ** TOTP_STELLEN)).zfill(TOTP_STELLEN)


def totp_geheimnis() -> str:
    """20 zufaellige Bytes als Base32 - das Format, das die Apps lesen."""
    return base64.b32encode(os.urandom(20)).decode("ascii").rstrip("=")


def totp_stimmt(geheim_b32: str, code: str) -> bool:
    code = re.sub(r"\s", "", code or "")
    if not code.isdigit() or len(code) != TOTP_STELLEN:
        return False
    jetzt = int(time.time() // TOTP_TAKT)
    for stufe in range(-TOTP_FENSTER, TOTP_FENSTER + 1):
        if secrets.compare_digest(code, _totp(geheim_b32, jetzt + stufe)):
            return True
    return False


def totp_adresse(name: str, geheim_b32: str) -> str:
    """Die otpauth-Adresse, aus der der QR-Code wird."""
    wer = urllib.parse.quote(f"Notizmappe:{name}")
    return (f"otpauth://totp/{wer}?secret={geheim_b32}&issuer=Notizmappe"
            f"&algorithm=SHA1&digits={TOTP_STELLEN}&period={TOTP_TAKT}")


def _codehash(code: str) -> str:
    """Notfallcodes sind lang und zufaellig - da genuegt ein schneller Hash.

    Passwoerter werden mit scrypt gerechnet, weil Menschen sie sich ausdenken.
    Diese hier kommen aus dem Zufallsgenerator; sie zu raten ist aussichtslos,
    und zehn scrypt-Durchlaeufe je Anmeldeversuch waeren eine Bremse ohne Nutzen.
    """
    return hashlib.sha256(re.sub(r"[\s-]", "", (code or "")).upper().encode()).hexdigest()


def notfallcodes_erzeugen() -> list[str]:
    # Kein O/0 und kein I/1: diese Codes werden abgeschrieben.
    zeichen = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    aus = []
    for _ in range(NOTFALLCODES):
        roh = "".join(secrets.choice(zeichen) for _ in range(10))
        aus.append(f"{roh[:5]}-{roh[5:]}")
    return aus


def zwei_schritte_stand(name: str) -> dict:
    b = _lesen()["benutzer"].get((name or "").strip().lower()) or {}
    zwei = b.get("zwei") or {}
    return {"an": bool(zwei.get("an")),
            "codes_uebrig": len(zwei.get("codes") or []) if zwei.get("an") else 0}


def zwei_schritte_vorbereiten(name: str) -> dict:
    """Geheimnis und Notfallcodes erzeugen - aber noch nicht einschalten.

    Eingeschaltet wird erst, wenn ein Code aus der App stimmt. Sonst sperrt
    sich jemand aus, dessen App das Geheimnis gar nicht bekommen hat.
    """
    name = (name or "").strip().lower()
    geheim = totp_geheimnis()
    codes = notfallcodes_erzeugen()
    with _sperre:
        daten = _lesen()
        if name not in daten["benutzer"]:
            raise BenutzerFehler("Den Benutzer gibt es nicht")
        daten["benutzer"][name]["zwei"] = {
            "an": False, "geheim": geheim,
            "codes": [_codehash(c) for c in codes],
            "begonnen": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        _schreiben(daten)
    return {"geheim": geheim, "adresse": totp_adresse(name, geheim), "codes": codes}


def zwei_schritte_einschalten(name: str, code: str) -> None:
    name = (name or "").strip().lower()
    with _sperre:
        daten = _lesen()
        zwei = (daten["benutzer"].get(name) or {}).get("zwei") or {}
        if not zwei.get("geheim"):
            raise BenutzerFehler("Erst einrichten, dann einschalten")
        if not totp_stimmt(zwei["geheim"], code):
            raise BenutzerFehler("Der Code stimmt nicht - geht die Uhr im Gerät richtig?")
        zwei["an"] = True
        _schreiben(daten)


def zwei_schritte_aus(name: str) -> None:
    name = (name or "").strip().lower()
    with _sperre:
        daten = _lesen()
        if name in daten["benutzer"]:
            daten["benutzer"][name].pop("zwei", None)
            _schreiben(daten)


def zweiter_schritt_pruefen(name: str, code: str) -> bool:
    """Code aus der App - oder einer der Notfallcodes, der dabei verbraucht wird."""
    name = (name or "").strip().lower()
    with _sperre:
        daten = _lesen()
        zwei = (daten["benutzer"].get(name) or {}).get("zwei") or {}
        if not zwei.get("an"):
            return True                         # gar nicht eingeschaltet
        if totp_stimmt(zwei.get("geheim", ""), code):
            return True
        gesucht = _codehash(code)
        if gesucht in (zwei.get("codes") or []):
            zwei["codes"].remove(gesucht)       # jeder Code gilt einmal
            _schreiben(daten)
            return True
    return False


# --- Einladungen -------------------------------------------------------------
#
# Ein Link, der nur kurz gilt und genau einmal: damit jemand sich seinen Zugang
# selbst anlegen kann, ohne dass ein Passwort durch die Gegend geschickt wird.
# Der Link ist das Geheimnis - deshalb ist er lang, zufaellig und jedes Mal ein
# anderer, und er verschwindet, sobald er benutzt wurde oder die Zeit um ist.
EINLADUNG_MINUTEN = 5


def _einladungen(daten: dict) -> dict:
    if not isinstance(daten.get("einladungen"), dict):
        daten["einladungen"] = {}
    jetzt = time.time()
    for schluessel, e in list(daten["einladungen"].items()):
        if not isinstance(e, dict) or e.get("bis", 0) < jetzt:
            daten["einladungen"].pop(schluessel, None)
    return daten["einladungen"]


def einladung_anlegen(von: str, rolle: str = "Benutzer", projekt: str = "",
                      recht: str = "schreiben", minuten: int = EINLADUNG_MINUTEN) -> dict:
    minuten = max(1, min(int(minuten or EINLADUNG_MINUTEN), 60))
    with _sperre:
        daten = _lesen()
        if rolle not in daten["rollen"]:
            raise BenutzerFehler(f"Die Rolle „{rolle}“ gibt es nicht")
        if projekt and projekt not in daten["projekte"]:
            raise BenutzerFehler(f"Das Projekt „{projekt}“ gibt es nicht")
        if projekt and recht not in PROJEKTRECHTE:
            raise BenutzerFehler("Unbekanntes Projektrecht")
        marke = secrets.token_urlsafe(24)
        bis = time.time() + minuten * 60
        _einladungen(daten)[marke] = {
            "rolle": rolle, "projekt": projekt, "recht": recht,
            "von": (von or "").strip().lower(), "bis": bis,
            "angelegt": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        _schreiben(daten)
    return {"marke": marke, "bis": bis, "minuten": minuten,
            "rolle": rolle, "projekt": projekt}


def einladung_lesen(marke: str) -> dict | None:
    """Gilt diese Einladung noch?"""
    with _sperre:
        daten = _lesen()
        e = _einladungen(daten).get(str(marke or ""))
        return dict(e) if e else None


def einladungen() -> list[dict]:
    with _sperre:
        daten = _lesen()
        aus = [{"marke": m, **e} for m, e in _einladungen(daten).items()]
        _schreiben(daten)                       # abgelaufene gleich wegraeumen
    return sorted(aus, key=lambda e: e["bis"])


def einladung_zuruecknehmen(marke: str) -> None:
    with _sperre:
        daten = _lesen()
        if _einladungen(daten).pop(str(marke or ""), None) is None:
            raise BenutzerFehler("Diese Einladung gibt es nicht mehr")
        _schreiben(daten)


def einladung_einloesen(marke: str, name: str, passwort: str) -> str:
    """Zugang anlegen und die Einladung verbrauchen - beides oder keines."""
    with _sperre:
        daten = _lesen()
        e = _einladungen(daten).get(str(marke or ""))
        if not e:
            raise BenutzerFehler("Diese Einladung gilt nicht mehr")
    # anlegen() nimmt die Sperre selbst; erst danach die Einladung streichen,
    # sonst waere sie bei einem zu kurzen Passwort schon verbraucht.
    anlegen(name, passwort, rolle=e["rolle"])
    with _sperre:
        daten = _lesen()
        _einladungen(daten).pop(str(marke), None)
        if e.get("projekt") and e["projekt"] in daten["projekte"]:
            daten["projekte"][e["projekt"]]["mitglieder"][name.strip().lower()] = e["recht"]
        _schreiben(daten)
    return name.strip().lower()


# --- Projekte: geteilte Bereiche ---------------------------------------------
#
# Ein Projekt ist ein eigener Notizordner, an dem mehrere arbeiten. Die privaten
# Notizen bleiben davon unberuehrt - niemand sieht sie, auch kein Verwalter.

def projektordner(name: str) -> Path:
    p = datenordner() / "projekte" / _dateiname(name)
    p.mkdir(parents=True, exist_ok=True)
    return p


def _dateiname(name: str) -> str:
    """Aus einem Projektnamen einen Ordnernamen machen - ohne Ueberraschungen."""
    sauber = re.sub(r"[^A-Za-z0-9 ._-]", "-", (name or "").strip())
    sauber = sauber.strip(" .") or "Projekt"
    return sauber[:60]


def projekte() -> dict:
    return _lesen()["projekte"]


def projekte_von(benutzer: str) -> list[dict]:
    """Die Projekte, in denen jemand Mitglied ist - mit seinem Recht darin."""
    benutzer = (benutzer or "").strip().lower()
    aus = []
    for name, pr in sorted(_lesen()["projekte"].items()):
        recht = pr["mitglieder"].get(benutzer)
        if recht in PROJEKTRECHTE:
            aus.append({"name": name, "recht": recht})
    return aus


def projekt_recht(benutzer: str, projekt: str) -> str:
    for p in projekte_von(benutzer):
        if p["name"] == projekt:
            return p["recht"]
    return ""


def projekt_anlegen(name: str, von: str, recht: str = "verwalten") -> str:
    name = (name or "").strip()
    if not PROJEKT_MUSTER.match(name):
        raise BenutzerFehler("Der Projektname darf 2 bis 41 Zeichen haben, "
                             "Buchstaben, Zahlen, Leerzeichen, Punkt, Minus, Unterstrich")
    with _sperre:
        daten = _lesen()
        if name in daten["projekte"]:
            raise BenutzerFehler("Ein Projekt mit dem Namen gibt es schon")
        daten["projekte"][name] = {
            "angelegt": time.strftime("%Y-%m-%d %H:%M:%S"),
            "ordner": _dateiname(name),
            "mitglieder": {(von or "").strip().lower(): recht},
        }
        _schreiben(daten)
    projektordner(name)
    return name


def projekt_entfernen(name: str) -> None:
    """Nimmt das Projekt aus der Liste. Die Notizen bleiben liegen - Loeschen
    von Inhalten gehoert nicht in einen Knopf, der "Projekt entfernen" heisst."""
    with _sperre:
        daten = _lesen()
        if name not in daten["projekte"]:
            raise BenutzerFehler("Das Projekt gibt es nicht")
        daten["projekte"].pop(name)
        _schreiben(daten)


def mitglied_setzen(projekt: str, benutzer: str, recht: str) -> None:
    benutzer = (benutzer or "").strip().lower()
    with _sperre:
        daten = _lesen()
        if projekt not in daten["projekte"]:
            raise BenutzerFehler("Das Projekt gibt es nicht")
        if benutzer not in daten["benutzer"]:
            raise BenutzerFehler("Den Benutzer gibt es nicht")
        if recht not in PROJEKTRECHTE:
            raise BenutzerFehler("Unbekanntes Recht")
        daten["projekte"][projekt]["mitglieder"][benutzer] = recht
        _schreiben(daten)


def mitglied_entfernen(projekt: str, benutzer: str) -> None:
    benutzer = (benutzer or "").strip().lower()
    with _sperre:
        daten = _lesen()
        pr = daten["projekte"].get(projekt)
        if not pr:
            raise BenutzerFehler("Das Projekt gibt es nicht")
        uebrig = [b for b, r in pr["mitglieder"].items() if r == "verwalten" and b != benutzer]
        if pr["mitglieder"].get(benutzer) == "verwalten" and not uebrig:
            raise BenutzerFehler("Das ist der letzte, der dieses Projekt verwalten darf")
        pr["mitglieder"].pop(benutzer, None)
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
            raise BenutzerFehler(f"Die Rolle „{rolle}“ gibt es nicht - "
                                 f"möglich sind: {', '.join(ROLLEN)}")
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


def _marke() -> Path:
    """Die Marke "hier war schon eingerichtet".

    Sie liegt im Einrichtungsordner, nicht bei den Notizen - und genau darum
    geht es: wird die Ablage umgestellt und zeigt auf einen leeren Ordner, ist
    benutzer.json weg, aber diese Marke bleibt. Ohne sie boete der Server
    freundlich die Ersteinrichtung an, und wer in dem Moment vorbeikommt, legt
    sich einen Verwalter an und hat alles.

    Dasselbe gilt fuer einen Mount, der nicht gegriffen hat, oder einen
    vertippten Pfad. Ein leerer Datenordner ist auf einem Server, der schon
    lief, nie eine gute Nachricht.
    """
    return Path(os.environ.get("NOTIZMAPPE_EINRICHTUNG", "/einrichtung")) / "eingerichtet"


def einrichtung_merken() -> None:
    try:
        p = _marke()
        p.parent.mkdir(parents=True, exist_ok=True)
        if not p.exists():
            p.write_text("ja\n", encoding="utf-8")
    except OSError:
        pass            # Kein Einrichtungsordner: dann eben ohne Marke


def war_schon_eingerichtet() -> bool:
    try:
        return _marke().is_file()
    except OSError:
        return False


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
        # Auch aus den Projekten nehmen - sonst steht dort ein Mitglied, das es
        # nicht mehr gibt, und niemand weiss, wer das war.
        for pr in daten["projekte"].values():
            pr["mitglieder"].pop(name, None)
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
