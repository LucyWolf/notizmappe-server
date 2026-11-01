"""Nummerierte Listen behalten ihre Art.

Der Reiniger drueben laesst an <ol> kein Attribut durch, und das aus gutem
Grund: style und class waeren ein Einfallstor, und alles, was nicht der Editor
selbst setzt, hat in der Datei nichts zu suchen. Die Nummerierungsbibliothek
braucht aber eine Stelle, an der steht, welche Art Nummer gemeint ist - "1)"
oder "(a)" oder "I.". Dasselbe bei der Aufzaehlung, dort steht das Zeichen
selbst darin. Dafuer genau ein Attribut mit fester Werteliste: data-art. Was
nicht in ARTEN oder ZEICHEN steht, faellt heraus wie bisher.

Geaendert wird das Modul drueben zur Laufzeit, nicht im Quelltext: die Dateien
unter desktop/ kommen aus der Fensterfassung und werden beim naechsten
desktop_holen.sh ueberschrieben. Dieselbe Stelle wie bei verlauf.einrichten().

Die Fensterfassung kennt das Attribut nicht. Sie zeigt eine so gesetzte Liste
mit ihren Standardzahlen - und wenn dort gespeichert wird, ist die Art weg.
Verloren geht dabei nichts ausser der Form der Zahlen.
"""
from __future__ import annotations

# Die Zeichenfolge sagt beides: welche Zaehlung (1, a, A, i, I) und was davor
# und dahinter steht. Dieselbe Liste steht in shim.js - dort wird daraus die
# Vorschau im Menue und die Regel im Stylesheet.
ARTEN = {
    "1.", "1)", "a)", "A.",
    "1.)", "I.", "A)", "(1)", "(a)",
    "a.", "1-", "1", "A", "a",
    "i.", "i)",
}

# Bei der Aufzaehlung ist der Wert das Zeichen selbst. Nur Zeichen aus der
# Grundebene: ein Emoji faellt in Schriften aus, die es nicht haben, und dann
# steht ein Kaestchen vor jeder Zeile.
ZEICHEN = {
    "\u25cf", "\u25cb", "\u2022", "\u25e6", "\u25c9",
    "\u2726", "\u25c6", "\u25c7", "\u2756", "\u22c4",
    "\u25a0", "\u25a1", "\u25aa", "\u25ab", "\u25fc",
    "\u25b6", "\u25b8", "\u2023", "\u2192", "\u21d2",
    "\u203a", "\u27a2", "\u2731", "\u2738", "\u2749",
    "\u2013", "\u2014", "\u2713", "\u2717", "\u2605",
    "\u263a", "\u260e", "\u2709", "\u2666", "\u2665",
}

_schon = False


def einrichten() -> None:
    """Dem Reiniger data-art an <ol> und <ul> beibringen - einmal."""
    global _schon
    if _schon:
        return
    import reinigen

    reinigen.ATTRIBUTE.setdefault("ol", set()).add("data-art")
    reinigen.ATTRIBUTE.setdefault("ul", set()).add("data-art")

    # Die Werte prueft der Reiniger nicht von sich aus: seine Pruefungen
    # haengen an den Namen, die er kennt. Also vorher aussortieren - der
    # Parser hat die Anfuehrungszeichen da schon weg, egal welche es waren.
    alt = reinigen._Reiniger.handle_starttag

    def neu(selbst, tag, attrs):
        gut = ARTEN if tag == "ol" else ZEICHEN if tag == "ul" else None
        if gut is not None:
            attrs = [(n, w) for n, w in attrs if n != "data-art" or w in gut]
        return alt(selbst, tag, attrs)

    reinigen._Reiniger.handle_starttag = neu
    _schon = True
