# Die Notizmappe als Server. Ein Image, ein Prozess, keine Datenbank.
#
# Das Desktop-Programm wird beim Bauen in einer **festen** Fassung geholt
# (DESKTOP_VERSION) - Oberflaeche und Ablage gibt es nur einmal, naemlich dort.
# Hier liegt nur die HTTP-Schicht mit Anmeldung.
FROM python:3.12-slim

# curl: holt das Desktop-Release. fontconfig + die Schriften: die Oberflaeche
# fragt "welche Schriften gibt es hier?" und das beantwortet fc-list. Ohne das
# ist die Schriftauswahl leer.
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates fontconfig fonts-dejavu-core fonts-liberation2 \
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
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Nicht als root. Die Notizen liegen in einem Volume, das dem Benutzer gehoert.
RUN useradd -u 10001 -m -s /usr/sbin/nologin notiz && mkdir -p /daten && chown notiz /daten
USER notiz
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/anmelden', timeout=4).status == 200 else 1)"

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", \
     "--app-dir", "/srv/web", "--proxy-headers", "--forwarded-allow-ips", "*"]
