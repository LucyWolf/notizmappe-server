"""Was in einer Gruppe neu ist - und wer es sehen soll.

    .venv/bin/python tests/test_gruppe.py

Die Frage ist nicht "hat sich die Datei geändert", sondern "hat sich etwas
geändert, seit **ich** zuletzt hingesehen habe". Daran hängen vier Fallen,
und jede davon macht das Zeichen wertlos:

* Wer selbst speichert, darf hinterher kein Ausrufezeichen an seiner eigenen
  Seite haben. Sonst steht hinter jeder Seite, an der man arbeitet, eines.
* Wer neu in ein Projekt kommt, darf nicht hinter jeder Seite eines finden.
  Ein Zeichen, das überall steht, sagt nichts.
* Eine Seite, die jemand anderes neu angelegt hat, muss eines bekommen - und
  es muss stehen bleiben, bis man sie aufmacht. Wäre sie beim Hinsehen gleich
  als gesehen abgelegt, verschwände das Zeichen beim nächsten Laden von
  selbst, ohne dass jemand hingesehen hat.
* In den eigenen Notizen gibt es das alles nicht.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
DESKTOP = WURZEL / "desktop"
if not (DESKTOP / "app").is_dir():
    sys.exit(f"Erst das Desktop-Programm holen: {WURZEL}/tools/desktop_holen.sh")

DATEN = Path(tempfile.mkdtemp(prefix="notizgruppe-test-"))
os.environ["NOTIZMAPPE_DATEN"] = str(DATEN)
os.environ["NOTIZMAPPE_DESKTOP"] = str(DESKTOP)
os.environ["NOTIZMAPPE_QUELLE"] = "http://127.0.0.1:1"
os.environ.pop("NOTIZEN_ORDNER", None)
sys.path.insert(0, str(WURZEL / "web"))

from fastapi.testclient import TestClient                   # noqa: E402

import neues                                                # noqa: E402
import server                                               # noqa: E402

fehler = []


def pruefe(was, bedingung, extra=""):
    print(("  ok  " if bedingung else "FEHLER") + "  " + was
          + (f"   {extra}" if extra and not bedingung else ""))
    if not bedingung:
        fehler.append(was)


def baum_von(*seiten):
    """Ein Baum mit einem Notizbuch, einem Abschnitt und diesen Seiten."""
    return {"notizbuecher": [{"name": "Buch", "abschnitte": [
        {"name": "Teil", "seiten": [{"name": n, "titel": n, "geaendert": z}
                                    for n, z in seiten]}]}]}


def markiert(baum):
    return sorted(s["name"] for b in baum["notizbuecher"]
                  for a in b["abschnitte"] for s in a["seiten"] if s.get("neu"))


# --- Die Regel für sich ------------------------------------------------------
print("Die Liste je Benutzer")
konfig = DATEN / "konfigprobe"
konfig.mkdir()

pruefe("beim ersten Blick ist nichts neu",
       markiert(neues.markieren(konfig, "P", baum_von(("eins", 100), ("zwei", 100)))) == [])
pruefe("und die Liste liegt im Konfigordner", (konfig / "gesehen.json").is_file())
pruefe("eine geänderte Seite bekommt ein Zeichen",
       markiert(neues.markieren(konfig, "P", baum_von(("eins", 200), ("zwei", 100)))) == ["eins"])
pruefe("und behält es, solange niemand hinsieht",
       markiert(neues.markieren(konfig, "P", baum_von(("eins", 200), ("zwei", 100)))) == ["eins"])
neues.merken(konfig, "P", ["Buch", "Teil", "eins"], 200)
pruefe("wer sie aufmacht, ist sie los",
       markiert(neues.markieren(konfig, "P", baum_von(("eins", 200), ("zwei", 100)))) == [])
pruefe("eine neu angelegte Seite ist neu",
       markiert(neues.markieren(konfig, "P", baum_von(("eins", 200), ("drei", 150)))) == ["drei"])
pruefe("und bleibt es auch beim zweiten Hinsehen",
       markiert(neues.markieren(konfig, "P", baum_von(("eins", 200), ("drei", 150)))) == ["drei"])
pruefe("in den eigenen Notizen wird nichts markiert",
       markiert(neues.markieren(konfig, "", baum_von(("eins", 999)))) == [])
pruefe("ein anderes Projekt fängt bei null an",
       markiert(neues.markieren(konfig, "Q", baum_von(("eins", 200)))) == [])

# Gelöschte Seiten dürfen nicht ewig in der Liste stehen bleiben.
neues.markieren(konfig, "P", baum_von(("eins", 200)))
liste = json.loads((konfig / "gesehen.json").read_text(encoding="utf-8"))
pruefe("gelöschte Seiten fallen aus der Liste",
       list(liste["P"]) == ["Buch/Teil/eins"], liste)

(konfig / "gesehen.json").write_text("{kaputt", encoding="utf-8")
pruefe("eine kaputte Liste wirft nichts um",
       markiert(neues.markieren(konfig, "P", baum_von(("eins", 200)))) == [])

# --- Und am laufenden Server -------------------------------------------------
print("\nZwei Leute in einem Projekt")
k = TestClient(server.app, follow_redirects=False)
k.post("/einrichten", data={"name": "chefin", "passwort": "chefinpasswort1",
                            "passwort2": "chefinpasswort1"})
server.nutzer.anlegen("anna", "annapasswort1", rolle="Benutzer")
server.nutzer.anlegen("bert", "bertpasswort1", rolle="Benutzer")
A = TestClient(server.app, follow_redirects=False)
A.post("/anmelden", data={"name": "anna", "passwort": "annapasswort1"})
B = TestClient(server.app, follow_redirects=False)
B.post("/anmelden", data={"name": "bert", "passwort": "bertpasswort1"})


def ruf(klient, methode, *args):
    a = klient.post(f"/bruecke/{methode}", json={"args": list(args)},
                    headers={"X-Notizmappe": "1"})
    try:
        return a.json()
    except ValueError:
        return {}


def verw(rumpf):
    return k.post("/verwaltung/projekt", json=rumpf, headers={"X-Notizmappe": "1"})


verw({"was": "anlegen", "name": "Hausbau"})
for wer in ("anna", "bert"):
    verw({"was": "mitglied", "projekt": "Hausbau", "benutzer": wer, "recht": "schreiben"})
    (A if wer == "anna" else B).post("/bereich", json={"bereich": "Hausbau"},
                                     headers={"X-Notizmappe": "1"})

buch = ruf(A, "notizbuch_anlegen", "Grundriss")["name"]
teil = ruf(A, "abschnitt_anlegen", buch, "Keller")["name"]
seite = ruf(A, "seite_anlegen", buch, teil, "Fundament")["name"]
ordner = server.nutzer.projektordner("Hausbau")
datei = ordner / buch / teil / f"{seite}.json"


def neu_bei(klient):
    return markiert(ruf(klient, "baum"))


def altern(sekunden):
    """Die Seite älter stellen - sonst passiert in einem Test alles in
    derselben Sekunde, und mit Sekunden rechnet die Markierung."""
    stand = int(datei.stat().st_mtime) + sekunden
    os.utime(datei, (stand, stand))
    return stand


altern(-10)
pruefe("Bert sieht beim ersten Blick nichts markiert", neu_bei(B) == [])
pruefe("Anna auch nicht", neu_bei(A) == [])

stand = ruf(A, "seite_lesen", buch, teil, seite)
geschrieben = ruf(A, "seite_speichern", {
    "notizbuch": buch, "abschnitt": teil, "name": seite, "titel": "Fundament",
    "rev": stand.get("rev"),
    "elemente": [{"art": "text", "x": 40, "y": 40, "breite": 300,
                  "inhalt": "<p>30 cm</p>"}]})
pruefe("Annas Änderung ist angekommen", "fehler" not in geschrieben, geschrieben)
pruefe("Nach Annas Änderung steht bei Bert ein Zeichen", neu_bei(B) == [seite], neu_bei(B))
pruefe("Bei Anna selbst nicht - sie hat ja gespeichert", neu_bei(A) == [], neu_bei(A))
ruf(B, "seite_lesen", buch, teil, seite)
pruefe("Nachdem Bert sie aufgemacht hat, ist das Zeichen weg", neu_bei(B) == [])

print("\nUnd wer war es?")


def wer_bei(klient):
    return [(s["name"], s.get("wer")) for b in ruf(klient, "baum").get("notizbuecher") or []
            for a in b.get("abschnitte") or [] for s in a.get("seiten") or [] if s.get("neu")]


# Bert hat die Seite eben aufgemacht; in derselben Sekunde zaehlt eine
# Aenderung nicht als neu. Also wird sein Stand um fuenf Sekunden
# zurueckgestellt - das ist genau das, was in echt die Zeit macht.
def berts_blick_zurueck(sekunden=5):
    g = server.nutzer.konfigordner("bert") / "gesehen.json"
    d = json.loads(g.read_text(encoding="utf-8"))
    schluessel = f"{buch}/{teil}/{seite}"
    d["Hausbau"][schluessel] = d["Hausbau"][schluessel] - sekunden
    g.write_text(json.dumps(d), encoding="utf-8")


berts_blick_zurueck()
stand = ruf(A, "seite_lesen", buch, teil, seite)
ruf(A, "seite_speichern", {
    "notizbuch": buch, "abschnitt": teil, "name": seite, "titel": "Fundament",
    "rev": stand.get("rev"), "geraet": "chefin",
    "elemente": [{"typ": "text", "x": 40, "y": 40, "b": 300, "inhalt": "x",
                  "html": "<p>40 cm</p>"}]})
pruefe("An der Änderung steht, wer sie war", wer_bei(B) == [(seite, "anna")], wer_bei(B))
# Das ist der Punkt, an dem der Server es eintraegt und nicht die Oberflaeche:
# Anna hat "chefin" mitgeschickt.
pruefe("Und zwar der Server - ein mitgeschickter fremder Name zählt nicht",
       json.loads((datei).read_text(encoding="utf-8"))["geraet"] == "anna",
       json.loads((datei).read_text(encoding="utf-8"))["geraet"])
ruf(B, "seite_lesen", buch, teil, seite)

zweite = ruf(A, "seite_anlegen", buch, teil, "Dach")["name"]
pruefe("Eine neue Seite von Anna ist für Bert neu", neu_bei(B) == [zweite], neu_bei(B))
pruefe("Für Anna selbst nicht - sie hat sie angelegt", neu_bei(A) == [], neu_bei(A))
pruefe("und bleibt es, bis er sie aufmacht", neu_bei(B) == [zweite], neu_bei(B))
ruf(B, "seite_lesen", buch, teil, zweite)
pruefe("dann nicht mehr", neu_bei(B) == [])

A.post("/bereich", json={"bereich": ""}, headers={"X-Notizmappe": "1"})
eigen = ruf(A, "notizbuch_anlegen", "Privat")["name"]
eigenteil = ruf(A, "abschnitt_anlegen", eigen, "Teil")["name"]
ruf(A, "seite_anlegen", eigen, eigenteil, "Nur ich")
pruefe("In den eigenen Notizen steht nie ein Zeichen", neu_bei(A) == [], neu_bei(A))
pruefe("und es wird dafür auch keine Liste angelegt",
       "gesehen.json" not in [p.name for p in server.nutzer.konfigordner("bert").iterdir()]
       or "" not in json.loads((server.nutzer.konfigordner("bert") / "gesehen.json")
                               .read_text(encoding="utf-8")))

# --- Der Reiter Verlauf: nur im Projekt --------------------------------------
#
# "Als gelesen markieren" und "Nach Autor suchen" gibt es nur dort, wo
# mehrere im selben Ordner arbeiten. In eigenen Notizen fuehrt der Server
# gar keine Leseliste, und im Feld `geraet` steht die Zufallskennung des
# eigenen Browsers - "Autor" waere dort ein grosses Wort fuer "dieser
# Rechner hier". Die Oberflaeche zeigt die Knoepfe deshalb nur im Projekt;
# hier steht die Absicherung, damit eine veraltete Oberflaeche nichts
# anlegt, was es nicht geben soll.
print("\nVerlauf: was nur im Projekt geht")
# Anna steht gerade in ihren eigenen Notizen.
pruefe("Als gelesen markieren geht dort nicht",
       A.post("/gelesen", json={}, headers={"X-Notizmappe": "1"}).status_code == 400)
pruefe("Nach Autor suchen auch nicht", A.get("/autoren").status_code == 400)

A.post("/bereich", json={"bereich": "Hausbau"}, headers={"X-Notizmappe": "1"})
drittes = ruf(A, "seite_anlegen", buch, teil, "Treppe")["name"]
zweitbuch = ruf(A, "notizbuch_anlegen", "Aussen")["name"]
zweitteil = ruf(A, "abschnitt_anlegen", zweitbuch, "Garten")["name"]
viertes = ruf(A, "seite_anlegen", zweitbuch, zweitteil, "Zaun")["name"]
pruefe("Bert hat jetzt zwei ungelesene Seiten",
       sorted(neu_bei(B)) == sorted([drittes, viertes]), neu_bei(B))

# Eingeschraenkt auf ein Notizbuch: das andere bleibt stehen. Sonst waere
# "dieses Notizbuch" dasselbe wie "alles", und man koennte nicht nur das
# wegraeumen, was man gerade durchgesehen hat.
nur_buch = B.post("/gelesen", json={"notizbuch": buch},
                  headers={"X-Notizmappe": "1"}).json()
pruefe("Ein Notizbuch als gelesen markieren zaehlt nur dessen Seiten",
       nur_buch.get("gelesen") == 1, nur_buch)
pruefe("und laesst das andere Notizbuch in Ruhe", neu_bei(B) == [viertes], neu_bei(B))

alles = B.post("/gelesen", json={}, headers={"X-Notizmappe": "1"}).json()
pruefe("Alles als gelesen markieren nimmt den Rest",
       alles.get("gelesen") == 1 and neu_bei(B) == [], (alles, neu_bei(B)))
nochmal = B.post("/gelesen", json={}, headers={"X-Notizmappe": "1"}).json()
# Null heisst "war schon alles gelesen" - die Oberflaeche sagt genau das,
# statt "fertig" zu melden, wo nichts war.
pruefe("ein zweites Mal zaehlt nichts mehr", nochmal.get("gelesen") == 0, nochmal)

# Nach Autor suchen sieht jede Seite an, nicht nur die markierten - deshalb
# findet es auch die, die Bert laengst gelesen hat.
wer = B.get("/autoren").json()
pruefe("Nach Autor suchen findet Anna",
       [a["name"] for a in wer.get("autoren") or []] == ["anna"], wer.get("autoren"))
# Gezaehlt wird, wer zuletzt *gespeichert* hat. Eine Seite, die nur
# angelegt und nie beschrieben wurde, hat niemanden - im Feld `geraet`
# steht dann nichts, und einen Autor zu erfinden waere falsch.
pruefe("gezaehlt wird, wer gespeichert hat - nicht, wer angelegt hat",
       (wer["autoren"][0]["seiten"] if wer.get("autoren") else 0) == 1,
       wer.get("autoren"))
pruefe("eine nur angelegte Seite steht nicht in der Liste",
       drittes not in [s["name"] for s in wer.get("seiten") or []],
       wer.get("seiten"))
pruefe("die gespeicherte dagegen schon",
       seite in [s["name"] for s in wer.get("seiten") or []], wer.get("seiten"))
pruefe("die Liste nennt Notizbuch, Abschnitt und Titel",
       all(s.get("notizbuch") and s.get("abschnitt") and s.get("titel")
           and s.get("wer") == "anna" for s in wer.get("seiten") or []),
       (wer.get("seiten") or [])[:2])
pruefe("und sie ist vollstaendig", wer.get("vollstaendig") is True, wer)

A.post("/bereich", json={"bereich": ""}, headers={"X-Notizmappe": "1"})

# --- Und wo steht das Zeichen in der Leiste? ---------------------------------
#
# Der Baum wird drueben in mappe.js gezeichnet; shim.js haengt sich dahinter
# und setzt die Zeichen. Geprüft wird an einem nachgebauten Baum, ob sie an
# der richtigen Zeile landen - auch am Abschnitt und am Notizbuch darüber,
# denn zugeklappt sieht man die Seite selbst gar nicht.
print("\nDas Zeichen in der Leiste")
shim = (WURZEL / "web/shim.js").read_text(encoding="utf-8")
teile = []
for muster, name in ((r"^  function el\(.*?^  \}", "el"),
                     (r"^  function autorenText\(.*?^  \}", "autorenText"),
                     (r"^  function neuesZeichen\(.*?^  \}", "neuesZeichen"),
                     (r"^  function neuesZahl\(.*?^  \}", "neuesZahl"),
                     (r"^  function neuesGelesen\(.*?^  \}", "neuesGelesen"),
                     (r"^  function neuesMarkieren\(.*?^  \}", "neuesMarkieren"),
                     (r"^  function meldungMitNamen\(.*?^  \}", "meldungMitNamen")):
    treffer = re.search(muster, shim, re.S | re.M)
    pruefe(f"{name} steht in shim.js", bool(treffer))
    if treffer:
        teile.append(treffer.group(0))

HARNISCH = r"""
/* Ein Baum aus Papier: nur so viel DOM, wie die Markierung anfasst. */
function Knoten(art) {
  this.art = art; this.className = ''; this.textContent = ''; this.title = '';
  this.kinder = []; this.eltern = null; this.dataset = {}; this.horcher = [];
}
Object.defineProperty(Knoten.prototype, 'classList', {
  get: function () {
    const selbst = this;
    return { contains: function (k) { return selbst.klassen().indexOf(k) >= 0; },
             add: function (k) { selbst.className = (selbst.className + ' ' + k).trim(); } };
  },
});
Object.defineProperty(Knoten.prototype, 'children', {
  get: function () { return this.kinder; },
});
Object.defineProperty(Knoten.prototype, 'firstElementChild', {
  get: function () { return this.kinder[0] || null; },
});
Knoten.prototype.klassen = function () {
  return String(this.className).split(' ').filter(Boolean);
};
Knoten.prototype.append = function (k) { k.eltern = this; this.kinder.push(k); };
Knoten.prototype.after = function (k) {
  const wo = this.eltern.kinder.indexOf(this);
  this.eltern.kinder.splice(wo + 1, 0, k);
  k.eltern = this.eltern;
};
Knoten.prototype.entfernen = function () {
  const wo = this.eltern ? this.eltern.kinder.indexOf(this) : -1;
  if (wo >= 0) this.eltern.kinder.splice(wo, 1);
};
Knoten.prototype.remove = function () { this.entfernen(); };
Knoten.prototype.querySelectorAll = function (wahl) {
  const nur = wahl.indexOf(':scope >') === 0;
  const klasse = wahl.replace(':scope >', '').trim().replace('.', '');
  const aus = [];
  const gehen = function (knoten, tief) {
    for (const kind of knoten.kinder) {
      if (kind.klassen().indexOf(klasse) >= 0) aus.push(kind);
      if (tief) gehen(kind, true);
    }
  };
  gehen(this, !nur);
  return aus;
};
Knoten.prototype.querySelector = function (wahl) {
  return this.querySelectorAll(wahl)[0] || null;
};
Knoten.prototype.addEventListener = function (art, tun) {
  if (art === 'click') this.horcher.push(tun);
};
Knoten.prototype.klick = function () { for (const tun of this.horcher) tun(); };

