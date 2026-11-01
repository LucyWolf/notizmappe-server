"""Nummerierte Listen behalten ihre Art.

Der Reiniger drueben laesst an <ol> kein Attribut durch, und das aus gutem
Grund: style und class waeren ein Einfallstor, und alles, was nicht der Editor
selbst setzt, hat in der Datei nichts zu suchen. Die Nummerierungsbibliothek
braucht aber eine Stelle, an der steht, welche Art Nummer gemeint ist - "1)"
oder "(a)" oder "I.". Dafuer genau ein Attribut mit fester Werteliste:
data-art. Was nicht in ARTEN steht, faellt heraus wie bisher.

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

_schon = False


def einrichten() -> None:
    """Dem Reiniger data-art an <ol> beibringen - einmal."""
    global _schon
    if _schon:
        return
    import reinigen

    reinigen.ATTRIBUTE.setdefault("ol", set()).add("data-art")

    # Die Werte prueft der Reiniger nicht von sich aus: seine Pruefungen
    # haengen an den Namen, die er kennt. Also vorher aussortieren - der
    # Parser hat die Anfuehrungszeichen da schon weg, egal welche es waren.
    alt = reinigen._Reiniger.handle_starttag

    def neu(selbst, tag, attrs):
        if tag == "ol":
            attrs = [(n, w) for n, w in attrs if n != "data-art" or w in ARTEN]
        return alt(selbst, tag, attrs)

    reinigen._Reiniger.handle_starttag = neu
    _schon = True
