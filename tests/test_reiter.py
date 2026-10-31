"""Zeigen die Reiter der Einstellungen genau einen Abschnitt?

    .venv/bin/python tests/test_reiter.py

Die Einstellungen standen in einer Spalte; jetzt steht oben eine Reiterleiste.
Daran kann dreierlei schiefgehen, und keins davon sieht man am Quelltext:
ein Abschnitt bleibt zugedeckt, obwohl er keinen Reiter mehr hat; es sind zwei
gleichzeitig offen; oder die Meldezeile steckt in einem Reiter fest und
"Zugang entfernt" liest keiner.

Also dasselbe Vorgehen wie beim Update-Balken: ein nachgebautes DOM, gerade
genug, dass die Funktionen aus shim.js darin laufen. Nicht geprueft: wie die
Leiste aussieht und ob sie schoen liegt - das sieht Lucy zuerst.
"""
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
shim = (WURZEL / "web/shim.js").read_text(encoding="utf-8")
fehler = []


def pruefe(was, bedingung, extra=""):
    print(("  ok  " if bedingung else "FEHLER") + "  " + was
          + (f"   {extra}" if extra and not bedingung else ""))
    if not bedingung:
        fehler.append(was)


teile = []
for muster, name in ((r"^  function el\(.*?^  \}", "el"),
                     (r"^  function optionentafel\(.*?^  \}", "optionentafel"),
                     (r"^  function optionAnhaengen\(.*?^  \}", "optionAnhaengen"),
                     (r"^  const REITER_WEG = [^\n]*$", "REITER_WEG"),
                     (r"^  const REITER_MERK = [^\n]*$", "REITER_MERK"),
                     (r"^  const REITERNAMEN = \{.*?^  \};", "REITERNAMEN"),
                     (r"^  let offenerReiter = null;[^\n]*$", "offenerReiter"),
                     (r"^  function nachH3Teilen\(.*?^  \}", "nachH3Teilen"),
                     (r"^  function reiterblaetter\(.*?^  \}", "reiterblaetter"),
                     (r"^  function optionenReiterBauen\(.*?^  \}", "optionenReiterBauen")):
    treffer = re.search(muster, shim, re.S | re.M)
    pruefe(f"{name} steht in shim.js", bool(treffer))
    if treffer:
        teile.append(treffer.group(0))
if fehler:
    sys.exit(1)

