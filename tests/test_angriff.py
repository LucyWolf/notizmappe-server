"""Was ein Mitarbeiter in eine Notiz schreiben kann - und was davon ankommt.

    .venv/bin/python tests/test_angriff.py

Am Desktop ist das eine Frage von Ordnung: dort schreibt man seine eigenen
Notizen und liest sie selbst. Am Server nicht. In einem Projekt schreibt der
eine, und der andere macht die Seite auf — im selben Browser, in dem auch
seine Sitzung steht. Was hier durchkommt, läuft bei jemand anderem.

Geprüft wird deshalb nicht der Reiniger für sich (der steht im Desktop-Repo),
sondern **der ganze Weg**: über die Brücke gespeichert, von der Platte
zurückgelesen. Dazwischen liegen die Stellen, an denen so etwas schiefgeht —
ein Feld, das am Reiniger vorbeigeht, oder eine spätere Fassung, die eines
dazunimmt.

Dazu die Anhänge: der Dateiname kommt aus dem Browser, und am Ende wird damit
eine Datei von der Platte ausgeliefert.
"""
import base64
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
DESKTOP = WURZEL / "desktop"
if not (DESKTOP / "app").is_dir():
    sys.exit(f"Erst das Desktop-Programm holen: {WURZEL}/tools/desktop_holen.sh")

DATEN = Path(tempfile.mkdtemp(prefix="notizangriff-test-"))
os.environ["NOTIZMAPPE_DATEN"] = str(DATEN)
os.environ["NOTIZMAPPE_DESKTOP"] = str(DESKTOP)
os.environ["NOTIZMAPPE_EINRICHTUNG"] = str(DATEN / "einrichtung")
os.environ["NOTIZMAPPE_QUELLE"] = "http://127.0.0.1:1"
os.environ.pop("NOTIZEN_ORDNER", None)
sys.path.insert(0, str(WURZEL / "web"))

from fastapi.testclient import TestClient                   # noqa: E402

import server                                               # noqa: E402

fehler = []


def pruefe(was, bedingung, extra=""):
    print(("  ok  " if bedingung else "FEHLER") + "  " + was
          + (f"   {extra}" if extra and not bedingung else ""))
    if not bedingung:
        fehler.append(was)


k = TestClient(server.app, follow_redirects=False)
k.post("/einrichten", data={"name": "chefin", "passwort": "chefinpasswort1",
                            "passwort2": "chefinpasswort1"})


def ruf(methode, *args):
    a = k.post(f"/bruecke/{methode}", json={"args": list(args)},
               headers={"X-Notizmappe": "1"})
    try:
        return a.json()
    except ValueError:
        return {}


buch = ruf("notizbuch_anlegen", "Probe")["name"]
teil = ruf("abschnitt_anlegen", buch, "Teil")["name"]
seite = ruf("seite_anlegen", buch, teil, "Seite")["name"]

# Was ein Browser beim Einfuegen wirklich herausgibt, und was ein Angreifer
# von Hand schickt. Letzteres geht nicht ueber die Oberflaeche, sondern als
# POST auf /bruecke - die Oberflaeche ist keine Schranke.
PROBEN = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<a href="javascript:alert(1)">klick</a>',
    '<a href="JaVaScRiPt:alert(1)">klick</a>',
    '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
    '<a href="vbscript:msgbox(1)">x</a>',
    '<svg onload=alert(1)></svg>',
    '<iframe src="https://fremd.example"></iframe>',
    '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>',
    '<p onmouseover="alert(1)">text</p>',
    '<SCRIPT>alert(1)</SCRIPT>',
    '<ScRiPt>alert(1)</ScRiPt>',
    '<img src="x" onerror="alert(1)"//>',
    '<p style="position:fixed;inset:0;z-index:9">überlagert alles</p>',
    '<font color="red" onclick="alert(1)">a</font>',
    '</p><script>a</script><p>',
    '<object data="x"></object><embed src="y">',
    '<form action="https://fremd.example"><input name="passwort"></form>',
    '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
    '<base href="https://fremd.example/">',
    '<link rel="stylesheet" href="https://fremd.example/x.css">',
    '<meta http-equiv="refresh" content="0;url=https://fremd.example">',
    '<textarea></textarea><script>a</script>',
    '<img src=x onerror=&#97;lert(1)>',
    '<div data-art="x\\" onload=\\"alert(1)">a</div>',
]

BOESE = re.compile(r"<\s*(script|iframe|object|embed|form|base|link|meta|style|svg)"
                   r"|\son[a-z]+\s*=|javascript:|vbscript:|srcdoc", re.I)

print("Was in einer Notiz stehen darf")
stand = ruf("seite_lesen", buch, teil, seite)
durch = []
for i, probe in enumerate(PROBEN):
    antwort = ruf("seite_speichern", {
        "notizbuch": buch, "abschnitt": teil, "name": seite, "titel": "Seite",
        "rev": stand.get("rev"),
        "elemente": [{"typ": "text", "x": 10, "y": 10, "b": 300, "html": probe}]})
    if "fehler" in antwort:
        durch.append(f"nicht gespeichert: {probe[:30]}")
        continue
    stand = ruf("seite_lesen", buch, teil, seite)
    gespeichert = "".join(str(e.get("html") or "") for e in stand.get("elemente") or [])
    if BOESE.search(gespeichert):
        durch.append(f"{probe[:34]} -> {gespeichert[:40]}")
pruefe(f"Keine der {len(PROBEN)} Proben kommt durch", not durch, " | ".join(durch[:3]))

