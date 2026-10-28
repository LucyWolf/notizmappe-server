"""Sieht die Serverfassung noch genauso aus wie der Desktop?

    .venv/bin/python tests/test_gleich.py

Das ist der Test, der die eigentliche Zusage hält: **eine** Oberfläche, nicht
zwei. Geprüft wird deshalb nicht "sieht ähnlich aus", sondern:

1. In diesem Repo liegt **keine Kopie** von index.html, mappe.js oder stil.css.
   Eine Kopie wäre der Anfang des Auseinanderlaufens, und niemand merkt es.
2. Was der Server ausliefert, ist Byte für Byte die Datei aus dem Desktop.
3. An index.html ist genau **eine** Zeile eingesetzt (das shim.js) und sonst
   nichts.
4. Die geholte Fassung ist die, die in DESKTOP_VERSION steht.
"""
import hashlib
import os
import re
import sys
import tempfile
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
DESKTOP = WURZEL / "desktop"
fehler = []


def pruefe(was, bedingung, extra=""):
    print(("  ok  " if bedingung else "FEHLER") + "  " + was + (f"   {extra}" if extra and not bedingung else ""))
    if not bedingung:
        fehler.append(was)


if not (DESKTOP / "app").is_dir():
    sys.exit(f"Erst holen: DESKTOP_PFAD=../notizmappe {WURZEL}/tools/desktop_holen.sh")

# --- 1. Keine Kopien in diesem Repo -----------------------------------------
EIGEN = {"shim.js", "anmelden.html", "einrichten.html", "benutzer.html"}
kopien = []
for p in WURZEL.rglob("*"):
    if not p.is_file():
        continue
    teile = set(p.parts)
    if {".git", ".venv", "desktop", "daten", "__pycache__"} & teile:
        continue
    if p.name in ("index.html", "mappe.js", "stil.css") and p.name not in EIGEN:
        kopien.append(str(p.relative_to(WURZEL)))
pruefe("keine Kopie der Oberflaeche in diesem Repo", not kopien, ", ".join(kopien))

# Auch kein nachgebauter Stil: eigene CSS-Dateien gibt es hier nicht.
eigenes_css = [str(p.relative_to(WURZEL)) for p in WURZEL.rglob("*.css")
               if not {".git", ".venv", "desktop", "daten"} & set(p.parts)]
pruefe("kein eigenes CSS - der Stil kommt aus dem Desktop", not eigenes_css, ", ".join(eigenes_css))

# --- 2./3. Was ausgeliefert wird -------------------------------------------
DATEN = Path(tempfile.mkdtemp(prefix="notizserver-gleich-"))
os.environ["NOTIZMAPPE_DATEN"] = str(DATEN)
os.environ["NOTIZMAPPE_DESKTOP"] = str(DESKTOP)
os.environ["NOTIZMAPPE_QUELLE"] = "http://127.0.0.1:1"
sys.path.insert(0, str(WURZEL / "web"))

from fastapi.testclient import TestClient                   # noqa: E402

import server                                               # noqa: E402

server.nutzer.anlegen("pruefer", "pruefpasswort", verwalter=True)
k = TestClient(server.app, follow_redirects=False)
k.post("/anmelden", data={"name": "pruefer", "passwort": "pruefpasswort"})


def summe(roh: bytes) -> str:
    return hashlib.sha256(roh).hexdigest()[:16]


for datei in ("mappe.js", "stil.css", "icon.png", "icon-128.png"):
    geliefert = k.get("/" + datei).content
    original = (DESKTOP / "app/oberflaeche" / datei).read_bytes()
    pruefe(f"{datei} ist Byte fuer Byte die Desktop-Datei", geliefert == original,
           f"{summe(geliefert)} statt {summe(original)}")

geliefert = k.get("/").text
original = (DESKTOP / "app/oberflaeche/index.html").read_text(encoding="utf-8")
zusatz = [z for z in geliefert.splitlines() if z not in original.splitlines()]
pruefe("an index.html ist genau eine Zeile eingesetzt", len(zusatz) == 1, str(zusatz))
pruefe("und zwar das shim.js", len(zusatz) == 1 and "shim.js" in zusatz[0], str(zusatz))
pruefe("sonst ist index.html unveraendert",
       geliefert.replace(zusatz[0] + "\n", "") == original if len(zusatz) == 1 else False)