HARNISCH = r"""
/* Ein DOM, so klein wie moeglich - aber mit Klassenliste, Kindern und
   textContent, denn genau daran haengt die Reiterschaltung. */
class Knoten {
  constructor(art) {
    this.art = art; this.kinder = []; this.zuhoerer = {};
    this.style = {}; this.dataset = {}; this.hidden = false;
    this.klassen = new Set(); this.merkmale = {};
    this.eigenerText = ''; this.id = ''; this.eltern = null;
    const selbst = this;
    this.classList = {
      add: (c) => selbst.klassen.add(c),
      remove: (c) => selbst.klassen.delete(c),
      contains: (c) => selbst.klassen.has(c),
    };
  }
  get tagName() { return this.art.toUpperCase(); }
  get children() { return this.kinder; }
  get parentElement() { return this.eltern; }
  get firstChild() { return this.kinder[0] || null; }
  get textContent() {
    return this.eigenerText + this.kinder.map((k) => k.textContent).join('');
  }
  set textContent(was) {
    for (const k of this.kinder) k.eltern = null;
    this.kinder = []; this.eigenerText = String(was);
  }
  append(...was) {
    for (const k of was) {
      if (typeof k === 'string') { this.eigenerText += k; continue; }
      if (k.eltern) k.remove();
      k.eltern = this; this.kinder.push(k);
    }
  }
  insertBefore(neu, davor) {
    if (neu.eltern) neu.remove();
    neu.eltern = this;
    const i = davor ? this.kinder.indexOf(davor) : -1;
    if (i < 0) this.kinder.push(neu); else this.kinder.splice(i, 0, neu);
  }
  remove() {
    if (this.eltern) this.eltern.kinder = this.eltern.kinder.filter((k) => k !== this);
    this.eltern = null;
  }
  setAttribute(name, wert) { this.merkmale[name] = String(wert); }
  getAttribute(name) { return name in this.merkmale ? this.merkmale[name] : null; }
  addEventListener(art, f) { (this.zuhoerer[art] = this.zuhoerer[art] || []).push(f); }
  klick() { for (const f of this.zuhoerer.click || []) f({ target: this }); }
  alle() { return this.kinder.reduce((a, k) => a.concat(k.alle()), [this]); }
  /* Nur die Waehler, die shim.js hier wirklich benutzt. Ein halbherziger
     Waehler, der stillschweigend null liefert, wuerde Fehler verstecken. */
  passt(waehler) {
    if (waehler === 'h3' || waehler === 'section') return this.art === waehler;
    if (waehler === '#einstellungen .tafel') return this.klassen.has('tafel');
    throw new Error('unbekannter Waehler: ' + waehler);
  }
  querySelector(w) { return this.alle().slice(1).find((k) => k.passt(w)) || null; }
  querySelectorAll(w) { return this.alle().slice(1).filter((k) => k.passt(w)); }
}

const wurzel = new Knoten('body');
const document = {
  createElement: (a) => new Knoten(a),
  getElementById: (id) => wurzel.alle().find((k) => k.id === id) || null,
  querySelector: (w) => {
    if (w === '.dateiseite[data-punkt="optionen"]') return seite;
    throw new Error('unbekannter Waehler: ' + w);
  },
};
const gespeichert = {};
const localStorage = {
  getItem: (k) => (k in gespeichert ? gespeichert[k] : null),
  setItem: (k, w) => { gespeichert[k] = String(w); },
};

/* Die Optionen-Seite der gemeinsamen Oberflaeche, nachgebaut. */
const seite = new Knoten('section');
const einstellungen = new Knoten('div');
einstellungen.id = 'einstellungen';
const tafel = new Knoten('div');
tafel.klassen.add('tafel');
wurzel.append(seite);
seite.append(einstellungen);
einstellungen.append(tafel);

function fremdabschnitt(ueberschrift, versteckt) {
  const s = new Knoten('section');
  s.hidden = !!versteckt;
  s.append(new Knoten('h3'));
  s.kinder[0].textContent = ueberschrift;
  tafel.append(s);
  return s;
}
const ferne = fremdabschnitt('Mit einem Server verbinden', true);
fremdabschnitt('Daten');
fremdabschnitt('Aus OneNote übernehmen');
fremdabschnitt('Sperre');
fremdabschnitt('Schriften');
fremdabschnitt('Fenster');
""" + "\n".join(teile) + r"""

/* Jetzt die beiden eigenen Abschnitte, so wie shim.js sie baut. */
function ueberschrift(text) { return el('h3', { textContent: text }); }

const verwaltung = el('section', { id: 'serververwaltung' }, [
  ueberschrift('Benutzer und Rollen'),
  el('div', { id: 'v-benutzer' }),
  el('p', { textContent: 'Benutzer anlegen' }),
  ueberschrift('Zwei Schritte beim Anmelden'),
  el('div', { id: 'v-zwei' }),
  ueberschrift('Einladen'),
  el('div', { id: 'v-einladungen' }),
  ueberschrift('Projekte'),
  el('div', { id: 'v-projekte' }),
  ueberschrift('Was die Rollen bedeuten'),
  el('div', { id: 'v-rollen' }),
  el('p', { id: 'v-meldung' }),
]);
optionAnhaengen(verwaltung);
nachH3Teilen(verwaltung);
const meldung = document.getElementById('v-meldung');
if (meldung) verwaltung.append(meldung);

optionAnhaengen(el('section', { id: 'postteil' }, [ueberschrift('Mailversand')]));

function sichtbar(k) {
  for (let s = k; s; s = s.eltern) {
    if (s.hidden || s.klassen.has(REITER_WEG)) return false;
  }
  return true;
}
function reiterbeschriftung() {
  const leiste = document.getElementById('optionenreiter');
  return leiste ? leiste.kinder.map((k) => k.textContent) : null;
}
function offeneBlaetter() {
  return reiterblaetter(tafel).filter(sichtbar)
    .map((s) => s.querySelector('h3').textContent);
}

const ergebnis = {};
optionenReiterBauen();
ergebnis.leiste_oben = tafel.kinder[0] && tafel.kinder[0].id === 'optionenreiter';
ergebnis.reiter = reiterbeschriftung();
ergebnis.offen = offeneBlaetter();

/* Umschalten */
const leiste = document.getElementById('optionenreiter');
leiste.kinder.find((k) => k.textContent === 'Mailversand').klick();
ergebnis.nach_klick = offeneBlaetter();
ergebnis.gemerkt = gespeichert['notizmappe.optionenreiter'] || null;
ergebnis.gewaehlt_markiert = document.getElementById('optionenreiter').kinder
  .filter((k) => k.getAttribute('aria-selected') === 'true').map((k) => k.textContent);
ergebnis.meldung_sichtbar = sichtbar(document.getElementById('v-meldung'));

/* Ein Abschnitt verschwindet (Mailversand nur fuer Verwalter: /post sagt 403) */
document.getElementById('postteil').remove();
optionenReiterBauen();
ergebnis.ohne_post = reiterbeschriftung();
ergebnis.offen_ohne_post = offeneBlaetter();

/* Die halbe Verwaltung darf ein Gast nicht sehen - verwaltungLaden versteckt
   die Unterabschnitte, nicht nur die Ueberschriften. */
for (const u of verwaltung.kinder) {
  const h = u.art === 'section' ? u.querySelector('h3') : null;
  if (h && ['Benutzer und Rollen', 'Einladen', 'Was die Rollen bedeuten']
        .indexOf(h.textContent) >= 0) u.hidden = true;
}
optionenReiterBauen();
ergebnis.als_gast = reiterbeschriftung();
ergebnis.offen_als_gast = offeneBlaetter();

/* Und wenn die ganze Verwaltung weg ist */
verwaltung.hidden = true;
optionenReiterBauen();
ergebnis.ohne_verwaltung = reiterbeschriftung();
ergebnis.offen_ohne_verwaltung = offeneBlaetter();
ergebnis.zugedeckt_ohne_reiter = tafel.querySelectorAll('section')
  .filter((s) => s.klassen.has(REITER_WEG) && reiterblaetter(tafel).indexOf(s) < 0).length;

console.log(JSON.stringify(ergebnis));
"""

