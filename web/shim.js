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
    abschnitt.hidden = !(d.darf || d.darf_projekte || (d.projekte || []).length);
    const nurprojekte = !d.darf;
    for (const id of ['v-benutzer', 'v-rollen']) {
      const k = document.getElementById(id);
      if (k) k.hidden = nurprojekte;
    }
    zeichneProjekte(d);
    if (!d.darf) return;            // Projekte darf man auch ohne Benutzerverwaltung sehen
    zeichneBenutzer(d);
    zeichneEinladungen(d);
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

  function zeichneEinladungen(d) {
    const wo = document.getElementById('v-einladungen');
    if (!wo) return;
    wo.textContent = '';
    for (const e of d.einladungen || []) {
      const rest = Math.max(0, Math.round(e.bis - Date.now() / 1000));
      const weg = el('button', { type: 'button', textContent: 'zurücknehmen' });
      weg.addEventListener('click', async () => {
        try {
          await hol('/verwaltung/einladung', { was: 'zuruecknehmen', marke: e.marke });
          verwaltungLaden();
        } catch (f) { sagen(f.message); }
      });
      wo.append(el('p', { className: 'zeile2' }, [
        el('span', { textContent: `${e.rolle}${e.projekt ? ' · ' + e.projekt : ''} — `
          + `noch ${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, '0')}` }),
        el('span', {}, [weg]),
      ]));
    }
  }

  function zeichneProjekte(d) {
    const wo = document.getElementById('v-projekte');
    if (!wo) return;
    wo.textContent = '';
    for (const pr of d.projekte || []) {
      const meins = pr.mitglieder[d.ich];
      const darf = d.darf_projekte || meins === 'verwalten';
      const zeilen = Object.entries(pr.mitglieder).map(([wer, recht]) => {
        const auswahl = el('select', {});
        for (const r of d.projektrechte) {
          auswahl.append(el('option', { value: r, textContent: r, selected: r === recht }));
        }
        auswahl.disabled = !darf;
        auswahl.addEventListener('change', async () => {
          try {
            await hol('/verwaltung/projekt', { was: 'mitglied', projekt: pr.name,
                                               benutzer: wer, recht: auswahl.value });
            verwaltungLaden();
          } catch (f) { sagen(f.message); verwaltungLaden(); }
        });
        const raus = el('button', { type: 'button', textContent: 'raus' });
        raus.disabled = !darf;
        raus.addEventListener('click', async () => {
          try {
            await hol('/verwaltung/projekt', { was: 'mitglied-raus', projekt: pr.name, benutzer: wer });
            verwaltungLaden();
          } catch (f) { sagen(f.message); }
        });
        return el('p', { className: 'zeile2' }, [
          el('span', { textContent: wer }), el('span', {}, [auswahl, raus])]);
      });

      const dazu = el('select', {});
      for (const b of d.benutzer || []) {
        if (!(b.name in pr.mitglieder)) dazu.append(el('option', { value: b.name, textContent: b.name }));
      }
      const dazuRecht = el('select', {});
      for (const r of d.projektrechte) dazuRecht.append(el('option', { value: r, textContent: r }));
      const dazuKnopf = el('button', { type: 'button', textContent: 'dazunehmen' });
      dazuKnopf.disabled = !darf;
      dazuKnopf.addEventListener('click', async () => {
        try {
          await hol('/verwaltung/projekt', { was: 'mitglied', projekt: pr.name,
                                             benutzer: dazu.value, recht: dazuRecht.value });
          verwaltungLaden();
        } catch (f) { sagen(f.message); }
      });
      const weg = el('button', { type: 'button', textContent: 'Projekt entfernen' });
      weg.disabled = !darf;
      weg.addEventListener('click', async () => {
        if (!confirm(`Projekt „${pr.name}" entfernen? Die Notizen darin bleiben liegen.`)) return;
        try {
          await hol('/verwaltung/projekt', { was: 'entfernen', projekt: pr.name });
          verwaltungLaden();
        } catch (f) { sagen(f.message); }
      });
      wo.append(el('div', { className: 'rollenkasten' }, [
        el('strong', { textContent: pr.name + (meins ? ` — du: ${meins}` : '') }),
        ...zeilen,
        el('p', { className: 'ordnerzeile' }, [dazu, dazuRecht, dazuKnopf]),
        el('p', { className: 'knoepfe' }, [weg]),
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

  /* --- Bereich: eigene Notizen oder ein Projekt ---------------------------
   *
   * Am Desktop gibt es das nicht - dort ist der Datenordner der Bereich. Hier
   * steht die Wahl oben im Band, weil man sie immer sehen muss: wer nicht
   * weiß, in welchem Bereich er schreibt, schreibt irgendwann ins falsche.
   */
  async function bereicheLaden() {
    const wahl = document.getElementById('bereichwahl');
    if (!wahl) return;
    let d;
    try { d = await hol('/bereiche'); } catch (f) { return; }
    wahl.textContent = '';
    wahl.append(el('option', { value: '', textContent: 'Meine Notizen',
                               selected: !d.jetzt }));
    for (const p of d.projekte || []) {
      wahl.append(el('option', { value: p.name, selected: p.name === d.jetzt,
                                 textContent: `Projekt: ${p.name} (${p.recht})` }));
    }
    wahl.hidden = !(d.projekte || []).length;
    const anzeige = document.getElementById('bereichjetzt');
    if (anzeige) {
      anzeige.textContent = d.jetzt ? `Projekt: ${d.jetzt}` : 'Meine Notizen';
      anzeige.classList.toggle('improjekt', !!d.jetzt);
    }
  }

  function bereichBauen() {
    const band = document.querySelector('#band #reiter .bandrechts');
    if (!band || document.getElementById('bereichwahl')) return;
    const anzeige = el('span', { id: 'bereichjetzt', textContent: 'Meine Notizen' });
    const wahl = el('select', { id: 'bereichwahl', title: 'Wo arbeitest du gerade?' });
    wahl.addEventListener('change', async () => {
      try {
        await hol('/bereich', { bereich: wahl.value });
        location.reload();          // der ganze Baum ist ein anderer
      } catch (f) { alert(f.message); }
    });
    band.insertBefore(wahl, band.firstChild);
    band.insertBefore(anzeige, band.firstChild);
    const stil = document.createElement('style');
    stil.textContent = `
      #bereichjetzt { font-size: 12px; color: var(--matt); }
      #bereichjetzt.improjekt { color: var(--akzent); font-weight: 600; }
      #bereichwahl { height: 26px; border: 1px solid var(--linie); border-radius: 6px;
        background: var(--papier); color: var(--schrift); font-size: 12px; max-width: 220px; }`;
    document.head.append(stil);
  }

  function kontoseite() {
    return document.querySelector('.dateiseite[data-punkt="konto"]');
  }

  function einstellungenAnpassen() {
    if (document.getElementById('serverkopf')) return;

    // "Konto" ist am Server die Benutzerseite. Was dort für den eigenen
    // Rechner steht - "Verbindung einrichten", "hier gibt es kein Konto" -
    // ist hier sinnlos; es verschwindet, bleibt aber im Gerüst stehen, damit
    // die gemeinsame Oberfläche weiter darauf zeigen darf.
    const konto = kontoseite();
    if (!konto) return;
    for (const kind of Array.from(konto.children)) {
      if (kind.tagName !== 'H2') kind.hidden = true;
    }
    const abmelden = el('button', { type: 'button', textContent: 'Abmelden' });
    abmelden.addEventListener('click', function () { location.href = '/abmelden'; });
    const kopf = el('section', { id: 'serverkopf' }, [
      el('h3', { textContent: 'Angemeldet' }),
      el('p', { className: 'zeile2' }, [
        el('span', { id: 'serverwer', textContent: 'angemeldet' }),
        el('span', {}, [abmelden]),
      ]),
      el('p', { className: 'hinweis', textContent:
        'Diese Notizmappe läuft auf einem Server. Jeder Zugang hat seinen eigenen '
        + 'Notizordner und sieht nur die eigenen Seiten.' }),
    ]);
    konto.append(kopf);

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

    // Version: die eigenen Knöpfe weg, dafür eine echte Auskunft. Dass es
    // etwas zu holen gibt, soll man sehen, ohne es zu wissen - auch wenn man
    // dann selbst "docker compose pull" tippen muss.
    const version = abschnittSuchen('Version');
    if (version) {
      for (const id of ['e-pruefen', 'e-einspielen', 'e-start-pruefen', 'e-auto']) {
        const k = document.getElementById(id);
        if (k) (k.closest('label') || k).remove();
      }
      for (const p of version.querySelectorAll('p.hinweis')) {
        if (p.textContent.indexOf('Läuft nur auf dem Rechner') === 0) p.remove();
      }
      const knopf = el('button', { type: 'button', textContent: 'Nach Updates sehen' });
      const befehl = el('pre', { id: 'serverbefehl', hidden: true, textContent:
        'docker compose pull\ndocker compose up -d' });
      knopf.addEventListener('click', async () => {
        const hinweis = document.getElementById('e-updatehinweis');
        hinweis.textContent = 'wird nachgesehen …';
        try {
          const f = await hol('/fassung');
          document.getElementById('e-verfuegbar').textContent = f.neueste || '—';
          befehl.hidden = !f.neuer;
          hinweis.textContent = f.fehler ? f.fehler
            : (f.neuer ? `Es gibt ${f.neueste} - hier läuft ${f.laeuft}. Auf dem Rechner, `
                       + 'auf dem der Container läuft:'
                       : `Hier läuft ${f.laeuft}, das ist die neueste.`);
        } catch (e2) { hinweis.textContent = e2.message; }
      });
      version.append(el('p', { className: 'knoepfe' }, [knopf]), befehl);
      const stil = document.createElement('style');
      stil.textContent = '#serverbefehl { background: var(--flaeche); border: 1px solid var(--linie);'
        + ' border-radius: 6px; padding: 8px 10px; font-size: 12px; margin: 8px 0 0; }';
      document.head.append(stil);
    }

    const schriften = abschnittSuchen('Schriften');
    if (schriften) {
      schriften.append(el('p', { className: 'hinweis', textContent:
        'Aufgeführt sind die Schriften des Servers, nicht die deines Rechners - '
        + 'er kann nicht wissen, was bei dir installiert ist.' }));
    }
  }

  function abschnittBauen() {
    const konto = kontoseite();
    if (!konto || document.getElementById('serververwaltung')) return;

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

    // Einladung: ein Link, der kurz gilt und genau einmal. So muss kein
    // Passwort durch die Gegend geschickt werden - und wenn der Link doch
    // irgendwo liegen bleibt, ist er laengst wertlos.
    const einRolle = el('select', {});
    const einProjekt = el('select', {});
    const einMinuten = el('select', {});
    for (const m of [5, 15, 60]) {
      einMinuten.append(el('option', { value: String(m), textContent: m + ' Minuten' }));
    }
    const einKnopf = el('button', { type: 'button', textContent: 'Einladungslink erzeugen' });
    const einFeld = el('input', { type: 'text', id: 'v-einladungslink', readOnly: true, hidden: true });
    const einKopieren = el('button', { type: 'button', textContent: 'Kopieren', hidden: true });
    einKopieren.addEventListener('click', async () => {
      einFeld.select();
      try {
        await navigator.clipboard.writeText(einFeld.value);
        sagen('Link kopiert - er gilt nur kurz, also gleich weitergeben.');
      } catch (f) { sagen('Markiert - mit Strg+C kopieren.'); }
    });
    einKnopf.addEventListener('click', async () => {
      try {
        const r = await hol('/verwaltung/einladung', {
          rolle: einRolle.value, projekt: einProjekt.value,
          recht: 'schreiben', minuten: Number(einMinuten.value),
        });
        einFeld.value = r.link;
        einFeld.hidden = false;
        einKopieren.hidden = false;
        sagen(`Gilt ${r.minuten} Minuten und genau einmal.`);
        verwaltungLaden();
      } catch (f) { sagen(f.message); }
    });

    const projektName = el('input', { type: 'text', placeholder: 'Name des neuen Projekts' });
    const projektAnlegen = el('button', { type: 'button', textContent: 'Projekt anlegen' });
    projektAnlegen.addEventListener('click', async () => {
      try {
        await hol('/verwaltung/projekt', { was: 'anlegen', name: projektName.value });
        sagen(`Projekt „${projektName.value}" angelegt - du bist darin Verwalter.`);
        projektName.value = '';
        verwaltungLaden();
        bereicheLaden();
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
      el('h3', { textContent: 'Einladen', style: 'margin-top:14px' }),
      el('p', { className: 'hinweis', textContent:
        'Ein Link, der kurz gilt und genau einmal. Wer ihn öffnet, legt sich Name und '
        + 'Passwort selbst an - so muss kein Passwort durch die Gegend geschickt werden.' }),
      el('p', { className: 'ordnerzeile' }, [einRolle, einProjekt, einMinuten, einKnopf]),
      el('p', { className: 'ordnerzeile' }, [einFeld, einKopieren]),
      el('div', { id: 'v-einladungen' }),
      el('h3', { textContent: 'Projekte', style: 'margin-top:14px' }),
      el('p', { className: 'hinweis', textContent:
        'Ein Projekt ist ein geteilter Bereich mit eigenen Notizbüchern. Umgeschaltet '
        + 'wird oben im Band. Private Notizen bleiben privat - dort kommt niemand hinein, '
        + 'auch kein Verwalter.' }),
      el('div', { id: 'v-projekte' }),
      el('p', { className: 'ordnerzeile' }, [projektName, projektAnlegen]),
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
    konto.append(abschnitt);

    // Die Auswahlfelder füllen sich aus dem Stand
    const fuellen = () => {
      if (!verwaltungStand || !verwaltungStand.darf) return;
      neueRolle.textContent = '';
      einRolle.textContent = '';
      for (const r of verwaltungStand.rollen) {
        neueRolle.append(el('option', { value: r.name, textContent: r.name }));
        einRolle.append(el('option', { value: r.name, textContent: r.name,
                                       selected: r.name === 'Benutzer' }));
      }
      einProjekt.textContent = '';
      einProjekt.append(el('option', { value: '', textContent: 'ohne Projekt' }));
      for (const pr of verwaltungStand.projekte || []) {
        einProjekt.append(el('option', { value: pr.name, textContent: 'Projekt: ' + pr.name }));
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

    // Eingesetzte Elemente bringen ihre Gestaltung selbst mit. Sonst nehmen sie
    // die Standarddarstellung des Browsers - weisse Felder und Knoepfe in einer
    // dunklen Oberflaeche, und das sieht aus wie hineingefallen.
    const stil = document.createElement('style');
    stil.textContent = `
      #serverkopf, #serververwaltung { max-width: 760px; }
      #serverkopf h3, #serververwaltung h3 {
        margin: 22px 0 8px; font-size: 13px; text-transform: uppercase;
        letter-spacing: .04em; color: var(--matt); font-weight: 600;
      }
      #serverkopf .zeile2, #serververwaltung .zeile2 {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; margin: 6px 0; padding-bottom: 6px;
        border-bottom: 1px solid var(--linie);
      }
      #serverkopf .zeile2 span:last-child,
      #serververwaltung .zeile2 span:last-child { display: flex; gap: 6px; flex: 0 0 auto; }
      #serverkopf .hinweis, #serververwaltung .hinweis {
        color: var(--matt); font-size: 12px; margin: 8px 0 0; max-width: 640px;
      }
      #serverkopf button, #serververwaltung button {
        border: 1px solid var(--linie); background: var(--leiste); color: var(--schrift);
        border-radius: 6px; padding: 5px 10px; cursor: pointer; font: inherit; font-size: 13px;
      }
      #serverkopf button:hover, #serververwaltung button:hover { border-color: var(--akzent); }
      #serverkopf button:disabled, #serververwaltung button:disabled {
        opacity: .45; cursor: default; border-color: var(--linie);
      }
      #serververwaltung input[type="text"], #serververwaltung input[type="password"],
      #serververwaltung select, #serverkopf select {
        padding: 5px 8px; height: 28px; border: 1px solid var(--linie); border-radius: 6px;
        background: var(--papier); color: var(--schrift); font: inherit; font-size: 13px;
      }
      #serververwaltung input::placeholder { color: var(--matt); }
      #serververwaltung .ordnerzeile { display: flex; gap: 8px; margin: 10px 0 4px; flex-wrap: wrap; }
      #serververwaltung .ordnerzeile input[type="text"],
      #serververwaltung .ordnerzeile input[type="password"] { flex: 1; min-width: 140px; }
      #serververwaltung .knoepfe { display: flex; gap: 8px; margin: 10px 0 0; flex-wrap: wrap; }
      #serververwaltung .rechte { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 6px 0; }
      #serververwaltung .rollenkasten {
        border: 1px solid var(--linie); border-radius: 8px; background: var(--leiste);
        padding: 10px 12px; margin-bottom: 8px;
      }
      #serververwaltung .rollenkasten strong { display: block; margin-bottom: 6px; }
      #serververwaltung .haken {
        display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--matt);
      }
      #serververwaltung .haken input { accent-color: var(--akzent); }
      /* Der Einladungslink wird abgeschrieben oder kopiert - also breit und
         in gleichmaessiger Schrift, nicht als schmales Eingabefeld. */
      #v-einladungslink {
        flex: 1; min-width: 240px; font-family: ui-monospace, "DejaVu Sans Mono", monospace;
        font-size: 12px; background: var(--flaeche, var(--papier));
      }
      #v-meldung { color: var(--matt); font-size: 12px; margin-top: 10px; }`;
    document.head.append(stil);
  }

  // Beim Öffnen der Einstellungen neu laden - Rollen können sich geändert haben.
  window.addEventListener('DOMContentLoaded', function () {
    einstellungenAnpassen();
    abschnittBauen();
    bereichBauen();
    bereicheLaden();
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