# --- 4. Die Fassung stimmt ---------------------------------------------------
soll = (WURZEL / "DESKTOP_VERSION").read_text(encoding="utf-8").strip()
drin = (DESKTOP / "app/VERSION").read_text(encoding="utf-8").strip()
if os.environ.get("DESKTOP_PFAD"):
    print(f"  --  Fassungsvergleich uebersprungen (aus dem Arbeitsordner: {drin})")
else:
    pruefe(f"geholt wurde die Fassung aus DESKTOP_VERSION ({soll})", soll == drin, drin)

# Und die Oberflaeche redet wirklich nur ueber die eine Schnittstelle - sonst
# haette der Stellvertreter Luecken.
js = (DESKTOP / "app/oberflaeche/mappe.js").read_text(encoding="utf-8")
anders = set(re.findall(r"window\.pywebview\.(\w+)", js)) - {"api"}
pruefe("die Oberflaeche benutzt nur window.pywebview.api", not anders, str(anders))

# --- Der Stellvertreter muss überhaupt laufen können -------------------------
#
# Er wird vom Browser ausgeführt, nicht von Python - ein Tippfehler darin fällt
# sonst erst dort auf, und zwar als tote Oberfläche. Genau das ist mir beim
# Vereinfachen der Rollen passiert: eine Klammer zu viel, alle Tests grün.
try:
    import esprima

    esprima.parseScript((WURZEL / "web/shim.js").read_text(encoding="utf-8"))
    pruefe("shim.js lässt sich überhaupt lesen", True)
except ImportError:
    print("  --  esprima fehlt, Syntax von shim.js ungeprüft (pip install esprima)")
except Exception as f:                                              # noqa: BLE001
    pruefe("shim.js lässt sich überhaupt lesen", False, str(f))

# --- Woran der Stellvertreter sich festhaelt ---------------------------------
#
# shim.js haengt eigene Bedienelemente an Stellen der gemeinsamen Oberflaeche:
# das Profil an die Fussleiste, die Bereichswahl ans Band, die Menuepunkte an
# die Reiter der Datei-Ebene. Verschwindet dort drueben eine id, baut der
# Stellvertreter stillschweigend nichts mehr - kein Fehler, keine Meldung, nur
# ein fehlender Knopf. Genau diese Sorte Fehler faellt sonst erst dem Menschen
# vor dem Bildschirm auf.
html = (DESKTOP / "app/oberflaeche/index.html").read_text(encoding="utf-8")
for anker in ('id="zahnrad"', 'class="fussrechts"',
              'id="dateileiste"', 'class="dateipunkt"', 'class="dateiseite"',
              'data-punkt="konto"', 'data-punkt="optionen"',
              'id="e-version"', 'id="e-verfuegbar"', 'id="e-updatehinweis"'):
    pruefe(f"die Oberflaeche hat noch {anker}", anker in html)

# Dasselbe fuer die Farben: eine selbst erfundene Farbe hier waere der weisse
# Fleck, der schon einmal aufgefallen ist.
stil = (DESKTOP / "app/oberflaeche/stil.css").read_text(encoding="utf-8")
shim = (WURZEL / "web/shim.js").read_text(encoding="utf-8")
benutzt = set(re.findall(r"var\((--[a-z-]+)\)", shim))
fehlend = sorted(v for v in benutzt if f"{v}:" not in stil)
pruefe("shim.js benutzt nur Farben, die es gibt", not fehlend, str(fehlend))

