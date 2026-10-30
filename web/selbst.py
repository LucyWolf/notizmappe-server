"""Die neue Fassung bereitlegen - ohne den Docker-Socket.

Ein Container kann sich nicht durch ein neues Image ersetzen. Er kann aber
seinen *Inhalt* erneuern und sich danach neu starten lassen:

    /daten/.programm/<fassung>/web/          die HTTP-Schicht
    /daten/.programm/<fassung>/desktop/app/  Oberflaeche und Ablage
    /daten/.programm/aktiv                   welche Fassung gelten soll

`start.py` sieht beim Start nach, ob dort etwas Neueres liegt als im Image, und
startet uvicorn dann von dort. Der Weg zurueck ist immer ein geloeschter
Ordner.

Warum nicht der Docker-Socket: wer ihn hat, ist root auf dem Wirt. Haengt er in
einem Container, der eine Weboberflaeche ins Netz stellt, wird jede Luecke in
der Anmeldung zur Uebernahme des ganzen Rechners. In phobos-bot ist er aus
genau dem Grund wieder ausgebaut worden.

-- Was hier passiert, beim Namen genannt ------------------------------------

Der Server laedt Code nach und fuehrt ihn beim naechsten Start aus. Das ist die
gefaehrlichste Stelle im ganzen Programm, und deshalb steht hier mehr Pruefung
als Arbeit:

  * geholt wird nur ueber HTTPS und nur von den beiden eigenen Repos,
  * eine Groessengrenze, damit kein Container volllaeuft,
  * ausgepackt mit filter="data" - kein "../", keine Symlinks,
  * jede .py wird uebersetzt, bevor die Fassung ueberhaupt gilt,
  * die Pflichtdateien muessen vorhanden sein,
  * neue Abhaengigkeiten werden erkannt und abgelehnt, statt spaeter als
    ImportError hochzukommen,
  * und start.py wirft eine Fassung weg, die zweimal nicht startet.

Dass die Archive von GitHub kommen, ist dabei kein Argument - ein Entpacker,
der nur bei gutwilligen Archiven sicher ist, ist keiner. Ausloesen darf das
Ganze ohnehin nur, wer Benutzer verwalten kann.
"""
from __future__ import annotations

import io
import os
import shutil
import tarfile
import urllib.request
from pathlib import Path

SERVER_ARCHIV = "https://codeload.github.com/LucyWolf/notizmappe-server/tar.gz/refs/heads/master"
DESKTOP_ARCHIV = "https://codeload.github.com/LucyWolf/notizmappe/tar.gz/refs/tags/v{f}"

# Ein Archiv ist ein paar hundert Kilobyte. Alles darueber ist nichts, was hier
# erwartet wird - lieber abbrechen als einen Container volllaufen lassen.
MAX_ARCHIV = 40 << 20

PFLICHT = ("VERSION", "web/server.py", "web/benutzer.py", "web/start.py", "web/ablage.py",
           "web/post.py", "web/shim.js", "web/anmelden.html",
           "web/vergessen.html", "web/neues-passwort.html",
           "desktop/app/VERSION", "desktop/app/bruecke.py", "desktop/app/speicher.py",
           "desktop/app/oberflaeche/index.html", "desktop/app/oberflaeche/mappe.js",
           "desktop/app/oberflaeche/stil.css")


class SelbstFehler(Exception):
    pass


def programmordner(daten) -> Path:
    return Path(daten) / ".programm"


def aktive_fassung(daten) -> str:
    """Welche nachgeladene Fassung gelten soll - "" heisst: die aus dem Image."""
    ordner = programmordner(daten)
    try:
        wert = (ordner / "aktiv").read_text(encoding="utf-8").strip()
    except OSError:
        return ""
    # Die Marke allein genuegt nicht: steht dort etwas, das nicht (mehr) da
    # ist, kaeme der Server nach dem Neustart nicht wieder hoch.
    if not wert or "/" in wert or wert.startswith("."):
        return ""
    return wert if (ordner / wert / "web" / "server.py").is_file() else ""


def _zahlen(fassung: str) -> list[int]:
    return [int(t) for t in (fassung or "").split(".") if t.isdigit()]


def neuer_als(a: str, b: str) -> bool:
    return bool(_zahlen(a)) and _zahlen(a) > _zahlen(b)


