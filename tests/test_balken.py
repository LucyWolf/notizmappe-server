"""Kommt der Update-Balken wirklich?

    .venv/bin/python tests/test_balken.py

Der Hinweis auf eine neue Fassung ist zweimal ausgeblieben, und beide Male
konnte ich nur raten, weil hier kein Browser läuft. Also ein nachgebautes DOM:
gerade genug, dass die Funktionen aus shim.js darin laufen. Das beantwortet
die Frage, die zählt - wird ein Balken angehängt oder nicht -, ohne zu
behaupten, es sei im Browser gesehen.

Nicht geprüft: wie er aussieht und ob er sichtbar liegt. Das sieht Lucy zuerst.
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
    print(("  ok  " if bedingung else "FEHLER") + "  " + was + (f"   {extra}" if extra and not bedingung else ""))
    if not bedingung:
        fehler.append(was)


teile = []
for muster, name in ((r"^  const UPDATE_WEG = [^\n]*$", "UPDATE_WEG"),
                     (r"^  function el\(.*?^  \}", "el"),
                     (r"^  function updateWarten\(.*?^  \}", "updateWarten"),
                     (r"^  async function updateStarten\(.*?^  \}", "updateStarten"),
                     (r"^  function updateBalken\(.*?^  \}", "updateBalken"),
                     (r"^  function updateHinweisBauen\(.*?^  \}", "updateHinweisBauen")):
    treffer = re.search(muster, shim, re.S | re.M)
    pruefe(f"{name} steht in shim.js", bool(treffer))
    if treffer:
        teile.append(treffer.group(0))
if fehler:
    sys.exit(1)

HARNISCH = r"""
/* Ein DOM, so klein wie moeglich. */
class Knoten {
  constructor(art) {
    this.art = art; this.kinder = []; this.zuhoerer = {};
    this.style = {}; this.dataset = {}; this.hidden = false;
    this.textContent = ''; this.id = ''; this.eltern = null;
  }
  append(...was) {
    for (const k of was) {
      if (typeof k === 'string') { this.textContent += k; continue; }
      k.eltern = this; this.kinder.push(k);
    }
  }
  remove() {
    if (this.eltern) this.eltern.kinder = this.eltern.kinder.filter((k) => k !== this);
    this.eltern = null;
  }
  addEventListener(art, f) { (this.zuhoerer[art] = this.zuhoerer[art] || []).push(f); }
  klick() { for (const f of this.zuhoerer.click || []) f({ target: this }); }
  alle() { return this.kinder.reduce((a, k) => a.concat(k.alle()), [this]); }
  text() { return this.alle().map((k) => k.textContent).join(' '); }
}
const body = new Knoten('body');
const document = {
  createElement: (a) => new Knoten(a),
  getElementById: (id) => body.alle().find((k) => k.id === id) || null,
  body,
};
const gespeichert = {};
const localStorage = {
  getItem: (k) => (k in gespeichert ? gespeichert[k] : null),
  setItem: (k, w) => { gespeichert[k] = String(w); },
};
let antwort = { laeuft: '1.2.3', neueste: '1.2.9', neuer: true };
const gefragt = [];
async function hol(weg) {
  gefragt.push(weg);
  if (weg === '/aktualisieren') return { getan: true, fassung: antwort.neueste };
  return antwort;
}
const uhren = [];
const setTimeout = (f, ms) => { uhren.push({ art: 'einmal', f, ms }); return uhren.length; };
const setInterval = (f, ms) => { uhren.push({ art: 'immer', f, ms }); return uhren.length; };
const clearInterval = () => {};
const fetch = async () => ({ ok: false });
const location = { reload: () => {} };
""" + "\n".join(teile) + r"""

