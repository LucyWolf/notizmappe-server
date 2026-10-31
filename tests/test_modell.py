"""Liest shim.js STL und OBJ richtig - und liegt das Modell dann im Bild?

    .venv/bin/python tests/test_modell.py

Hier laeuft kein Browser, also ist das Zeichnen selbst nicht zu pruefen - wie
es aussieht, sieht Lucy zuerst. Pruefbar ist aber alles, was davor schiefgehen
kann, und das ist das meiste:

  * binaer oder Text? Viele binaere STL fangen ebenfalls mit "solid" an - wer
    danach entscheidet, liest Muell.
  * Normalen: die in der Datei stehen oft auf 0 oder zeigen falsch, deshalb
    werden sie neu gerechnet. Steht hier eine falsche drin, muss sie ignoriert
    werden.
  * OBJ: Vielecke, Schraegstrich-Formen (7/3/2) und negative Nummern.
  * und die Matrizen: ein Vorzeichen daneben und das Teil steht hinter der
    Kamera. Darum wandern die Ecken des Wuerfels durch die echte Matrix aus
    modellZeichnen und muessen im Bild liegen - in jeder Drehung.
"""
import base64
import json
import re
import shutil
import struct
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
for muster, name in ((r"^  const MODELL_ARTEN = [^\n]*$", "MODELL_ARTEN"),
                     (r"^  const MODELL_MAX_DREIECKE = [^\n]*$", "MODELL_MAX_DREIECKE"),
                     (r"^  const MODELL_WEG = [^\n]*$", "MODELL_WEG"),
                     (r"^  function modellArt\(.*?^  \}", "modellArt"),
                     (r"^  function stlLesen\(.*?^  \}", "stlLesen"),
                     (r"^  function stlBinaer\(.*?^  \}", "stlBinaer"),
                     (r"^  function stlText\(.*?^  \}", "stlText"),
                     (r"^  function objLesen\(.*?^  \}", "objLesen"),
                     (r"^  function netzBauen\(.*?^  \}", "netzBauen"),
                     (r"^  function matEinheit\(.*?^  \}", "matEinheit"),
                     (r"^  function matMal\(.*?^  \}", "matMal"),
                     (r"^  function matPerspektive\(.*?^  \}", "matPerspektive"),
                     (r"^  function matSchieben\(.*?^  \}", "matSchieben"),
                     (r"^  function matSkala\(.*?^  \}", "matSkala"),
                     (r"^  function matDrehX\(.*?^  \}", "matDrehX"),
                     (r"^  function matDrehY\(.*?^  \}", "matDrehY"),
                     (r"^  function mat3Von\(.*?^  \}", "mat3Von"),
                     (r"^  function modellZeichnen\(.*?^  \}", "modellZeichnen")):
    treffer = re.search(muster, shim, re.S | re.M)
    pruefe(f"{name} steht in shim.js", bool(treffer))
    if treffer:
        teile.append(treffer.group(0))
if fehler:
    sys.exit(1)


# --- Dateien bauen -----------------------------------------------------------
def stl_binaer(dreiecke, kopf=b"solid aus einem Programm, das luegt"):
    # Der Kopf fangt absichtlich mit "solid" an: genau daran scheitern Leser,
    # die nach dem ersten Wort entscheiden.
    daten = kopf.ljust(80, b" ")[:80] + struct.pack("<I", len(dreiecke))
    for ecken in dreiecke:
        daten += struct.pack("<3f", 9.0, 9.0, 9.0)          # falsche Normale
        for e in ecken:
            daten += struct.pack("<3f", *e)
        daten += struct.pack("<H", 0)
    return daten


ZWEI = stl_binaer([
    [(0, 0, 0), (1, 0, 0), (0, 1, 0)],     # Normale muss (0,0,1) werden
    [(0, 0, 0), (0, 1, 0), (1, 0, 0)],     # verkehrt herum -> (0,0,-1)
])

