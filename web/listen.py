"""Leer, und das mit Absicht.

Hier stand die Regel, die dem Reiniger des Desktops beibrachte, dass eine
Liste sagen darf, welche Art Nummer oder welches Zeichen vor ihren Punkten
steht (`data-art`). Seit der Desktop-Fassung 1.2.5 kann `reinigen.py` das
selbst - die Regel ist dorthin gewandert, wo sie hingehoert, und wird hier
nicht mehr gebraucht.

**Warum die Datei trotzdem dasteht:** eine laufende Installation prueft ein
nachgeladenes Paket gegen *ihre eigene* Liste der Pflichtdateien, und in
Fassungen bis 1.2.44 steht `web/listen.py` darin. Ohne diese Datei lehnt so
eine Installation jede neuere Fassung ab - mit genau dem Satz "In der neuen
Fassung fehlt web/listen.py - nicht aktiviert." - und kommt aus eigener Kraft
nie wieder hoch. Das ist die Art Fehler, die man nicht beim Bauen merkt,
sondern bei jemandem, der seit Wochen nicht aktualisiert hat.

Weg darf sie, wenn keine Installation unter 1.2.45 mehr nachlaedt. Das ist
keine Frage von Tagen.
"""
from __future__ import annotations


def einrichten() -> None:
    """Gibt es nur noch, damit ein alter Aufruf nicht ins Leere laeuft."""