def _holen(adresse: str) -> bytes:
    if not adresse.startswith("https://codeload.github.com/LucyWolf/"):
        raise SelbstFehler("Geholt wird nur von den eigenen Repos über HTTPS.")
    with urllib.request.urlopen(adresse, timeout=30) as antwort:
        roh = antwort.read(MAX_ARCHIV + 1)
    if len(roh) > MAX_ARCHIV:
        raise SelbstFehler("Das Archiv ist unerwartet groß - abgebrochen.")
    return roh


def _entpacken(roh: bytes, ziel: Path, unterordner: str) -> Path:
    ziel.mkdir(parents=True, exist_ok=True)
    try:
        with tarfile.open(fileobj=io.BytesIO(roh), mode="r:gz") as t:
            t.extractall(ziel, filter="data")
    except tarfile.TarError as f:
        raise SelbstFehler(f"Das Archiv ließ sich nicht auspacken: {f}")
    treffer = [p for p in ziel.iterdir() if p.is_dir() and (p / unterordner).exists()]
    if not treffer:
        raise SelbstFehler(f"Im Archiv liegt kein {unterordner}/ - falsches Archiv?")
    return treffer[0]


def _syntax_pruefen(ordner: Path) -> None:
    """Jede mitgelieferte .py einmal uebersetzen, bevor sie gilt.

    Eine Fassung, die nicht einmal uebersetzt, darf gar nicht erst aktiv
    werden - sonst merkt man es am nicht mehr startenden Server, und dann ist
    auch die Oberflaeche weg, mit der man es zuruecknehmen wuerde.
    """
    for p in sorted(ordner.rglob("*.py")):
        try:
            compile(p.read_text(encoding="utf-8"), str(p), "exec")
        except (SyntaxError, ValueError) as f:
            raise SelbstFehler(f"{p.name} ließe sich nicht ausführen: {f}")
        except OSError as f:
            raise SelbstFehler(f"{p.name} ist nicht lesbar: {f}")


def _pakete_vergleichen(quelle: Path, hier: Path) -> None:
    """Neue Abhaengigkeiten kann diese Fassung nicht nachinstallieren.

    pip laeuft im laufenden Container nicht, und das soll es auch nicht. Dann
    muss ein neues Image her - lieber jetzt gesagt als nach dem Neustart als
    ImportError.
    """
    neu = quelle / "requirements.txt"
    if not (hier.is_file() and neu.is_file()):
        return
    if hier.read_text(encoding="utf-8").split() != neu.read_text(encoding="utf-8").split():
        raise SelbstFehler(
            "Diese Fassung braucht andere Pakete als die hier eingebauten. Das geht "
            "nur mit einem neuen Image: docker compose pull && docker compose up -d")


