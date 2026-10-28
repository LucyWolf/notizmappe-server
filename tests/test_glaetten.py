"""Glättet das Glätten, ohne den Strich zu verbiegen?

    .venv/bin/python tests/test_glaetten.py

Gemessen wird am Weg, nicht an den Punkten. Das ist der Unterschied, an dem
dieser Test schon einmal falsch grün war: zählt man die Abweichung je Punkt,
misst man die Punktauswahl mit. Das Ausdünnen behält gerade die Ausreißer, also
sieht ein geglätteter Strich dort schlechter aus als der gezogene - obwohl die
Linie auf dem Bildschirm ruhiger ist.

Deshalb zwei ehrliche Maße, beide entlang der Strecken abgetastet:
* **Treue** - mittlerer Abstand zur Kurve, die die Hand gemeint hat.
* **Wackeln** - mittlere Richtungsänderung je Bildpunkt Weg.

Glätten muss das Wackeln deutlich senken, ohne die Treue zu verschlechtern.
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
for name in ("abstand", "ausduennen", "ecken_runden", "geglaettet"):
    treffer = re.search(r"^  function " + name + r"\(.*?^  \}", shim, re.S | re.M)
    pruefe(f"{name} steht in shim.js", bool(treffer))
    if treffer:
        teile.append(treffer.group(0))
if fehler:
    sys.exit(1)

HARNISCH = "\n".join(teile) + r"""
/* Eine Maushand: eine glatte Welle, darauf Zittern. Die Punkte liegen rund
   zwei Bildpunkte auseinander - so kommen sie drueben auch an. */