# Und das Gegenstueck: was erlaubt ist, muss auch ankommen. Ein Reiniger, der
# alles wegwirft, bestuende jeden Angriffstest und waere trotzdem kaputt.
gut = '<p><b>fett</b> <i>kursiv</i> <a href="https://example.com/x">Link</a> ' \
      '<font size="4">gross</font></p>'
ruf("seite_speichern", {"notizbuch": buch, "abschnitt": teil, "name": seite,
                        "titel": "Seite", "rev": stand.get("rev"),
                        "elemente": [{"typ": "text", "x": 10, "y": 10, "b": 300,
                                      "html": gut}]})
stand = ruf("seite_lesen", buch, teil, seite)
behalten = "".join(str(e.get("html") or "") for e in stand.get("elemente") or [])
pruefe("Fett, kursiv, Link und Schriftgröße bleiben stehen",
       all(t in behalten for t in ("<b>", "<i>", 'href="https://example.com/x"',
                                   'size="4"')), behalten)

# Der Titel wird nicht gereinigt, und das ist richtig so: er landet in einem
# Eingabefeld (.value) und in der Leiste (textContent). Beides setzt Text,
# kein HTML. Gefaehrlich waere nur, ihn irgendwo als HTML einzusetzen -
# deshalb wird hier nachgesehen, dass mappe.js das nirgends tut.
print("\nDer Titel")
ruf("seite_umbenennen", buch, teil, seite, '<img src=x onerror=alert(1)>')
titel = ""
for b in ruf("baum").get("notizbuecher") or []:
    for a in b.get("abschnitte") or []:
        for s in a.get("seiten") or []:
            titel = s.get("titel") or ""
pruefe("Der Titel kommt unveraendert zurueck - er ist Text", "<img" in titel, titel)
_mappe = (DESKTOP / "app/oberflaeche/mappe.js").read_text(encoding="utf-8")
_hinein = [z.strip() for z in _mappe.splitlines()
           if re.search(r"\.innerHTML\s*=", z)]
# Seit die Formatleiste in der gemeinsamen Oberflaeche liegt, gibt es eine
# zweite Stelle: die Knoepfe bekommen ihr Zeichen als SVG. Das ist eine feste
# Zeichenkette aus dem Programm, kein Text aus einer Notiz - sie steht
# deshalb namentlich hier und nicht als Ausnahme "irgendwas mit innerHTML".
ERLAUBT_HTML = ("e.html", "k.innerHTML = inhalt;")
pruefe("In mappe.js wird nur Gereinigtes und Eigenes als HTML eingesetzt",
       _hinein and all(any(g in z for g in ERLAUBT_HTML) for z in _hinein),
       _hinein[:3])
pruefe("und das Eigene ist ein Bild aus dem Programm, kein Text von aussen",
       "function flBild" in _mappe and "<svg class=\"fl-bild\"" in _mappe)
pruefe("und der Titel nirgends",
       not any("titel" in z.lower() for z in _hinein), _hinein[:3])

print("\nAnhänge")
neu = ruf("seite_anlegen", buch, teil, "Anhangseite")["name"]
inhalt = base64.b64encode(b"<html><script>alert(1)</script>").decode()
abgelegt = ruf("anhang_ablegen", buch, teil, neu, "../../../ausbruch.html", inhalt)
pruefe("Der Anhang wird angenommen", "fehler" not in abgelegt, abgelegt)
name_drin = abgelegt.get("datei") or ""
# Die Punkte duerfen im Namen stehen bleiben - gefaehrlich sind die
# Trennzeichen, und ein Name, der mit einem Punkt anfaengt.
pruefe("Aus ../../../ wird ein flacher Dateiname",
       bool(name_drin) and "/" not in name_drin and "\\" not in name_drin
       and not name_drin.startswith("."), name_drin)
seitenordner = DATEN / "notizen" / "chefin" / buch / teil
pruefe("Und die Datei liegt im Anhangsordner der Seite, nirgends sonst",
       [p.relative_to(DATEN) for p in DATEN.glob("**/*ausbruch*")] == []
       or all(p.parent.parent == seitenordner for p in DATEN.glob("**/*ausbruch*")),
       [str(p.relative_to(DATEN)) for p in DATEN.glob("**/*ausbruch*")])
a = k.get(f"/anhang?notizbuch={buch}&abschnitt={teil}&name={neu}&datei={name_drin}")
pruefe("Er kommt nur als Download heraus, nie als Seite",
       a.headers.get("content-type") == "application/octet-stream"
       and "attachment" in a.headers.get("content-disposition", "")
       and a.headers.get("x-content-type-options") == "nosniff",
       dict(a.headers))

for weg in (f"/anhang?notizbuch={buch}&abschnitt={teil}&name={neu}&datei=../../../benutzer.json",
            f"/anhang?notizbuch=../..&abschnitt={teil}&name={neu}&datei={name_drin}",
            f"/anhang?notizbuch={buch}&abschnitt=../../..&name={neu}&datei={name_drin}",
            "/anhang?notizbuch=.&abschnitt=.&name=.&datei=benutzer.json"):
    a = k.get(weg)
    pruefe(f"Kein Ausbruch über {weg.split('&')[1][:28]}…",
           a.status_code != 200 or b"salz" not in a.content,
           (a.status_code, a.content[:60]))

shutil.rmtree(DATEN, ignore_errors=True)
print()
if fehler:
    print(f"{len(fehler)} Prüfungen gescheitert")
    sys.exit(1)
print("Was in einer Notiz steht, läuft bei niemandem")
