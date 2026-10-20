# Die Notizmappe als Server. Ein Image, ein Prozess, keine Datenbank.
#
# Das Desktop-Programm wird beim Bauen in einer **festen** Fassung geholt
# (DESKTOP_VERSION) - Oberflaeche und Ablage gibt es nur einmal, naemlich dort.
# Hier liegt nur die HTTP-Schicht mit Anmeldung.
FROM python:3.12-slim

# curl: holt das Desktop-Release. fontconfig + die Schriften: die Oberflaeche
# fragt "welche Schriften gibt es hier?" und das beantwortet fc-list. Ohne das
# ist die Schriftauswahl leer.
# cifs-utils + nfs-common: damit eine in der Oberflaeche eingestellte
# NAS-Freigabe beim Start eingehaengt werden kann. Ohne die Faehigkeit
# SYS_ADMIN in der compose-Datei passiert damit trotzdem nichts - die Programme
# allein geben keine Rechte.
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates fontconfig fonts-dejavu-core fonts-liberation2 \
      cifs-utils nfs-common \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY DESKTOP_VERSION .
COPY tools/desktop_holen.sh tools/
RUN tools/desktop_holen.sh && mv /srv/desktop /desktop

COPY web/ /srv/web/

ENV NOTIZMAPPE_DESKTOP=/desktop \
    NOTIZMAPPE_DATEN=/daten \
    NOTIZMAPPE_EINRICHTUNG=/einrichtung \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Der eingebaute Benutzer fuer den Fall, dass der Datenordner ein frisches
# Docker-Volume ist. Gehoert er dagegen einem Benutzer auf der Platte (Bind-
# Mount), uebernimmt web/start.py dessen Nummer - sonst kann der Server nicht
# schreiben. Der Start laeuft als root, legt die Rechte ab und uebergibt dann
# an uvicorn; ab da laeuft nichts mehr mit Rechten, die es nicht braucht.
RUN useradd -u 10001 -m -s /usr/sbin/nologin notiz \
    && mkdir -p /daten /einrichtung && chown notiz /daten /einrichtung
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/anmelden', timeout=4).status == 200 else 1)"

CMD ["python", "/srv/web/start.py"]