# --- Woran das Markieren von Strichen haengt ------------------------------
#
# shim.js greift fuer den Auswahlrahmen auf Namen aus mappe.js zu - das geht,
# weil beide im selben globalen Skript-Kontext laufen. Praktisch, aber der wunde
# Punkt: benennt drueben jemand "gewaehlt" oder "strichGrenzen" um, faellt der
# Rahmen lautlos aus. Kein Fehler, keine Meldung, nur ein fehlender Kasten.
for name, muster in (("gewaehlt", r"^let gewaehlt\b"),
                     ("werkzeug", r"^let werkzeug\b"),
                     ("Klasse 'an' am Werkzeug", r"classList\.toggle\('an'"),
                     ("strichGrenzen", r"^function strichGrenzen\b"),
                     ("malblatt.id", r"malblatt\.id = 'malblatt'"),
                     ("Lasso-Knopf", r'data-werkzeug="lasso"'),
                     ("malzeug-Leiste", r'id="malzeug"')):
    wo = html if name in ("Lasso-Knopf", "malzeug-Leiste") else js
    pruefe(f"mappe.js hat noch {name}", bool(re.search(muster, wo, re.M)))

# Und der Tastenweg, den der Loeschen-Knopf benutzt: er schickt Delete, statt
# die Striche selbst anzufassen - damit Rueckgaengig und Speichern weiter
# ueber dieselbe Stelle laufen.
pruefe("Delete loescht drueben die Auswahl",
       bool(re.search(r"ev\.key === 'Delete'", js)))

# Das Markieren rechnet den getroffenen Strich selbst aus, statt Ereignisse
# nachzustellen. Es haengt damit an drei Dingen drueben - fallen die weg, passiert
# wieder lautlos nichts.
pruefe("ein Strich haelt seine Punkte flach in p (x, y, Druck)",
       bool(re.search(r"i < st\.p\.length; i \+= 3", js)))
pruefe("strichGrenzen rechnet mit der Strichstaerke",
       bool(re.search(r"const rand = st\.d", js)))
pruefe("stelle() rechnet gegen #flaeche und den Zoom",
       bool(re.search(r"flaeche\.getBoundingClientRect\(\)", js))
       and bool(re.search(r'id="flaeche"', html)))
pruefe("die Meldezeile m-hinweis gibt es noch", 'id="m-hinweis"' in html)

# Ein Fehler drueben, der hier geradegerueckt wird: die Klasse fuers Schieben
# heisst im Stil .schiebt, gesetzt wird .zieht. Faellt das hier um, war es
# drueben behoben - dann kann der Ausgleich raus.
stil_kennt = set(re.findall(r"#malblatt\.([a-z]+)", stil))
js_setzt = set(re.findall(r"malblatt\.classList\.toggle\('([a-z]+)'", js))
pruefe("der Klassenfehler .zieht/.schiebt besteht drueben noch",
       "zieht" in js_setzt and "zieht" not in stil_kennt,
       f"Stil: {sorted(stil_kennt)}, JS: {sorted(js_setzt)}")

# --- Rahmen aufziehen und Strg+A -----------------------------------------
#
# Das Lasso drueben kann nur im Zeichnen-Reiter markieren: ausserhalb faengt
# das Blatt keine Zeiger. Deshalb ein eigener Rahmen - der aber nichts anfassen
# darf, was auf dem Blatt liegt, sonst funkt er dem Werkzeug dazwischen.
pruefe("der Rahmen laesst das Blatt in Ruhe",
       bool(re.search(r"closest\('#malblatt, \.text", shim)))
pruefe("der Rahmen nimmt Striche nach ihren Punkten, nicht nach den Grenzen",
       "function strichImKasten" in shim)
# Strg+A im Text gehoert dem Browser - sonst markiert es statt der Zeilen die
# Striche, und man bekommt seinen eigenen Text nicht mehr kopiert.
pruefe("Strg+A laesst den Text dem Browser",
       bool(re.search(r"closest\('\[contenteditable\], input, textarea'\)\) return;", shim)))
pruefe("Strg+A ausserhalb markiert alle Striche",
       bool(re.search(r"toLowerCase\(\) !== 'a'\) return;", shim)))

