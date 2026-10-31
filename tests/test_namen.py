"""Kommt jeder Name in shim.js auch irgendwoher?

    .venv/bin/python tests/test_namen.py

Diese Prüfung gibt es wegen eines echten Fehlers: `modellHolen` stand im
Entwurf, wurde beim Schreiben vergessen und trotzdem aufgerufen. Die Syntax
war in Ordnung, der Aufbau lief durch - nur im Browser flog ein ReferenceError,
und der landete in einem `catch`, das daraus eine harmlose Meldung machte.
Zu sehen war: nichts passiert.

Geprüft wird deshalb jeder gelesene Name gegen drei Quellen: was shim.js
selbst erklärt, was die gemeinsame Oberfläche (mappe.js) oben anlegt, und was
der Browser mitbringt. Was in keiner davon steht, gibt es zur Laufzeit nicht.

Die Prüfung kennt keine Blöcke - ein Name, der irgendwo in shim.js erklärt
wird, gilt überall. Das ist absichtlich grob: so meldet sie nichts Falsches
und findet trotzdem genau den Fehler, um den es geht.
"""
import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
DESKTOP = WURZEL / "desktop"
fehler = []


def pruefe(was, bedingung, extra=""):
    print(("  ok  " if bedingung else "FEHLER") + "  " + was
          + (f"   {extra}" if extra and not bedingung else ""))
    if not bedingung:
        fehler.append(was)


try:
    import esprima
except ImportError:
    print("  --  esprima fehlt, die Namen sind ungeprüft (pip install esprima)")
    sys.exit(0)

# Was der Browser mitbringt. Keine Vollständigkeit angestrebt - nur das, was
# hier wirklich benutzt wird. Ein fehlender Eintrag meldet sich von selbst.
BROWSER = {
    "window", "document", "console", "navigator", "location", "history",
    "localStorage", "sessionStorage", "fetch", "URL", "URLSearchParams",
    "setTimeout", "setInterval", "clearTimeout", "clearInterval",
    "requestAnimationFrame", "cancelAnimationFrame", "queueMicrotask",
    "Math", "JSON", "Object", "Array", "String", "Number", "Boolean", "Date",
    "Promise", "Map", "Set", "WeakMap", "WeakSet", "Symbol", "Error",
    "TypeError", "RangeError", "RegExp", "Proxy", "Reflect", "BigInt",
    "isNaN", "isFinite", "parseInt", "parseFloat", "Infinity", "NaN",
    "undefined", "globalThis", "arguments", "performance",
    "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI",
    "btoa", "atob", "structuredClone", "getComputedStyle", "matchMedia",
    "alert", "confirm", "prompt", "close", "open", "print", "scrollTo",
    "Float32Array", "Float64Array", "Uint8Array", "Uint16Array", "Uint32Array",
    "Int8Array", "Int16Array", "Int32Array", "Uint8ClampedArray",
    "DataView", "ArrayBuffer", "TextDecoder", "TextEncoder",
    "Blob", "File", "FileReader", "FormData", "Image", "Audio",
    "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "PointerEvent",
    "MutationObserver", "IntersectionObserver", "ResizeObserver",
    "WebGLRenderingContext", "WebGL2RenderingContext", "AbortController",
    "HTMLElement", "Element", "Node", "NodeList", "DOMParser", "XMLHttpRequest",
    "CSS", "Intl", "crypto", "devicePixelRatio", "screen", "frames", "self",
}

shimquelle = (WURZEL / "web/shim.js").read_text(encoding="utf-8")
baum = esprima.parseScript(shimquelle).toDict()


def gehe(knoten, tun):
    if isinstance(knoten, dict):
        tun(knoten)
        for wert in knoten.values():
            gehe(wert, tun)
    elif isinstance(knoten, list):
        for wert in knoten:
            gehe(wert, tun)


def namen_im_muster(knoten, heraus):
    """Aus `const {a, b: [c]} = …` kommen a, b und c."""
    gehe(knoten, lambda k: heraus.add(k["name"])
         if k.get("type") == "Identifier" else None)