ordner = Path(tempfile.mkdtemp(prefix="reiter-"))
(ordner / "pruef.js").write_text(HARNISCH, encoding="utf-8")
if shutil.which("node"):
    befehl = ["node", str(ordner / "pruef.js")]
elif shutil.which("docker"):
    befehl = ["docker", "run", "--rm", "-v", f"{ordner}:/p:ro", "node:alpine",
              "node", "/p/pruef.js"]
else:
    print("  --  weder node noch docker da, die Reiter sind ungeprueft")
    sys.exit(0)

lauf = subprocess.run(befehl, capture_output=True, text=True)
if lauf.returncode != 0:
    print(lauf.stdout)
    print(lauf.stderr)
    sys.exit(1)
d = json.loads(lauf.stdout.strip().splitlines()[-1])

print("\nDie Leiste")
pruefe("sie steht oben in der Tafel", d["leiste_oben"], d)
ERWARTET = ['Benutzer', 'Zwei Schritte', 'Einladen', 'Projekte', 'Rollen',
            'Mailversand', 'Daten', 'OneNote', 'Sperre', 'Schriften', 'Fenster']
pruefe("ein Reiter je Thema, in dieser Reihenfolge", d["reiter"] == ERWARTET, d["reiter"])
pruefe("die langen Ueberschriften stehen kurz im Reiter",
       'Benutzer' in d["reiter"] and 'Benutzer und Rollen' not in d["reiter"])
pruefe("ein versteckter Abschnitt bekommt keinen Reiter",
       'Server' not in d["reiter"] and 'Mit einem Server verbinden' not in d["reiter"])

print("\nGenau einer offen")
pruefe("beim Aufbau ist genau ein Abschnitt zu sehen",
       d["offen"] == ['Benutzer und Rollen'], d["offen"])
pruefe("nach dem Klick genau der angeklickte", d["nach_klick"] == ['Mailversand'], d["nach_klick"])
pruefe("und nur sein Reiter ist markiert",
       d["gewaehlt_markiert"] == ['Mailversand'], d["gewaehlt_markiert"])
pruefe("die Wahl wird gemerkt", d["gemerkt"] == 'Mailversand', d["gemerkt"])
# Die Meldezeile ist der Grund, warum sie beim Zerlegen herausgenommen wird.
pruefe("die Meldezeile bleibt sichtbar, egal welcher Reiter offen ist",
       d["meldung_sichtbar"], d)

print("\nWenn sich etwas aendert")
pruefe("faellt ein Abschnitt weg, faellt sein Reiter weg",
       'Mailversand' not in d["ohne_post"], d["ohne_post"])
pruefe("und es bleibt einer offen", len(d["offen_ohne_post"]) == 1, d["offen_ohne_post"])
pruefe("ein Gast sieht nur, was er darf",
       d["als_gast"] == ['Zwei Schritte', 'Projekte', 'Daten', 'OneNote', 'Sperre',
                         'Schriften', 'Fenster'], d["als_gast"])
pruefe("ohne Verwaltung bleiben die Einstellungen der Oberflaeche",
       d["ohne_verwaltung"] == ['Daten', 'OneNote', 'Sperre', 'Schriften', 'Fenster'],
       d["ohne_verwaltung"])
pruefe("und auch dann ist genau einer offen",
       len(d["offen_ohne_verwaltung"]) == 1, d["offen_ohne_verwaltung"])
# Der Fehler, der sich am leichtesten einschleicht: ein Abschnitt verliert
# seinen Reiter und bleibt von der letzten Runde zugedeckt liegen.
pruefe("kein Abschnitt bleibt ohne Reiter zugedeckt",
       d["zugedeckt_ohne_reiter"] == 0, d)

shutil.rmtree(ordner, ignore_errors=True)
print()
if fehler:
    print(f"{len(fehler)} Prüfungen gescheitert")
    sys.exit(1)
print("Die Reiter der Einstellungen sind in Ordnung")
