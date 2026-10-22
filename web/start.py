#!/usr/bin/env python3
"""Startet den Server - und bringt vorher die Rechte am Datenordner in Ordnung.

Der Grund: ein Container laeuft unter einer eigenen Nummer, der gemountete
Ordner auf der Platte gehoert aber dem Benutzer, der ihn angelegt hat. Passt das
nicht zusammen, kann der Server nicht schreiben - und zwar auf eine besonders
unangenehme Art: die Seite kommt hoch, die Anmeldung sieht normal aus, nur
angelegt wird nichts. Genau das ist beim ersten Probelauf passiert.

Deshalb richtet sich der Server nach dem Ordner, statt umgekehrt:

* `./daten` gehoert dir (ein Bind-Mount)? Dann laeuft er unter deiner Nummer.
* Der Ordner ist noch root (ein frisches Docker-Volume)? Dann wird er dem
  eingebauten Benutzer uebergeben.
* PUID/PGID gesetzt? Dann gilt das.

Danach werden die Rechte abgelegt: ab dem exec laeuft nichts mehr als root.

Die Schreibprobe prueft gleich mit, ob 0600 auf der Ablage ueberhaupt
greift. Auf einer SMB-Freigabe tut es das nicht - dort setzen die
Mount-Optionen die Rechte fest, und benutzer.json und der
Sitzungsschluessel liegen offen. Lieber eine Zeile im Protokoll als die
stille Annahme, das waere schon in Ordnung.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ablage                                                      # noqa: E402
import selbst                                                      # noqa: E402

DATEN = os.environ.get("NOTIZMAPPE_DATEN", "/daten")
EINGEBAUT = 10001


def zahl(name: str) -> int | None:
    wert = (os.environ.get(name) or "").strip()
    return int(wert) if wert.isdigit() else None


def ablage_vorbereiten(uid: int, gid: int) -> str:
    """Die eingestellte Ablage herrichten und sagen, wo geschrieben wird.

    Drei Faelle, und nur einer braucht Rechte:

      lokal   - der Ordner im Volume, nichts zu tun
      ordner  - ein anderer Ordner; es wird nichts eingehaengt, der Server
                schreibt schlicht woanders hin. Deshalb ohne SYS_ADMIN.
      smb/nfs - die Freigabe wird eingehaengt, und zwar NICHT auf den
                Datenordner, sondern auf einen eigenen Punkt. Erst darin liegt
                der Datenordner, womoeglich in einem Unterordner.

    Geht etwas schief, laeuft der Server trotzdem weiter - mit dem Volume. Ein
    Server, der wegen einer stummen NAS gar nicht mehr hochkommt, waere
    schlimmer als einer, der die alten Notizen zeigt und dazusagt, warum.
    """
    eingestellt = ablage.lesen()
    art = eingestellt.get("art", "lokal")
    if art == "lokal":
        return DATEN

    if art == "ordner":
        gut, text = ablage.ordner_pruefen(eingestellt.get("pfad") or "")
        if not gut:
            print(f"[start] {text}", flush=True)
            print(f"[start] Es bleibt bei {DATEN}.", flush=True)
            ablage.meldung_merken(text)
            return DATEN
        ziel = ablage.datenordner_fuer(eingestellt)
        try:
            ziel.mkdir(parents=True, exist_ok=True)
        except OSError as f:
            print(f"[start] {ziel} ließ sich nicht anlegen ({f.strerror}).", flush=True)
            return DATEN
        print(f"[start] Ablage: {ziel}", flush=True)
        return str(ziel)

    gut, text = ablage.einhaengen(eingestellt, uid, gid)
    print(f"[start] {text}", flush=True)
    ablage.meldung_merken(text)
    if not gut:
        print("[start] Die Notizen kommen bis auf Weiteres aus dem Volume.", flush=True)
        return DATEN
    return str(ablage.datenordner_fuer(eingestellt))


def rechte_richten() -> None:
    os.makedirs(DATEN, exist_ok=True)
    stand = os.stat(DATEN)
    uid = zahl("PUID") or (stand.st_uid or EINGEBAUT)
    gid = zahl("PGID") or (stand.st_gid or EINGEBAUT)


    if stand.st_uid != uid or stand.st_gid != gid:
        print(f"[start] {DATEN} gehört {stand.st_uid}:{stand.st_gid}, "
              f"wird {uid}:{gid} übergeben", flush=True)
        for wurzel, ordner, dateien in os.walk(DATEN):
            for name in ordner + dateien:
                try:
                    os.chown(os.path.join(wurzel, name), uid, gid)
                except OSError:
                    pass            # NFS, SMB: dann muss es dort schon passen
        try:
            os.chown(DATEN, uid, gid)
        except OSError as f:
            print(f"[start] Rechte an {DATEN} nicht zu ändern: {f}", flush=True)

    # Eine Probe, bevor es losgeht: lieber hier eine klare Zeile im Protokoll
    # als später eine Anmeldung, die stumm nichts speichert.
    os.setgroups([])
    os.setgid(gid)
    os.setuid(uid)
    probe = os.path.join(DATEN, ".schreibprobe")
    try:
        fd = os.open(probe, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write("ok")
        rechte = os.stat(probe).st_mode & 0o777
        os.unlink(probe)
    except OSError as f:
        sys.exit(f"[start] In {DATEN} lässt sich nicht schreiben ({f}).\n"
                 f"        Dem Ordner auf der Platte Schreibrechte geben oder\n"
                 f"        PUID/PGID auf den Eigentümer setzen.")
    print(f"[start] läuft als {uid}:{gid}, Daten in {DATEN}", flush=True)
    if rechte != 0o600:
        print(f"[start] ACHTUNG: eine mit 0600 angelegte Datei liegt als "
              f"{rechte:04o} in {DATEN}.", flush=True)
        print("[start]   Das ist bei SMB/CIFS normal - die Mount-Optionen "
              "setzen die Rechte fest,", flush=True)
        print("[start]   der Server kann sie nicht ändern. Damit sind "
              "benutzer.json UND", flush=True)
        print("[start]   .sitzungsschluessel für andere lesbar; mit dem "
              "Sitzungsschlüssel lässt", flush=True)
        print("[start]   sich ein gültiger Keks für jeden Zugang bauen.",
              flush=True)
        print("[start]   Mount-Optionen setzen: "
              "file_mode=0600,dir_mode=0700,uid=<puid>,gid=<pgid>", flush=True)


# Hoechstens zwei Anlaeufe mit einer nachgeladenen Fassung. Beim dritten ist
# klar, dass sie nicht laeuft - und ohne Oberflaeche gaebe es keinen Knopf mehr,
# mit dem man sie zuruecknimmt.
MAX_ANLAEUFE = 2


def programm_waehlen() -> tuple[str, str]:
    """Aus dem Image starten oder aus einer nachgeladenen Fassung?

    Gibt (app-dir, desktop-ordner) zurueck. Im Zweifel immer das Image: eine
    Ueberlagerung, die zweimal nicht hochkam, fliegt hier raus.
    """
    image_web, image_desktop = "/srv/web", os.environ.get("NOTIZMAPPE_DESKTOP", "/desktop")
    fassung = selbst.aktive_fassung(DATEN)
    if not fassung:
        return image_web, image_desktop

    anlauf = selbst.versuch_merken(DATEN, fassung)
    if anlauf > MAX_ANLAEUFE:
        print(f"[start] Fassung {fassung} ist {anlauf - 1}x nicht hochgekommen - "
              "wird verworfen, es gilt wieder die aus dem Image.", flush=True)
        selbst.zuruecknehmen(DATEN)
        selbst.versuch_gelungen(DATEN)          # Zaehler zuruecksetzen
        return image_web, image_desktop

    ordner = selbst.programmordner(DATEN) / fassung
    print(f"[start] nachgeladene Fassung {fassung} (Anlauf {anlauf})", flush=True)
    return str(ordner / "web"), str(ordner / "desktop")


if __name__ == "__main__":
    # Zuerst entscheiden, wohin ueberhaupt geschrieben wird - alles danach
    # (Rechte, Einhaengen, nachgeladene Fassungen) bezieht sich darauf.
    VORHER = DATEN
    # Einhaengen muss als root passieren, das Herrichten der Rechte danach.
    uid0 = zahl("PUID") or (os.stat(DATEN).st_uid or EINGEBAUT)
    gid0 = zahl("PGID") or (os.stat(DATEN).st_gid or EINGEBAUT)
    DATEN = ablage_vorbereiten(uid0, gid0)
    os.environ["NOTIZMAPPE_DATEN"] = DATEN
    if os.geteuid() == 0:
        rechte_richten()

    # Erst JETZT die Notizen mitnehmen, nach dem Ablegen der Rechte. Vorher
    # waere das Kopieren als root gelaufen, und die Dateien haetten root
    # gehoert - der Server kommt dann hoch, kann benutzer.json aber nicht
    # lesen und meldet 503. Genau so ist es beim ersten Probelauf passiert.
    if DATEN != VORHER:
        gesagt = ablage.mitnehmen(VORHER, DATEN)
        if gesagt:
            print(f"[start] {gesagt}", flush=True)
            ablage.meldung_merken(f"Die Notizen liegen in {DATEN}. {gesagt}")
    web, desktop = programm_waehlen()
    os.environ["NOTIZMAPPE_DESKTOP"] = desktop
    os.execvp("uvicorn", [
        "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000",
        "--app-dir", web, "--proxy-headers", "--forwarded-allow-ips", "*",
    ])