erklaert = set()
# Identifier-Knoten, die keine Lesezugriffe sind: x.name, {name: 1}, Sprungmarken.
keine_lesung = set()


def einsammeln(k):
    art = k.get("type")
    if art in ("FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"):
        if k.get("id"):
            namen_im_muster(k["id"], erklaert)
        for p in k.get("params") or []:
            namen_im_muster(p, erklaert)
    elif art == "VariableDeclarator":
        namen_im_muster(k["id"], erklaert)
    elif art in ("ClassDeclaration", "ClassExpression") and k.get("id"):
        namen_im_muster(k["id"], erklaert)
    elif art == "CatchClause" and k.get("param"):
        namen_im_muster(k["param"], erklaert)

    if art == "MemberExpression" and not k.get("computed"):
        keine_lesung.add(id(k["property"]))
    elif art in ("Property", "MethodDefinition") and not k.get("computed"):
        keine_lesung.add(id(k["key"]))
    elif art == "LabeledStatement":
        keine_lesung.add(id(k["label"]))
    elif art in ("BreakStatement", "ContinueStatement") and k.get("label"):
        keine_lesung.add(id(k["label"]))


gehe(baum, einsammeln)

gelesen = {}
def lesen_sammeln(k):
    if k.get("type") == "Identifier" and id(k) not in keine_lesung:
        gelesen.setdefault(k["name"], 0)
        gelesen[k["name"]] += 1
gehe(baum, lesen_sammeln)

pruefe("shim.js lässt sich lesen und hat Namen drin", len(gelesen) > 50, len(gelesen))
pruefe("und erklärt selbst welche", len(erklaert) > 50, len(erklaert))

# Was die gemeinsame Oberfläche oben anlegt - daran darf shim.js hängen.
mappequelle = (DESKTOP / "app/oberflaeche/mappe.js").read_text(encoding="utf-8")
oben = set()
for satz in esprima.parseScript(mappequelle).toDict()["body"]:
    art = satz.get("type")
    if art == "FunctionDeclaration" and satz.get("id"):
        oben.add(satz["id"]["name"])
    elif art == "VariableDeclaration":
        for d in satz["declarations"]:
            namen_im_muster(d["id"], oben)
    elif art in ("ClassDeclaration",) and satz.get("id"):
        oben.add(satz["id"]["name"])

pruefe("mappe.js legt oben Namen an, an die sich hängen lässt", len(oben) > 20, len(oben))

unbekannt = sorted(n for n in gelesen if n not in erklaert and n not in oben
                   and n not in BROWSER)
pruefe("jeder gelesene Name in shim.js kommt irgendwoher",
       not unbekannt, ", ".join(unbekannt))

# Gegenprobe: die Prüfung muss den Fehler auch wirklich finden. Ohne das
# könnte sie stillschweigend nichts mehr tun.
probe = shimquelle.replace("function modellHolen(", "function modellHolenX(", 1)
if probe != shimquelle:
    pbaum = esprima.parseScript(probe).toDict()
    perklaert, keine_lesung2, pgelesen = set(), set(), {}
    erklaert, keine_lesung = perklaert, keine_lesung2
    gehe(pbaum, einsammeln)
    def p_lesen(k):
        if k.get("type") == "Identifier" and id(k) not in keine_lesung2:
            pgelesen[k["name"]] = 1
    gehe(pbaum, p_lesen)
    fehlt = [n for n in pgelesen if n not in perklaert and n not in oben
             and n not in BROWSER]
    pruefe("und sie fällt wirklich auf, wenn eine Funktion fehlt",
           fehlt == ["modellHolen"], fehlt)
else:
    pruefe("die Gegenprobe findet modellHolen", False, "Funktion heißt anders")

print()
if fehler:
    print(f"{len(fehler)} Prüfungen gescheitert")
    sys.exit(1)
print("Alle Namen in shim.js kommen irgendwoher")
