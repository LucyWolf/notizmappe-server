"""Rechnet das Ziehen an den Griffen richtig?

    .venv/bin/python tests/test_zerren.py

Die Griffe am Auswahlrahmen skalieren die markierten Striche. Daran ist nichts
sichtbar falsch, wenn ein Vorzeichen verdreht ist - die Zeichnung springt dann
beim Anfassen weg oder klappt um, und das sieht man erst im Browser. Deshalb
steht die Rechnung in shim.js als eigene Funktion `zerrfaktor` ohne DOM, und
dieser Test fuettert sie mit gezogenen Griffen.

Geprueft wird:
* die gegenueberliegende Kante bleibt liegen (sonst wandert alles mit),
* die gezogene Kante landet unter dem Finger,
* Kantengriffe lassen die andere Achse in Ruhe,
* ueber den Anker hinaus klappt nichts um.
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


anker = re.search(r"^  const ANKER = \{.*?^  \};", shim, re.S | re.M)
funktion = re.search(r"^  function zerrfaktor\(.*?^  \}", shim, re.S | re.M)
pruefe("ANKER und zerrfaktor stehen in shim.js", bool(anker) and bool(funktion))
if fehler:
    sys.exit(1)

# Wie im Rahmen: Urpunkte liegen flach als x, y, Druck.
HARNISCH = anker.group(0) + "\n" + funktion.group(0) + r"""
const g0 = { x1: 0, y1: 0, x2: 100, y2: 100 };
function ziehen(griff, p, punkte) {
  const { x: sx, y: sy } = zerrfaktor(griff, g0, p);
  const neu = [];
  for (let i = 0; i < punkte.length; i += 3) {
    neu.push(sx.anker + (punkte[i] - sx.anker) * sx.f,
             sy.anker + (punkte[i + 1] - sy.anker) * sy.f,
             punkte[i + 2]);
  }
  return { sx: sx.f, sy: sy.f, punkte: neu };
}
// Ein Rechteck aus vier Ecken der Auswahl.
const ecken = [0, 0, 1, 100, 0, 1, 0, 100, 1, 100, 100, 1];
console.log(JSON.stringify({
  so_breiter: ziehen('so', { x: 200, y: 100 }, ecken),
  nw_doppelt: ziehen('nw', { x: -100, y: -100 }, ecken),
  n_halb: ziehen('n', { x: 0, y: 50 }, ecken),
  so_umgeklappt: ziehen('so', { x: -50, y: 100 }, ecken),
  w_nur_x: ziehen('w', { x: -100, y: 999 }, ecken),
}));
"""

ordner = Path(tempfile.mkdtemp(prefix="notiz-zerren-"))
(ordner / "pruef.js").write_text(HARNISCH, encoding="utf-8")
if shutil.which("node"):
    befehl = ["node", str(ordner / "pruef.js")]
elif shutil.which("docker"):
    befehl = ["docker", "run", "--rm", "-v", f"{ordner}:/p:ro", "node:alpine", "node", "/p/pruef.js"]
else:
    print("  --  weder node noch docker da, Griff-Rechnung ungeprueft")
    sys.exit(0)

lauf = subprocess.run(befehl, capture_output=True, text=True)
pruefe("der Harnisch laeuft durch", lauf.returncode == 0, lauf.stderr.strip()[-300:])
if fehler:
    sys.exit(1)
d = json.loads(lauf.stdout)


def nah(a, b, luft=0.001):
    return abs(a - b) <= luft


# Nach Suedosten gezogen: links/oben bleibt liegen, rechts landet beim Finger.
a = d["so_breiter"]
pruefe("Suedost-Griff verdoppelt die Breite", nah(a["sx"], 2) and nah(a["sy"], 1))
pruefe("die linke Kante bleibt liegen", nah(a["punkte"][0], 0) and nah(a["punkte"][6], 0))
pruefe("die rechte Kante landet unter dem Finger",
       nah(a["punkte"][3], 200) and nah(a["punkte"][9], 200))
pruefe("die Hoehe bleibt unveraendert", nah(a["punkte"][7], 100) and nah(a["punkte"][1], 0))

# Nach Nordwesten gezogen: unten/rechts bleibt liegen.
b = d["nw_doppelt"]
pruefe("Nordwest-Griff verdoppelt in beide Richtungen", nah(b["sx"], 2) and nah(b["sy"], 2))
pruefe("die Suedost-Ecke bleibt liegen",
       nah(b["punkte"][9], 100) and nah(b["punkte"][10], 100))
pruefe("die Nordwest-Ecke landet unter dem Finger",
       nah(b["punkte"][0], -100) and nah(b["punkte"][1], -100))

# Kantengriff oben: nur die Hoehe, und die untere Kante bleibt.
c = d["n_halb"]
pruefe("Nord-Griff laesst die Breite in Ruhe", nah(c["sx"], 1))
pruefe("Nord-Griff halbiert die Hoehe", nah(c["sy"], 0.5))
pruefe("die untere Kante bleibt liegen", nah(c["punkte"][7], 100))
pruefe("die obere Kante ist in die Mitte gewandert", nah(c["punkte"][1], 50))
pruefe("x bleibt unberuehrt", nah(c["punkte"][3], 100) and nah(c["punkte"][0], 0))

# Ueber den Anker hinaus: nicht umklappen, nicht auf null.
e = d["so_umgeklappt"]
pruefe("ueber den Anker hinaus klappt nichts um", e["sx"] > 0)
pruefe("und faellt auch nicht auf null zusammen", e["punkte"][3] >= 5)

# Westgriff: y bleibt, auch wenn der Finger weit daneben liegt.
f = d["w_nur_x"]
pruefe("West-Griff ruehrt y nicht an", nah(f["sy"], 1) and nah(f["punkte"][7], 100))
pruefe("West-Griff laesst die rechte Kante liegen", nah(f["punkte"][3], 100))
pruefe("die linke Kante landet unter dem Finger", nah(f["punkte"][0], -100))

shutil.rmtree(ordner, ignore_errors=True)
print()
print("ALLES GRUEN" if not fehler else f"{len(fehler)} Fehler")
sys.exit(1 if fehler else 0)
