/* Der Stellvertreter für window.pywebview.api.
 *
 * Im Fenster sind das die Methoden aus bruecke.py, im selben Prozess. Im
 * Browser gibt es diesen Prozess nicht - also wird hier ein Objekt hingelegt,
 * das genauso aussieht und jeden Aufruf als POST an /bruecke/<name> schickt.
 *
 * Das ist der ganze Unterschied zwischen Desktop und Server. index.html,
 * mappe.js und stil.css werden dafür nicht angefasst, deshalb sieht die
 * Oberfläche in beiden Fassungen zwangsläufig gleich aus.
 */
(function () {
  'use strict';

  async function schicken(name, args) {
    let antwort;
    try {
      antwort = await fetch('/bruecke/' + encodeURIComponent(name), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Notizmappe': '1' },
        body: JSON.stringify({ args: args }),
        credentials: 'same-origin',
      });
    } catch (f) {
      // Kein Netz, Server neu gestartet, Laptop zugeklappt: die Oberfläche
      // erwartet hier ein Wörterbuch mit "fehler", keine geworfene Ausnahme.
      return { fehler: 'Keine Verbindung zum Server: ' + f.message };
    }
    if (antwort.status === 401) {
      location.href = '/anmelden';
      return { fehler: 'Nicht angemeldet' };
    }
    let daten = null;
    try { daten = await antwort.json(); } catch (f) { daten = null; }
    if (daten && typeof daten === 'object') return daten;
    return { fehler: 'Der Server antwortet nicht verständlich (' + antwort.status + ')' };
  }

  /* Zwei Sachen kann nur der Browser selbst, nicht der Server: eine Datei beim
   * Benutzer öffnen oder speichern. Am Desktop macht das bruecke.py mit dem
   * Dialog des Systems - hier wird daraus ein Download. Die Oberfläche merkt
   * davon nichts, sie bekommt wie immer {ok: true} zurück. */
  async function herunterladen(args) {
    const felder = new URLSearchParams({
      notizbuch: args[0] || '', abschnitt: args[1] || '',
      name: args[2] || '', datei: args[3] || '',
    });
    // Nicht location.assign: geht dabei etwas schief, springt der Browser auf
    // die Fehlermeldung und ersetzt damit die ganze Seite - samt allem, was
    // noch nicht gespeichert war. Also holen, und erst dann anbieten.
    let antwort;
    try {
      antwort = await fetch('/anhang?' + felder.toString(), { credentials: 'same-origin' });
    } catch (f) {
      return { fehler: 'Der Anhang ließ sich nicht holen: ' + f.message };
    }
    if (!antwort.ok) {
      let text = 'Der Anhang ließ sich nicht holen (' + antwort.status + ')';
      try {
        const d = await antwort.json();
        if (d && d.fehler) text = d.fehler;
      } catch (f) { /* dann der Satz von oben */ }
      return { fehler: text };
    }
    const brocken = await antwort.blob();
    const adresse = URL.createObjectURL(brocken);
    const verweis = document.createElement('a');
    verweis.href = adresse;
    verweis.download = args[3] || 'anhang';
    document.body.append(verweis);
    verweis.click();
    verweis.remove();
    // Die Adresse haelt den Inhalt im Speicher fest, bis man sie freigibt.
    setTimeout(function () { URL.revokeObjectURL(adresse); }, 30000);
    return { ok: true, ziel: verweis.download };
  }

  const SELBST = {
    anhang_oeffnen: herunterladen,
    anhang_speichern_unter: herunterladen,
  };

  const stellvertreter = new Proxy({}, {
    get: function (ziel, name) {
      if (typeof name !== 'string') return undefined;
      // Ein Promise prüft beim await, ob .then eine Funktion ist. Gäbe der
      // Stellvertreter hier eine zurück, hielte sich das Objekt selbst für ein
      // Promise und await liefe ins Leere.
      if (name === 'then' || name === 'catch' || name === 'finally'
          || name === 'toJSON' || name === 'constructor') return undefined;
      if (SELBST[name]) return function () { return SELBST[name](Array.from(arguments)); };
      return function () { return schicken(name, Array.from(arguments)); };
    },
    has: function () { return true; },
  });

  window.pywebview = { api: stellvertreter, platform: 'server' };
  // mappe.js sieht zuerst selbst nach und hört zusätzlich auf dieses Ereignis.
  window.addEventListener('DOMContentLoaded', function () {
    window.dispatchEvent(new Event('pywebviewready'));
  });
})();
