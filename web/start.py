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

DATEN = os.environ.get("NOTIZMAPPE_DATEN", "/daten")
EINGEBAUT = 10001


def zahl(name: str) -> int | None:
    wert = (os.environ.get(name) or "").strip()
    return int(wert) if wert.isdigit() else None


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


if __name__ == "__main__":
    if os.geteuid() == 0:
        rechte_richten()
    os.execvp("uvicorn", [
        "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000",
        "--app-dir", "/srv/web", "--proxy-headers", "--forwarded-allow-ips", "*",
    ])