const wurzel = new Knoten('div');
const document = {
  createElement: function (art) { return new Knoten(art); },
  getElementById: function (id) { return id === 'baum' ? wurzel : null; },
};

function zeile(text, klassen) {
  const z = new Knoten('div');
  z.className = 'zeile' + (klassen ? ' ' + klassen : '');
  const n = new Knoten('span');
  n.className = 'name';
  n.textContent = text;
  z.append(n);
  return z;
}

/* Der Baum, wie mappe.js ihn baut: Buch > Abschnitt > Seitenzeilen. */
let meinBereich = '';
let letzterStand = null;
const baumDaten = [{ name: 'Buch', abschnitte: [
  { name: 'Keller', seiten: [{ name: 'a', titel: 'a' },
                             { name: 'b', titel: 'b', neu: true, wer: 'anna' }] },
  { name: 'Dach', seiten: [{ name: 'c', titel: 'c' }] },
  { name: 'Garten', seiten: [{ name: 'd', titel: 'd', neu: true }] },
]}];
for (const buch of baumDaten) {
  const bd = new Knoten('div');
  bd.className = 'buch';
  bd.append(zeile(buch.name));
  for (const ab of buch.abschnitte) {
    const ad = new Knoten('div');
    ad.className = 'abschnitt';
    ad.append(zeile(ab.name));
    for (const s of ab.seiten) ad.append(zeile(s.titel, 'seite'));
    bd.append(ad);
  }
  wurzel.append(bd);
}
let autorenAus = false;
function ungelesenFrischen() {}
""" + "\n".join(teile) + r"""

