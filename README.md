# Notizmappe — Serverfassung

Die [Notizmappe](https://github.com/LucyWolf/notizmappe) über eine Webadresse,
mit Anmeldung, in Docker. Jeder Benutzer hat seinen eigenen Notizordner; wer
zusammen an etwas arbeitet, bekommt ein [Projekt](#projekte-zusammen-an-etwas-arbeiten).

Stand: 03.11.2026

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

### Was sich geändert hat, steht mit **!** da

In einem Projekt arbeiten mehrere im selben Ordner. Hat jemand anders eine
Seite geändert oder eine neue angelegt, steht in der Leiste hinter ihr ein
**!** — und auch hinter dem Abschnitt und dem Notizbuch darüber, denn
zugeklappt sieht man die Seite sonst gar nicht. Beim Daraufzeigen steht, wie
viele es darunter sind. Aufmachen lässt das Zeichen verschwinden.

Beim Daraufzeigen steht auch, **wer** es war. Den Namen trägt der Server beim
Speichern ein, nicht die Oberfläche — so kann sich niemand als jemand anderes
eintragen. Er steht im Feld, in dem am eigenen Rechner die Zufallskennung des
Browsers steht („Gerät 7f3k2a9"); die sagt zu Hause etwas und im Projekt
niemandem. Deshalb heißt es an einer offenen Seite jetzt auch
*„anna hat diese Seite geändert"* statt *„Neuere Fassung vom Sync da"* — in
den eigenen Notizen bleibt der alte Text, dort ist die Gerätenummer die
richtige Auskunft.

Wer selbst speichert, anlegt oder umbenennt, bekommt kein Zeichen an seiner
eigenen Arbeit. Und wer neu in ein Projekt kommt, findet nicht hinter jeder
Seite eines: beim ersten Blick gilt alles als gesehen. Ein Zeichen, das
überall steht, sagt nichts.

Gemerkt wird das **je Benutzer**, in seinem Konfigordner (`gesehen.json`), und
nicht in der Seite. Eine Leseliste in der Seite wäre eine Änderung an der
Seite — jedes Aufmachen würde die Datei anfassen und bei allen anderen als
neue Änderung auftauchen: ein Zeichen, das sich selbst erzeugt. In den eigenen
Notizen gibt es das alles nicht, dort ändert nur einer etwas.

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

### Per SSH, wenn über den Browser nichts mehr geht

Jemand hat sein Passwort vergessen und keine Mailadresse hinterlegt, der
zweite Schritt hängt an einem Telefon, das weg ist, oder der letzte Verwalter
kommt nicht mehr hinein — dann hilft `web/verwalten.py`:

```bash
docker exec -it notizmappe python3 /srv/web/verwalten.py liste
docker exec -it notizmappe python3 /srv/web/verwalten.py passwort anna
docker exec -it notizmappe python3 /srv/web/verwalten.py zweischritt-aus anna
docker exec -it notizmappe python3 /srv/web/verwalten.py rolle anna Verwalter
```

Ohne Docker, direkt auf dem Datenordner (`--daten` steht **vor** dem Befehl):

```bash
python3 web/verwalten.py --daten ./daten liste
```

| Befehl | |
|---|---|
| `liste`, `rollen`, `projekte` | nachsehen, ändert nichts |
| `passwort <name>` | fragt zweimal; `--passwort X` für Skripte (steht dann im Shell-Verlauf) |
| `anlegen <name> [--rolle X]` | neuer Zugang |
| `entfernen <name>` | Zugang weg, **Notizen bleiben liegen** |
| `rolle <name> <Rolle>` | Rolle zuweisen |
| `zweischritt-aus <name>` | zweiten Schritt abschalten |
| `mitglied <projekt> <name> <recht>`, `mitglied-raus` | Projekte besetzen |

Gerechnet wird mit denselben Funktionen wie im Server, nicht mit eigenen:
**die Sperren gelten auch hier.** Den letzten Zugang, der Benutzer verwalten
darf, entfernt auch dieses Werkzeug nicht — sonst wäre die Mappe zu, und
daraus hilft kein Werkzeug mehr heraus. Ein neues Passwort wirft nebenbei
alle offenen Sitzungen dieses Benutzers weg: die Sitzungsmarke wird aus dem
Hash gerechnet.

Läuft es als `root` (etwa über `sudo`), gleicht es den Eigentümer von
`benutzer.json` hinterher dem Datenordner an. Sonst gehört die Datei danach
`root`, der Server läuft unter einer anderen Nummer — und das fällt erst auf,
wenn das nächste Mal jemand sein Passwort ändern will.

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

## Verlauf: jede Änderung, ein Jahr lang

Am Desktop wird der Verlauf ausgedünnt — höchstens alle zehn Minuten eine
Fassung, nach einem Tag nur noch eine je Tag, nach einem Monat eine je Woche,
nach 90 Tagen nichts mehr. Das passt zu einem Rechner, auf dem eine Platte
voll werden kann.

Hier gilt: **alles bleibt, ein Jahr lang.** Geändert wird dafür nichts am
Desktop-Programm — [web/verlauf.py](web/verlauf.py) setzt beim Start die
eigene Regel an die Stelle der alten. Mit `NOTIZMAPPE_VERLAUF_TAGE` lässt sich
die Zeit einstellen.

Zwei Sachen, die man dazu wissen sollte:

* **Feiner als eine Sekunde geht es nicht.** Eine Fassung heißt nach ihrem
  Zeitpunkt (`20261101-143052.json`), und die Oberfläche speichert 900 ms nach
  der letzten Eingabe. „Jede Änderung" heißt also: jede Sekunde, in der sich
  etwas geändert hat. Wer eine Stunde am Stück schreibt, kann damit bis zu
  3600 Fassungen einer Seite bekommen — eine Seite mit viel Text ist einige
  Kilobyte groß, das summiert sich.
* **Aufgeräumt wird höchstens einmal am Tag je Seite.** Drüben liest das
  Wegräumen bei jedem Speichern den ganzen Ordner; bei zehntausend Fassungen
  hinge daran jedes Speichern. Jeder Verlaufsordner merkt sich deshalb in
  `.geputzt`, wann er zuletzt durchgesehen wurde.

Die Liste im Verlauf-Fenster zeigt alles, was da ist — bei viel Arbeit an
einer Seite wird sie entsprechend lang.

## Was wo liegt

Alles, was bleiben muss, liegt im Volume `./daten`:

```
daten/benutzer.json         Zugänge; Passwörter als scrypt-Hash, nie im Klartext
daten/.sitzungsschluessel   unterschreibt die Sitzungs-Kekse (0600)
daten/.programm/            nachgeladene Fassungen (siehe Aktualisieren)
daten/notizen/<benutzer>/   die Notizen - dieselbe Ablage wie am Desktop
daten/projekte/<projekt>/   die Notizen eines Projekts, allen Mitgliedern gemeinsam
daten/konfig/<benutzer>/    je Benutzer:
    einstellungen.json        was am Desktop „dieser Rechner" wäre (Schriften)
    aussehen.json             hell oder dunkel
    bereich.json              in welchem Bereich er zuletzt war
    gesehen.json              was er in welchem Projekt zuletzt gesehen hat
```

Daneben liegt `./einrichtung` als **eigenes** Volume. Darin steht nur eine
Marke: dass dieser Server schon einmal eingerichtet war. Sie liegt getrennt
von den Notizen, weil `daten` auf eine NAS-Freigabe zeigen kann — hängt die
nicht ein, wäre der Datenordner leer, und die Einrichtungsseite stünde wieder
offen.

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

### Wer darf sagen, woher eine Anfrage kommt

Die Bremse gegen Durchprobieren zählt je **Herkunft und Name**. Steht ein
Proxy davor, kommt die Herkunft aus `X-Forwarded-For` — und wem der Server
dabei glaubt, entscheidet `NOTIZMAPPE_PROXY`.

Ohne Angabe gelten private Adressen als Proxy (`127.0.0.1`, `10.x`,
`172.16–31.x`, `192.168.x`, IPv6-ULA). Dann nimmt der Server die Adresse, die
der eigene Proxy angehängt hat; was der Anfragende selbst in den Kopf
schreibt, zählt nicht. Steht der Proxy woanders, hier eintragen.

`NOTIZMAPPE_PROXY: "*"` heißt *jedem glauben* — damit kann sich jeder eine
Herkunft ausdenken, und die Bremse ist ausgehängt. Das war bis v1.2.17 die
Voreinstellung.

### HTTPS

Im Image steckt kein Reverse Proxy. Steht einer davor (nginx, Caddy), dann
`NOTIZMAPPE_HTTPS=1` setzen. Im eigenen Netz ohne Zertifikat muss es `0`
bleiben, sonst wirft der Browser den Keks weg und niemand kommt hinein.

Beispiel nginx — **vollständig**, die drei Weiterleitungs-Zeilen gehören
zusammen:

```nginx
server {
    listen 443 ssl;
    server_name notizen.beispiel.de;

    # Zertifikat hier (certbot trägt das selbst ein)

    add_header Strict-Transport-Security "max-age=63072000" always;

    location / {
        proxy_pass http://127.0.0.1:8112;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 48m;      # Anhänge kommen als Base64 durch
    }
}
```

**`X-Forwarded-For` ist keine Kosmetik.** Ohne diese Zeile sieht der Server
für jeden Zugriff `127.0.0.1`. Die Bremse gegen Durchprobieren zählt je
Herkunft **und** Name — ist die Herkunft für alle dieselbe, kann ein Fremder
dich aus deinem eigenen Zugang aussperren, indem er oft genug mit deinem
Namen danebenliegt. Er braucht das Passwort gar nicht zu erraten, nur Geduld.

**Und der Port gehört zugeklebt.** In `docker-compose.yml` steht
`"8112:8000"` — das lauscht auf allen Adressen. Wer `http://server:8112`
direkt aufruft, geht an nginx vorbei: ohne TLS, und der Sitzungs-Keks hat
dann kein `Secure`. Steht nginx auf demselben Rechner:

```yaml
ports:
  - "127.0.0.1:8112:8000"
```

### Kopfzeilen

Jede Antwort bekommt eine **Content-Security-Policy**, dazu `X-Frame-Options`,
`X-Content-Type-Options: nosniff` und `Referrer-Policy: no-referrer`. Das ist
die zweite Reihe hinter dem Reiniger: `frame-ancestors 'none'` verhindert,
dass jemand die Mappe in einen fremden Rahmen setzt und der Besucher in
Wahrheit hier klickt.

Skripte laufen nur aus dem eigenen Haus. Das kurze Inline-Skript in
`index.html`, das Ladefehler fängt, steht mit seinem **sha256-Hash** in der
Regel — beim Start aus der Datei gerechnet, eine neue Desktop-Fassung bringt
also ihren eigenen Hash mit. `unsafe-inline` gibt es für Skripte nicht.

Für **Stile** gibt es das: die Oberfläche setzt ihre Stilblöcke zur Laufzeit.
Das ist der eine weiche Punkt der Regel — ein Stil kann keine Daten abholen.

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

## Listen: Zahl oder Zeichen davor

Beide Listenknöpfe haben einen Pfeil daneben. Er macht die Bibliothek auf —
**16 Nummernarten** von `1.` über `a)` und `(1)` bis `i.`, und **35
Aufzählungszeichen** von ● über ▪ und → bis ✓. Zuoberst steht „Keine": damit
ist die Liste wieder ein normaler Absatz.

Gespeichert wird das als **ein** Attribut an der Liste, `data-art="1)"`
beziehungsweise `data-art="●"`, und nur mit einem Wert aus einer festen Liste
(`web/listen.py`). Kein `style`, kein `class`: was sonst an einem Element
stehen dürfte, wäre ein Einfallstor — damit ließe sich ein unsichtbares Feld
über die Seite legen.

Angeboten werden nur Zeichen aus der Grundebene. Ein Emoji fällt in Schriften
aus, die es nicht haben, und dann steht ein Kästchen vor jeder Zeile.

Die Fensterfassung kennt das Attribut noch nicht. Sie zeigt eine so gesetzte
Liste mit ihren eigenen Zahlen, und wird die Seite **dort** gespeichert, ist
die Art weg. Der Text bleibt.

## Platinen: ein Gerber-ZIP in der Notiz

Hängt an einer Notiz ein **Gerber-Paket** (das ZIP, das man zur Platinenfirma
schickt), steht die Platine da statt der 📎-Kachel: Träger, Kupfer, Bohrungen
und Bestückungsdruck, **ziehen schiebt, Rad zoomt, Doppelklick stellt zurück**,
und ein Knopf oben rechts dreht sie auf die Unterseite.

Das Fenster ist so breit wie der Kasten; nur die **Höhe** richtet sich nach der
Platine — ein langes schmales Brett bekommt ein hohes Fenster, ein flaches ein
flaches. Rahmen, Rundung und Grund sind dieselben wie bei einem 3D-Modell, und
darunter steht dieselbe Kachel wie sonst — mit Maßen und Zahl der Bohrungen
dahinter.

Was im Umriss als geschlossener Zug **innerhalb** der Platine steht, ist ein
Ausschnitt und bleibt leer — ein Frässchlitz quer durch das Brett sieht
deshalb aus wie ein schwarzes Band, und das ist richtig so.

Gelesen werden die üblichen Endungen (GTL, GBL, GTO, GBO, GKO, DRL …) und die
Namen, die KiCad und EasyEDA vergeben. Ein ZIP ohne Gerber bleibt eine ganz
normale Kachel — ohne Meldung, es hat ja niemand eine Platine erwartet.

**Was hier nicht geht:** die Bauteile als Körper, so wie es JLCPCB im Browser
zeigt. Die stecken in keiner dieser Dateien; JLCPCB holt sie über die
Bauteilnummer aus seiner eigenen Bibliothek. Dafür müsste der Server bei jedem
Öffnen einer Notiz dorthin funken — und damit wären die Stücklisten aus einer
selbst gehosteten Mappe draußen im Netz.

## 3D-Dateien in der Notiz

Ein Anhang mit `.stl`, `.obj` oder `.fbx` wird nicht als Kachel gezeichnet,
sondern als Modell: **ziehen dreht, Umschalt-ziehen schiebt den Drehpunkt, Rad zoomt,
Doppelklick stellt die Ansicht zurück**. Geschoben wird dabei nicht nur das
Bild — der Punkt, um den gedreht wird, wandert mit. Sonst sieht man das Teil
zwar von der Seite, dreht aber weiter um seine alte Mitte und kommt an eine
Ecke nie heran.
Darunter bleibt die Zeile mit Name, Größe und Dreieckszahl — ein Klick darauf
lädt die Datei weiterhin herunter.

Das ist **kein neuer Elementtyp**. Der Kasten bleibt ein Datei-Kasten, nur sein
Inhalt wird ausgetauscht. Am Format der Notizen ändert sich dadurch nichts:
dieselbe Seite im Desktop-Programm zeigt weiter die Kachel, und eine ältere
Fassung stolpert nicht über etwas Unbekanntes.

Gezeichnet wird mit WebGL, ohne fremde Bibliothek — STL ist Kopf, Anzahl und
50 Byte je Dreieck, OBJ sind Zeilen mit `v` und `f`. Entsprechend gibt es ein
graues Modell wie im Slicer: keine Farben, keine Materialien.

**FBX** ist der Sonderfall: keine Datei mit einem Teil, sondern eine Szene aus
mehreren Objekten, jedes mit eigener Lage, Drehung und Größe an einem
Elternbaum. Beide Fassungen werden gelesen — binär (die Zahlenfelder sind
zlib-gepackt, das entpackt der Browser selbst) und Text. Die Lagen werden
mitgerechnet, sonst läge bei einem Avatar alles übereinander im Nullpunkt.

* **Von FBX kommt nur die Form.** Keine Materialien, keine Texturen, keine
  Knochen, keine Animation. Von den Lagen fehlen die Exoten: andere
  Drehreihenfolgen als XYZ, Dreh- und Skalierpunkte, Vererbungsarten. Ein
  normaler Export aus Blender oder Fusion steht richtig; bei einer Szene aus
  Maya kann etwas schief stehen.
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
* **Ein neues Image per Knopf.** Die Fassung *nachladen* geht (siehe
  [Aktualisieren](#aktualisieren)) — ein Container kann sich aber nicht selbst
  durch ein neues Image ersetzen. Braucht eine Fassung andere Pakete, sagt der
  Knopf das und tut nichts; dann sind es `docker compose pull` und
  `docker compose up -d`. Beides steht unter *Datei → Informationen*, samt der
  Befehle zum Mitnehmen.
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

`test_angriff.py` nimmt die andere Richtung: was jemand **in** eine Notiz
schreibt. Am Desktop liest man seine eigenen Notizen selbst; in einem Projekt
schreibt der eine und der andere macht die Seite auf — im selben Browser, in
dem auch seine Sitzung steht. Geprüft wird nicht der Reiniger für sich,
sondern der ganze Weg: 26 Muster über die Brücke gespeichert und von der
Platte zurückgelesen. Und die Gegenprobe dazu, dass Fett, Kursiv, Link und
Schriftgröße stehen bleiben — ein Reiniger, der alles wegwirft, bestünde
jeden Angriffstest und wäre trotzdem kaputt.

`test_tuer.py` nimmt die Stufe davor: **ohne Anmeldung überhaupt nichts.** Er
holt sich die Routen aus der App selbst und klopft an jede einzeln. Jede muss
entweder mit Begründung auf der Liste der öffentlichen Türen stehen oder einen
Unangemeldeten abweisen — eine neue Route, die die Prüfung vergisst, fällt
damit durch, ohne dass jemand daran denken muss. Dazu wird der Sitzungskeks in
seine Teile zerlegt: andere Unterschrift, anderer Name, längerer Ablauf, der
halbe Keks aus dem zweiten Schritt als ganzer ausgegeben, und ein alter Keks
nach einem Passwortwechsel. Nichts davon öffnet.

Die anderen prüfen je eine Sache, und jede steht wegen eines echten Fehlers da:

| | |
|---|---|
| `test_gleich.py` | dass Desktop und Server dieselbe Oberfläche sind — keine Kopien, Byte für Byte gleich, und die Stellen, an die sich `shim.js` hängt, gibt es drüben noch |
| `test_namen.py` | dass jeder gelesene Name irgendwoher kommt — in `shim.js` **und** in `web/*.py`. Eine vergessene Funktion sieht man dem Quelltext nicht an |
| `test_unsinn.py` | dass kein Aufruf einen 500er auslöst, egal was im Rumpf steht. Die Routen holt er sich aus der App selbst |
| `test_post.py` | Mailversand, Zurücksetzen, Benachrichtigung bei Anmeldeversuchen |
| `test_ablage.py` | NAS-Einstellungen: nichts, was in einer Mount-Option etwas anderes bedeuten könnte |
| `test_selbst.py` | das Nachladen einer Fassung und vor allem den Weg zurück |
| `test_verlauf.py` | dass am Server jede Änderung bleibt, ein Jahr lang — und dass nicht bei jedem Speichern der ganze Ordner durchgesehen wird |
| `test_leiste.py` | die Formatleiste: dass hinter jedem Knopf der richtige Befehl steckt, und dass im Rechtsklickmenü nicht zwei Leisten übereinander stehen |
| `test_angriff.py` | dass aus einer Notiz nichts ausbricht: 26 Angriffsmuster über die Brücke gespeichert und zurückgelesen, dazu Anhangnamen mit `../` |
| `test_tuer.py` | dass keine Route ohne Anmeldung antwortet und kein gebogener Keks öffnet |
| `test_verwalten.py` | Das Werkzeug für die Kommandozeile — und dass auch es den letzten Verwalter stehen lässt |
| `test_gruppe.py` | Das **!** in der Gruppe: wer es sieht, wer nicht, und an welcher Zeile es steht |
| `test_platine.py` | Gerber: ZIP auspacken, Koordinatenformat, Zoll, Bohrdatei — und ob die Platine am Ende wirklich im Bild liegt und von unten gespiegelt ist |
| `test_modell.py` | STL, OBJ und FBX einlesen, und ob das Teil wirklich im Bild liegt |
| `test_reiter.py`, `test_zerren.py`, `test_glaetten.py`, `test_balken.py` | Oberflächensachen in einem nachgebauten DOM: Reiter, Griffe, Glätten, Update-Balken |

## Wie es innen aussieht

```
web/start.py         fährt hoch: Rechte am Datenordner, Proxy-Liste, uvicorn
web/server.py        Anmeldung, Sitzungen, /bruecke/<name>, Download, Kopfzeilen
web/benutzer.py      Zugänge, Rollen, Projekte, zweiter Schritt (scrypt)
web/verwalten.py     dasselbe von der Kommandozeile, wenn der Browser nicht hilft
web/ablage.py        NAS-Freigabe einhängen
web/post.py          Mailversand: Zurücksetzen, Hinweis bei Anmeldeversuchen
web/verlauf.py       die Server-Regel für den Verlauf: alles bleibt, ein Jahr
web/listen.py        Aufzählungsarten durch den Reiniger lassen
web/neues.py         was in einer Gruppe seit dem letzten Blick anders ist
web/selbst.py        eine Fassung nachladen - und der Weg zurück
web/shim.js          der Stellvertreter für window.pywebview.api
web/*.html           Anmelden, Einrichten, Benutzerverwaltung - mit der stil.css
                     des Desktops, damit es aussieht wie das Programm
tools/desktop_holen.sh   holt das Desktop-Programm in fester Fassung
DESKTOP_VERSION      welche Fassung das ist
```

`listen.py` und `neues.py` zeigen, wie hier gearbeitet wird, wenn am Desktop
etwas fehlt: nicht in `desktop/` hineinschreiben, sondern beim Start die
Stelle ersetzen (`reinigen._Reiniger.handle_starttag`) oder die Antwort im
Vorbeigehen ergänzen (der Baum bekommt sein `neu`). Was in `desktop/` liegt,
ist beim nächsten `desktop_holen.sh` wieder überschrieben.

Die Brücke läuft hinter einer Sperre: `speicher.wurzel()` liest
`NOTIZEN_ORDNER` bei jedem Aufruf, also wird er je Aufruf gesetzt. Dadurch
laufen die Aufrufe hintereinander statt gleichzeitig. Bei einer Handvoll Leuten
und JSON-Dateien von ein paar Kilobyte ist das keine Bremse — und es ist der
einzige Weg, der **ohne Änderung am Desktop-Programm** auskommt.