TEXT_STL = """solid eins
  facet normal 0 0 0
    outer loop
      vertex 0 0 0
      vertex 2e0 0 0
      vertex 0 2 0
    endloop
  endfacet
endsolid eins
""".encode()

OBJ = """# ein Viereck und zweimal dasselbe Dreieck anders geschrieben
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
f 1 2 3 4
f 1/1/1 2/2/2 3/3/3
f -4 -3 -2
""".encode()

ECKEN = [(x, y, z) for x in (0, 10) for y in (0, 10) for z in (0, 10)]
WUERFEL = stl_binaer([
    [(0, 0, 0), (10, 0, 0), (10, 10, 0)], [(0, 0, 0), (10, 10, 0), (0, 10, 0)],
    [(0, 0, 10), (10, 0, 10), (10, 10, 10)], [(0, 0, 10), (10, 10, 10), (0, 10, 10)],
    [(0, 0, 0), (0, 0, 10), (0, 10, 10)], [(0, 0, 0), (0, 10, 10), (0, 10, 0)],
    [(10, 0, 0), (10, 0, 10), (10, 10, 10)], [(10, 0, 0), (10, 10, 10), (10, 10, 0)],
    [(0, 0, 0), (10, 0, 0), (10, 0, 10)], [(0, 0, 0), (10, 0, 10), (0, 0, 10)],
    [(0, 10, 0), (10, 10, 0), (10, 10, 10)], [(0, 10, 0), (10, 10, 10), (0, 10, 10)],
])

HARNISCH = r"""
const window = { devicePixelRatio: 2 };
function bytes(b64) {
  const roh = Buffer.from(b64, 'base64');
  return roh.buffer.slice(roh.byteOffset, roh.byteOffset + roh.byteLength);
}
""" + "\n".join(teile) + r"""

/* Ein gefaelschtes WebGL: es rechnet nicht, es schreibt mit. */
function glAttrappe() {
  const notiert = { mvp: null, dreh: null, gezeichnet: null, sichtfeld: null };
  return {
    notiert,
    gl: {
      COLOR_BUFFER_BIT: 1, DEPTH_BUFFER_BIT: 2, TRIANGLES: 4,
      viewport: (x, y, b, h) => { notiert.sichtfeld = [x, y, b, h]; },
      clear: () => {},
      uniformMatrix4fv: (_wo, _t, m) => { notiert.mvp = Array.from(m); },
      uniformMatrix3fv: (_wo, _t, m) => { notiert.dreh = Array.from(m); },
      drawArrays: (_art, _ab, zahl) => { notiert.gezeichnet = zahl; },
    },
  };
}

function werfen(m, p) {
  // spaltenweise: m[spalte * 4 + zeile]
  const o = [0, 1, 2, 3].map((z) =>
    m[0 * 4 + z] * p[0] + m[1 * 4 + z] * p[1] + m[2 * 4 + z] * p[2] + m[3 * 4 + z]);
  return { x: o[0], y: o[1], z: o[2], w: o[3] };
}

const ergebnis = {};
const AUFGABE = JSON.parse(process.argv[2]);

/* 1. Binaer, mit "solid" im Kopf */
const zwei = netzBauen(stlLesen(bytes(AUFGABE.zwei)));
ergebnis.zwei_dreiecke = zwei.dreiecke;
ergebnis.zwei_punkte = Array.from(zwei.punkte);
ergebnis.zwei_normalen = Array.from(zwei.normalen).map((w) => Math.round(w * 1000) / 1000);

/* 2. Text-STL */
const text = netzBauen(stlLesen(bytes(AUFGABE.text)));
ergebnis.text_dreiecke = text.dreiecke;
ergebnis.text_punkte = Array.from(text.punkte);

/* 3. OBJ */
const obj = netzBauen(objLesen(bytes(AUFGABE.obj)));
ergebnis.obj_dreiecke = obj.dreiecke;
ergebnis.obj_punkte = Array.from(obj.punkte);

/* 4. Namen */
ergebnis.arten = ['teil.stl', 'TEIL.STL', 'ding.obj', 'plan.3mf', 'bild.png', 'ohne']
  .map((n) => modellArt(n));

/* 5. Der Wuerfel durch die echte Matrix */
const wuerfel = netzBauen(stlLesen(bytes(AUFGABE.wuerfel)));
ergebnis.wuerfel_mitte = wuerfel.mitte;
ergebnis.wuerfel_radius = Math.round(wuerfel.radius * 1000) / 1000;

const attrappe = glAttrappe();
const z = {
  bild: { clientWidth: 320, clientHeight: 240, width: 0, height: 0 },
  glz: { gl: attrappe.gl, mvp: 'mvp', dreh: 'dreh' },
  netz: wuerfel, seite: 0.6, hoehe: -0.5, weg: MODELL_WEG,
};
modellZeichnen(z);
ergebnis.puffergroesse = [z.bild.width, z.bild.height];
ergebnis.sichtfeld = attrappe.notiert.sichtfeld;
ergebnis.gezeichnet = attrappe.notiert.gezeichnet;

ergebnis.drehungen = [];
for (const [seite, hoehe] of [[0.6, -0.5], [0, 0], [1.5, 1.5], [3.1, -1.5], [-2.2, 0.7]]) {
  z.seite = seite; z.hoehe = hoehe;
  modellZeichnen(z);
  const m = attrappe.notiert.mvp;
  let drin = true, vorne = true, rand = 0;
  for (const e of AUFGABE.ecken) {
    const o = werfen(m, e);
    if (o.w <= 0) vorne = false;
    const dx = Math.abs(o.x / o.w), dy = Math.abs(o.y / o.w);
    if (dx > 1 || dy > 1) drin = false;
    rand = Math.max(rand, dx, dy);
  }
  ergebnis.drehungen.push({ seite, hoehe, drin, vorne, rand: Math.round(rand * 100) / 100 });
}

/* 6. Die Drehmatrix fuer die Normalen muss die Laengen lassen */
const laengen = [0, 1, 2].map((s) => {
  const d = attrappe.notiert.dreh;
  return Math.round(Math.sqrt(d[s * 3] ** 2 + d[s * 3 + 1] ** 2 + d[s * 3 + 2] ** 2) * 1000) / 1000;
});
ergebnis.drehlaengen = laengen;

console.log(JSON.stringify(ergebnis));
"""

