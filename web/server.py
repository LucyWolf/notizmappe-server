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
import inspect
import urllib.parse
import urllib.request

import segno
import json
import os
import sys
import threading
import time
from pathlib import Path

from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from starlette.concurrency import run_in_threadpool

import ablage
import benutzer as nutzer
import selbst

HIER = Path(__file__).resolve().parent
DESKTOP = Path(os.environ.get("NOTIZMAPPE_DESKTOP", "/desktop")).resolve()
# Derselbe Ordner, den benutzer.py verwaltet - hier fuer die nachgeladenen
# Fassungen unter .programm/ gebraucht.
DATEN = Path(os.environ.get("NOTIZMAPPE_DATEN", "/daten"))
OBERFLAECHE = DESKTOP / "app" / "oberflaeche"

# Das Desktop-Programm ist eine Abhaengigkeit wie jede andere - es liegt nur
# nicht auf PyPI, sondern kommt aus dem Release.
if str(DESKTOP / "app") not in sys.path:
    sys.path.insert(0, str(DESKTOP / "app"))

import bruecke as bruecke_modul                                    # noqa: E402
import speicher                                                    # noqa: E402

BRUECKE = bruecke_modul.Bruecke()
DESKTOP_FASSUNG = bruecke_modul.VERSION

# Die eigene Fassung der Serverschicht. Bis hierher trug der Server die Nummer
# des Desktop-Programms, das in ihm steckt - und damit war eine Aenderung, die
# nur web/ betrifft, fuer den Update-Knopf unsichtbar: DESKTOP_VERSION blieb
# gleich, also galt "ist die neueste", obwohl neuer Servercode bereitlag.
FASSUNG = (Path(__file__).resolve().parent.parent / "VERSION").read_text(
    encoding="utf-8").strip()

# Ueber HTTPS gehoert "Secure" an den Keks. Im eigenen Netz ohne Zertifikat
# wuerde der Browser ihn damit wegwerfen und niemand kaeme hinein.
HTTPS = os.environ.get("NOTIZMAPPE_HTTPS", "").strip() not in ("", "0", "nein", "no", "false")
KEKS = "notizmappe"
SITZUNG_TAGE = 14

app = FastAPI(title="Notizmappe", docs_url=None, redoc_url=None, openapi_url=None)


@app.on_event("startup")
def _beim_start() -> None:
    fehlen = _fehlende_methoden()
    if fehlen:
        print(f"[server] Achtung: Notizmappe {DESKTOP_FASSUNG} kennt diese Methoden "
              f"nicht: {', '.join(fehlen)}. DESKTOP_VERSION nachziehen.", flush=True)
    else:
        print(f"[server] Notizmappe {DESKTOP_FASSUNG}, alle freigegebenen Methoden da.",
              flush=True)
    # Der Start zaehlt als geglueckt - erst jetzt, nicht beim Hochfahren von
    # uvicorn. Kommt eine nachgeladene Fassung bis hierher, war sie in Ordnung;
    # sonst findet start.py beim naechsten Mal die Marke und wirft sie weg.
    selbst.versuch_gelungen(DATEN)
    # Bestehende Installationen kennen die Marke noch nicht - wer Zugaenge hat,
    # bekommt sie jetzt. Sonst wuerde der Schutz erst beim naechsten frisch
    # eingerichteten Server greifen, also genau dort nicht, wo schon Notizen
    # liegen.
    try:
        if not nutzer.leer():
            nutzer.einrichtung_merken()
    except Exception:                                           # noqa: BLE001
        pass


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
# Welches Recht jede Methode braucht. Was hier nicht steht, braucht "lesen".
# Das ist die Stelle, an der aus einer angehakten Rolle eine Wirkung wird -
# ohne sie waere ein Recht nur eine Beschriftung.
RECHT_JE_METHODE = {
    "notizbuch_anlegen": "schreiben", "abschnitt_anlegen": "schreiben",
    "seite_anlegen": "schreiben", "seite_speichern": "schreiben",
    "seite_umbenennen": "schreiben", "favorit_setzen": "schreiben",
    "anhang_ablegen": "anhaenge",
    "loeschen": "loeschen", "papierkorb_weg": "loeschen", "papierkorb_leeren": "loeschen",
    "versionen": "verlauf", "version_lesen": "verlauf", "version_zurueck": "verlauf",
    "papierkorb": "verlauf", "papierkorb_zurueck": "verlauf",
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


def _fehlende_methoden() -> list[str]:
    """Was in der Positivliste steht, aber im eingefrorenen Desktop fehlt.

    Die Oberflaeche kommt aus derselben Fassung, kennt die Methode also auch
    nicht - aufrufen wird sie dort niemand. Haengt das Image aber hinterher,
    waehrend jemand mit einem neueren Browser-Zwischenspeicher kommt, gab es
    vorher einen Absturz mit HTTP 500. Beim Start steht es jetzt im Protokoll.
    """
    return sorted(m for m in ERLAUBT if not hasattr(BRUECKE, m))


def _passt(methode: str, args: list) -> str | None:
    """Passt die Anzahl der Werte zur Methode?

    Ohne diese Pruefung faengt die Bruecke den TypeError ab und schickt ihn
    wortwoertlich zurueck - mitsamt dem Namen der Methode und der Zahl ihrer
    Werte. Das ist eine Auskunft ueber das Innere des Programms, die niemanden
    etwas angeht, und als Meldung ist sie auch nichts wert.
    """
    sig = inspect.signature(getattr(BRUECKE, methode))
    stellen = [p for p in sig.parameters.values()
               if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)]
    noetig = [p for p in stellen if p.default is p.empty]
    if not len(noetig) <= len(args) <= len(stellen):
        return (f"Der Aufruf erwartet {len(noetig)} bis {len(stellen)} Werte, "
                f"bekommen hat er {len(args)}")
    return None


