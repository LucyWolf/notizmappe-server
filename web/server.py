"""Die Notizmappe über eine Webadresse - mit Anmeldung, in Docker.

Der Desktop ist das Programm. Dieser Server ist nur eine zweite Tuer dazu: er
benutzt **dieselben Dateien** fuer Oberflaeche und Ablage, geholt aus einer
festen Fassung des Desktop-Repos (siehe tools/desktop_holen.sh). Hier wird
nichts nachgebaut und nichts kopiert - deshalb koennen die beiden Fassungen
nicht unterschiedlich aussehen.

Der einzige Beruehrungspunkt der Oberflaeche mit dem Programm ist
`window.pywebview.api.xyz`. Im Fenster sind das die Methoden aus bruecke.py im
selben Prozess. Im Browser legt web/shim.js dort einen Stellvertreter hin, der
jeden Aufruf als POST an /bruecke/xyz schickt. index.html, mappe.js und stil.css
werden dafuer nicht angefasst.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import sys
import threading
import time
from pathlib import Path

from fastapi import FastAPI, Form, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from starlette.concurrency import run_in_threadpool

import benutzer as nutzer

HIER = Path(__file__).resolve().parent
DESKTOP = Path(os.environ.get("NOTIZMAPPE_DESKTOP", "/desktop")).resolve()
OBERFLAECHE = DESKTOP / "app" / "oberflaeche"

# Das Desktop-Programm ist eine Abhaengigkeit wie jede andere - es liegt nur
# nicht auf PyPI, sondern kommt aus dem Release.
if str(DESKTOP / "app") not in sys.path:
    sys.path.insert(0, str(DESKTOP / "app"))

import bruecke as bruecke_modul                                    # noqa: E402
import speicher                                                    # noqa: E402

BRUECKE = bruecke_modul.Bruecke()
DESKTOP_FASSUNG = bruecke_modul.VERSION

# Ueber HTTPS gehoert "Secure" an den Keks. Im eigenen Netz ohne Zertifikat
# wuerde der Browser ihn damit wegwerfen und niemand kaeme hinein.
HTTPS = os.environ.get("NOTIZMAPPE_HTTPS", "").strip() not in ("", "0", "nein", "no", "false")
KEKS = "notizmappe"
SITZUNG_TAGE = 14

app = FastAPI(title="Notizmappe", docs_url=None, redoc_url=None, openapi_url=None)


# --- Was die Oberflaeche aufrufen darf ---------------------------------------
#
# Positivliste, keine Verbotsliste: kommt im Desktop eine Methode dazu, ist sie
# hier erst einmal gesperrt. Das ist die richtige Richtung - eine neue Methode,
# die versehentlich offen steht, faellt niemandem auf.
ERLAUBT = {
    "baum", "notizbuch_anlegen", "abschnitt_anlegen", "seite_anlegen",
    "seite_lesen", "seite_speichern", "seite_umbenennen", "stand", "loeschen",
    "anhang_ablegen", "anhang_bild", "einstellungen", "schriften", "favorit_setzen",
    # Verlauf und Papierkorb: reine Dateiarbeit im Ordner des angemeldeten
    # Benutzers. Der Reiter dafuer kommt mit der Oberflaeche des Desktops
    # automatisch mit - ohne diese Zeilen waeren alle drei Knoepfe dort tot.
    "versionen", "version_lesen", "version_zurueck",
    "papierkorb", "papierkorb_zurueck", "papierkorb_weg", "papierkorb_leeren",
}
# Ausdruecklich gesperrt, mit Grund:
#   ordner_waehlen, ordner_setzen  - Dateidialoge und Pfade des Servers
#   anhang_oeffnen, anhang_speichern_unter - starten Programme bzw. Dialoge auf
#       dem Server; im Browser macht das shim.js daraus einen Download
#   update, update_stand           - am Server ist das docker pull
#   version                        - wird hier ohne GitHub beantwortet
#   sperre_*, entsperren, sperren, rettung_* - der Tresorschluessel liegt im
#       Prozess und passt nicht zu mehreren Sitzungen; am Server ist die
#       Anmeldung die Sperre
#   optionen_setzen                - Update-Optionen gelten fuer den Rechner
#   onenote_einlesen               - braucht einen Dateidialog am Rechner; am
#       Server muesste das ein Upload werden

MAX_TEXT = 40 * 1024 * 1024          # ein Anhang kommt als Base64 durch
_arbeit = threading.Lock()


def _args_pruefen(roh) -> list:
    """Nur einfache Werte durchlassen, und nicht beliebig tief."""
    if not isinstance(roh, list):
        raise ValueError("args muss eine Liste sein")
    if len(roh) > 8:
        raise ValueError("zu viele Werte")

    def tief(wert, stufe=0):
        if stufe > 6:
            raise ValueError("zu tief verschachtelt")
        if isinstance(wert, str):
            if len(wert) > MAX_TEXT:
                raise ValueError("Wert zu lang")
        elif isinstance(wert, (int, float, bool)) or wert is None:
            pass
        elif isinstance(wert, list):
            if len(wert) > 2000:
                raise ValueError("Liste zu lang")
            for e in wert:
                tief(e, stufe + 1)
        elif isinstance(wert, dict):
            if len(wert) > 200:
                raise ValueError("zu viele Felder")
            for k, v in wert.items():
                if not isinstance(k, str) or len(k) > 80:
                    raise ValueError("ungueltiger Feldname")
                tief(v, stufe + 1)
        else:
            raise ValueError("unerlaubte Art von Wert")
        return wert

    return [tief(w) for w in roh]


def _ausfuehren(name: str, methode: str, args: list):
    """Eine Bruecken-Methode fuer einen Benutzer laufen lassen.

    speicher.wurzel() liest NOTIZEN_ORDNER bei jedem Aufruf - also wird er je
    Aufruf gesetzt. Dafuer laufen die Aufrufe hintereinander statt gleichzeitig:
    bei einer Handvoll Leuten und JSON-Dateien von ein paar Kilobyte ist das
    keine Bremse, und es ist der einzige Weg, der ohne Aenderung am
    Desktop-Programm auskommt.
    """
    with _arbeit:
        os.environ["NOTIZEN_ORDNER"] = str(nutzer.notizordner(name))
        os.environ["NOTIZMAPPE_KONFIG"] = str(nutzer.konfigordner(name))
        return getattr(BRUECKE, methode)(*args)


# --- Sitzungen ---------------------------------------------------------------

def _unterschreiben(text: str) -> str:
    unterschrift = hmac.new(nutzer.geheimnis(), text.encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(unterschrift).decode("ascii").rstrip("=")


def keks_bauen(name: str) -> str:
    ablauf = int(time.time()) + SITZUNG_TAGE * 24 * 3600
    kern = f"{name}:{ablauf}"
    return f"{kern}:{_unterschreiben(kern)}"


def keks_lesen(wert: str | None) -> str | None:
    if not wert or wert.count(":") != 2:
        return None
    name, ablauf, unterschrift = wert.split(":")
    kern = f"{name}:{ablauf}"
    if not hmac.compare_digest(unterschrift, _unterschreiben(kern)):
        return None
    try:
        if int(ablauf) < time.time():
            return None
    except ValueError:
        return None
    if name not in {b["name"] for b in nutzer.liste()}:
        return None                         # Zugang entfernt: Keks gilt nicht mehr
    return name


def angemeldet(bitte: Request) -> str | None:
    return keks_lesen(bitte.cookies.get(KEKS))


def keks_setzen(antwort: Response, name: str) -> None:
    antwort.set_cookie(KEKS, keks_bauen(name), max_age=SITZUNG_TAGE * 24 * 3600,
                       httponly=True, samesite="lax", secure=HTTPS, path="/")


# --- Bremse gegen Durchprobieren --------------------------------------------
_fehlversuche: dict[str, list] = {}


def gebremst(wer: str) -> int:
    """Wie viele Sekunden noch zu warten sind."""
    eintrag = _fehlversuche.get(wer)
    if not eintrag:
        return 0
    anzahl, bis = eintrag
    return max(0, int(bis - time.time()))


def fehlversuch(wer: str) -> None:
    anzahl = (_fehlversuche.get(wer) or [0, 0])[0] + 1
    # 1-3 Versuche frei, danach steigend bis 5 Minuten
    wartezeit = 0 if anzahl <= 3 else min(300, 5 * 2 ** (anzahl - 4))
    _fehlversuche[wer] = [anzahl, time.time() + wartezeit]


def geklappt(wer: str) -> None:
    _fehlversuche.pop(wer, None)


# --- Seiten ------------------------------------------------------------------

def _vorlage(name: str, **werte) -> str:
    roh = (HIER / name).read_text(encoding="utf-8")
    for k, v in werte.items():
        roh = roh.replace("{{" + k + "}}", str(v))
    return roh


def _text(roh: str) -> str:
    """Fuer Namen, die in eine Seite geschrieben werden."""
    return (str(roh).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


@app.get("/anmelden", response_class=HTMLResponse)
def anmeldeseite(bitte: Request, fehler: str = ""):
    if nutzer.leer():
        return HTMLResponse(_vorlage("einrichten.html", fehler=_text(fehler),
                                     fassung=DESKTOP_FASSUNG))
    return HTMLResponse(_vorlage("anmelden.html", fehler=_text(fehler),
                                 fassung=DESKTOP_FASSUNG))


@app.post("/anmelden")
def anmelden(bitte: Request, name: str = Form(""), passwort: str = Form("")):
    wer = (name or "").strip().lower()
    warte = gebremst(wer)
    if warte:
        return RedirectResponse(f"/anmelden?fehler=Zu+viele+Versuche.+Bitte+{warte}+Sekunden+warten.",
                                status_code=303)
    b = nutzer.pruefen(wer, passwort)
    if not b:
        fehlversuch(wer)
        # Nicht sagen, ob der Name oder das Passwort falsch war: sonst ist die
        # Seite eine Auskunft darueber, welche Namen es gibt.
        return RedirectResponse("/anmelden?fehler=Name+oder+Passwort+stimmt+nicht.", status_code=303)
    geklappt(wer)
    nutzer.gesehen(b["name"])
    antwort = RedirectResponse("/", status_code=303)
    keks_setzen(antwort, b["name"])
    return antwort


@app.post("/einrichten")
def einrichten(name: str = Form(""), passwort: str = Form(""), passwort2: str = Form("")):
    """Nur solange es keinen einzigen Benutzer gibt."""
    if not nutzer.leer():
        return RedirectResponse("/anmelden", status_code=303)
    if passwort != passwort2:
        return RedirectResponse("/anmelden?fehler=Die+Passw%C3%B6rter+sind+nicht+gleich.", status_code=303)
    try:
        nutzer.anlegen(name, passwort, verwalter=True)
    except nutzer.BenutzerFehler as f:
        return RedirectResponse(f"/anmelden?fehler={_text(str(f))}", status_code=303)
    antwort = RedirectResponse("/", status_code=303)
    keks_setzen(antwort, (name or "").strip().lower())
    return antwort


@app.post("/abmelden")
@app.get("/abmelden")
def abmelden():
    antwort = RedirectResponse("/anmelden", status_code=303)
    antwort.delete_cookie(KEKS, path="/")
    return antwort


@app.get("/", response_class=HTMLResponse)
def mappe(bitte: Request):
    if not angemeldet(bitte):
        return RedirectResponse("/anmelden", status_code=303)
    roh = (OBERFLAECHE / "index.html").read_text(encoding="utf-8")
    # Der Stellvertreter muss **vor** mappe.js geladen sein, sonst sucht die
    # Oberflaeche ein Fenster, das es hier nicht gibt. Eine Zeile eingesetzt,
    # sonst nichts - die Datei selbst bleibt, wie sie im Desktop-Repo liegt.
    marke = '<script src="mappe.js"></script>'
    if marke not in roh:
        raise RuntimeError("In index.html steht kein mappe.js - falsche Desktop-Fassung?")
    roh = roh.replace(marke, '<script src="shim.js"></script>\n' + marke)
    return HTMLResponse(roh, headers={"Cache-Control": "no-store"})


@app.get("/shim.js")
def shim():
    return FileResponse(HIER / "shim.js", media_type="application/javascript",
                        headers={"Cache-Control": "no-store"})


# --- Anhaenge herunterladen --------------------------------------------------
#
# Am Desktop oeffnet bruecke.py einen Anhang mit dem Programm des Systems oder
# legt ihn ueber den Dialog ab. Beides gibt es hier nicht, also macht shim.js
# daraus einen Download auf diese Stelle. Die Oberflaeche selbst bleibt gleich.

@app.get("/anhang")
def anhang(bitte: Request, notizbuch: str = "", abschnitt: str = "",
           name: str = "", datei: str = ""):
    wer = angemeldet(bitte)
    if not wer:
        return RedirectResponse("/anmelden", status_code=303)
    try:
        with _arbeit:
            os.environ["NOTIZEN_ORDNER"] = str(nutzer.notizordner(wer))
            os.environ["NOTIZMAPPE_KONFIG"] = str(nutzer.konfigordner(wer))
            pfad = speicher.anhang_lesen(notizbuch, abschnitt, name, datei)
            inhalt = speicher.anhang_inhalt(notizbuch, abschnitt, name, datei)
            dateiname = pfad.name
    except Exception as f:                                  # noqa: BLE001
        return JSONResponse({"fehler": f"Gibt es nicht: {f}"}, status_code=404)
    # Immer als Anhang und als Strom von Bytes: eine hochgeladene HTML- oder
    # SVG-Datei soll der Browser nicht anzeigen und schon gar nicht ausfuehren.
    return Response(inhalt, media_type="application/octet-stream", headers={
        "Content-Disposition": f'attachment; filename="{dateiname}"',
        "X-Content-Type-Options": "nosniff",
    })


# --- Benutzer verwalten ------------------------------------------------------
#
# Eine eigene Seite unter /benutzer, kein Knopf in der Oberflaeche: die soll in
# beiden Fassungen gleich aussehen, und einen Benutzerknopf gibt es am Desktop
# nicht.

def _verwalter(bitte: Request) -> str | None:
    wer = angemeldet(bitte)
    if not wer:
        return None
    for b in nutzer.liste():
        if b["name"] == wer and b["verwalter"]:
            return wer
    return None


@app.get("/benutzer", response_class=HTMLResponse)
def benutzerseite(bitte: Request, meldung: str = ""):
    wer = _verwalter(bitte)
    if not wer:
        if angemeldet(bitte):
            return HTMLResponse("<p>Das darf nur ein Verwalter.</p>", status_code=403)
        return RedirectResponse("/anmelden", status_code=303)
    zeilen = []
    for b in nutzer.liste():
        rolle = " · Verwalter" if b["verwalter"] else ""
        zuletzt = f" · zuletzt {_text(b['zuletzt'])}" if b["zuletzt"] else " · noch nie angemeldet"
        knopf = ""
        if b["name"] != wer:
            knopf = (f'<form method="post" action="/benutzer/entfernen" style="display:inline">'
                     f'<input type="hidden" name="name" value="{_text(b["name"])}">'
                     f'<button type="submit">Zugang entfernen</button></form>')
        zeilen.append(f'<p class="zeile2"><span><strong>{_text(b["name"])}</strong>{rolle}'
                      f'{zuletzt}</span><span>{knopf}</span></p>')
    return HTMLResponse(_vorlage("benutzer.html", liste="\n".join(zeilen),
                                 meldung=_text(meldung)))


@app.post("/benutzer/anlegen")
def benutzer_anlegen(bitte: Request, name: str = Form(""), passwort: str = Form(""),
                     verwalter: str = Form("")):
    if not _verwalter(bitte):
        return RedirectResponse("/anmelden", status_code=303)
    try:
        nutzer.anlegen(name, passwort, verwalter=bool(verwalter))
    except nutzer.BenutzerFehler as f:
        return RedirectResponse(f"/benutzer?meldung={f}", status_code=303)
    return RedirectResponse(f"/benutzer?meldung=Angelegt: {name.strip().lower()}", status_code=303)


@app.post("/benutzer/passwort")
def benutzer_passwort(bitte: Request, name: str = Form(""), passwort: str = Form("")):
    if not _verwalter(bitte):
        return RedirectResponse("/anmelden", status_code=303)
    try:
        nutzer.passwort_setzen((name or "").strip().lower(), passwort)
    except nutzer.BenutzerFehler as f:
        return RedirectResponse(f"/benutzer?meldung={f}", status_code=303)
    return RedirectResponse("/benutzer?meldung=Passwort gesetzt", status_code=303)


@app.post("/benutzer/entfernen")
def benutzer_entfernen(bitte: Request, name: str = Form("")):
    wer = _verwalter(bitte)
    if not wer:
        return RedirectResponse("/anmelden", status_code=303)
    ziel = (name or "").strip().lower()
    if ziel == wer:
        return RedirectResponse("/benutzer?meldung=Den eigenen Zugang nicht", status_code=303)
    try:
        nutzer.entfernen(ziel)
    except nutzer.BenutzerFehler as f:
        return RedirectResponse(f"/benutzer?meldung={f}", status_code=303)
    return RedirectResponse(f"/benutzer?meldung=Zugang entfernt: {ziel}. "
                            "Die Notizen liegen weiter im Datenordner.", status_code=303)


MITGELIEFERT = {"mappe.js": "application/javascript", "stil.css": "text/css",
                "icon.png": "image/png", "icon-128.png": "image/png"}


@app.get("/{datei}")
def oberflaeche(datei: str):
    """Oberflaeche ohne Anmeldung - und das mit Absicht.

    Die Anmeldeseite braucht stil.css und das Icon, sonst steht man vor einem
    nackten Formular. Geheim ist daran nichts: es sind dieselben Dateien, die
    im oeffentlichen Desktop-Repo liegen. Geheim sind die Notizen, und die
    kommen nur ueber /bruecke."""
    typ = MITGELIEFERT.get(datei)
    if not typ:
        return JSONResponse({"fehler": "Gibt es nicht"}, status_code=404)
    return FileResponse(OBERFLAECHE / datei, media_type=typ)


# --- Die Bruecke -------------------------------------------------------------

MAX_RUMPF = 48 * 1024 * 1024         # Anhang (25 MB) als Base64 plus Luft


@app.post("/bruecke/{methode}")
async def bruecke(methode: str, bitte: Request):
    name = angemeldet(bitte)
    if not name:
        return JSONResponse({"fehler": "Nicht angemeldet", "art": "anmelden"}, status_code=401)
    # Ein eigener Kopf laesst sich von einer fremden Seite nicht mitschicken,
    # ohne dass der Browser vorher um Erlaubnis fragt. Zusammen mit SameSite ist
    # das die Absicherung dagegen, dass eine andere Seite hier etwas aufruft.
    if bitte.headers.get("x-notizmappe") != "1":
        return JSONResponse({"fehler": "Falscher Aufruf"}, status_code=400)
    if methode not in ERLAUBT:
        if methode == "version":
            return JSONResponse({"installiert": DESKTOP_FASSUNG, "verfuegbar": DESKTOP_FASSUNG,
                                 "neuer": False, "aktualisierbar": False,
                                 "fehler": "Am Server wird über docker pull aktualisiert."})
        return JSONResponse({"fehler": "Das geht nur am eigenen Rechner."}, status_code=403)

    # Erst die Groesse, dann lesen: sonst liegt ein Gigabyte im Arbeitsspeicher,
    # bevor ueberhaupt jemand nachgesehen hat, was da kommt.
    laenge = bitte.headers.get("content-length")
    if laenge and laenge.isdigit() and int(laenge) > MAX_RUMPF:
        return JSONResponse({"fehler": "Das ist zu groß"}, status_code=413)
    roh = await bitte.body()
    if len(roh) > MAX_RUMPF:
        return JSONResponse({"fehler": "Das ist zu groß"}, status_code=413)
    try:
        rumpf = json.loads(roh or b"{}")
    except ValueError:
        return JSONResponse({"fehler": "Konnte den Aufruf nicht lesen"}, status_code=400)
    if not isinstance(rumpf, dict):
        return JSONResponse({"fehler": "Konnte den Aufruf nicht lesen"}, status_code=400)
    # Die Bruecke rechnet und schreibt Dateien - das darf die Schleife nicht
    # anhalten, die gerade die anderen Anfragen bedient.
    return JSONResponse(await run_in_threadpool(_antwort, name, methode, rumpf))


def _antwort(name: str, methode: str, rumpf: dict):
    try:
        args = _args_pruefen(rumpf.get("args") or [])
    except ValueError as f:
        return {"fehler": f"Ungültiger Aufruf: {f}"}
    try:
        aus = _ausfuehren(name, methode, args)
    except TypeError as f:
        return {"fehler": f"Ungültiger Aufruf: {f}"}
    if isinstance(aus, dict) and aus.get("art") == "zu":
        # Die Mappe ist mit der Sperre des Desktop-Programms verschluesselt.
        # "art": "zu" darf hier nicht durchgehen: die Oberflaeche laedt daraufhin
        # neu, damit der Sperrschirm kommt - und bekommt wieder dasselbe. Das
        # waere eine Seite, die sich endlos neu laedt. Also ein klarer Satz
        # statt des Signals.
        return {"fehler": "Diese Notizen sind mit der Sperre des Desktop-Programms "
                          "verschlüsselt. Am Server lässt sie sich nicht öffnen - "
                          "dort abschalten oder einen anderen Ordner verwenden."}
    if methode == "einstellungen" and isinstance(aus, dict):
        aus = dict(aus)
        # Die Oberflaeche richtet sich danach: nicht am selben Rechner, also kein
        # Umstellen des Ordners und keine Updates per Knopf. Genau dafuer ist das
        # Feld da - hier ist es ehrlich falsch, es auf true zu setzen.
        aus["hier"] = False
        aus["ordner_waehlbar"] = False
        aus["aus_installation"] = True
        aus["ordner"] = f"Server: {name}"
    return aus
