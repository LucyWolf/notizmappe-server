# Notizmappe — Serverfassung

Die [Notizmappe](https://github.com/LucyWolf/notizmappe) über eine Webadresse,
mit Anmeldung, in Docker. Jeder Benutzer hat seinen eigenen Notizordner.

Stand: 14.10.2026

## Das Wichtigste zuerst: es gibt nur **eine** Oberfläche

Das Desktop-Programm ist das Programm. Dieser Server ist eine zweite Tür dazu.
In diesem Repo liegen **keine** `index.html`, **keine** `mappe.js`, **kein** CSS
— sie werden beim Bauen aus einer festen Fassung des Desktop-Repos geholt
(`DESKTOP_VERSION`, siehe `tools/desktop_holen.sh`). Deshalb können die beiden
Fassungen nicht unterschiedlich aussehen; es sind dieselben Dateien.

Möglich ist das, weil die Oberfläche genau einen Berührungspunkt mit dem
Programm hat: `window.pywebview.api.xyz`. Im Fenster sind das die Methoden aus
`bruecke.py` im selben Prozess. Im Browser legt [web/shim.js](web/shim.js) dort
einen Stellvertreter hin, der jeden Aufruf als `POST /bruecke/xyz` schickt. An
`index.html` wird dafür **eine** Zeile eingesetzt (das `<script>` für den
Stellvertreter), sonst nichts.

`tests/test_gleich.py` prüft das nach: keine Kopien im Repo, ausgelieferte
Dateien Byte für Byte identisch, an `index.html` genau eine Zeile mehr. Und
`.github/workflows/nachziehen.yml` zieht `DESKTOP_VERSION` täglich nach, wenn
der Desktop ein neues Release hat — damit niemand daran denken muss.

## Starten

```bash
git clone https://github.com/LucyWolf/notizmappe-server
cd notizmappe-server
docker compose up -d
```

Dann `http://<rechner>:8112` aufrufen. Beim ersten Mal kommt die
Einrichtungsseite: der erste Zugang wird gleich der **Verwalter** und kann unter
`/benutzer` weitere Benutzer anlegen.

Selbst bauen statt das fertige Image ziehen: in `docker-compose.yml` `image:`
auskommentieren und `build: .` setzen.

## Was wo liegt

Alles, was bleiben muss, liegt im Volume `./daten`:

```
daten/benutzer.json         Zugänge; Passwörter als scrypt-Hash, nie im Klartext
daten/.sitzungsschluessel   unterschreibt die Sitzungs-Kekse (0600)
daten/notizen/<benutzer>/   die Notizen - dieselbe Ablage wie am Desktop
daten/konfig/<benutzer>/    Schriftfavoriten usw., je Benutzer
```

Die Notizen sind **Dateien**: Notizbuch = Ordner, Abschnitt = Unterordner,
Seite = JSON. Du kannst `daten/notizen/<name>` also auch einfach wegsichern oder
mit dem Desktop-Programm öffnen, indem du den Ordner dort als Datenordner
einstellst.

## Anmeldung und Absicherung

* Passwörter per **scrypt** (N=2¹⁶, ~130 ms) — dieselbe Rechnung wie der Tresor
  im Desktop-Programm.
* Sitzungs-Keks, mit HMAC unterschrieben, `HttpOnly`, `SameSite=Lax`, 14 Tage.
  Mit `NOTIZMAPPE_HTTPS=1` zusätzlich `Secure`.
* **Bremse**: ab dem vierten Fehlversuch steigende Wartezeit bis 5 Minuten.
  Ob ein Name existiert, verrät die Seite nicht — die Antwort ist immer dieselbe,
  und gerechnet wird auch bei unbekannten Namen (sonst wäre es an der Zeit zu
  sehen).
* Jeder Aufruf an die Brücke braucht den Kopf `X-Notizmappe: 1`. Den kann eine
  fremde Seite nicht mitschicken, ohne vorher um Erlaubnis zu fragen — das und
  `SameSite` sind der Schutz dagegen, dass eine andere Seite hier etwas auslöst.
* **Positivliste**, keine Verbotsliste: nur die Methoden in `ERLAUBT` sind
  erreichbar. Kommt im Desktop eine dazu, ist sie hier erst einmal gesperrt.
  Gesperrt sind unter anderem die Dateidialoge, das Umstellen des Datenordners,
  die Updates (am Server ist das `docker pull`) und `anhang_oeffnen` — das würde
  sonst ein Programm **auf dem Server** starten.

### HTTPS

Im Image steckt kein Reverse Proxy. Steht einer davor (nginx, Caddy), dann
`NOTIZMAPPE_HTTPS=1` setzen. Im eigenen Netz ohne Zertifikat muss es `0`
bleiben, sonst wirft der Browser den Keks weg und niemand kommt hinein.

Beispiel nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:8112;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 48m;          # Anhänge kommen als Base64 durch
}
```

## Rechte am Ordner `daten`

Darum muss sich normalerweise niemand kümmern: der Server richtet sich beim
Start nach dem **Eigentümer** von `/daten`. Gehört `./daten` dir (ein
Bind-Mount), läuft er unter deiner Nummer; ist es ein frisches Docker-Volume,
übernimmt der eingebaute Benutzer. Passt es trotzdem nicht, helfen `PUID` und
`PGID` in der `docker-compose.yml`.

Der Start läuft als root, legt die Rechte ab und übergibt dann an uvicorn — der
Serverprozess selbst läuft nie als root. Im Protokoll steht, was er gewählt hat:

```
[start] läuft als 1000:1000, Daten in /daten
```

Warum das überhaupt eine eigene Zeile wert ist: ohne Schreibrecht kommt die
Seite ganz normal hoch, die Anmeldung sieht richtig aus — und gespeichert wird
**stumm nichts**. Genau so ist es beim ersten Probelauf passiert. Deshalb macht
der Start jetzt eine Schreibprobe und bricht mit einer klaren Zeile ab, statt
scheinbar zu laufen.

## Was der Server nicht kann (und warum)

* **Die Sperre aus dem Desktop** (Passwort + Verschlüsselung der Dateien). Der
  Tresorschlüssel liegt im Prozess, und das passt nicht zu mehreren Sitzungen.
  Am Server ist die Anmeldung die Sperre. Liegt in einem Benutzerordner eine
  verschlüsselte Mappe, sagt der Server das — er zeigt keine leeren Seiten.
* **Anhänge „mit Programm öffnen"**. Das würde auf dem Server passieren und
  nicht bei dir. Der Stellvertreter macht daraus einen Download.
* **Updates per Knopf.** `docker pull && docker compose up -d`.
* Die **Schriftliste** ist die des Containers, nicht die deines Rechners — der
  Server kann nicht wissen, was bei dir installiert ist. Im Image sind DejaVu
  und Liberation dabei.

## Tests

```bash
DESKTOP_PFAD=../notizmappe tests/alle.sh   # gegen den Arbeitsordner nebenan
tests/alle.sh                              # gegen die Fassung aus DESKTOP_VERSION
```

`test_server.py` fährt Anmeldung, Bremse, Positivliste, Download und vor allem
die **Trennung der Benutzer** durch: zwei Zugänge, und der eine kommt nicht an
die Notizen des anderen — auch nicht, wenn er den Pfad kennt.

## Wie es innen aussieht

```
web/server.py        Anmeldung, Sitzungen, /bruecke/<name>, Download
web/benutzer.py      Zugänge: anlegen, prüfen, Passwort setzen (scrypt)
web/shim.js          der Stellvertreter für window.pywebview.api
web/*.html           Anmelden, Einrichten, Benutzerverwaltung - mit der stil.css
                     des Desktops, damit es aussieht wie das Programm
tools/desktop_holen.sh   holt das Desktop-Programm in fester Fassung
DESKTOP_VERSION      welche Fassung das ist
```

Die Brücke läuft hinter einer Sperre: `speicher.wurzel()` liest
`NOTIZEN_ORDNER` bei jedem Aufruf, also wird er je Aufruf gesetzt. Dadurch
laufen die Aufrufe hintereinander statt gleichzeitig. Bei einer Handvoll Leuten
und JSON-Dateien von ein paar Kilobyte ist das keine Bremse — und es ist der
einzige Weg, der **ohne Änderung am Desktop-Programm** auskommt.