def bereich_lesen(name: str) -> str:
    """In welchem Bereich arbeitet dieser Benutzer gerade?

    "" heisst: in den eigenen Notizen. Sonst der Name eines Projekts. Die Wahl
    liegt in seinem Konfigordner und ueberlebt damit einen Neustart - sonst
    staende man nach jedem Update wieder woanders, ohne es zu merken.
    """
    try:
        roh = json.loads((nutzer.konfigordner(name) / "bereich.json").read_text(encoding="utf-8"))
        gewaehlt = str(roh.get("bereich") or "")
    except (OSError, ValueError, AttributeError):
        return ""
    return gewaehlt if nutzer.projekt_recht(name, gewaehlt) else ""


def bereich_setzen(name: str, bereich: str) -> str:
    bereich = (bereich or "").strip()
    if bereich and not nutzer.projekt_recht(name, bereich):
        raise nutzer.BenutzerFehler("In diesem Projekt bist du nicht")
    (nutzer.konfigordner(name) / "bereich.json").write_text(
        json.dumps({"bereich": bereich}), encoding="utf-8")
    return bereich


def arbeitsordner(name: str) -> Path:
    bereich = bereich_lesen(name)
    return nutzer.projektordner(bereich) if bereich else nutzer.notizordner(name)


def rechte_hier(name: str) -> set:
    """Was jemand im gerade gewaehlten Bereich darf.

    In einem Projekt gilt das Schwaechere von Rolle und Mitgliedsrecht: wer als
    Gast angemeldet ist, darf auch in einem Projekt nichts schreiben, in dem er
    "verwalten" hat - und umgekehrt bringt eine maechtige Rolle nichts, wenn man
    im Projekt nur lesen darf.
    """
    rolle = nutzer.rechte_von(name)
    bereich = bereich_lesen(name)
    if not bereich:
        return rolle
    recht = nutzer.projekt_recht(name, bereich)
    return rolle & set(nutzer.PROJEKTRECHTE.get(recht, []))


def _ausfuehren(name: str, methode: str, args: list):
    """Eine Bruecken-Methode fuer einen Benutzer laufen lassen.

    speicher.wurzel() liest NOTIZEN_ORDNER bei jedem Aufruf - also wird er je
    Aufruf gesetzt. Dafuer laufen die Aufrufe hintereinander statt gleichzeitig:
    bei einer Handvoll Leuten und JSON-Dateien von ein paar Kilobyte ist das
    keine Bremse, und es ist der einzige Weg, der ohne Aenderung am
    Desktop-Programm auskommt.
    """
    with _arbeit:
        os.environ["NOTIZEN_ORDNER"] = str(arbeitsordner(name))
        os.environ["NOTIZMAPPE_KONFIG"] = str(nutzer.konfigordner(name))
        return getattr(BRUECKE, methode)(*args)


# --- Sitzungen ---------------------------------------------------------------