def vorbereiten(daten, image_fassung: str, hier_requirements: Path) -> dict:
    """Die neue Fassung holen, pruefen und scharf stellen.

    Neu gestartet wird hier *nicht* - das entscheidet der Aufrufer, damit die
    Antwort noch beim Browser ankommt, bevor der Prozess geht.
    """
    ordner = programmordner(daten)
    ordner.mkdir(parents=True, exist_ok=True)
    tmp = ordner / ".neu"
    shutil.rmtree(tmp, ignore_errors=True)
    try:
        quelle = _entpacken(_holen(SERVER_ARCHIV), tmp, "web")
        # Massgeblich ist die Fassung des Servers. Die Oberflaeche dazu steht
        # in DESKTOP_VERSION und kann derselben Fassung ueber mehrere
        # Server-Stufen hinweg gleich bleiben - das ist kein Widerspruch,
        # sondern der Normalfall: nicht jede Aenderung hier betrifft sie.
        try:
            fassung = (quelle / "VERSION").read_text(encoding="utf-8").strip()
            oberflaeche = (quelle / "DESKTOP_VERSION").read_text(encoding="utf-8").strip()
        except OSError:
            raise SelbstFehler("Im Archiv fehlt VERSION oder DESKTOP_VERSION.")
        if not _zahlen(fassung):
            raise SelbstFehler(f"VERSION ergibt keine Fassung: {fassung!r}")
        if not neuer_als(fassung, image_fassung):
            return {"getan": False, "fassung": fassung,
                    "hinweis": f"Hier läuft {image_fassung}, das ist die neueste."}

        _pakete_vergleichen(quelle, Path(hier_requirements))

        dquelle = _entpacken(_holen(DESKTOP_ARCHIV.format(f=oberflaeche)), tmp / ".d", "app")
        drin = (dquelle / "app" / "VERSION").read_text(encoding="utf-8").strip()
        if drin != oberflaeche:
            raise SelbstFehler(f"Das Desktop-Archiv sagt {drin}, erwartet war {oberflaeche}.")

        bau = ordner / f".bau-{fassung}"
        shutil.rmtree(bau, ignore_errors=True)
        (bau / "desktop").mkdir(parents=True)
        shutil.copytree(quelle / "web", bau / "web")
        shutil.copytree(dquelle / "app", bau / "desktop" / "app")
        # server.py liest seine Fassung aus ../VERSION - die muss also neben
        # web/ liegen, sonst startet die nachgeladene Fassung ins Leere.
        # requirements.txt kommt mit, damit der naechste Vergleich gegen das
        # laeuft, was hier wirklich installiert ist.
        for beiwerk in ("VERSION", "DESKTOP_VERSION", "requirements.txt"):
            if (quelle / beiwerk).is_file():
                shutil.copy2(quelle / beiwerk, bau / beiwerk)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    try:
        _syntax_pruefen(bau)
        for noetig in PFLICHT:
            if not (bau / noetig).exists():
                raise SelbstFehler(f"In der neuen Fassung fehlt {noetig} - nicht aktiviert.")
    except SelbstFehler:
        shutil.rmtree(bau, ignore_errors=True)
        raise

    fertig = ordner / fassung
    shutil.rmtree(fertig, ignore_errors=True)
    os.replace(bau, fertig)

    vorlaeufig = ordner / ".aktiv.neu"
    vorlaeufig.write_text(fassung, encoding="utf-8")
    os.replace(vorlaeufig, ordner / "aktiv")
    aufraeumen(daten, behalten=fassung)
    return {"getan": True, "fassung": fassung,
            "hinweis": f"Fassung {fassung} liegt bereit. Der Server startet jetzt neu."}


def aufraeumen(daten, behalten: str) -> None:
    """Alte nachgeladene Fassungen wegwerfen - eine reicht als Weg zurueck."""
    ordner = programmordner(daten)
    if not ordner.is_dir():
        return
    andere = sorted((p for p in ordner.iterdir()
                     if p.is_dir() and _zahlen(p.name) and p.name != behalten),
                    key=lambda p: _zahlen(p.name))
    for p in andere[:-1]:
        shutil.rmtree(p, ignore_errors=True)


def zuruecknehmen(daten) -> str:
    """Die Ueberlagerung fallen lassen: ab dem naechsten Start gilt das Image."""
    try:
        (programmordner(daten) / "aktiv").unlink()
    except OSError:
        pass
    return ("Die nachgeladene Fassung ist abgeschaltet. Nach dem Neustart läuft "
            "wieder die aus dem Image.")


# -- Der Rueckfall ------------------------------------------------------------
#
# Eine nachgeladene Fassung, die nicht hochkommt, waere sonst eine Sackgasse:
# ohne Oberflaeche gibt es keinen Knopf, mit dem man sie zuruecknimmt. Deshalb
# hinterlaesst start.py vor dem Start eine Marke und der Server loescht sie,
# sobald er wirklich antwortet. Findet start.py sie beim naechsten Mal noch
# vor, war der letzte Start nichts - und die Fassung fliegt raus.

def versuch_merken(daten, fassung: str) -> int:
    """Vor dem Start: zaehlen, der wievielte Versuch mit dieser Fassung das ist."""
    marke = programmordner(daten) / "startversuch"
    try:
        alt, _, zahl = marke.read_text(encoding="utf-8").strip().partition(" ")
        bisher = int(zahl) if alt == fassung and zahl.isdigit() else 0
    except (OSError, ValueError):
        bisher = 0
    try:
        marke.write_text(f"{fassung} {bisher + 1}", encoding="utf-8")
    except OSError:
        pass
    return bisher + 1


def versuch_gelungen(daten) -> None:
    """Der Server antwortet - der Start zaehlt als geglueckt."""
    try:
        (programmordner(daten) / "startversuch").unlink()
    except OSError:
        pass
