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

  /* --- Benutzer und Rollen -------------------------------------------------
   *
   * Am Desktop gibt es keine Benutzer, dort hätte der Abschnitt nichts zu
   * zeigen - also wird er hier eingesetzt statt in die gemeinsame Oberfläche
   * geschrieben. Das ist der eine Unterschied, den die Serverfassung haben
   * darf, und er steht an genau dieser Stelle.
   */

  async function hol(weg, rumpf) {
    const a = await fetch(weg, {
      method: rumpf ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Notizmappe': '1' },
      body: rumpf ? JSON.stringify(rumpf) : undefined,
      credentials: 'same-origin',
    });
    let d = null;
    try { d = await a.json(); } catch (f) { d = null; }
    if (!a.ok || (d && d.fehler)) throw new Error((d && (d.fehler || d.detail)) || ('Fehler ' + a.status));
    return d;
  }

  function el(art, eigenschaften, kinder) {
    const k = document.createElement(art);
    Object.assign(k, eigenschaften || {});
    for (const kind of kinder || []) k.append(kind);
    return k;
  }

  let verwaltungStand = null;

  function sagen(text) {
    const p = document.getElementById('v-meldung');
    if (p) p.textContent = text;
  }

  async function verwaltungLaden() {
    const abschnitt = document.getElementById('serververwaltung');
    if (!abschnitt) return;
    let d;
    try { d = await hol('/verwaltung'); } catch (f) { sagen(f.message); return; }
    verwaltungStand = d;
    const wer = document.getElementById('serverwer');
    if (wer && d.ich) {
      wer.textContent = 'Angemeldet als ' + d.ich
        + (d.meine_rechte ? ' · darf: ' + d.meine_rechte.join(', ') : '');
    }
    abschnitt.hidden = !d.darf;
    if (!d.darf) return;
    zeichneBenutzer(d);
    zeichneRollen(d);
  }

  function zeichneBenutzer(d) {
    const wo = document.getElementById('v-benutzer');
    wo.textContent = '';
    for (const b of d.benutzer) {
      const auswahl = el('select', { title: 'Rolle' });
      for (const r of d.rollen) {
        auswahl.append(el('option', { value: r.name, textContent: r.name, selected: r.name === b.rolle }));
      }
      auswahl.addEventListener('change', async () => {
        try {
          await hol('/verwaltung/benutzer', { was: 'rolle', name: b.name, rolle: auswahl.value });
          sagen(`${b.name} ist jetzt „${auswahl.value}“.`);
          verwaltungLaden();
        } catch (f) { sagen(f.message); verwaltungLaden(); }
      });
      const raus = el('button', { type: 'button', textContent: 'Entfernen' });
      raus.addEventListener('click', async () => {
        if (!confirm(`Zugang „${b.name}“ entfernen? Die Notizen bleiben liegen.`)) return;
        try {
          await hol('/verwaltung/benutzer', { was: 'entfernen', name: b.name });
          sagen(`Zugang ${b.name} entfernt. Die Notizen liegen weiter im Datenordner.`);
          verwaltungLaden();
        } catch (f) { sagen(f.message); }
      });
      const neuespw = el('button', { type: 'button', textContent: 'Passwort setzen' });
      neuespw.addEventListener('click', async () => {
        const pw = prompt(`Neues Passwort für ${b.name} (mind. 8 Zeichen):`);
        if (!pw) return;
        try {
          await hol('/verwaltung/benutzer', { was: 'passwort', name: b.name, passwort: pw });
          sagen(`Passwort für ${b.name} gesetzt - offene Sitzungen enden damit.`);
        } catch (f) { sagen(f.message); }
      });
      wo.append(el('p', { className: 'zeile2' }, [
        el('span', { textContent: b.name + (b.name === d.ich ? ' (du)' : '')
          + (b.zuletzt ? ' · zuletzt ' + b.zuletzt : ' · noch nie angemeldet') }),
        el('span', {}, [auswahl, neuespw, ...(b.name === d.ich ? [] : [raus])]),
      ]));
    }
  }

  function zeichneRollen(d) {
    const wo = document.getElementById('v-rollen');
    wo.textContent = '';
    for (const r of d.rollen) {
      const haken = [];
      for (const [schluessel, text] of Object.entries(d.rechte)) {
        const kasten = el('input', { type: 'checkbox', checked: r.rechte.includes(schluessel),
                                     disabled: r.fest });
        kasten.dataset.recht = schluessel;
        haken.push(el('label', { className: 'haken', title: text }, [kasten, document.createTextNode(' ' + text)]));
      }
      const knoepfe = [];
      if (!r.fest) {
        const sichern = el('button', { type: 'button', textContent: 'Speichern' });
        sichern.addEventListener('click', async () => {
          const rechte = haken.map((h) => h.firstChild).filter((k) => k.checked).map((k) => k.dataset.recht);
          try {
            await hol('/verwaltung/rolle', { name: r.name, rechte });
            sagen(`Rolle „${r.name}“ gespeichert.`);
            verwaltungLaden();
          } catch (f) { sagen(f.message); }
        });
        const weg = el('button', { type: 'button', textContent: 'Rolle löschen' });
        weg.addEventListener('click', async () => {
          if (!confirm(`Rolle „${r.name}“ löschen?`)) return;
          try {
            await hol('/verwaltung/rolle', { was: 'entfernen', name: r.name });
            verwaltungLaden();
          } catch (f) { sagen(f.message); }
        });
        knoepfe.push(sichern, weg);
      }
      wo.append(el('div', { className: 'rollenkasten' }, [
        el('strong', { textContent: r.name + (r.fest ? ' (mitgeliefert)' : '') }),
        el('div', { className: 'rechte' }, haken),
        el('p', { className: 'knoepfe' }, knoepfe),
      ]));
    }
  }

  /* Die Einstellungen stammen aus der gemeinsamen Oberfläche und bieten
   * deshalb Dinge an, die nur am eigenen Rechner etwas tun. Hier werden sie
   * nicht einfach ausgeblendet, sondern durch einen Satz ersetzt, der sagt
   * warum - ein Knopf, der nichts tut, ist schlimmer als keiner, aber ein
   * Abschnitt, der kommentarlos fehlt, lässt einen suchen. */
  function abschnittSuchen(ueberschrift) {
    // Seit die Einstellungen in der Datei-Ebene stehen, liegt "Version" unter
    // Informationen und der Rest unter Optionen - also an beiden Stellen suchen.
    for (const s of document.querySelectorAll(
        '#einstellungen .tafel section, #einstellungen-oben section')) {
      const h = s.querySelector('h3');
      if (h && h.textContent.trim() === ueberschrift) return s;
    }
    return null;
  }

  function stattdessen(abschnitt, text) {
    if (!abschnitt) return;
    for (const kind of Array.from(abschnitt.children)) {
      if (kind.tagName !== 'H3') kind.remove();
    }
    abschnitt.append(el('p', { className: 'hinweis', textContent: text }));
  }

  function einstellungenAnpassen() {
    if (document.getElementById('serverkopf')) return;

    // Oben: wer bin ich, und wie komme ich wieder raus.
    const tafel = document.querySelector('#einstellungen .tafel');
    if (!tafel) return;
    const abmelden = el('button', { type: 'button', textContent: 'Abmelden' });
    abmelden.addEventListener('click', function () { location.href = '/abmelden'; });
    const kopf = el('section', { id: 'serverkopf' }, [
      el('h3', { textContent: 'Zugang' }),
      el('p', { className: 'zeile2' }, [
        el('span', { id: 'serverwer', textContent: 'angemeldet' }),
        el('span', {}, [abmelden]),
      ]),
      el('p', { className: 'hinweis', textContent:
        'Diese Notizmappe läuft auf einem Server. Jeder Zugang hat seinen eigenen '
        + 'Notizordner und sieht nur die eigenen Seiten.' }),
    ]);
    tafel.insertBefore(kopf, tafel.firstChild);

    stattdessen(abschnittSuchen('Aus OneNote übernehmen'),
      'Geht nur am eigenen Rechner: zum Einlesen muss die Datei über einen '
      + 'Dateidialog gewählt werden, den es im Browser nicht gibt. Auf dem Rechner '
      + 'einlesen und den Notizordner hierher übernehmen - oder warten, bis es '
      + 'hier einen Upload gibt.');

    stattdessen(abschnittSuchen('Sperre'),
      'Am Server ist die Anmeldung die Sperre. Die Verschlüsselung des '
      + 'Desktop-Programms lässt sich hier nicht einschalten: ihr Schlüssel liegt '
      + 'im laufenden Programm, und das bedient mehrere Leute gleichzeitig. Liegt '
      + 'in einem Notizordner eine verschlüsselte Mappe, sagt der Server das, '
      + 'statt leere Seiten zu zeigen.');

    // Version: die Zeilen bleiben, die Knöpfe nicht.
    const version = abschnittSuchen('Version');
    if (version) {
      for (const id of ['e-pruefen', 'e-einspielen', 'e-start-pruefen', 'e-auto']) {
        const k = document.getElementById(id);
        if (k) (k.closest('label') || k).remove();
      }
      const hinweis = document.getElementById('e-updatehinweis');
      if (hinweis) {
        hinweis.textContent = 'Aktualisiert wird hier mit "docker compose pull" und '
          + '"docker compose up -d" - nicht aus dem Programm heraus.';
      }
      for (const p of version.querySelectorAll('p.hinweis')) {
        if (p.textContent.indexOf('Läuft nur auf dem Rechner') === 0) p.remove();
      }
    }

    const schriften = abschnittSuchen('Schriften');
    if (schriften) {
      schriften.append(el('p', { className: 'hinweis', textContent:
        'Aufgeführt sind die Schriften des Servers, nicht die deines Rechners - '
        + 'er kann nicht wissen, was bei dir installiert ist.' }));
    }
  }

  function abschnittBauen() {
    const tafel = document.querySelector('#einstellungen .tafel');
    if (!tafel || document.getElementById('serververwaltung')) return;

    const neuerName = el('input', { type: 'text', placeholder: 'Benutzername', autocapitalize: 'none' });
    const neuesPw = el('input', { type: 'password', placeholder: 'Passwort (mind. 8 Zeichen)' });
    const neueRolle = el('select', {});
    const anlegen = el('button', { type: 'button', textContent: 'Benutzer anlegen' });
    anlegen.addEventListener('click', async () => {
      try {
        await hol('/verwaltung/benutzer', { was: 'anlegen', name: neuerName.value,
                                            passwort: neuesPw.value, rolle: neueRolle.value });
        sagen(`Benutzer ${neuerName.value.trim().toLowerCase()} angelegt.`);
        neuerName.value = ''; neuesPw.value = '';
        verwaltungLaden();
      } catch (f) { sagen(f.message); }
    });

    const rollenName = el('input', { type: 'text', placeholder: 'Name der neuen Rolle' });
    const rollenRechte = el('div', { className: 'rechte' });
    const rollenAnlegen = el('button', { type: 'button', textContent: 'Rolle anlegen' });
    rollenAnlegen.addEventListener('click', async () => {
      const rechte = Array.from(rollenRechte.querySelectorAll('input:checked')).map((k) => k.dataset.recht);
      try {
        await hol('/verwaltung/rolle', { name: rollenName.value, rechte });
        rollenName.value = '';
        sagen(`Rolle „${rollenName.value}“ angelegt.`);
        verwaltungLaden();
      } catch (f) { sagen(f.message); }
    });

    const abschnitt = el('section', { id: 'serververwaltung', hidden: true }, [
      el('h3', { textContent: 'Benutzer und Rollen' }),
      el('div', { id: 'v-benutzer' }),
      el('p', { className: 'ordnerzeile' }, [neuerName, neuesPw, neueRolle]),
      el('p', { className: 'knoepfe' }, [anlegen]),
      el('h3', { textContent: 'Rollen', style: 'margin-top:14px' }),
      el('div', { id: 'v-rollen' }),
      el('p', { className: 'ordnerzeile' }, [rollenName]),
      rollenRechte,
      el('p', { className: 'knoepfe' }, [rollenAnlegen]),
      el('p', { className: 'hinweis', id: 'v-meldung' }),
      el('p', { className: 'hinweis', textContent:
        'Die Rechte werden am Server durchgesetzt, nicht nur in der Oberfläche. '
        + 'Ein Zugang zu entfernen löscht keine Notizen - die liegen weiter im Datenordner.' }),
    ]);
    tafel.append(abschnitt);

    // Die Auswahlfelder füllen sich aus dem Stand
    const fuellen = () => {
      if (!verwaltungStand || !verwaltungStand.darf) return;
      neueRolle.textContent = '';
      for (const r of verwaltungStand.rollen) {
        neueRolle.append(el('option', { value: r.name, textContent: r.name }));
      }
      if (!rollenRechte.children.length) {
        for (const [schluessel, text] of Object.entries(verwaltungStand.rechte)) {
          const kasten = el('input', { type: 'checkbox' });
          kasten.dataset.recht = schluessel;
          rollenRechte.append(el('label', { className: 'haken' }, [kasten, document.createTextNode(' ' + text)]));
        }
      }
    };
    const alt = verwaltungLaden;
    verwaltungLaden = async function () { await alt(); fuellen(); };

    const stil = document.createElement('style');
    stil.textContent = `
      #serververwaltung .zeile2 span:last-child { display: flex; gap: 6px; }
      #serververwaltung select { height: 28px; border: 1px solid var(--linie);
        border-radius: 6px; background: var(--papier); color: var(--schrift); font-size: 13px; }
      #serververwaltung .rechte { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 6px 0; }
      #serververwaltung .rollenkasten { border: 1px solid var(--linie); border-radius: 8px;
        padding: 8px 10px; margin-bottom: 8px; }
      #serververwaltung .haken { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; }`;
    document.head.append(stil);
  }

  // Beim Öffnen der Einstellungen neu laden - Rollen können sich geändert haben.
  window.addEventListener('DOMContentLoaded', function () {
    einstellungenAnpassen();
    abschnittBauen();
    verwaltungLaden();
    const zahnrad = document.getElementById('zahnrad');
    if (zahnrad) zahnrad.addEventListener('click', function () { setTimeout(verwaltungLaden, 50); });
  });

  window.pywebview = { api: stellvertreter, platform: 'server' };
  // mappe.js sieht zuerst selbst nach und hört zusätzlich auf dieses Ereignis.
  window.addEventListener('DOMContentLoaded', function () {
    window.dispatchEvent(new Event('pywebviewready'));
  });
})();
