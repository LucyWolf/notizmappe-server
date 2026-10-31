# Notizmappe — Serverfassung

Die [Notizmappe](https://github.com/LucyWolf/notizmappe) über eine Webadresse,
mit Anmeldung, in Docker. Jeder Benutzer hat seinen eigenen Notizordner.

Stand: 31.10.2026

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
Einrichtungsseite: der erste Zugang wird gleich der **Verwalter**.

## Benutzer und Rollen

Wer angemeldet ist und was diese Rolle darf, steht im **Profil** — unten
links auf den Namen klicken. Für Verwalter steht unter **Datei → Optionen**
alles andere: Benutzer anlegen, einladen, Projekte, Rollen zuweisen.

Es gibt **drei Rollen**, mehr nicht:

| Rolle | darf |
|---|---|
| **Verwalter** | alles: eigene Notizen, Benutzer anlegen, einladen, Projekte. Davon darf es mehrere geben — so kann jemand einspringen |
| **Benutzer** | eigene Notizen vollständig; in Projekten so viel, wie dort für ihn eingestellt ist |
| **Gast** | nur mitlesen |

Selbstgebaute Rollen mit angehakten Einzelrechten gab es einmal und sind wieder
weg: das ist, was große Firmen brauchen. Hier hat jeder seine eigenen Notizen
und arbeitet manchmal zusammen — wer mehr oder weniger dürfen soll, wird **im
Projekt** eingestellt, und wer einspringen können soll, wird einfach auch
Verwalter.

Intern prüft der Server weiterhin je Methode ein Recht (lesen, schreiben,
anhaenge, loeschen, verlauf, benutzer) — das ist die Durchsetzung. Es ist nur
nichts mehr, was jemand zusammenklicken muss.

Wer aus einer früheren Fassung eine eigene Rolle oder „Moderator" hatte, wird
beim nächsten Lesen zu **Benutzer** — außer er durfte verwalten, dann zu
**Verwalter**. Niemand verliert dabei seinen Zugang.

## Projekte: zusammen an etwas arbeiten

Jeder Zugang hat seine **eigenen Notizen**, die niemand sonst sieht — auch kein
Verwalter. Ein **Projekt** ist daneben ein geteilter Bereich mit eigenen
Notizbüchern, an dem mehrere arbeiten.

Oben im Band steht, wo man gerade ist, und daneben die Auswahl zum Umschalten:
*Meine Notizen* oder eines der Projekte. Angelegt und besetzt werden sie unter
**Datei → Optionen**.

Jedes Mitglied hat im Projekt ein eigenes Recht:

| | |
|---|---|
| `lesen` | mitlesen, nichts ändern |
| `schreiben` | schreiben, anlegen, anhängen |
| `verwalten` | dazu löschen, Verlauf — und Mitglieder setzen |

**Es gilt immer das Schwächere von beidem.** Wer als *Gast* angemeldet ist,
darf auch in einem Projekt nichts schreiben, in dem er „verwalten" hat; und eine
mächtige Rolle nützt nichts, wenn man im Projekt nur lesen darf. Das wird am
Server durchgesetzt und im Test an genau diesem Fall geprüft.

Projekte anlegen darf, wer das Recht `projekte` hat. Wer in einem Projekt
`verwalten` ist, darf dort Mitglieder setzen, ohne Verwalter zu sein — sonst
müsste für jede Kleinigkeit jemand von oben kommen. Den letzten Verwalter eines
Projekts kann niemand hinauswerfen.

Die Rechte werden **am Server durchgesetzt**, nicht in der Oberfläche: jede
Brückenmethode hat ein Recht, das sie braucht. Ein Recht, das man mit einem
eigenen Aufruf umgehen kann, wäre keins — deshalb prüft der Test genau das.

Zwei Sperren gegen Aussperren: der letzte Zugang mit dem Recht `benutzer` lässt
sich weder entfernen noch entmachten, und eine Rolle, die noch jemand hat, lässt
sich nicht löschen.

Dieser Abschnitt wird von `shim.js` in die Einstellungen **eingesetzt** — am
Desktop gibt es keine Benutzer, dort hätte er nichts zu zeigen. Das ist der eine
Unterschied, den die Serverfassung haben darf; die Seite selbst bleibt dieselbe.

Ohne Oberfläche geht es auch: die Seite `/benutzer` gibt es weiterhin.

Selbst bauen statt das fertige Image ziehen: in `docker-compose.yml` `image:`
auskommentieren und `build: .` setzen.

## Zwei Schritte beim Anmelden

Unter **Datei → Optionen → Zwei Schritte beim Anmelden** richtet sich jeder für
seinen eigenen Zugang ein. Die Reihenfolge ist Absicht:

1. **QR-Code** in eine Authenticator-App einlesen (oder das Geheimnis abtippen).
2. **Zehn Notfallcodes** werden gezeigt — *bevor* etwas eingeschaltet wird. Sie
   erscheinen danach nie wieder und sind der Weg hinein, wenn das Telefon weg
   ist. Jeder gilt genau einmal.
3. **Erst mit einem gültigen Code aus der App wird eingeschaltet.** Wer sein
   Geheimnis nie in die App bekommen hat, sperrt sich sonst selbst aus.

Beim Anmelden kommt danach ein zweiter Schritt. Der Zwischenzustand ist ein
eigener, anders unterschriebener Keks: er **öffnet nichts**, verfällt nach fünf
Minuten und merkt sich nur, wer gerade beim zweiten Schritt steht. Auch die
Brücke bleibt bis dahin zu, und Fehlversuche laufen in dieselbe Bremse wie beim
Passwort.

Verliert jemand Telefon **und** Notfallcodes, kann ein Verwalter die zwei
Schritte für ihn abschalten. Einrichten dagegen muss jeder selbst — das
Geheimnis gehört in seine App und sonst nirgendwohin.

TOTP ist selbst geschrieben (RFC 6238, dreißig Zeilen `hmac` und `struct`), der
QR-Code kommt von `segno`: reines Python, keine Bildbibliothek. Der Code ist
schwarz auf weiß, auch in dunkler Oberfläche — manche Kameras lesen umgekehrte
QR-Codes nicht.

Auch aus dem **Fenster** heraus funktioniert das: meldet man sich dort an einem
Server mit zwei Schritten an, erscheint das Feld für den Code gleich darunter.

## Aktualisieren

In der Oberfläche unter **Datei → Informationen**: „Nach Updates sehen", und
wenn es etwas gibt, **„Jetzt aktualisieren"**. Der Server holt die neue Fassung,
prüft sie, startet neu und die Seite lädt sich von allein wieder.

Ein Container kann sich nicht durch ein neues Image ersetzen — aber er kann
seinen *Inhalt* erneuern. Das Nachgeladene liegt neben den Notizen:

```
daten/.programm/<fassung>/web/          die HTTP-Schicht
daten/.programm/<fassung>/desktop/app/  Oberfläche und Ablage
daten/.programm/aktiv                   welche Fassung gelten soll
```

`start.py` startet von dort, wenn die Fassung neuer ist als die im Image. Der
Weg zurück ist ein gelöschter Ordner — oder der Knopf, der die Überlagerung
fallen lässt.

**Warum nicht der Docker-Socket:** wer ihn hat, ist root auf dem Rechner. In
einem Container, der eine Weboberfläche ins Netz stellt, wird damit jede Lücke
in der Anmeldung zur Übernahme des ganzen Rechners. In `phobos-bot` ist er aus
genau dem Grund wieder ausgebaut worden.

### Wenn die neue Fassung nicht läuft

Das ist der Fall, der sonst zur Sackgasse würde: ohne Oberfläche gibt es keinen
Knopf mehr, mit dem man es zurücknimmt. Deshalb zählt `start.py` die Anläufe,
und der Server quittiert einen Start erst, wenn er wirklich antwortet. Nach zwei
Fehlstarts fliegt die Überlagerung von allein raus:

```
[start] nachgeladene Fassung 1.1.84 (Anlauf 2)
[start] Fassung 1.1.84 ist 2x nicht hochgekommen - wird verworfen,
        es gilt wieder die aus dem Image.
```

Danach läuft wieder die Fassung aus dem Image, mit allen Notizen. Durchgespielt
wird das in `tests/test_selbst.py` und einmal von Hand an einem echten
Container.

### Was nicht geht

Braucht eine neue Fassung **andere Pakete**, sagt der Knopf das und tut nichts —
`pip` läuft im laufenden Container nicht und soll es auch nicht. Dann ist es ein
Fall für ein neues Image:

```bash
docker compose pull && docker compose up -d
```

Geholt wird ausschließlich über HTTPS von den beiden eigenen Repos, mit
Größengrenze, ohne `../` oder Symlinks beim Auspacken, und jede `.py` wird
übersetzt, bevor die Fassung überhaupt gilt. Auslösen darf das nur, wer Benutzer
verwalten kann.

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

## NAS als Ablage

Der Datenordner muss nicht auf der Platte des Docker-Rechners liegen. Der
Container braucht dafür **keine** Sonderrechte — eingehängt wird entweder vom
Rechner selbst oder von Docker.

### Weg 0: in der Oberfläche einstellen

Unter **Datei → System → Wo die Notizen liegen** lässt sich die Freigabe direkt
eintragen: Art (Volume / SMB / NFS), Rechnername, Freigabe, Benutzer, Passwort.
Nur Verwalter sehen den Abschnitt.

Eingehängt wird dabei **nicht sofort**, sondern beim nächsten Start — der
laufende Serverprozess hat die Rechte dafür längst abgelegt, und soll sie auch
nicht haben. `start.py` erledigt es in dem kurzen Moment, in dem er noch root
ist. Nach dem Speichern also:

```bash
docker compose restart notizmappe
```

Dafür braucht der Container eine Fähigkeit, die **nicht** von allein gesetzt
ist — in `docker-compose.yml` beim Dienst `notizmappe`:

```yaml
    cap_add:
      - SYS_ADMIN
```

Ohne sie lässt sich alles eintragen, es passiert nur nichts; die Oberfläche
sagt genau das, statt stumm zu schweigen.

**Was man damit aufgibt:** `SYS_ADMIN` erlaubt Mounts im Container. Das ist ein
ordentlicher Hebel — deutlich weniger als der Docker-Socket, der direkt root auf
dem Rechner wäre, aber mehr als nichts. Wer das nicht möchte, nimmt Weg 1: die
Freigabe auf dem Rechner einhängen und mit `NOTIZMAPPE_ABLAGE` daraufzeigen.
Dann bleibt der Container so unbeteiligt wie bisher.

Geht das Einhängen schief, **startet der Server trotzdem** und arbeitet mit dem
Volume weiter. Was passiert ist, steht danach in der Oberfläche, nicht nur im
Protokoll:

```
nas.fritz.box ist eingehängt.
```

Die Einstellung liegt in einem eigenen Volume `./einrichtung`, nicht in
`./daten` — sonst wäre sie verschwunden, sobald die Freigabe darüber hängt. Das
Passwort steht in `einrichtung/smb-zugang` mit `0600` und geht nie über die
Kommandozeile, wo es in der Prozessliste stünde.

### Weg 1: die Freigabe ist schon eingehängt

Hängt die NAS auf dem Rechner bereits (fstab, systemd, autofs), genügt eine
Zeile in einer Datei `.env` neben der `docker-compose.yml`:

```
NOTIZMAPPE_ABLAGE=/mnt/nas/notizmappe
```

Dann `docker compose up -d`. Ohne diese Zeile bleibt es bei `./daten`.

### Weg 2: Docker hängt sie selbst ein

```bash
cp docker-compose.override.yml.beispiel docker-compose.override.yml
$EDITOR docker-compose.override.yml
docker compose up -d
```

Compose liest die `override`-Datei von allein dazu, ein extra Schalter ist nicht
nötig. Sie steht in `.gitignore` — und genau dort gehören die Zugangsdaten hin,
denn die `docker-compose.yml` liegt im Repo. Wer sein NAS-Passwort dort einträgt
und pusht, hat es auf GitHub stehen.

Noch besser als das Passwort in der Datei ist eine eigene Zugangsdatei, auf die
die Mount-Optionen zeigen:

```bash
printf 'username=notizmappe\npassword=GEHEIM\n' > .smb-zugang
chmod 600 .smb-zugang
```

(`.smb-zugang` steht ebenfalls in `.gitignore`.)

### SMB: die Rechte greifen nicht

Das ist der Punkt, an dem man sich etwas einbildet, was nicht da ist. Auf einer
SMB-Freigabe setzen die **Mount-Optionen** die Rechte fest — `chmod 0600` im Code
läuft durch, ohne zu wirken. Ohne `file_mode=0600,dir_mode=0700` liegen
`benutzer.json` **und `.sitzungsschluessel`** für jeden lesbar auf der Freigabe.
Der Sitzungsschlüssel ist dabei der schlimmere Fund: damit lässt sich ein
gültiger Keks für **jeden** Zugang bauen, ohne ein Passwort zu kennen — auch an
der Zwei-Schritte-Anmeldung vorbei.

`uid`/`gid` der Mount-Optionen müssen zu `PUID`/`PGID` passen. Der Start prüft
das jetzt mit und schreibt eine Warnung ins Protokoll, wenn eine mit `0600`
angelegte Datei anders auf der Ablage landet:

```
[start] ACHTUNG: eine mit 0600 angelegte Datei liegt als 0644 in /daten.
```

Bei **NFS** greifen die Rechte normal, solange die Freigabe die passende
uid durchlässt. Dort `hard` nehmen, nicht `soft` — sonst bricht ein Schreibvorgang
bei einer Netzstörung ab, statt zu warten.

**Nur ein Server pro Freigabe.** Die Sperre im Code gilt innerhalb des Prozesses,
nicht über das Netz. Zwei Container auf derselben Ablage zerschießen sich
gegenseitig Dateien.

### FTP geht dafür nicht

Jede Seite wird über eine Hilfsdatei und `os.replace` geschrieben — damit ist beim
Speichern immer entweder die alte oder die neue Seite da, nie eine halbe. FTP
kennt kein garantiert atomares Umbenennen und keine Dateisperren: ein Abbruch
mitten im Speichern hinterlässt Bruchstücke. Dazu kommt eine Netzrunde pro Datei,
und ohne FTPS gehen die Zugangsdaten im Klartext durchs Netz.

Als **Ziel für eine Sicherung** ist FTP dagegen in Ordnung — dort wird eine
fertige Datei einmal abgelegt, nicht laufend in Stücken geschrieben.

### Was eine NAS löst, und was nicht

Eine NAS schützt gegen **Datenverlust** (RAID, Snapshots, Papierkorb). Gegen
**Mitlesen** schützt sie nicht, sondern verschlechtert die Lage: die Notizen
liegen dann auf einem zweiten Gerät im Netz, und bei SMB ohne `file_mode` sogar
offen. Wer beides will, verschlüsselt die Ablage und lässt den Schlüssel auf dem
Docker-Rechner — dann hat jemand mit Zugriff auf die Freigabe nur Kauderwelsch.

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

## Passwort vergessen

Der einzige Weg in einen Zugang hinein, der ohne Passwort auskommt — deshalb
eng gebaut:

1. **E-Mail im eigenen Profil** eintragen (Profilfenster, freiwillig). Ohne
   Adresse geht nichts zurückzusetzen; dann hilft nur ein Verwalter.
2. **Mailversand einrichten**: Datei → Optionen → *Mailversand* (nur Verwalter).
   Server, Port, Verschlüsselung, Anmeldung, Absender und die **Adresse dieses
   Servers**. Daneben steht ein Knopf für eine Testnachricht an die eigene
   Adresse — sonst merkt man den Tippfehler erst, wenn jemand sein Passwort
   braucht.
3. Auf der Anmeldeseite steht dann **„Passwort vergessen?"**.

Was dabei absichtlich so ist:

* Die Antwort auf „Link schicken" ist **immer dieselbe**, auch bei einem Namen,
  den es nicht gibt. Sonst wäre die Seite eine Auskunft darüber, welche Zugänge
  es gibt.
* Die Marke im Link steht **gehasht** in `benutzer.json`, gilt **30 Minuten**
  und **genau einmal**. Höchstens drei Anforderungen je Zugang und Stunde.
* Nach dem Setzen sind **alle offenen Sitzungen** dieses Zugangs abgemeldet.
* Die Adresse im Link kommt aus den Einstellungen, **nicht** aus dem Host-Kopf
  der Anfrage. Sonst könnte jemand den Server dazu bringen, einen Link auf
  seinen eigenen Rechner zu verschicken und dort das neue Passwort abzufangen.
* Eine neue E-Mail-Adresse macht offene Marken wertlos.

### Nachricht bei Anmeldeversuchen

Wer eine Adresse hinterlegt hat, bekommt Bescheid, wenn jemand an seinem Zugang
scheitert. Drei Stufen im Profil: **nur fehlgeschlagene** (Voreinstellung),
**jede Anmeldung**, **gar nicht**. Gemeldet wird auch ein falscher Code beim
zweiten Schritt — das ist ein Versuch von jemandem, der das Passwort schon hat.

Höchstens **eine Nachricht je Viertelstunde**; in der nächsten steht, wie viele
Versuche dazwischen lagen. Ohne diese Bremse schickt ein Durchprobieren im
Minutentakt Mail, und wer das einmal erlebt hat, schaltet es ab — dann fällt
auch der echte Einbruch nicht mehr auf.

Verschickt wird **nach** der Antwort, nicht davor. Sonst dauerte ein
Fehlversuch an einem echten Zugang messbar länger als an einem erfundenen
Namen, und die Anmeldeseite wäre über die Zeit doch wieder eine Auskunft
darüber, welche Zugänge es gibt.

In der Nachricht steht die Adresse, die **der Server** sieht. Steht ein Reverse
Proxy davor, ist es dessen Adresse.

**Das SMTP-Passwort liegt im Klartext** in `daten/.post.json` (Datei auf 0600).
Anders geht es nicht: der Server muss sich damit anmelden, und was er selbst
wieder lesbar machen kann, ist nicht verschlüsselt, sondern nur versteckt. Wer
an die Datei kommt, hat das Mailkonto — das sollte man wissen, bevor man dort
die Zugangsdaten des Hauptpostfachs einträgt. Ein eigenes Konto nur für diesen
Zweck ist die bessere Wahl.

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

## 3D-Dateien in der Notiz

Ein Anhang mit `.stl` oder `.obj` wird nicht als Kachel gezeichnet, sondern als
Modell: **ziehen dreht, Rad zoomt, Doppelklick stellt die Ansicht zurück**.
Darunter bleibt die Zeile mit Name, Größe und Dreieckszahl — ein Klick darauf
lädt die Datei weiterhin herunter.

Das ist **kein neuer Elementtyp**. Der Kasten bleibt ein Datei-Kasten, nur sein
Inhalt wird ausgetauscht. Am Format der Notizen ändert sich dadurch nichts:
dieselbe Seite im Desktop-Programm zeigt weiter die Kachel, und eine ältere
Fassung stolpert nicht über etwas Unbekanntes.

Gezeichnet wird mit WebGL, ohne fremde Bibliothek — STL ist Kopf, Anzahl und
50 Byte je Dreieck, OBJ sind Zeilen mit `v` und `f`. Entsprechend gibt es ein
graues Modell wie im Slicer: keine Farben, keine Materialien.

* **3MF und STEP gehen nicht.** 3MF ist ein ZIP, STEP ist Kurvenmathematik und
  braucht einen eigenen Kern.
* **Geladen wird erst, wenn das Modell ins Bild rollt** — zehn Anhänge auf
  einer Seite wären sonst zehn Dateien auf einmal.
* **Gleichzeitig leben vier Modelle.** Mehr 3D-Flächen gibt ein Browser pro
  Seite nicht her; die übrigen stehen als Standbild da und wachen beim Klick
  wieder auf.
* Die Grenze für Anhänge (25 MB) gilt auch hier. Darüber, oder wenn in der
  Datei keine Dreiecke stehen, bleibt die Kachel stehen — der Grund steht im
  Tooltip des Kastens.

## Was der Server nicht kann (und warum)

* **Die Sperre aus dem Desktop** (Passwort + Verschlüsselung der Dateien). Der
  Tresorschlüssel liegt im Prozess, und das passt nicht zu mehreren Sitzungen.
  Am Server ist die Anmeldung die Sperre. Liegt in einem Benutzerordner eine
  verschlüsselte Mappe, sagt der Server das — er zeigt keine leeren Seiten.
* **Anhänge „mit Programm öffnen"**. Das würde auf dem Server passieren und
  nicht bei dir. Der Stellvertreter macht daraus einen Download.
* **Updates per Knopf.** Unter *Datei → Informationen* steht aber, welche
  Fassung hier läuft und ob es eine neuere gibt — samt der beiden Befehle:
  `docker compose pull` und `docker compose up -d`. Dass es etwas zu holen
  gibt, soll man sehen, ohne es zu wissen.
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