aufgabe = json.dumps({
    "zwei": base64.b64encode(ZWEI).decode(),
    "text": base64.b64encode(TEXT_STL).decode(),
    "obj": base64.b64encode(OBJ).decode(),
    "wuerfel": base64.b64encode(WUERFEL).decode(),
    "ecken": ECKEN,
})

ordner = Path(tempfile.mkdtemp(prefix="modell-"))
(ordner / "pruef.js").write_text(HARNISCH, encoding="utf-8")
if shutil.which("node"):
    befehl = ["node", str(ordner / "pruef.js"), aufgabe]
elif shutil.which("docker"):
    (ordner / "aufgabe.json").write_text(aufgabe, encoding="utf-8")
    befehl = ["docker", "run", "--rm", "-v", f"{ordner}:/p:ro", "node:alpine", "sh", "-c",
              'node /p/pruef.js "$(cat /p/aufgabe.json)"']
else:
    print("  --  weder node noch docker da, die Modelle sind ungeprueft")
    sys.exit(0)

lauf = subprocess.run(befehl, capture_output=True, text=True)
if lauf.returncode != 0:
    print(lauf.stdout)
    print(lauf.stderr)
    sys.exit(1)
d = json.loads(lauf.stdout.strip().splitlines()[-1])

print("\nSTL, binaer")
pruefe("zwei Dreiecke, obwohl der Kopf mit \"solid\" anfaengt",
       d["zwei_dreiecke"] == 2, d["zwei_dreiecke"])
