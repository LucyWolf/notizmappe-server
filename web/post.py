"""Mail verschicken - und nur dafuer da, das Passwort zurueckzusetzen.

Der Server kennt sonst keinen Weg nach draussen. Das ist Absicht: je weniger
er von sich aus tut, desto weniger kann mit ihm getan werden. Deshalb steht
hier genau eine Art Nachricht, an genau eine Adresse, die vorher im eigenen
Profil eingetragen wurde.

**Das SMTP-Passwort liegt im Klartext.** Anders geht es nicht - der Server muss
sich damit anmelden, und etwas, das er selbst wieder lesbar machen kann, ist
nicht verschluesselt, sondern nur versteckt. Die Datei liegt deshalb auf 0600
und gehoert dem Benutzer, als der der Server laeuft. Wer an sie herankommt, hat
das Mail-Konto - das muss man wissen, bevor man es eintraegt.
"""
from __future__ import annotations

import json
import os
import re
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr
from pathlib import Path

import benutzer as nutzer

DATEI = ".post.json"
ZEIT = 15                           # Sekunden; ein haengender Mailserver darf
                                    # nicht die halbe Oberflaeche aufhalten
SICHERHEITEN = ("starttls", "ssl", "keine")

MUSTER_WIRT = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$")
# Keine vollstaendige Adressgrammatik - bewusst enger als RFC 5322. Was hier
# durchkommt, laesst sich gefahrlos in einen Kopf schreiben; alles mit
# Zeilenumbruch oder Komma darin faellt durch.
MUSTER_ADRESSE = re.compile(r"^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,251}\.[A-Za-z]{2,24}$")
MUSTER_STELLE = re.compile(r"^https?://[A-Za-z0-9.-]{1,253}(:\d{1,5})?$")


class PostFehler(Exception):
    pass


def _datei() -> Path:
    return nutzer.datenordner() / DATEI


def _roh() -> dict:
    p = _datei()
    if not p.is_file():
        return {}
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return d if isinstance(d, dict) else {}


def stand() -> dict:
    """Was die Oberflaeche sehen darf - ohne das Passwort.

    Statt des Passworts nur, ob eines hinterlegt ist. Sonst muesste man es beim
    Aendern jedes Mal neu eintippen, und ein Feld, das heimlich leer bleibt,
    ist schlimmer als keins.
    """
    d = _roh()
    return {
        "an": bool(d.get("an")),
        "server": d.get("server", ""),
        "port": int(d.get("port") or 587),
        "sicherheit": d.get("sicherheit", "starttls"),
        "benutzer": d.get("benutzer", ""),
        "passwort_da": bool(d.get("passwort")),
        "absender": d.get("absender", ""),
        "stelle": d.get("stelle", ""),
    }


def eingerichtet() -> bool:
    d = _roh()
    return bool(d.get("an") and d.get("server") and d.get("absender") and d.get("stelle"))