(async () => {
  const ergebnis = {};
  updateHinweisBauen();
  const einmal = uhren.find((u) => u.art === 'einmal');
  const immer = uhren.find((u) => u.art === 'immer');
  ergebnis.erst_ms = einmal ? einmal.ms : null;
  ergebnis.takt_ms = immer ? immer.ms : null;

  // 1. Es gibt etwas Neues -> Balken
  await einmal.f();
  let balken = document.getElementById('updatebalken');
  ergebnis.balken_da = !!balken;
  ergebnis.balken_text = balken ? balken.text() : '';
  ergebnis.hat_knopf = !!document.getElementById('u-jetzt');
  ergebnis.gefragt_erst = gefragt.slice();

  // 2. "Später" legt ihn weg - und er kommt fuer diese Fassung nicht wieder
  document.getElementById('u-spaeter').klick();
  ergebnis.weg_nach_spaeter = !document.getElementById('updatebalken');
  ergebnis.gemerkt = gespeichert[UPDATE_WEG] || null;
  await immer.f();
  ergebnis.bleibt_weg = !document.getElementById('updatebalken');

  // 3. Eine noch neuere Fassung kommt wieder durch
  antwort = { laeuft: '1.2.3', neueste: '1.3.0', neuer: true };
  await immer.f();
  ergebnis.neue_fassung_wieder_da = !!document.getElementById('updatebalken');

  // 4. Der Knopf im Balken stoesst das Update an
  gefragt.length = 0;
  document.getElementById('u-jetzt').klick();
  await new Promise((f) => process.nextTick(f));
  ergebnis.knopf_fragt = gefragt.slice();

  // 5. Nichts Neues -> kein Balken
  document.getElementById('updatebalken').remove();
  antwort = { laeuft: '1.3.0', neueste: '1.3.0', neuer: false };
  await immer.f();
  ergebnis.nichts_neues_kein_balken = !document.getElementById('updatebalken');

  console.log(JSON.stringify(ergebnis));
})();
"""

ordner = Path(tempfile.mkdtemp(prefix="notiz-balken-"))
(ordner / "pruef.js").write_text(HARNISCH, encoding="utf-8")
if shutil.which("node"):
    befehl = ["node", str(ordner / "pruef.js")]
elif shutil.which("docker"):
    befehl = ["docker", "run", "--rm", "-v", f"{ordner}:/p:ro", "node:alpine", "node", "/p/pruef.js"]
else:
    print("  --  weder node noch docker da, der Balken ist ungeprueft")
    sys.exit(0)

lauf = subprocess.run(befehl, capture_output=True, text=True)
pruefe("der Harnisch laeuft durch", lauf.returncode == 0, lauf.stderr.strip()[-400:])
if fehler:
    sys.exit(1)
d = json.loads(lauf.stdout)

pruefe("beim Laden wird nachgesehen", d["erst_ms"] is not None and d["erst_ms"] <= 10000,
       str(d["erst_ms"]))
pruefe("und danach alle fuenf Minuten", d["takt_ms"] == 5 * 60 * 1000, str(d["takt_ms"]))
pruefe("ohne frisch=1 gefragt - der Server haelt die Antwort kurz genug",
       d["gefragt_erst"] == ["/fassung"], str(d["gefragt_erst"]))
pruefe("es gibt etwas Neues -> der Balken haengt im Fenster", d["balken_da"])
pruefe("er nennt die neue Fassung", "1.2.9" in d["balken_text"], d["balken_text"])
pruefe("er bringt den Knopf mit, statt nur Bescheid zu sagen", d["hat_knopf"])
pruefe("'Später' legt ihn weg", d["weg_nach_spaeter"])
pruefe("und merkt sich die Fassung", d["gemerkt"] == "1.2.9", str(d["gemerkt"]))
pruefe("für diese Fassung kommt er nicht wieder", d["bleibt_weg"])
pruefe("eine neuere Fassung kommt wieder durch", d["neue_fassung_wieder_da"])
pruefe("der Knopf stoesst das Update an",
       d["knopf_fragt"] == ["/aktualisieren"], str(d["knopf_fragt"]))
pruefe("ohne Neues bleibt es still", d["nichts_neues_kein_balken"])

shutil.rmtree(ordner, ignore_errors=True)
print()
print("ALLES GRUEN" if not fehler else f"{len(fehler)} Fehler")
sys.exit(1 if fehler else 0)