let saat = 7;
const zuf = () => (saat = (saat * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5;
const ideal = [], echt = [];
for (let i = 0; i <= 150; i++) {
  ideal.push(i * 2, 40 * Math.sin(i / 25));
  echt.push(i * 2 + zuf() * 1.2, 40 * Math.sin(i / 25) + zuf() * 1.6, 0.5);
}

function zuStrecke(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
function zurKurve(x, y) {
  let b = 1e9;
  for (let k = 0; k < ideal.length - 2; k += 2) {
    b = Math.min(b, zuStrecke(x, y, ideal[k], ideal[k + 1], ideal[k + 2], ideal[k + 3]));
  }
  return b;
}
function treue(g) {
  let s = 0, n = 0;
  for (let i = 0; i < g.length - 3; i += 3) {
    const d = Math.hypot(g[i + 3] - g[i], g[i + 4] - g[i + 1]);
    const schritte = Math.max(1, Math.ceil(d));
    for (let k = 0; k < schritte; k++) {
      const t = k / schritte;
      s += zurKurve(g[i] + (g[i + 3] - g[i]) * t, g[i + 1] + (g[i + 4] - g[i + 1]) * t);
      n++;
    }
  }
  return s / n;
}
function wackeln(g) {
  let w = 0, l = 0;
  for (let i = 3; i < g.length - 3; i += 3) {
    const a = Math.atan2(g[i + 1] - g[i - 2], g[i] - g[i - 3]);
    const b = Math.atan2(g[i + 4] - g[i + 1], g[i + 3] - g[i]);
    let d = Math.abs(b - a);
    if (d > Math.PI) d = 2 * Math.PI - d;
    w += d;
    l += Math.hypot(g[i + 3] - g[i], g[i + 4] - g[i + 1]);
  }
  return l ? w / l : 0;
}
// Eine mit Absicht gezogene Ecke: nach rechts, dann nach unten.
const ecke = [];
for (let i = 0; i <= 100; i++) ecke.push(i, 0, 0.5);
for (let i = 1; i <= 100; i++) ecke.push(100, i, 0.5);

const raus = { roh: { treue: treue(echt), wackeln: wackeln(echt), punkte: echt.length / 3 } };
for (const stufe of ['aus', 'leicht', 'stark']) {
  const g = geglaettet(echt.slice(), stufe);
  raus[stufe] = { treue: treue(g), wackeln: wackeln(g), punkte: g.length / 3,
                  anfang: [g[0], g[1]], ende: [g[g.length - 3], g[g.length - 2]],
                  druck: g.filter((w, i) => i % 3 === 2),
                  teilbar: g.length % 3 === 0 };
  const e = geglaettet(ecke.slice(), stufe);
  let nah = 1e9;
  for (let i = 0; i < e.length; i += 3) nah = Math.min(nah, Math.hypot(e[i] - 100, e[i + 1]));
  raus[stufe].ecke_nah = nah;
  raus[stufe].ecke_enden = [e[0], e[1], e[e.length - 3], e[e.length - 2]];
}
raus.kurz = geglaettet([1, 2, 0.5, 3, 4, 0.5], 'stark');
console.log(JSON.stringify(raus));
"""

ordner = Path(tempfile.mkdtemp(prefix="notiz-glatt-"))
(ordner / "pruef.js").write_text(HARNISCH, encoding="utf-8")
if shutil.which("node"):
    befehl = ["node", str(ordner / "pruef.js")]
elif shutil.which("docker"):
    befehl = ["docker", "run", "--rm", "-v", f"{ordner}:/p:ro", "node:alpine", "node", "/p/pruef.js"]
else:
    print("  --  weder node noch docker da, Glätten ungeprueft")
    sys.exit(0)

lauf = subprocess.run(befehl, capture_output=True, text=True)
pruefe("der Harnisch laeuft durch", lauf.returncode == 0, lauf.stderr.strip()[-300:])
if fehler:
    sys.exit(1)
d = json.loads(lauf.stdout)
roh = d["roh"]
print(f"        gezogen: Treue {roh['treue']:.3f}, Wackeln {roh['wackeln']:.4f}, "
      f"{roh['punkte']} Punkte")

pruefe("'aus' ruehrt nichts an",
       d["aus"]["punkte"] == roh["punkte"] and abs(d["aus"]["wackeln"] - roh["wackeln"]) < 1e-9)

for stufe, wackel_ziel, ecke_luft in (("leicht", 0.6, 4.0), ("stark", 0.2, 12.0)):
    g = d[stufe]
    print(f"        {stufe}: Treue {g['treue']:.3f}, Wackeln {g['wackeln']:.4f}, "
          f"{g['punkte']} Punkte")
    pruefe(f"'{stufe}' nimmt das Wackeln heraus",
           g["wackeln"] < wackel_ziel * roh["wackeln"],
           f"{g['wackeln']:.4f} statt unter {wackel_ziel * roh['wackeln']:.4f}")
    pruefe(f"'{stufe}' trifft die gemeinte Kurve nicht schlechter",
           g["treue"] <= roh["treue"] + 0.02, f"{g['treue']:.3f} gegen {roh['treue']:.3f}")
    pruefe(f"'{stufe}' braucht nicht mehr Punkte als der gezogene Strich",
           g["punkte"] <= roh["punkte"], f"{g['punkte']} statt {roh['punkte']}")
    pruefe(f"'{stufe}' laesst den Anfang liegen",
           abs(g["anfang"][0]) < 1.5 and abs(g["anfang"][1]) < 2,
           str(g["anfang"]))
    pruefe(f"'{stufe}' laesst das Ende liegen", abs(g["ende"][0] - 300) < 1.5, str(g["ende"]))
    pruefe(f"'{stufe}' haelt die Punkte dreiteilig und den Druck im Rahmen",
           g["teilbar"] and all(0 <= w <= 1 for w in g["druck"]))
    pruefe(f"'{stufe}' schneidet eine gewollte Ecke nicht ab",
           g["ecke_nah"] < ecke_luft, f"naechster Punkt {g['ecke_nah']:.1f} daneben")
    pruefe(f"'{stufe}' behaelt beide Enden der Ecke",
           g["ecke_enden"] == [0, 0, 100, 100])

pruefe("'stark' glaettet staerker als 'leicht'", d["stark"]["wackeln"] < d["leicht"]["wackeln"])
pruefe("ein zu kurzer Strich bleibt, wie er ist", d["kurz"] == [1, 2, 0.5, 3, 4, 0.5])

shutil.rmtree(ordner, ignore_errors=True)
print()
print("ALLES GRUEN" if not fehler else f"{len(fehler)} Fehler")
sys.exit(1 if fehler else 0)