def _unterschreiben(text: str) -> str:
    unterschrift = hmac.new(nutzer.geheimnis(), text.encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(unterschrift).decode("ascii").rstrip("=")


HALBKEKS = "notizmappe_halb"
HALB_MINUTEN = 5


def halbkeks_bauen(name: str) -> str:
    """Zwischen Passwort und zweitem Schritt.

    Dieser Keks oeffnet nichts - er merkt sich nur, wer gerade beim zweiten
    Schritt steht, und das fuenf Minuten lang statt zwei Wochen. Er ist
    ausdruecklich anders unterschrieben als der richtige, damit sich der eine
    nie als der andere ausgeben kann.
    """
    ablauf = int(time.time()) + HALB_MINUTEN * 60
    return f"{name}:{ablauf}:{_unterschreiben(f'halb:{name}:{ablauf}')}"


def halbkeks_lesen(wert: str | None) -> str | None:
    if not wert or wert.count(":") != 2:
        return None
    name, ablauf, unterschrift = wert.split(":")
    if not hmac.compare_digest(unterschrift, _unterschreiben(f"halb:{name}:{ablauf}")):
        return None
    try:
        if int(ablauf) < time.time():
            return None
    except ValueError:
        return None
    return name


def keks_bauen(name: str) -> str:
    ablauf = int(time.time()) + SITZUNG_TAGE * 24 * 3600
    kern = f"{name}:{ablauf}:{nutzer.sitzungsmarke(name)}"
    return f"{kern}:{_unterschreiben(kern)}"


def keks_lesen(wert: str | None) -> str | None:
    if not wert or wert.count(":") != 3:
        return None                         # auch alte Kekse ohne Marke
    name, ablauf, marke, unterschrift = wert.split(":")
    kern = f"{name}:{ablauf}:{marke}"
    if not hmac.compare_digest(unterschrift, _unterschreiben(kern)):
        return None
    try:
        if int(ablauf) < time.time():
            return None
    except ValueError:
        return None
    if name not in {b["name"] for b in nutzer.liste()}:
        return None                         # Zugang entfernt: Keks gilt nicht mehr
    # Und: gehoert der Keks noch zum jetzigen Passwort? Nach einem Wechsel
    # sollen offene Sitzungen enden - das ist der Sinn eines Wechsels.
    jetzige = nutzer.sitzungsmarke(name)
    if not jetzige or not hmac.compare_digest(marke, jetzige):
        return None
    return name


def angemeldet(bitte: Request) -> str | None:
    return keks_lesen(bitte.cookies.get(KEKS))


def keks_setzen(antwort: Response, name: str) -> None:
    antwort.set_cookie(KEKS, keks_bauen(name), max_age=SITZUNG_TAGE * 24 * 3600,
                       httponly=True, samesite="lax", secure=HTTPS, path="/")


# --- Bremse gegen Durchprobieren --------------------------------------------
#
# Gezaehlt wird je **Herkunft und Name**, nicht je Name allein. Sonst kann ein
# Fremder jemanden aus dem eigenen Zugang aussperren, indem er oft genug mit
# dessen Namen danebenliegt - er braucht das Passwort gar nicht zu erraten, nur
# die Geduld. Genau das ist beim Durchprobieren herausgekommen.
_fehlversuche: dict[str, list] = {}
MAX_BREMSE = 2000               # mehr Eintraege nicht; sonst waere das Fuellen
                                # dieses Woerterbuchs selbst der Angriff


def bremsschluessel(bitte: Request, name: str) -> str:
    herkunft = bitte.client.host if bitte.client else "?"
    return f"{herkunft}|{(name or '').strip().lower()}"


def _aufraeumen() -> None:
    """Abgelaufene Eintraege wegwerfen, und notfalls die aeltesten dazu."""
    jetzt = time.time()
    for schluessel, (_, bis) in list(_fehlversuche.items()):
        if bis + 3600 < jetzt:
            _fehlversuche.pop(schluessel, None)
    while len(_fehlversuche) > MAX_BREMSE:
        aeltester = min(_fehlversuche, key=lambda k: _fehlversuche[k][1])
        _fehlversuche.pop(aeltester, None)


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
    _aufraeumen()


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
    try:
        keiner_da = nutzer.leer()
    except nutzer.BenutzerFehler as f:
        # Lieber gar nichts anbieten als die Einrichtung: wer die hier bekommt,
        # legt sich einen Verwalter an und hat alles.
        return HTMLResponse(
            "<h2>Die Notizmappe kann ihre Zugänge nicht lesen</h2>"
            f"<p>{_text(str(f))}</p>"
            "<p>Bis das behoben ist, wird hier nichts angeboten.</p>",
            status_code=503)
    if keiner_da and nutzer.war_schon_eingerichtet():
        # Hier gab es schon Zugaenge, jetzt ist der Datenordner leer. Das ist
        # kein frischer Server, sondern ein Hinweis: Ablage umgestellt und der
        # neue Ordner ist leer, ein Mount hat nicht gegriffen, oder der Pfad
        # war vertippt. Die Ersteinrichtung hier anzubieten hiesse, dem
        # Naechstbesten einen Verwalterzugang zu schenken.
        return HTMLResponse(
            "<h2>Der Datenordner ist leer</h2>"
            "<p>Auf diesem Server gab es schon Zugänge - jetzt ist "
            f"<code>{_text(ablage.datenordner_jetzt())}</code> leer.</p>"
            "<p>Meist heißt das: die Ablage wurde umgestellt und der neue Ort ist "
            "leer, eine Freigabe hat nicht eingehängt, oder der Pfad stimmt nicht. "
            "Die bisherigen Notizen sind dabei nicht weg, sie liegen am alten Ort.</p>"
            "<p>Eine Ersteinrichtung wird hier mit Absicht nicht angeboten - wer "
            "sie bekäme, hätte einen Verwalterzugang zu diesem Server.</p>"
            "<p>Im Protokoll steht, was beim Start passiert ist: "
            "<code>docker compose logs --tail 40 notizmappe</code></p>",
            status_code=503)
    if keiner_da:
        return HTMLResponse(_vorlage("einrichten.html", fehler=_text(fehler),
                                     fassung=DESKTOP_FASSUNG))
    return HTMLResponse(_vorlage("anmelden.html", fehler=_text(fehler),
                                 fassung=DESKTOP_FASSUNG))


@app.post("/anmelden")
def anmelden(bitte: Request, name: str = Form(""), passwort: str = Form("")):
    wer = bremsschluessel(bitte, name)
    warte = gebremst(wer)
    if warte:
        return RedirectResponse(f"/anmelden?fehler=Zu+viele+Versuche.+Bitte+{warte}+Sekunden+warten.",
                                status_code=303)
    try:
        b = nutzer.pruefen(name, passwort)
    except nutzer.BenutzerFehler as f:
        return RedirectResponse(f"/anmelden?fehler={urllib.parse.quote_plus(str(f))}",
                                status_code=303)
    if not b:
        fehlversuch(wer)
        # Nicht sagen, ob der Name oder das Passwort falsch war: sonst ist die
        # Seite eine Auskunft darueber, welche Namen es gibt.
        return RedirectResponse("/anmelden?fehler=Name+oder+Passwort+stimmt+nicht.", status_code=303)
    geklappt(wer)
    if nutzer.zwei_schritte_stand(b["name"])["an"]:
        antwort = RedirectResponse("/zweiter-schritt", status_code=303)
        antwort.set_cookie(HALBKEKS, halbkeks_bauen(b["name"]),
                           max_age=HALB_MINUTEN * 60, httponly=True,
                           samesite="lax", secure=HTTPS, path="/")
        return antwort
    nutzer.gesehen(b["name"])
    antwort = RedirectResponse("/", status_code=303)
    keks_setzen(antwort, b["name"])
    return antwort


@app.get("/zweiter-schritt", response_class=HTMLResponse)
def zweiter_schritt_seite(bitte: Request, fehler: str = ""):
    wer = halbkeks_lesen(bitte.cookies.get(HALBKEKS))
    if not wer:
        return RedirectResponse("/anmelden", status_code=303)
    return HTMLResponse(_vorlage("zweischritt.html", wer=_text(wer), fehler=_text(fehler)))


@app.post("/zweiter-schritt")
def zweiter_schritt(bitte: Request, code: str = Form("")):
    wer = halbkeks_lesen(bitte.cookies.get(HALBKEKS))
    if not wer:
        return RedirectResponse("/anmelden?fehler=Bitte+neu+anmelden.", status_code=303)
    bremse = bremsschluessel(bitte, wer + "/zweiter")
    warte = gebremst(bremse)
    if warte:
        return RedirectResponse(
            f"/zweiter-schritt?fehler=Zu+viele+Versuche.+Bitte+{warte}+Sekunden+warten.",
            status_code=303)
    if not nutzer.zweiter_schritt_pruefen(wer, code):
        fehlversuch(bremse)
        return RedirectResponse("/zweiter-schritt?fehler=Der+Code+stimmt+nicht.",
                                status_code=303)
    geklappt(bremse)
    nutzer.gesehen(wer)
    antwort = RedirectResponse("/", status_code=303)
    keks_setzen(antwort, wer)
    antwort.delete_cookie(HALBKEKS, path="/")
    return antwort


@app.post("/einrichten")
def einrichten(name: str = Form(""), passwort: str = Form(""), passwort2: str = Form("")):
    """Nur solange es keinen einzigen Benutzer gibt."""
    try:
        if not nutzer.leer():
            return RedirectResponse("/anmelden", status_code=303)
    except nutzer.BenutzerFehler:
        # Unlesbare Datei ist nicht dasselbe wie "noch niemand da".
        return RedirectResponse("/anmelden", status_code=303)
    if nutzer.war_schon_eingerichtet():
        # Siehe /anmelden: leerer Datenordner auf einem Server, der schon lief.
        return RedirectResponse("/anmelden", status_code=303)
    if passwort != passwort2:
        return RedirectResponse("/anmelden?fehler=Die+Passw%C3%B6rter+sind+nicht+gleich.", status_code=303)
    try:
        nutzer.anlegen(name, passwort, verwalter=True)
    except nutzer.BenutzerFehler as f:
        return RedirectResponse(f"/anmelden?fehler={_text(str(f))}", status_code=303)
    nutzer.einrichtung_merken()
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
    if "lesen" not in rechte_hier(wer):
        return JSONResponse({"fehler": "Dafür fehlt deiner Rolle das Recht zum Lesen."},
                            status_code=403)
    try:
        with _arbeit:
            os.environ["NOTIZEN_ORDNER"] = str(arbeitsordner(wer))
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
    """Wer darf Benutzer und Rollen verwalten?"""
    wer = angemeldet(bitte)
    if wer and "benutzer" in nutzer.rechte_von(wer):
        return wer
    return None


def _nur_verwalter(bitte: Request) -> str:
    wer = _verwalter(bitte)
    if not wer:
        raise HTTPException(status_code=403, detail="Das darf nur, wer Benutzer verwalten kann.")
    return wer


@app.post("/aktualisieren")
async def aktualisieren(bitte: Request):
    """Die neue Fassung bereitlegen und neu starten.

    Das Nachladen laeuft in einem Nebenlauf, weil es ein paar Sekunden dauert
    und sonst die ganze Oberflaeche steht. Neu gestartet wird erst, nachdem die
    Antwort draussen ist - sonst saehe der Browser nur einen Abbruch und
    niemand wuesste, ob es geklappt hat.
    """
    _nur_verwalter(bitte)
    hier = Path(__file__).resolve().parent.parent / "requirements.txt"
    try:
        ergebnis = await run_in_threadpool(selbst.vorbereiten, DATEN,
                                           FASSUNG, hier)
    except selbst.SelbstFehler as f:
        return JSONResponse({"fehler": str(f)}, status_code=400)
    except Exception as f:                                      # noqa: BLE001
        return JSONResponse({"fehler": f"Das Nachladen ging schief: {f}"},
                            status_code=502)
    if ergebnis.get("getan"):
        threading.Timer(1.5, lambda: os._exit(0)).start()
    return ergebnis


@app.post("/aktualisieren/zurueck")
def aktualisieren_zurueck(bitte: Request):
    """Die nachgeladene Fassung fallen lassen - zurueck auf die aus dem Image."""
    _nur_verwalter(bitte)
    text = selbst.zuruecknehmen(DATEN)
    threading.Timer(1.5, lambda: os._exit(0)).start()
    return {"hinweis": text}


@app.get("/ablage")
def ablage_lesen(bitte: Request):
    """Wo die Notizen liegen - und ob das gerade wirklich so ist."""
    _nur_verwalter(bitte)
    return ablage.stand()


# Die Designs stehen in shim.js - hier wird nur gemerkt, welches einer gewaehlt
# hat. Die Liste ist trotzdem hier, damit der Server nichts annimmt, was die
# Oberflaeche gar nicht kennt.
AUSSEHEN = ("system", "hell", "dunkel", "mitternacht", "sepia", "wald", "kontrast")


@app.get("/aussehen")
def aussehen_lesen(bitte: Request):
    """Welches Design dieser Benutzer gewaehlt hat.

    Pro Benutzer, nicht pro Browser: wer sich an einem anderen Rechner
    anmeldet, soll seine Oberflaeche wiedererkennen.
    """
    wer = angemeldet(bitte)
    if not wer:
        return JSONResponse({"fehler": "Nicht angemeldet"}, status_code=401)
    try:
        roh = json.loads((nutzer.konfigordner(wer) / "aussehen.json")
                         .read_text(encoding="utf-8"))
        gewaehlt = roh.get("thema")
    except (OSError, ValueError, AttributeError):
        gewaehlt = None
    return {"thema": gewaehlt if gewaehlt in AUSSEHEN else "system",
            "moeglich": list(AUSSEHEN)}


@app.post("/aussehen")
async def aussehen_setzen(bitte: Request):
    wer = angemeldet(bitte)
    if not wer:
        return JSONResponse({"fehler": "Nicht angemeldet"}, status_code=401)
    gewaehlt = (_rumpf(await bitte.json()).get("thema") or "").strip()
    if gewaehlt not in AUSSEHEN:
        return JSONResponse({"fehler": f"Unbekanntes Design: {gewaehlt!r}"},
                            status_code=400)
    ziel = nutzer.konfigordner(wer) / "aussehen.json"
    vorlaeufig = ziel.with_name(".aussehen.neu")
    try:
        vorlaeufig.write_text(json.dumps({"thema": gewaehlt}), encoding="utf-8")
        os.replace(vorlaeufig, ziel)
    except OSError as f:
        return JSONResponse({"fehler": f"Ließ sich nicht merken: {f.strerror}"},
                            status_code=500)
    return {"thema": gewaehlt}


@app.get("/profil")
def profil_lesen(bitte: Request):
    """Das eigene Konto - und nur das.

    Bewusst getrennt von /verwaltung: dort geht es um andere Leute, hier um
    einen selbst. Wer kein Verwalter ist, hatte bisher ueberhaupt keine
    Stelle, an der er sein eigenes Passwort aendern konnte.
    """
    wer = angemeldet(bitte)
    if not wer:
        return JSONResponse({"fehler": "Nicht angemeldet"}, status_code=401)
    rechte = sorted(nutzer.rechte_von(wer))
    return {"ich": wer, "rechte": rechte,
            "rolle": ("Verwalter" if "benutzer" in rechte
                      else ("Benutzer" if "schreiben" in rechte else "Gast")),
            "zwei": nutzer.zwei_schritte_stand(wer)["an"],
            "darf_verwalten": "benutzer" in rechte}


@app.post("/profil/passwort")
async def profil_passwort(bitte: Request):
    """Sein eigenes Passwort aendern - mit dem alten als Nachweis.

    Das alte Passwort ist hier kein Formalismus: wer an einem offen stehenden
    Rechner vorbeikommt, soll nicht in zwei Klicks den Zugang uebernehmen
    koennen. Und weil passwort_setzen die Sitzungsmarke mitaendert, fliegen
    danach ohnehin alle anderen Sitzungen heraus.
    """
    wer = angemeldet(bitte)
    if not wer:
        return JSONResponse({"fehler": "Nicht angemeldet"}, status_code=401)
    rumpf = _rumpf(await bitte.json())
    alt = rumpf.get("alt") or ""
    neu = rumpf.get("neu") or ""
    if not nutzer.pruefen(wer, alt):
        return JSONResponse({"fehler": "Das bisherige Passwort stimmt nicht."},
                            status_code=400)
    try:
        nutzer.passwort_setzen(wer, neu)
    except nutzer.BenutzerFehler as f:
        return JSONResponse({"fehler": str(f)}, status_code=400)
    antwort = JSONResponse({"hinweis": "Passwort geändert. Andere Sitzungen sind "
                                       "damit abgemeldet."})
    keks_setzen(antwort, wer)
    return antwort


@app.post("/ablage/pruefen")
async def ablage_pruefen(bitte: Request):
    """Taugt dieser Ordner? Antwort, bevor etwas gespeichert wird."""
    _nur_verwalter(bitte)
    rumpf = _rumpf(await bitte.json())
    gut, text = ablage.ordner_pruefen((rumpf.get("pfad") or "").strip())
    return {"gut": gut, "text": text}


@app.post("/ablage")
async def ablage_setzen(bitte: Request):
    """Die Ablage einstellen. Wirksam wird sie beim naechsten Start.

    Eingehaengt wird hier mit Absicht nicht: der Serverprozess hat die Rechte
    dafuer laengst abgelegt (und soll sie auch nicht haben). start.py macht es
    in dem Moment, in dem er noch root ist.
    """
    _nur_verwalter(bitte)
    rumpf = _rumpf(await bitte.json())
    try:
        neu = ablage.pruefen(rumpf)
        ablage.schreiben(neu, (rumpf.get("passwort") or ""))
    except ablage.AblageFehler as f:
        return JSONResponse({"fehler": str(f)}, status_code=400)
    except OSError as f:
        return JSONResponse({"fehler": f"Die Einstellung ließ sich nicht ablegen: {f}"},
                            status_code=500)
    stand = ablage.stand()
    if neu["art"] == "lokal":
        stand["hinweis"] = "Beim nächsten Start liegen die Notizen wieder im Volume."
    elif not stand["darf"]:
        stand["hinweis"] = (
            "Gespeichert - aber einhängen darf dieser Container nicht. Dafür muss in "
            "der docker-compose.yml beim Dienst notizmappe stehen:\n"
            "    cap_add:\n      - SYS_ADMIN\n"
            "Danach docker compose up -d.")
    else:
        stand["hinweis"] = ("Gespeichert. Beim nächsten Start wird eingehängt - "
                            "docker compose restart notizmappe.")
    return stand


_fassung_geholt = [0.0, {}]


@app.get("/fassung")
def fassung(bitte: Request):
    """Welche Fassung laeuft, und gibt es eine neuere?

    Die Antwort wird eine Stunde wiederverwendet, damit nicht jeder
    Seitenaufruf bei GitHub anklopft.

    Wer aber ausdruecklich auf "Nach Updates sehen" drueckt, will nachgesehen
    haben - nicht eine Stunde alte Auskunft. Genau das ist passiert: der Knopf
    meldete "das ist die neueste", waehrend die naechste Fassung laengst
    bereitlag, und das eine Stunde lang. Ein Knopf, der nicht tut, was
    draufsteht, ist schlimmer als keiner.

    Deshalb umgeht "frisch" den Zwischenspeicher - mit einer kleinen Bremse,
    damit daraus kein Hammer auf GitHub wird.
    """
    if not angemeldet(bitte):
        return JSONResponse({"fehler": "Nicht angemeldet"}, status_code=401)
    jetzt = time.time()
    frisch = bitte.query_params.get("frisch") == "1"
    alt_genug = jetzt - _fassung_geholt[0] >= 10
    if _fassung_geholt[1] and not (frisch and alt_genug):
        if jetzt - _fassung_geholt[0] < 3600:
            return _fassung_geholt[1]

    stand = {"laeuft": FASSUNG, "oberflaeche": DESKTOP_FASSUNG,
             "neueste": "", "neuer": False, "fehler": ""}
    try:
        # Die eigene VERSION aus dem Repo - nicht das Desktop-Release. Sonst
        # bliebe eine Aenderung, die nur den Server betrifft, unsichtbar.
        #
        # Und ueber die API, nicht ueber raw.githubusercontent: raw haengt
        # hinter einem eigenen Zwischenspeicher von einigen Minuten. Direkt
        # nach einem Push meldet es noch die vorige Nummer - und der Knopf
        # saehe wieder "das ist die neueste", obwohl es das nicht ist.
        # phobos-bot fragt aus demselben Grund die API.
        bitte_api = urllib.request.Request(
            "https://api.github.com/repos/LucyWolf/notizmappe-server"
            "/contents/VERSION?ref=master",
            headers={"Accept": "application/vnd.github.raw",
                     "User-Agent": "notizmappe-server"})
        with urllib.request.urlopen(bitte_api, timeout=8) as antwort:
            stand["neueste"] = antwort.read(64).decode("utf-8").strip()
        stand["neuer"] = selbst.neuer_als(stand["neueste"], FASSUNG)
    except Exception as f:                                  # noqa: BLE001
        stand["fehler"] = f"GitHub nicht erreichbar: {f}"
    _fassung_geholt[0], _fassung_geholt[1] = jetzt, stand
    return stand


@app.get("/bereiche")
def bereiche(bitte: Request):
    """Wo dieser Benutzer arbeiten kann: eigene Notizen und seine Projekte."""
    wer = angemeldet(bitte)
    if not wer:
        return JSONResponse({"fehler": "Nicht angemeldet"}, status_code=401)
    return {"jetzt": bereich_lesen(wer), "projekte": nutzer.projekte_von(wer),
            "rechte_hier": sorted(rechte_hier(wer))}


@app.post("/bereich")
async def bereich_wechseln(bitte: Request):
    wer = angemeldet(bitte)
    if not wer:
        return JSONResponse({"fehler": "Nicht angemeldet"}, status_code=401)
    if bitte.headers.get("x-notizmappe") != "1":
        return JSONResponse({"fehler": "Falscher Aufruf"}, status_code=400)
    d = _rumpf(await bitte.json() if await bitte.body() else {})
    try:
        jetzt = bereich_setzen(wer, str(d.get("bereich") or ""))
    except nutzer.BenutzerFehler as f:
        return JSONResponse({"fehler": str(f)}, status_code=400)
    return {"jetzt": jetzt}


@app.get("/zwei-schritte")
def zwei_schritte_lesen(bitte: Request):
    wer = angemeldet(bitte)
    if not wer:
        return JSONResponse({"fehler": "Nicht angemeldet"}, status_code=401)
    return nutzer.zwei_schritte_stand(wer)


@app.post("/zwei-schritte")
async def zwei_schritte(bitte: Request):
    """Einrichten, einschalten, abschalten - immer nur fuer sich selbst.

    Ausnahme: ein Verwalter darf sie bei jemand anderem abschalten. Ohne das
    waere ein verlorenes Telefon mit aufgebrauchten Notfallcodes das Ende des
    Zugangs - und jemand muss ja helfen koennen.
    """
    wer = angemeldet(bitte)
    if not wer:
        return JSONResponse({"fehler": "Nicht angemeldet"}, status_code=401)
    if bitte.headers.get("x-notizmappe") != "1":
        return JSONResponse({"fehler": "Falscher Aufruf"}, status_code=400)
    d = _rumpf(await bitte.json() if await bitte.body() else {})
    was = str(d.get("was") or "")
    ziel = str(d.get("benutzer") or "").strip().lower() or wer
    if ziel != wer and "benutzer" not in nutzer.rechte_von(wer):
        return JSONResponse({"fehler": "Das geht nur für den eigenen Zugang."}, status_code=403)
    try:
        if was in ("vorbereiten", "einschalten") and ziel != wer:
            return JSONResponse({"fehler": "Einrichten muss jeder selbst - "
                                           "das Geheimnis gehört in seine App."},
                                status_code=403)
        if was == "vorbereiten":
            vor = nutzer.zwei_schritte_vorbereiten(wer)
            # Schwarz auf weiss, auch in einer dunklen Oberflaeche: manche
            # Kameras lesen umgekehrte QR-Codes nicht. Der weisse Rand gehoert
            # dazu, sonst findet der Scanner die Ecken nicht.
            qr = segno.make(vor["adresse"], error="m")
            return {**vor, "qr": qr.svg_inline(scale=4, border=3,
                                               dark="#000000", light="#ffffff")}
        if was == "einschalten":
            nutzer.zwei_schritte_einschalten(wer, str(d.get("code") or ""))
        elif was == "aus":
            nutzer.zwei_schritte_aus(ziel)
        else:
            return JSONResponse({"fehler": "Unbekannt"}, status_code=400)
    except nutzer.BenutzerFehler as f:
        return JSONResponse({"fehler": str(f)}, status_code=400)
    return {"ok": True, **nutzer.zwei_schritte_stand(ziel)}


@app.post("/verwaltung/einladung")
async def verwaltung_einladung(bitte: Request):
    """Einen Einladungslink erzeugen oder zuruecknehmen."""
    _nur_verwalter(bitte)
    if bitte.headers.get("x-notizmappe") != "1":
        return JSONResponse({"fehler": "Falscher Aufruf"}, status_code=400)
    d = _rumpf(await bitte.json() if await bitte.body() else {})
    try:
        if d.get("was") == "zuruecknehmen":
            nutzer.einladung_zuruecknehmen(str(d.get("marke") or ""))
            return {"ok": True}
        e = nutzer.einladung_anlegen(
            angemeldet(bitte), str(d.get("rolle") or "Benutzer"),
            str(d.get("projekt") or ""), str(d.get("recht") or "schreiben"),
            int(d.get("minuten") or nutzer.EINLADUNG_MINUTEN))
    except (nutzer.BenutzerFehler, ValueError, TypeError) as f:
        return JSONResponse({"fehler": str(f)}, status_code=400)
    # Die Adresse so bauen, wie der Browser sie gerade benutzt - hinter einem
    # Proxy ist das nicht dieselbe, die der Server von sich kennt.
    grund = str(bitte.base_url).rstrip("/")
    return {**e, "link": f"{grund}/einladung/{e['marke']}"}


@app.get("/einladung/{marke}", response_class=HTMLResponse)
def einladungsseite(marke: str, fehler: str = ""):
    e = nutzer.einladung_lesen(marke)
    if not e:
        # Nicht verraten, ob es die Marke mal gab - es gibt nichts zu holen.
        return HTMLResponse(
            "<h2>Diese Einladung gilt nicht mehr</h2>"
            "<p>Einladungen laufen nach wenigen Minuten ab und gelten einmal. "
            "Bitte um eine neue.</p>", status_code=410)
    projekt = f" · Projekt {_text(e['projekt'])} ({_text(e['recht'])})" if e.get("projekt") else ""
    rest = max(0, int(e["bis"] - time.time()))
    return HTMLResponse(_vorlage(
        "einladung.html", wer=_text(e.get("von") or "Jemand"), rolle=_text(e["rolle"]),
        projekt=projekt, marke=_text(marke), bis=int(e["bis"]),
        rest=f"{rest // 60}:{rest % 60:02d}", fehler=_text(fehler)))


@app.post("/einladung/{marke}")
def einladung_einloesen(marke: str, bitte: Request, name: str = Form(""),
                        passwort: str = Form(""), passwort2: str = Form("")):
    if passwort != passwort2:
        return RedirectResponse(f"/einladung/{marke}?fehler=Die+Passw%C3%B6rter+sind+nicht+gleich.",
                                status_code=303)
    try:
        wer = nutzer.einladung_einloesen(marke, name, passwort)
    except nutzer.BenutzerFehler as f:
        return RedirectResponse(
            f"/einladung/{marke}?fehler={urllib.parse.quote_plus(str(f))}", status_code=303)
    antwort = RedirectResponse("/", status_code=303)
    keks_setzen(antwort, wer)
    return antwort


@app.post("/verwaltung/projekt")
async def verwaltung_projekt(bitte: Request):
    """Projekte anlegen, Mitglieder setzen, entfernen."""
    wer = angemeldet(bitte)
    if not wer:
        return JSONResponse({"fehler": "Nicht angemeldet"}, status_code=401)
    if bitte.headers.get("x-notizmappe") != "1":
        return JSONResponse({"fehler": "Falscher Aufruf"}, status_code=400)
    d = _rumpf(await bitte.json() if await bitte.body() else {})
    was = str(d.get("was") or "")
    projekt = str(d.get("projekt") or "")
    meine = nutzer.rechte_von(wer)

    # Anlegen darf ein Verwalter. Innerhalb eines Projekts darf auch, wer dort
    # "verwalten" ist - sonst muesste fuer jede Kleinigkeit ein Verwalter
    # kommen, und das ist genau die Art Huerde, die niemand will.
    darf_hier = "benutzer" in meine or nutzer.projekt_recht(wer, projekt) == "verwalten"
    try:
        if was == "anlegen":
            if "benutzer" not in meine:
                return JSONResponse({"fehler": "Projekte anlegen darf nur ein Verwalter."},
                                    status_code=403)
            nutzer.projekt_anlegen(str(d.get("name") or ""), wer)
        elif not darf_hier:
            return JSONResponse({"fehler": "Dieses Projekt darfst du nicht verwalten."},
                                status_code=403)
        elif was == "mitglied":
            nutzer.mitglied_setzen(projekt, str(d.get("benutzer") or ""),
                                   str(d.get("recht") or ""))
        elif was == "mitglied-raus":
            nutzer.mitglied_entfernen(projekt, str(d.get("benutzer") or ""))
        elif was == "entfernen":
            nutzer.projekt_entfernen(projekt)
        else:
            return JSONResponse({"fehler": "Unbekannt"}, status_code=400)
    except nutzer.BenutzerFehler as f:
        return JSONResponse({"fehler": str(f)}, status_code=400)
    return {"ok": True}


@app.get("/verwaltung")
def verwaltung(bitte: Request):
    """Alles, was der Abschnitt in den Einstellungen braucht - als JSON."""
    wer = angemeldet(bitte)
    if not wer:
        return JSONResponse({"fehler": "Nicht angemeldet"}, status_code=401)
    meine = sorted(nutzer.rechte_von(wer))
    if "benutzer" not in meine:
        # Kein Verwalter: nur die eigene Lage, damit die Oberflaeche weiss,
        # dass sie den Abschnitt gar nicht erst zeigen muss.
        return {"darf": False, "ich": wer, "meine_rechte": meine}
    return {
        "darf": "benutzer" in meine, "ich": wer, "meine_rechte": meine,
        "benutzer": [{**b, "zwei": nutzer.zwei_schritte_stand(b["name"])["an"]}
                     for b in nutzer.liste()],
        "rollen": [{"name": n, "erklaerung": r["erklaerung"]}
                   for n, r in nutzer.ROLLEN.items()],
        "projekte": [{"name": n, "mitglieder": pr["mitglieder"]}
                     for n, pr in sorted(nutzer.projekte().items())],
        "projektrechte": list(nutzer.PROJEKTRECHTE),
        "darf_projekte": "benutzer" in nutzer.rechte_von(wer),
        "einladungen": nutzer.einladungen() if "benutzer" in meine else [],
        "einladung_minuten": nutzer.EINLADUNG_MINUTEN,
    }


def _rumpf(wert) -> dict:
    return wert if isinstance(wert, dict) else {}


@app.post("/verwaltung/benutzer")
async def verwaltung_benutzer(bitte: Request):
    """Anlegen, Rolle setzen, Passwort setzen, entfernen - je nach "was"."""
    _nur_verwalter(bitte)
    if bitte.headers.get("x-notizmappe") != "1":
        return JSONResponse({"fehler": "Falscher Aufruf"}, status_code=400)
    d = _rumpf(await bitte.json() if await bitte.body() else {})
    was = str(d.get("was") or "")
    name = str(d.get("name") or "").strip().lower()
    try:
        if was == "anlegen":
            nutzer.anlegen(name, str(d.get("passwort") or ""), rolle=str(d.get("rolle") or ""))
        elif was == "rolle":
            nutzer.rolle_zuweisen(name, str(d.get("rolle") or ""))
        elif was == "passwort":
            nutzer.passwort_setzen(name, str(d.get("passwort") or ""))
        elif was == "entfernen":
            if name == angemeldet(bitte):
                return JSONResponse({"fehler": "Den eigenen Zugang nicht"}, status_code=400)
            nutzer.entfernen(name)
        else:
            return JSONResponse({"fehler": "Unbekannt"}, status_code=400)
    except nutzer.BenutzerFehler as f:
        return JSONResponse({"fehler": str(f)}, status_code=400)
    return {"ok": True}


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
    # "no-cache" heisst nicht "nicht speichern", sondern "vorher nachfragen":
    # der Browser behaelt die Datei, holt sie aber nur neu, wenn sie sich
    # geaendert hat (FileResponse schickt dafuer ETag und Datum mit). Ohne das
    # kann nach einem Update des Images noch tagelang die alte Oberflaeche im
    # Fenster stehen - und niemand versteht, warum eine Aenderung nicht ankommt.
    return FileResponse(OBERFLAECHE / datei, media_type=typ,
                        headers={"Cache-Control": "no-cache"})


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
    if methode in ERLAUBT and not hasattr(BRUECKE, methode):
        return JSONResponse(
            {"fehler": "Diese Fassung des Programms kennt das noch nicht - "
                       f"im Image steckt Notizmappe {DESKTOP_FASSUNG}."},
            status_code=501)
    noetig = RECHT_JE_METHODE.get(methode, "lesen")
    if methode in ERLAUBT and noetig not in rechte_hier(name):
        return JSONResponse(
            {"fehler": f"Dafür fehlt deiner Rolle das Recht „{nutzer.RECHTE.get(noetig, noetig)}“."},
            status_code=403)
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
    schief = _passt(methode, args)
    if schief:
        return {"fehler": f"Ungültiger Aufruf: {schief}"}
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
    # Wo die Dateien auf dem Server liegen, geht den Browser nichts an - das
    # ist eine Auskunft ueber den Rechner, nicht ueber die Notizen.
    if isinstance(aus, dict) and isinstance(aus.get("ordner"), str):
        bereich = bereich_lesen(name)
        aus = dict(aus)
        aus["ordner"] = f"Projekt: {bereich}" if bereich else f"Server: {name}"
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