def setzen(an: bool, server: str, port, sicherheit: str, benutzer: str,
           passwort, absender: str, stelle: str) -> None:
    """Prueft alles, bevor etwas geschrieben wird.

    `passwort=None` heisst "das bisherige behalten" - das ist der Normalfall,
    wenn jemand nur den Absender aendert.
    """
    server = (server or "").strip()
    benutzer = (benutzer or "").strip()
    absender = (absender or "").strip()
    stelle = (stelle or "").strip().rstrip("/")
    sicherheit = (sicherheit or "starttls").strip()
    try:
        port = int(port or 0)
    except (TypeError, ValueError):
        raise PostFehler("Der Port muss eine Zahl sein")

    if an:
        if not MUSTER_WIRT.match(server):
            raise PostFehler("Der Mailserver sieht nicht wie ein Rechnername aus")
        if not 1 <= port <= 65535:
            raise PostFehler("Der Port liegt zwischen 1 und 65535")
        if sicherheit not in SICHERHEITEN:
            raise PostFehler("Verschlüsselung: STARTTLS, SSL oder keine")
        if not MUSTER_ADRESSE.match(absender):
            raise PostFehler("Die Absenderadresse sieht nicht wie eine E-Mail aus")
        # Ohne erreichbare Adresse ist der Link in der Mail wertlos. Lieber
        # jetzt meckern als in der Mail, die jemand nachts bekommt.
        if not MUSTER_STELLE.match(stelle):
            raise PostFehler("Die Adresse des Servers muss mit http:// oder https:// "
                             "anfangen und ohne Pfad enden, z. B. https://notizen.example.de")
        if len(benutzer) > 200:
            raise PostFehler("Der Anmeldename ist zu lang")

    alt = _roh()
    neu = {
        "an": bool(an),
        "server": server,
        "port": port or 587,
        "sicherheit": sicherheit,
        "benutzer": benutzer,
        "passwort": alt.get("passwort", "") if passwort is None else str(passwort),
        "absender": absender,
        "stelle": stelle,
    }
    p = _datei()
    tmp = p.with_name(f".{p.name}.neu")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(neu, f, ensure_ascii=False, indent=1)
    os.replace(tmp, p)
    try:
        os.chmod(p, 0o600)
    except OSError:
        # Auf einer SMB-Freigabe gibt es keine Rechte in dem Sinn. Das steht
        # beim Start schon als Warnung da, hier nicht noch einmal.
        pass


def _verbinden(d: dict):
    if d.get("sicherheit") == "ssl":
        return smtplib.SMTP_SSL(d["server"], d["port"], timeout=ZEIT,
                                context=ssl.create_default_context())
    post = smtplib.SMTP(d["server"], d["port"], timeout=ZEIT)
    if d.get("sicherheit") != "keine":
        post.starttls(context=ssl.create_default_context())
    return post


def senden(empfaenger: str, betreff: str, text: str) -> None:
    d = _roh()
    if not d.get("an"):
        raise PostFehler("Der Mailversand ist nicht eingeschaltet")
    if not MUSTER_ADRESSE.match((empfaenger or "").strip()):
        raise PostFehler("Die Empfängeradresse sieht nicht wie eine E-Mail aus")
    if "\n" in betreff or "\r" in betreff:
        # Ein Zeilenumbruch im Betreff waere eine eigene Kopfzeile. So kommt
        # man sonst in die Mail hinein, die der Server verschickt.
        raise PostFehler("Der Betreff darf keinen Zeilenumbruch haben")

    nachricht = EmailMessage()
    nachricht["From"] = formataddr(("Notizmappe", d["absender"]))
    nachricht["To"] = empfaenger.strip()
    nachricht["Subject"] = betreff
    nachricht.set_content(text)
    try:
        with _verbinden(d) as post:
            if d.get("benutzer"):
                post.login(d["benutzer"], d.get("passwort", ""))
            post.send_message(nachricht)
    except (smtplib.SMTPException, OSError, ssl.SSLError) as f:
        raise PostFehler(f"Der Mailserver hat nicht mitgespielt: {f}")


def probe(empfaenger: str) -> None:
    senden(empfaenger,
           "Notizmappe: Testnachricht",
           "Diese Nachricht kommt von deiner Notizmappe.\n\n"
           "Wenn sie angekommen ist, stimmen die Einstellungen - dann kann der "
           "Server auch Links zum Zurücksetzen des Passworts verschicken.\n")


def ruecksetzmail(empfaenger: str, name: str, marke: str) -> None:
    d = _roh()
    stelle = d.get("stelle", "").rstrip("/")
    senden(
        empfaenger,
        "Notizmappe: Passwort zurücksetzen",
        f"Für den Zugang „{name}“ wurde ein neues Passwort angefordert.\n\n"
        f"{stelle}/neues-passwort?marke={marke}\n\n"
        "Der Link gilt 30 Minuten und genau einmal. Danach sind alle offenen "
        "Sitzungen dieses Zugangs abgemeldet.\n\n"
        "Wenn du das nicht warst, kannst du diese Nachricht wegwerfen - solange "
        "niemand den Link hat, ändert sich nichts.\n")