function marken() {
  return wurzel.querySelectorAll('.neumarke').length;
}
function hat(knoten) { return !!knoten.querySelector('.neumarke'); }
const abschnitte = wurzel.querySelectorAll('.abschnitt');
const aus = {};
neuesMarkieren();
neuesMarkieren();                       // zweimal: es darf nichts doppelt stehen
aus.anzahl = marken();
aus.seiten = wurzel.querySelectorAll('.seite').filter(hat)
  .map((z) => z.querySelector('.name').textContent);
aus.abschnitte = abschnitte.filter((a) => hat(a.firstElementChild)).map((a) => a.firstElementChild.querySelector('.name').textContent);
aus.buch = hat(wurzel.children[0].firstElementChild);
aus.buchtitel = wurzel.children[0].firstElementChild.querySelector('.neumarke').title;
aus.zeichen = wurzel.querySelectorAll('.neumarke')[0].textContent;
aus.hinweis_mit_namen = wurzel.querySelectorAll('.seite').filter(hat)
  .map((z) => z.querySelector('.neumarke').title);
// "Autoren ausblenden" im Reiter Verlauf: dieselben Zeichen, ohne Namen.
autorenAus = true;
neuesMarkieren();
aus.hinweis_ohne_namen = wurzel.querySelectorAll('.seite').filter(hat)
  .map((z) => z.querySelector('.neumarke').title);