pruefe("die Ecken stehen richtig",
       d["zwei_punkte"] == [0, 0, 0, 1, 0, 0, 0, 1, 0,
                            0, 0, 0, 0, 1, 0, 1, 0, 0], d["zwei_punkte"])
# Die Datei behauptet (9,9,9) fuer beide Dreiecke. Wer sie glaubt, sieht nichts.
pruefe("die falsche Normale aus der Datei wird nicht geglaubt",
       9 not in d["zwei_normalen"], d["zwei_normalen"])
pruefe("sie wird aus den Ecken gerechnet - vorne (0,0,1)",
       d["zwei_normalen"][0:9] == [0, 0, 1] * 3, d["zwei_normalen"][0:9])
pruefe("und beim verkehrt herum gewickelten Dreieck (0,0,-1)",
       d["zwei_normalen"][9:18] == [0, 0, -1] * 3, d["zwei_normalen"][9:18])

print("\nSTL als Text")
pruefe("ein Dreieck", d["text_dreiecke"] == 1, d["text_dreiecke"])
pruefe("auch 2e0 wird als 2 gelesen",
       d["text_punkte"] == [0, 0, 0, 2, 0, 0, 0, 2, 0], d["text_punkte"])

print("\nOBJ")
pruefe("das Viereck wird zu zwei Dreiecken, die drei f-Zeilen zu vier",
       d["obj_dreiecke"] == 4, d["obj_dreiecke"])
pruefe("das Viereck als Faecher: 1-2-3 und 1-3-4",
       d["obj_punkte"][0:18] == [0, 0, 0, 1, 0, 0, 1, 1, 0,
                                 0, 0, 0, 1, 1, 0, 0, 1, 0], d["obj_punkte"][0:18])
pruefe("die Form 7/3/2 nimmt die erste Zahl",
       d["obj_punkte"][18:27] == [0, 0, 0, 1, 0, 0, 1, 1, 0], d["obj_punkte"][18:27])
pruefe("negative Nummern zaehlen vom Ende",
       d["obj_punkte"][27:36] == [0, 0, 0, 1, 0, 0, 1, 1, 0], d["obj_punkte"][27:36])

print("\nWelche Dateien ueberhaupt")
pruefe("stl und obj, gross oder klein geschrieben",
       d["arten"] == ["stl", "stl", "obj", None, None, None], d["arten"])

print("\nDie Matrix")
pruefe("die Mitte des Wuerfels ist seine Mitte",
       d["wuerfel_mitte"] == [5, 5, 5], d["wuerfel_mitte"])
# Kugel um den Wuerfel: halbe Raumdiagonale, 10*sqrt(3)/2 = 8.66
pruefe("der Radius ist die halbe Raumdiagonale",
       abs(d["wuerfel_radius"] - 8.660) < 0.002, d["wuerfel_radius"])
pruefe("die Zeichenflaeche folgt der Bildschirmdichte",
       d["puffergroesse"] == [640, 480] and d["sichtfeld"] == [0, 0, 640, 480], d)
pruefe("gezeichnet werden alle 36 Eckpunkte", d["gezeichnet"] == 36, d["gezeichnet"])
for dr in d["drehungen"]:
    pruefe(f"in der Drehung {dr['seite']}/{dr['hoehe']} liegt der Wuerfel vor der Kamera",
           dr["vorne"], dr)
    pruefe(f"... und ganz im Bild (Rand {dr['rand']})", dr["drin"], dr)
pruefe("das Teil fuellt das Bild auch aus (nicht winzig in der Mitte)",
       max(dr["rand"] for dr in d["drehungen"]) > 0.45,
       [dr["rand"] for dr in d["drehungen"]])
pruefe("die Drehmatrix der Normalen laesst die Laengen",
       all(abs(w - 1) < 0.002 for w in d["drehlaengen"]), d["drehlaengen"])

shutil.rmtree(ordner, ignore_errors=True)
print()
if fehler:
    print(f"{len(fehler)} Prüfungen gescheitert")
    sys.exit(1)
print("STL und OBJ werden richtig gelesen")