# --- Eigenes Profil im Fenster, Verwaltung nur in der Datei-Ebene --------
#
# Zwei verschiedene Dinge: im Profil geht es um einen selbst, in der Verwaltung
# um andere Leute. Das Profil ist deshalb ein Fenster und kein Reiter, und in
# das Menue unten gehoert die Verwaltung nicht - sonst gibt es zwei Wege zur
# selben Seite, und einer davon fuehrt an der Datei-Ebene vorbei.
pruefe("das Profil ist ein Fenster", "el('dialog', { id: 'profilfenster' }" in shim)
pruefe("der Menuepunkt oeffnet es", "punkt('Mein Profil', profilOeffnen)" in shim)
pruefe("und legt keinen Reiter mehr an", 'data-punkt="profil"' not in shim)
pruefe("die Benutzerverwaltung steht nicht im Profilmenue",
       "Benutzer verwalten" not in shim)
pruefe("sie haengt weiter an der Konto-Seite der Datei-Ebene",
       bool(re.search(r"function abschnittBauen\(\) \{\s*const konto = kontoseite\(\);", shim)))
# Das Design hing am Profil: als Reiter wurde es beim Start mitgebaut, als
# Fenster erst beim Oeffnen - bis dahin saesse man im Standarddesign.
pruefe("das Design wird beim Start geladen, nicht erst mit dem Profil",
       "['Aussehen', themaLaden]" in shim)

# --- Von allein auf Updates hinweisen ------------------------------------
#
# Dass es eine neue Fassung gibt, stand vorher nur in den Einstellungen hinter
# einem Knopf. Wer nicht nachsieht, erfaehrt nichts - und genau das war der
# Fall. Faellt der Balken aus der Startkette, passiert wieder lautlos nichts.
pruefe("der Update-Hinweis haengt in der Startkette",
       "['Update-Hinweis', updateHinweisBauen]" in shim)
pruefe("der Balken bringt den Knopf mit, statt nur Bescheid zu sagen",
       "id: 'u-jetzt'" in shim and "updateStarten(melden)" in shim)
pruefe("und laesst sich je Fassung wegklicken",
       "UPDATE_WEG" in shim and "localStorage.setItem(UPDATE_WEG" in shim)
# Beide Wege - Balken und Einstellungen - warten auf die FASSUNG, nicht auf
# ein Lebenszeichen. Sonst laedt die Seite neu, waehrend noch die alte laeuft.
pruefe("gewartet wird auf die neue Fassung",
       bool(re.search(r"if \(d\.laeuft === fassung\)", shim)))

# --- Jedes Design muss die ganze Oberflaeche abdecken ---------------------
#
# Ein Design setzt die Farbnamen am <html> neu. Vergisst eines davon einen
# Namen, bleibt dort die Farbe des vorigen stehen - und das sieht man nicht beim
# Lesen des Codes, sondern erst als heller Fleck in einer dunklen Oberflaeche.
# Genau so ist --flaeche schon einmal durchgerutscht.
wurzel = set(re.findall(r"(--[a-z-]+):", re.search(r":root \{(.*?)\}", stil, re.S).group(1)))
block = re.search(r"const DESIGNS = \{(.*?)\n  \};", shim, re.S)
pruefe("shim.js hat eine Design-Liste", bool(block))
if block:
    for name, inhalt in re.findall(r"(\w+): \{\s*name: '[^']*',\s*farben: (\{.*?\}|null),",
                                   block.group(1), re.S):
        if inhalt.strip() == "null":
            continue            # "system" setzt mit Absicht nichts
        gesetzt = set(re.findall(r"'(--[a-z-]+)':", inhalt))
        fehlend = sorted(wurzel - gesetzt)
        pruefe(f"Design {name} setzt alle Farben", not fehlend, str(fehlend))

# Und umgekehrt: eine Farbe, die benutzt, aber nie definiert wird, faellt nur
# auf, wenn sie keinen Rueckfall hat (var(--x, irgendwas) ist in Ordnung).
ohne_rueckfall = set(re.findall(r"var\((--[a-z-]+)\)", stil + shim))
pruefe("keine Farbe ohne Definition und ohne Rückfall",
       not (ohne_rueckfall - wurzel), str(sorted(ohne_rueckfall - wurzel)))

print()
print("Desktop und Server sind dieselbe Oberflaeche" if not fehler
      else f"{len(fehler)} FEHLER:\n - " + "\n - ".join(fehler))
import shutil                                               # noqa: E402
shutil.rmtree(DATEN, ignore_errors=True)
sys.exit(1 if fehler else 0)