aus.anzahl_ohne_namen = marken();
autorenAus = false;
neuesMarkieren();
// Aufgemacht: das Zeichen muss an der Seite und am Abschnitt darueber weg.
const garten = abschnitte[2];
garten.querySelectorAll('.seite')[0].querySelector('.name').klick();
aus.nach_klick = marken();
aus.garten_nach_klick = hat(garten.firstElementChild);
aus.buch_nach_klick = hat(wurzel.children[0].firstElementChild);
// Die Meldungen drueben: in den eigenen Notizen bleibt alles, wie es ist.
letzterStand = { geraet: 'anna' };
meinBereich = '';
aus.eigen_konflikt = meldungMitNamen('Diese Seite wurde woanders geändert (Gerät 7f3k2a9).');
aus.eigen_sync = meldungMitNamen('Neuere Fassung vom Sync da.');
meinBereich = 'Hausbau';
aus.projekt_konflikt = meldungMitNamen('Diese Seite wurde woanders geändert (Gerät anna). Deine Änderungen sind noch nicht gespeichert.');
aus.projekt_sync = meldungMitNamen('Neuere Fassung vom Sync da.');
aus.projekt_anderes = meldungMitNamen('Die Seite ist nicht mehr da (gelöscht oder verschoben).');
process.stdout.write(JSON.stringify(aus) + '\n');
"""

ordner = Path(tempfile.mkdtemp(prefix="notizgruppe-js-"))
(ordner / "marken.js").write_text(HARNISCH, encoding="utf-8")
if shutil.which("node"):
    befehl = ["node", str(ordner / "marken.js")]
else:
    befehl = ["docker", "run", "--rm", "-v", f"{ordner}:/t:ro", "node:alpine",
              "node", "/t/marken.js"]
lauf = subprocess.run(befehl, capture_output=True, text=True)
if lauf.returncode != 0:
    print(lauf.stdout)
    print(lauf.stderr)
    sys.exit(1)
j = json.loads(lauf.stdout.strip().splitlines()[-1])
shutil.rmtree(ordner, ignore_errors=True)

pruefe("das Zeichen ist ein Ausrufezeichen", j["zeichen"] == "!", j["zeichen"])
pruefe("es steht an den geänderten Seiten", j["seiten"] == ["b", "d"], j["seiten"])
pruefe("und an den Abschnitten darüber", j["abschnitte"] == ["Keller", "Garten"], j["abschnitte"])
pruefe("und am Notizbuch", j["buch"] is True)
pruefe("am Notizbuch steht, wie viele es sind",
       j["buchtitel"] == "2 geänderte Seiten darin", j["buchtitel"])
# Zweimal gezeichnet, einmal so viele Zeichen: 2 Seiten + 2 Abschnitte + 1 Buch.
pruefe("nichts steht doppelt da", j["anzahl"] == 5, j["anzahl"])
pruefe("wer eine Seite aufmacht, ist ihr Zeichen los", j["nach_klick"] == 3, j["nach_klick"])
pruefe("und das des Abschnitts darüber auch", j["garten_nach_klick"] is False)
pruefe("das Notizbuch behält seines - der Keller ist noch ungelesen",
       j["buch_nach_klick"] is True)
pruefe("am Zeichen steht, wer es war",
       j["hinweis_mit_namen"][0] == "Geändert von anna, seit du zuletzt hier warst",
       j["hinweis_mit_namen"])
pruefe("und bei einer Seite ohne Namen nur, dass sich etwas geändert hat",
       j["hinweis_mit_namen"][1] == "Geändert, seit du zuletzt hier warst",
       j["hinweis_mit_namen"])
# "Autoren ausblenden": das Zeichen bleibt, der Name verschwindet. Wer in
# einer Gruppe nicht sehen will, wer was war, will trotzdem sehen, dass
# sich etwas geändert hat.
pruefe("Autoren ausblenden nimmt den Namen weg",
       all(h == "Geändert, seit du zuletzt hier warst"
           for h in j["hinweis_ohne_namen"]), j["hinweis_ohne_namen"])
pruefe("und lässt die Zeichen stehen",
       j["anzahl_ohne_namen"] == j["anzahl"],
       (j["anzahl_ohne_namen"], j["anzahl"]))

print("\nDie Meldungen an der offenen Seite")
pruefe("In den eigenen Notizen bleibt der Text, wie er ist",
       j["eigen_konflikt"].endswith("(Gerät 7f3k2a9).")
       and j["eigen_sync"] == "Neuere Fassung vom Sync da.",
       (j["eigen_konflikt"], j["eigen_sync"]))
pruefe("Im Projekt steht der Name statt der Gerätenummer",
       "von anna" in j["projekt_konflikt"] and "Gerät" not in j["projekt_konflikt"],
       j["projekt_konflikt"])
pruefe("Aus der Sync-Meldung wird: anna hat diese Seite geändert",
       j["projekt_sync"] == "anna hat diese Seite geändert.", j["projekt_sync"])
pruefe("Andere Meldungen bleiben unangetastet",
       j["projekt_anderes"] == "Die Seite ist nicht mehr da (gelöscht oder verschoben).",
       j["projekt_anderes"])

shutil.rmtree(DATEN, ignore_errors=True)
print()
if fehler:
    print(f"{len(fehler)} Prüfungen gescheitert")
    sys.exit(1)
print("In der Gruppe steht das Zeichen an der richtigen Seite")
