"""Eigene Speicher je Benutzer - NAS (SMB), spaeter Google Drive.

Ohne Einrichtung aendert sich nichts: die Notizen liegen in
`daten/notizen/<name>` wie bisher ("standard"). Wer einen Speicher dazunimmt,
bekommt ihn als eigenen Abschnitt in der Leiste.

-- Warum Abgleich und nicht Einhaengen ---------------------------------------

`mount` geht nur als root, und root ist der Server nur in der Sekunde beim
Start (siehe ablage.py). Ein Benutzer, der seine NAS selbst einrichtet, haette
also jedes Mal einen Neustart fuer ALLE gebraucht - und noch einen, wenn die
NAS spaeter wieder da ist. Ein dauerhafter root-Helfer waere der andere Weg,
und das ist ein Hebel, den hier niemand will.

Also arbeitet der Server in einer Arbeitskopie
(`daten/speicher/<name>/<kennung>/`), und rclone gleicht sie in beide
Richtungen mit dem Speicher ab: nach dem Speichern und alle paar Minuten. Ist
die NAS aus, wird weitergearbeitet und spaeter nachgeholt.

-- Was getrennt liegt ---------------------------------------------------------

  * die Liste der Speicher (ohne Geheimnisse): konfig/<name>/speicher.json
  * das Passwort: /einrichtung/speicher/<name>/<kennung>.json, 0600 - nicht in
    /daten, damit es nicht mit den Notizen auf eine Freigabe wandert
  * rclones eigene Buchfuehrung (--workdir): ebenfalls unter /einrichtung,
    sonst glich rclone seine eigenen Listen mit ab

-- Zur Vorsicht ----------------------------------------------------------------

Aufgerufen wird ohne Shell, als Liste. Zugangsdaten gehen ueber die Umgebung
des Kindprozesses, nicht ueber die Kommandozeile - dort stuenden sie in der
Prozessliste. Jedes Feld laeuft gegen dieselben engen Muster wie bei der
Ablage.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import platform
import re
import secrets
import shutil
import subprocess
import threading
import time
import urllib.request
import zipfile
from pathlib import Path

import ablage
import benutzer as nutzer

EINRICHTUNG = Path(os.environ.get("NOTIZMAPPE_EINRICHTUNG", "/einrichtung"))

STANDARD = "standard"
ARTEN = ("smb",)
MUSTER_KENNUNG = re.compile(r"^s[0-9a-f]{8}$")
MUSTER_ANZEIGE = re.compile(r"^[^\x00-\x1f/\\]{1,40}$")

# Wie oft ohne Anlass abgeglichen wird, und wie lange nach dem letzten
# Speichern gewartet wird. Die Oberflaeche speichert 900 ms nach jeder
# Eingabe - wer schreibt, loest also staendig aus. Erst wenn eine Weile Ruhe
# ist, lohnt der Weg ueber das Netz.
ABSTAND = 5 * 60
RUHE = 20
ZEITGRENZE = 10 * 60

# Mehr als das wird beim ersten Verbinden nicht heruntergeholt. Wer sich im
# Unterordner vertippt und die halbe NAS erwischt, soll eine Frage bekommen und
# nicht 300 GB auf dem Server.
MAX_ERSTABGLEICH = 2 << 30

# -- rclone ------------------------------------------------------------------
#
# Im Image steckt es. Wer aber ueber den Update-Knopf aktualisiert, hat noch
# das alte Image - dort wird es beim ersten Bedarf geholt. Die Pruefsummen
# stehen fest hier drin und sind am 28.11.2026 gegen die geladene Datei
# nachgerechnet; eine Datei, die nicht passt, wird nicht ausgefuehrt.
RCLONE_FASSUNG = "v1.68.2"
RCLONE_PRUEFSUMMEN = {
    "amd64": "0e6fa18051e67fc600d803a2dcb10ddedb092247fc6eee61be97f64ec080a13c",
    "arm64": "c6e9d4cf9c88b279f6ad80cd5675daebc068e404890fa7e191412c1bc7a4ac5f",
}
RCLONE_ADRESSE = ("https://github.com/rclone/rclone/releases/download/"
                  "{f}/rclone-{f}-linux-{a}.zip")
MAX_RCLONE_ARCHIV = 60 << 20


class SpeicherortFehler(Exception):
    pass


def _bauart() -> str:
    m = platform.machine().lower()
    if m in ("x86_64", "amd64"):
        return "amd64"
    if m in ("aarch64", "arm64"):
        return "arm64"
    raise SpeicherortFehler(f"Für diesen Rechner ({m}) gibt es hier kein rclone.")


_holen = threading.Lock()


def rclone() -> str:
    """Pfad zu rclone - aus dem Image, sonst nachgeladen und geprueft."""
    da = shutil.which("rclone")
    if da:
        return da
    ziel = EINRICHTUNG / "bin" / f"rclone-{RCLONE_FASSUNG}"
    if ziel.is_file():
        return str(ziel)
    with _holen:
        if ziel.is_file():
            return str(ziel)
        art = _bauart()
        adresse = RCLONE_ADRESSE.format(f=RCLONE_FASSUNG, a=art)
        try:
            with urllib.request.urlopen(adresse, timeout=60) as antwort:
                roh = antwort.read(MAX_RCLONE_ARCHIV + 1)
        except OSError as f:
            raise SpeicherortFehler(f"rclone ließ sich nicht laden: {f}") from f
        if len(roh) > MAX_RCLONE_ARCHIV:
            raise SpeicherortFehler("Das rclone-Archiv ist größer als erwartet.")
        if hashlib.sha256(roh).hexdigest() != RCLONE_PRUEFSUMMEN[art]:
            raise SpeicherortFehler("Die Prüfsumme von rclone stimmt nicht - nicht verwendet.")
        name = f"rclone-{RCLONE_FASSUNG}-linux-{art}/rclone"
        try:
            with zipfile.ZipFile(io.BytesIO(roh)) as z:
                inhalt = z.read(name)
        except (KeyError, zipfile.BadZipFile) as f:
            raise SpeicherortFehler("Im rclone-Archiv fehlt das Programm.") from f
        ziel.parent.mkdir(parents=True, exist_ok=True)
        vorlaeufig = ziel.with_name(ziel.name + ".neu")
        vorlaeufig.write_bytes(inhalt)
        os.chmod(vorlaeufig, 0o755)
        os.replace(vorlaeufig, ziel)
    return str(ziel)


# -- Einstellungen -----------------------------------------------------------

def _liste_datei(name: str) -> Path:
    return nutzer.konfigordner(name) / "speicher.json"


def _geheim_ordner(name: str) -> Path:
    return EINRICHTUNG / "speicher" / name


def _geheim_datei(name: str, kennung: str) -> Path:
    return _geheim_ordner(name) / f"{kennung}.json"


def _arbeitsbuch(name: str, kennung: str) -> Path:
    """rclones Listen vom letzten Abgleich - getrennt von den Notizen."""
    return _geheim_ordner(name) / f"{kennung}.bisync"


def arbeitskopie(name: str, kennung: str) -> Path:
    return nutzer.datenordner() / "speicher" / name / kennung


def lesen(name: str) -> dict:
    """Die Speicher eines Benutzers. Ohne Datei: nur der Standardordner."""
    try:
        roh = json.loads(_liste_datei(name).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        roh = {}
    if not isinstance(roh, dict):
        roh = {}
    orte = [o for o in (roh.get("orte") or [])
            if isinstance(o, dict) and MUSTER_KENNUNG.match(str(o.get("kennung") or ""))
            and o.get("art") in ARTEN]
    aktiv = str(roh.get("aktiv") or STANDARD)
    standard_aus = bool(roh.get("standard_aus")) and bool(orte)
    if aktiv != STANDARD and aktiv not in {o["kennung"] for o in orte}:
        aktiv = STANDARD
    if aktiv == STANDARD and standard_aus:
        aktiv = orte[0]["kennung"]
    return {"aktiv": aktiv, "standard_aus": standard_aus, "orte": orte}


def _schreiben(name: str, stand: dict) -> None:
    p = _liste_datei(name)
    vorlaeufig = p.with_name(".speicher.neu")
    vorlaeufig.write_text(json.dumps(stand, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(vorlaeufig, p)


def ort(name: str, kennung: str) -> dict | None:
    for o in lesen(name)["orte"]:
        if o["kennung"] == kennung:
            return o
    return None


def ordner(name: str, kennung: str) -> Path:
    """Wo die Notizen dieses Speichers am Server liegen."""
    if kennung and kennung != STANDARD and ort(name, kennung):
        p = arbeitskopie(name, kennung)
        p.mkdir(parents=True, exist_ok=True)
        return p
    return nutzer.notizordner(name)


def sichtbar(name: str) -> list[dict]:
    """Die Abschnitte der Leiste, in ihrer Reihenfolge - Standard zuerst."""
    stand = lesen(name)
    aus = []
    if not stand["standard_aus"]:
        aus.append({"kennung": STANDARD, "name": "Standard", "art": "standard"})
    for o in stand["orte"]:
        aus.append({"kennung": o["kennung"], "name": o["name"], "art": o["art"],
                    **zustand(name, o["kennung"])})
    return aus


def pruefen(rumpf: dict) -> dict:
    """Aus dem Formular einen Speicher machen - oder sagen, was fehlt."""
    art = str(rumpf.get("art") or "").strip()
    if art not in ARTEN:
        raise SpeicherortFehler(f"Unbekannte Art: {art!r}")
    anzeige = str(rumpf.get("name") or "").strip() or "NAS"
    if not MUSTER_ANZEIGE.match(anzeige):
        raise SpeicherortFehler("Der Name enthält Zeichen, die dort nicht hingehören.")
    # Ohne Unterordner wuerde die ganze Freigabe abgeglichen - und alles, was
    # sonst auf der NAS liegt, landete am Server. Deshalb ist er Pflicht.
    unter = str(rumpf.get("unterordner") or "Notizmappe").strip().strip("/")
    if ".." in unter.split("/"):
        raise SpeicherortFehler("Der Unterordner darf nicht aus der Freigabe herausführen.")
    try:
        neu = {
            "art": art,
            "name": anzeige,
            "wirt": ablage._pruefe(ablage.MUSTER_WIRT, rumpf.get("wirt"), "Der Name der NAS"),
            "freigabe": ablage._pruefe(ablage.MUSTER_FREIGABE, rumpf.get("freigabe"),
                                       "Die Freigabe"),
            "benutzer": ablage._pruefe(ablage.MUSTER_BENUTZER, rumpf.get("benutzer"),
                                       "Der Benutzername"),
            "unterordner": ablage._pruefe(ablage.MUSTER_UNTER, unter, "Der Unterordner"),
        }
    except ablage.AblageFehler as f:
        raise SpeicherortFehler(str(f)) from f
    return neu


def _verschleiern(passwort: str) -> str:
    """rclone will Passwoerter "obscured" - das ist keine Verschluesselung,
    nur das Format, das es erwartet. Geschuetzt wird die Datei durch 0600."""
    fertig = subprocess.run([rclone(), "obscure", "-"], input=passwort, capture_output=True,
                            text=True, timeout=30, env=_umgebung_grund())
    if fertig.returncode != 0:
        raise SpeicherortFehler("Das Passwort ließ sich nicht ablegen.")
    return fertig.stdout.strip()


def _geheim_lesen(name: str, kennung: str) -> dict:
    try:
        roh = json.loads(_geheim_datei(name, kennung).read_text(encoding="utf-8"))
        return roh if isinstance(roh, dict) else {}
    except (OSError, ValueError):
        return {}


def _geheim_schreiben(name: str, kennung: str, daten: dict) -> None:
    o = _geheim_ordner(name)
    o.mkdir(parents=True, exist_ok=True)
    os.chmod(o, 0o700)
    p = _geheim_datei(name, kennung)
    vorlaeufig = p.with_name(p.name + ".neu")
    fd = os.open(vorlaeufig, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(daten, f)
    os.replace(vorlaeufig, p)


# -- rclone aufrufen ---------------------------------------------------------

def _umgebung_grund() -> dict:
    """Eine Umgebung ohne die des Servers - der Kindprozess braucht nichts davon."""
    EINRICHTUNG.mkdir(parents=True, exist_ok=True)
    return {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": str(EINRICHTUNG),
        # Eine leere eigene Datei: sonst sucht rclone in ~/.config und meckert.
        "RCLONE_CONFIG": str(EINRICHTUNG / "speicher" / "rclone.conf"),
        "RCLONE_CACHE_DIR": str(EINRICHTUNG / "speicher" / ".cache"),
    }


def fern(name: str, o: dict) -> tuple[str, dict]:
    """Ziel und Umgebung fuer rclone. In Tests wird das ersetzt."""
    umgebung = _umgebung_grund()
    if o["art"] == "smb":
        umgebung.update({
            "RCLONE_SMB_HOST": o["wirt"],
            "RCLONE_SMB_USER": o["benutzer"],
            "RCLONE_SMB_PASS": str(_geheim_lesen(name, o["kennung"]).get("pass") or ""),
        })
        return f":smb:{o['freigabe']}/{o['unterordner']}", umgebung
    raise SpeicherortFehler(f"Unbekannte Art: {o['art']!r}")


def _rclone(args: list[str], umgebung: dict, zeit: int = 60) -> tuple[int, str]:
    (EINRICHTUNG / "speicher").mkdir(parents=True, exist_ok=True)
    conf = Path(umgebung["RCLONE_CONFIG"])
    if not conf.exists():
        conf.touch(mode=0o600)
    try:
        fertig = subprocess.run([rclone(), *args], capture_output=True, text=True,
                                timeout=zeit, env=umgebung)
    except subprocess.TimeoutExpired:
        return 124, "Keine Antwort in der Zeit - ist der Speicher erreichbar?"
    except OSError as f:
        return 127, f"rclone ließ sich nicht starten: {f}"
    return fertig.returncode, (fertig.stderr or fertig.stdout or "")


def _kurz(text: str) -> str:
    """Aus rclones Ausgabe den Satz, der etwas sagt."""
    zeilen = [z.strip() for z in text.splitlines() if z.strip()]
    for z in reversed(zeilen):
        if "ERROR" in z or "Failed" in z or "failed" in z:
            z = re.sub(r"^\d{4}/\d\d/\d\d \d\d:\d\d:\d\d\s+", "", z)
            return _uebersetzen(z)[:300]
    return _uebersetzen(zeilen[-1])[:300] if zeilen else "Unbekannter Fehler"


def _uebersetzen(z: str) -> str:
    """Die haeufigen Faelle in einem Satz, den man versteht."""
    klein = z.lower()
    if "logon failure" in klein or "status_logon_failure" in klein:
        return "Anmeldung an der NAS abgelehnt - Benutzername oder Passwort stimmt nicht."
    if "bad_network_name" in klein:
        return "Diese Freigabe gibt es auf der NAS nicht."
    if "no such host" in klein:
        return "Den Rechnernamen kennt hier niemand - lieber die IP-Adresse eintragen."
    if "connection refused" in klein:
        return "Die NAS lehnt die Verbindung ab - ist SMB dort eingeschaltet?"
    if "i/o timeout" in klein or "no route to host" in klein:
        return "Die NAS antwortet nicht - ist sie an und im selben Netz?"
    if "access_denied" in klein or "permission denied" in klein:
        return "Kein Zugriff - dem NAS-Benutzer fehlen Rechte auf diesen Ordner."
    return z


def verbindung_pruefen(name: str, o: dict) -> dict:
    """Vor dem Speichern einmal hin: kommt man an, und was liegt dort schon?"""
    ziel, umgebung = fern(name, o)
    code, text = _rclone(["mkdir", ziel], umgebung, zeit=45)
    if code != 0:
        raise SpeicherortFehler(_kurz(text))
    code, text = _rclone(["size", "--json", ziel], umgebung, zeit=120)
    if code != 0:
        raise SpeicherortFehler(_kurz(text))
    try:
        groesse = json.loads(text.strip().splitlines()[-1])
    except (ValueError, IndexError):
        groesse = {}
    return {"bytes": int(groesse.get("bytes") or 0), "dateien": int(groesse.get("count") or 0)}


# -- Anlegen, entfernen, umschalten -----------------------------------------

_aendern = threading.Lock()


def anlegen(name: str, rumpf: dict) -> dict:
    neu = pruefen(rumpf)
    passwort = str(rumpf.get("passwort") or "")
    if not passwort:
        raise SpeicherortFehler("Das Passwort fehlt.")
    if "\n" in passwort:
        raise SpeicherortFehler("Zeilenumbrüche gehen hier nicht.")
    kennung = "s" + secrets.token_hex(4)
    neu["kennung"] = kennung
    _geheim_schreiben(name, kennung, {"pass": _verschleiern(passwort)})
    try:
        da = verbindung_pruefen(name, neu)
        if da["bytes"] > MAX_ERSTABGLEICH and not rumpf.get("trotzdem"):
            raise SpeicherortFehler(
                f"Im Ordner „{neu['unterordner']}“ liegen schon "
                f"{da['bytes'] / (1 << 30):.1f} GB in {da['dateien']} Dateien. "
                "Ist das wirklich der Ordner für die Notizen? Sonst einen eigenen "
                "Unterordner angeben.")
    except Exception:
        _geheim_entfernen(name, kennung)
        raise
    with _aendern:
        stand = lesen(name)
        stand["orte"].append(neu)
        _schreiben(name, stand)
    arbeitskopie(name, kennung).mkdir(parents=True, exist_ok=True)
    anstossen(name, kennung, sofort=True)
    return {"kennung": kennung, **da}


def _geheim_entfernen(name: str, kennung: str) -> None:
    try:
        _geheim_datei(name, kennung).unlink()
    except OSError:
        pass
    shutil.rmtree(_arbeitsbuch(name, kennung), ignore_errors=True)


def entfernen(name: str, kennung: str) -> str:
    """Den Speicher abhaengen. Die Notizen DORT bleiben unberuehrt.

    Die Arbeitskopie am Server wird nicht geloescht, sondern zur Seite gelegt:
    war der letzte Abgleich nicht durch, steht dort das Neueste.
    """
    with _aendern:
        stand = lesen(name)
        if not any(o["kennung"] == kennung for o in stand["orte"]):
            raise SpeicherortFehler("Diesen Speicher gibt es nicht.")
        stand["orte"] = [o for o in stand["orte"] if o["kennung"] != kennung]
        if stand["aktiv"] == kennung:
            stand["aktiv"] = STANDARD
        if not stand["orte"]:
            stand["standard_aus"] = False
        _schreiben(name, stand)
    _geheim_entfernen(name, kennung)
    _zustaende.pop((name, kennung), None)
    alt = arbeitskopie(name, kennung)
    if alt.is_dir():
        weg = alt.with_name(f".entfernt-{kennung}-{time.strftime('%Y%m%d-%H%M%S')}")
        os.replace(alt, weg)
        return f"Abgehängt. Die Kopie am Server liegt noch in {weg.name}."
    return "Abgehängt."


def aktiv_setzen(name: str, kennung: str) -> str:
    with _aendern:
        stand = lesen(name)
        gueltig = {o["kennung"] for o in stand["orte"]}
        if not stand["standard_aus"]:
            gueltig.add(STANDARD)
        if kennung not in gueltig:
            raise SpeicherortFehler("Diesen Speicher gibt es nicht.")
        stand["aktiv"] = kennung
        _schreiben(name, stand)
    return kennung


def leer(p: Path) -> bool:
    """Keine Notizbuecher drin - Papierkorb und Verborgenes zaehlen nicht."""
    try:
        return not any(c.is_dir() and not c.name.startswith(".") for c in p.iterdir())
    except OSError:
        return True


def standard_aus(name: str, aus: bool) -> None:
    with _aendern:
        stand = lesen(name)
        if aus:
            if not stand["orte"]:
                raise SpeicherortFehler("Erst einen anderen Speicher einrichten.")
            if not leer(nutzer.notizordner(name)):
                raise SpeicherortFehler("Im Standardordner liegen noch Notizbücher - "
                                        "erst übertragen, dann abschalten.")
            if stand["aktiv"] == STANDARD:
                stand["aktiv"] = stand["orte"][0]["kennung"]
        stand["standard_aus"] = bool(aus)
        _schreiben(name, stand)


# -- Abgleich ------------------------------------------------------------------

_zustaende: dict[tuple[str, str], dict] = {}
_anstoesse: dict[tuple[str, str], float] = {}
_zuletzt: dict[tuple[str, str], float] = {}
_mit_gewalt: set[tuple[str, str]] = set()
_sperren: dict[tuple[str, str], threading.Lock] = {}
_zustand_sperre = threading.Lock()


def zustand(name: str, kennung: str) -> dict:
    """Fuer die Leiste: wie steht es um diesen Speicher?"""
    z = _zustaende.get((name, kennung)) or {}
    return {"stand": z.get("stand", "neu"), "zuletzt": z.get("zuletzt", 0),
            "fehler": z.get("fehler", ""), "seit": z.get("seit", 0)}


def anstossen(name: str, kennung: str, sofort: bool = False) -> None:
    """Nach einer Aenderung: bald abgleichen, aber nicht sofort bei jedem Zeichen."""
    if not kennung or kennung == STANDARD:
        return
    _anstoesse[(name, kennung)] = 0.0 if sofort else time.time()


def grosse_loeschung_erlaubt(name: str, kennung: str) -> None:
    """rclone bricht ab, wenn mehr als die Haelfte verschwindet - gut so, ausser
    jemand hat gerade selbst alles hinausgeschoben. Dann einmal mit --force."""
    _mit_gewalt.add((name, kennung))


def _konflikte_in_verlauf(wurzel: Path) -> int:
    """Was rclone bei einem Konflikt unterlegen umbenannt hat, kommt in den
    Verlauf der Seite. Als lose Datei im Abschnitt saehe es aus wie eine
    zweite Seite - und waere beim naechsten Mal wieder ein Konflikt."""
    n = 0
    for p in list(wurzel.rglob("*.konflikt*")):
        m = re.match(r"^(?P<stamm>.+)\.konflikt\d+(?P<endung>\.json)?$", p.name)
        if not m or not p.is_file():
            continue
        stamm = m.group("stamm")
        if stamm.endswith(".json"):
            stamm = stamm[:-5]
        elif not m.group("endung"):
            continue
        if any(t.startswith(".") for t in p.relative_to(wurzel).parts[:-1]):
            # Im Verlauf oder Papierkorb selbst: dort ist ein Konflikt egal,
            # beide Fassungen sind ohnehin Geschichte.
            continue
        ziel = p.parent / ".verlauf" / stamm
        ziel.mkdir(parents=True, exist_ok=True)
        marke = time.strftime("%Y%m%d-%H%M%S", time.localtime(p.stat().st_mtime))
        name = marke
        k = 1
        while (ziel / f"{name}.json").exists():
            k += 1
            name = f"{marke}-{k}"
        os.replace(p, ziel / f"{name}.json")
        n += 1
    return n


def abgleichen(name: str, kennung: str) -> dict:
    """Einmal abgleichen. Laeuft nie zweimal gleichzeitig fuer denselben Ort."""
    o = ort(name, kennung)
    if not o:
        return {"stand": "fehler", "fehler": "Diesen Speicher gibt es nicht."}
    schluessel = (name, kennung)
    with _zustand_sperre:
        sperre = _sperren.setdefault(schluessel, threading.Lock())
    if not sperre.acquire(blocking=False):
        return zustand(name, kennung)
    try:
        vorher = _zustaende.get(schluessel) or {}
        _zustaende[schluessel] = {**vorher, "stand": "laeuft"}
        _anstoesse.pop(schluessel, None)
        ziel, umgebung = fern(name, o)
        hier = arbeitskopie(name, kennung)
        hier.mkdir(parents=True, exist_ok=True)
        buch = _arbeitsbuch(name, kennung)
        buch.mkdir(parents=True, exist_ok=True)
        grund = [
            "bisync", str(hier), ziel,
            "--workdir", str(buch),
            # Leere Notizbuecher und Abschnitte sind Ordner ohne Datei - ohne
            # das kaemen sie nie auf der anderen Seite an.
            "--create-empty-src-dirs",
            "--conflict-resolve", "newer", "--conflict-loser", "num",
            "--conflict-suffix", "konflikt",
            "--resilient", "--recover", "--max-lock", "5m",
        ]
        erst = not any(buch.glob("*.lst"))
        args = grund + (["--resync"] if erst else [])
        if schluessel in _mit_gewalt:
            args.append("--force")
        code, text = _rclone(args, umgebung, zeit=ZEITGRENZE)
        if code != 0 and not erst and "--resync" in text:
            # rclone traut seinen Listen nicht mehr. --resync loescht nie etwas,
            # es fuehrt nur zusammen - deshalb darf das ohne Rueckfrage laufen.
            code, text = _rclone(grund + ["--resync"], umgebung, zeit=ZEITGRENZE)
        jetzt = time.time()
        _zuletzt[schluessel] = jetzt
        if code == 0:
            _mit_gewalt.discard(schluessel)
            _konflikte_in_verlauf(hier)
            _zustaende[schluessel] = {"stand": "ok", "zuletzt": jetzt, "fehler": "", "seit": 0}
        else:
            _zustaende[schluessel] = {
                "stand": "fehler", "zuletzt": vorher.get("zuletzt", 0),
                "fehler": _kurz(text),
                "seit": vorher.get("seit") or jetzt,
            }
            print(f"[speicher] {name}/{kennung}: {text.strip()[-500:]}", flush=True)
        return zustand(name, kennung)
    finally:
        sperre.release()


def _faellig(name: str, kennung: str, jetzt: float) -> bool:
    s = (name, kennung)
    if s in _anstoesse and jetzt - _anstoesse[s] >= RUHE:
        return True
    return jetzt - _zuletzt.get(s, 0) >= ABSTAND


def _runde() -> None:
    jetzt = time.time()
    try:
        namen = [b["name"] for b in nutzer.liste()]
    except Exception:                                               # noqa: BLE001
        return
    for name in namen:
        for o in lesen(name)["orte"]:
            if _faellig(name, o["kennung"], jetzt):
                try:
                    abgleichen(name, o["kennung"])
                except Exception as f:                              # noqa: BLE001
                    print(f"[speicher] {name}/{o['kennung']}: {f}", flush=True)


_gestartet = threading.Event()


def hintergrund_starten() -> None:
    """Ein Faden fuer alle: der Reihe nach, nie zwei rclone auf einmal."""
    if _gestartet.is_set():
        return
    _gestartet.set()

    def schleife():
        while True:
            _runde()
            time.sleep(5)

    threading.Thread(target=schleife, name="speicherabgleich", daemon=True).start()
