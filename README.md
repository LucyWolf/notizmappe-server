# Notizmappe-Server

Dieselbe freie Notizfläche wie die [Notizmappe](https://github.com/LucyWolf/notizmappe),
aber für mehrere Leute: läuft als Container, hat Konten, und jedes Notizbuch ist ein
Projekt mit eigener Mitgliederliste.

Stand: 09.10.2026.

**Das hier ist nicht das Desktop-Programm.** Die Notizmappe für den eigenen Rechner
ist ein eigenes Projekt, hört nur auf `127.0.0.1`, kennt keine Konten und enthält
nichts aus diesem Repo. Die beiden teilen sich die Herkunft und das Dateiformat,
sonst nichts — eigene Versionen, eigene Releases, getrennte Auslieferung.

## Starten

```bash
docker compose up -d
docker logs notizmappe            # hier steht der Einrichtungscode
```

Dann `http://<rechner>:8099` öffnen und mit dem Code das erste Konto anlegen. Der
Code steht nur im Protokoll: wer nicht an den Container kommt, kann auch kein
Admin-Konto anlegen. Festlegen lässt er sich auch selbst:

```yaml
environment:
  NOTIZMAPPE_EINRICHTUNGSCODE: "ein-langer-geheimer-code"
```

**Fürs Internet gehört ein Reverse-Proxy mit HTTPS davor.** Der Container spricht
HTTP und setzt den Sitzungskeks nur dann als `Secure`, wenn er über
`X-Forwarded-Proto: https` erfährt, dass die Verbindung verschlüsselt ist.

## Daten

```
/notizen   Notizbücher = Projekte, Abschnitte, Seiten als JSON, Anhänge daneben
/konfig    Konten, Sitzungen, Einstellungen
```

Zwei Volumes, beide in `docker-compose.yml`. Das Format ist dasselbe wie beim
Desktop-Programm — ein Ordner lässt sich zwischen beiden hin- und herkopieren.

## Konten und Projekte

* Das erste Konto ist Admin. Admins sehen alle Notizbücher und verwalten Konten.
* Alle anderen sehen nur die Notizbücher, bei denen sie eingetragen sind. Wer selbst
  eins anlegt, ist automatisch drin.
* Ein gelöschtes Konto wird aus allen Projekten genommen — sonst erbt ein später
  angelegtes Konto mit demselben Namen den alten Zugriff.
* Passwortwechsel meldet alle anderen Geräte ab.

## Updates

Kein Selbstupdate: ein Container wird nicht von innen umgebaut, sondern ausgetauscht.

```bash
docker compose pull && docker compose up -d
```

## Tests

```bash
PY=python3 ./tests/alle.sh
```

`test_api.py` prüft Seiten, Anhänge, Konflikte, XSS und Pfadausbruch,
`test_konten.py` Anmeldung, Bremse gegen Passwortraten, Sitzungen, Projektrechte.
Der Workflow fährt beide bei jedem Lauf und startet danach das gebaute Image
einmal wirklich — „baut" heißt nicht „läuft".

## Neue Fassung

Version in `app/VERSION` hochzählen (letzte Stelle bis 99, nie rückwärts), taggen,
pushen. `docker.yml` baut dann `ghcr.io/lucywolf/notizmappe-server:<version>` und
`:latest`.

Beim allerersten Mal ist das Paket auf GitHub privat — unter *Packages →
notizmappe-server → Package settings* auf **Public** stellen, sonst braucht jeder
`docker pull` eine Anmeldung.
