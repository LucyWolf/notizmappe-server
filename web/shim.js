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
    abschnitt.hidden = false;           // "Zwei Schritte" geht jeden etwas an
    for (const id of ['v-benutzer', 'v-rollen', 'v-einladungen']) {
      const k = document.getElementById(id);
      if (k) k.hidden = !d.darf;
    }
    for (const h of abschnitt.querySelectorAll('h3')) {
      const nurVerwalter = ['Benutzer und Rollen', 'Einladen', 'Was die Rollen bedeuten']
        .indexOf(h.textContent) >= 0;
      h.hidden = nurVerwalter && !d.darf;
      // Seit die Verwaltung in Reiter zerlegt ist, haengt an jeder
      // Ueberschrift ein ganzer Unterabschnitt. Nur die Ueberschrift zu
      // verstecken liess die Eingabefelder darunter stehen - fuer jemanden,
      // der sie gar nicht benutzen darf.
      const teil = h.parentElement;
      if (teil && teil !== abschnitt && teil.tagName === 'SECTION') {
        teil.hidden = nurVerwalter && !d.darf;
      }
    }
    zweiLaden();
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
    // Keine Haken zum Selberbauen mehr: es gibt drei Rollen, und hier steht
    // nur, wofür sie da sind. Wer feiner steuern will, wer was darf, stellt
    // das im Projekt ein - dort gehört es hin.
    const wo = document.getElementById('v-rollen');
    if (!wo) return;
    wo.textContent = '';
    for (const r of d.rollen || []) {
      wo.append(el('p', { className: 'zeile2' }, [
        el('strong', { textContent: r.name }),
        el('span', { className: 'rollenwozu', textContent: r.erklaerung }),
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
    meinBereich = d.jetzt || '';
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
      } catch (f) {
        alert(f.message);
        // Sonst steht im Kaestchen weiter das Projekt, in das der Server
        // gerade nicht gewechselt hat - und die Anzeige luegt.
        bereicheLaden();
      }
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

  /* --- Zwei Schritte beim Anmelden ---------------------------------------
   *
   * Der Ablauf ist absichtlich dreistufig: QR zeigen, Notfallcodes zeigen,
   * und erst einschalten, wenn ein Code aus der App stimmt. Wer sein
   * Geheimnis nie in die App bekommen hat, sperrt sich sonst selbst aus - und
   * die Notfallcodes muss man gesehen haben, bevor man sie braucht.
   */
  let zweiVorbereitet = null;

  async function zweiLaden() {
    const wo = document.getElementById('v-zwei');
    if (!wo) return;
    let d;
    try { d = await hol('/zwei-schritte'); } catch (f) { return; }
    wo.textContent = '';
    if (zweiVorbereitet) { zweiEinrichtenZeigen(wo); return; }
    wo.append(el('p', { className: 'zeile2' }, [
      el('span', { textContent: 'Zweiter Schritt beim Anmelden' }),
      el('span', { textContent: d.an ? `an · ${d.codes_uebrig} Notfallcodes übrig` : 'aus' }),
    ]));
    const knopf = el('button', { type: 'button',
      textContent: d.an ? 'Abschalten' : 'Einrichten' });
    knopf.addEventListener('click', async () => {
      if (d.an) {
        if (!confirm('Zweiten Schritt abschalten? Danach genügt wieder das Passwort allein.')) return;
        try { await hol('/zwei-schritte', { was: 'aus' }); zweiLaden(); verwaltungLaden(); }
        catch (f) { sagen(f.message); }
        return;
      }
      try {
        zweiVorbereitet = await hol('/zwei-schritte', { was: 'vorbereiten' });
        zweiLaden();
      } catch (f) { sagen(f.message); }
    });
    wo.append(el('p', { className: 'knoepfe' }, [knopf]));
    if (!d.an) {
      wo.append(el('p', { className: 'hinweis', textContent:
        'Zusätzlich zum Passwort ein Code aus einer Authenticator-App. '
        + 'Beim Einrichten bekommst du Notfallcodes für den Fall, dass das Telefon weg ist.' }));
    }
  }

  function zweiEinrichtenZeigen(wo) {
    const v = zweiVorbereitet;
    const qr = el('div', { className: 'qrkasten' });
    qr.innerHTML = v.qr;                     // kommt vom eigenen Server, kein fremder Inhalt

    const codefeld = el('input', { type: 'text', placeholder: '123456',
                                   inputMode: 'numeric', autocomplete: 'one-time-code' });
    const fertig = el('button', { type: 'button', textContent: 'Einschalten' });
    fertig.addEventListener('click', async () => {
      try {
        await hol('/zwei-schritte', { was: 'einschalten', code: codefeld.value });
        zweiVorbereitet = null;
        sagen('Zwei Schritte sind an. Beim nächsten Anmelden fragt er nach dem Code.');
        zweiLaden();
        verwaltungLaden();
      } catch (f) { sagen(f.message); }
    });
    const abbrechen = el('button', { type: 'button', textContent: 'Abbrechen' });
    abbrechen.addEventListener('click', () => { zweiVorbereitet = null; zweiLaden(); });

    const codes = el('div', { className: 'notfallcodes' });
    for (const c of v.codes) codes.append(el('code', { textContent: c }));
    const kopieren = el('button', { type: 'button', textContent: 'Codes kopieren' });
    kopieren.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(v.codes.join('\n'));
        sagen('Notfallcodes kopiert - sicher ablegen, nicht neben dem Passwort.');
      } catch (f) { sagen('Bitte abschreiben - die Zwischenablage ging nicht.'); }
    });

    wo.append(
      el('h4', { textContent: '1. In der App einlesen' }),
      qr,
      el('p', { className: 'hinweis', textContent:
        'Geht die Kamera nicht, trag dieses Geheimnis von Hand ein:' }),
      el('code', { className: 'geheimnis', textContent: v.geheim }),
      el('h4', { textContent: '2. Notfallcodes aufschreiben' }),
      el('p', { className: 'hinweis', textContent:
        'Jeder gilt genau einmal. Sie sind der Weg hinein, wenn das Telefon weg ist - '
        + 'und sie werden danach nie wieder angezeigt.' }),
      codes,
      el('p', { className: 'knoepfe' }, [kopieren]),
      el('h4', { textContent: '3. Mit einem Code aus der App bestätigen' }),
      el('p', { className: 'hinweis', textContent:
        'Erst damit wird eingeschaltet - so steht fest, dass die App wirklich funktioniert.' }),
      el('p', { className: 'ordnerzeile' }, [codefeld, fertig, abbrechen]),
    );
  }

  function systemseite() {
    return document.querySelector('.dateiseite[data-punkt="konto"]');
  }

  /* Die Server-Einstellungen gehoeren in die Tafel der Optionen - dorthin, wo
     auch "Daten", "Schriften" und "Fenster" stehen. Sie stehen oben in einem
     eigenen Kasten: was nur dieser Server kann, soll man zuerst sehen und
     nicht unter den Hinweisen suchen, die am Server nichts tun. */
  function optionentafel() {
    const seite = document.querySelector('.dateiseite[data-punkt="optionen"]');
    if (!seite) return null;
    return seite.querySelector('#einstellungen .tafel') || seite;
  }

  /* Eigene Abschnitte kommen vor die der Oberflaeche: was nur dieser Server
     kann, soll vor Daten, Schriften und Fenster stehen. */
  function optionAnhaengen(abschnitt) {
    const tafel = optionentafel();
    if (!tafel) return null;
    abschnitt.dataset.eigen = 'ja';
    const fremd = Array.from(tafel.children).find(
      (k) => k.tagName === 'SECTION' && !k.dataset.eigen);
    tafel.insertBefore(abschnitt, fremd || null);
    return abschnitt;
  }

  /* --------------------------------------------- Reiter in den Einstellungen

     Alles in einer Spalte war ein Band von zwei Metern: Benutzer, zwei
     Schritte, Einladen, Projekte, Rollen, Mailversand, Daten, Schriften,
     Fenster - und dazwischen die Hinweise, warum etwas am Server nicht geht.
     Jetzt steht oben eine Reiterleiste und darunter genau ein Abschnitt.

     Zugedeckt wird mit einer eigenen Klasse, nicht mit hidden. hidden setzen
     hier mehrere Stellen aus eigenem Grund - die Verwaltung erst, wenn die
     Rechte da sind, "Mit einem Server verbinden" ueberhaupt nicht. Wer hidden
     traegt, bekommt keinen Reiter; wer einen bekommt, wird mit der Klasse
     zugedeckt. So treten sich die beiden nicht gegenseitig weg. */
  const REITER_WEG = 'reiterzu';
  const REITER_MERK = 'notizmappe.optionenreiter';
  // Die Ueberschriften sind Saetze, Reiter muessen kurz sein.
  const REITERNAMEN = {
    'Benutzer und Rollen': 'Benutzer',
    'Zwei Schritte beim Anmelden': 'Zwei Schritte',
    'Was die Rollen bedeuten': 'Rollen',
    'Aus OneNote übernehmen': 'OneNote',
    'Mit einem Server verbinden': 'Server',
  };
  let offenerReiter = null;
  try { offenerReiter = localStorage.getItem(REITER_MERK); } catch (f) { /* ohne eben nicht */ }

  /* Einen langen Abschnitt an seinen Ueberschriften zerlegen, damit jedes
     Thema einen eigenen Reiter bekommen kann. Was vor der ersten Ueberschrift
     steht, bleibt stehen - es gehoert zu keinem Thema. */
  function nachH3Teilen(abschnitt) {
    const kinder = Array.from(abschnitt.children);
    if (!kinder.some((k) => k.tagName === 'H3')) return;
    let teil = null;
    for (const kind of kinder) {
      if (kind.tagName === 'H3') {
        kind.style.marginTop = '';        // der Abstand kam vom langen Band
        teil = el('section', {});
        abschnitt.append(teil);
      }
      if (teil) teil.append(kind);
    }
  }

  /* Ein Blatt ist, was einen Reiter bekommt: ein Abschnitt mit Ueberschrift.
     Stecken in einem Abschnitt weitere, zaehlen die inneren - so bleibt
     #serververwaltung als Ganzes abschaltbar und liefert trotzdem fuenf
     Reiter. */
  function reiterblaetter(tafel) {
    const blaetter = [];
    for (const aussen of Array.from(tafel.children)) {
      if (aussen.tagName !== 'SECTION' || aussen.hidden) continue;
      const innen = Array.from(aussen.children).filter((k) => k.tagName === 'SECTION');
      if (innen.length) {
        for (const i of innen) if (!i.hidden && i.querySelector('h3')) blaetter.push(i);
      } else if (aussen.querySelector('h3')) {
        blaetter.push(aussen);
      }
    }
    return blaetter;
  }

  function optionenReiterBauen() {
    const tafel = optionentafel();
    if (!tafel) return;
    const blaetter = reiterblaetter(tafel);
    // Erst alles aufdecken: was gerade keinen Reiter hat - weil es hidden
    // traegt oder weil ein Abschnitt zerlegt wurde -, darf nicht von einer
    // alten Runde zugedeckt bleiben.
    for (const s of tafel.querySelectorAll('section')) s.classList.remove(REITER_WEG);

    let leiste = document.getElementById('optionenreiter');
    if (!leiste) {
      leiste = el('div', { id: 'optionenreiter' });
      leiste.setAttribute('role', 'tablist');
      tafel.insertBefore(leiste, tafel.children[0] || null);
    }
    leiste.textContent = '';
    leiste.hidden = blaetter.length < 2;
    if (!blaetter.length) return;

    const wie = (s) => s.querySelector('h3').textContent.trim();
    if (!blaetter.some((s) => wie(s) === offenerReiter)) offenerReiter = wie(blaetter[0]);

    for (const blatt of blaetter) {
      const schluessel = wie(blatt);
      const auf = schluessel === offenerReiter;
      if (!auf) blatt.classList.add(REITER_WEG);
      const knopf = el('button', { type: 'button',
                                   textContent: REITERNAMEN[schluessel] || schluessel });
      knopf.setAttribute('role', 'tab');
      knopf.setAttribute('aria-selected', auf ? 'true' : 'false');
      knopf.addEventListener('click', function () {
        offenerReiter = schluessel;
        try { localStorage.setItem(REITER_MERK, schluessel); } catch (f) { /* egal */ }
        optionenReiterBauen();
      });
      leiste.append(knopf);
    }
  }

  function einstellungenAnpassen() {
    // Aus "Konto" wird "System": hier steht nicht der eigene Zugang - der
    // steht im Profil -, sondern die Installation. Was auf der Seite für den
    // eigenen Rechner steht - "Verbindung einrichten", "hier gibt es kein
    // Konto" - ist hier sinnlos; es verschwindet, bleibt aber im Gerüst
    // stehen, damit die gemeinsame Oberfläche weiter darauf zeigen darf.
    const system = systemseite();
    // Die Sperre gegen ein zweites Durchlaufen hing vorher an einem Abschnitt
    // "Angemeldet", der hier stand. Der ist weg - wer angemeldet ist und was
    // er darf, steht unten im Profil, und zweimal braucht das niemand. Also
    // eine eigene Marke, statt die Sperre an etwas Sichtbares zu haengen.
    if (!system || system.dataset.angepasst === 'ja') return;
    system.dataset.angepasst = 'ja';
    for (const kind of Array.from(system.children)) {
      if (kind.tagName !== 'H2') kind.hidden = true;
    }

    // Umbenannt wird nur die Beschriftung. Der Schlüssel data-punkt bleibt
    // "konto" - daran findet die Umschaltung der Datei-Ebene die Seite, und
    // die kommt aus der gemeinsamen Oberfläche.
    const kopf = system.querySelector('h2');
    if (kopf) kopf.textContent = 'System';
    const reiter = document.querySelector('#dateileiste .dateipunkt[data-punkt="konto"]');
    if (reiter) reiter.textContent = 'System';

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
      const BEFEHLE = 'docker compose pull\ndocker compose up -d';
      const knopf = el('button', { type: 'button', textContent: 'Nach Updates sehen' });
      // Ein echter "Jetzt aktualisieren"-Knopf kann hier nicht stehen: ein
      // Container kann sich nicht selbst ersetzen. Dafuer braeuchte er den
      // Docker-Socket - und wer den hat, ist root auf dem Rechner. Das ueber
      // eine Weboberflaeche erreichbar zu machen, waere die groesste Luecke im
      // ganzen Programm. Also der naechstbeste Knopf: die Befehle mitnehmen.
      const kopieren = el('button', { type: 'button', id: 'e-befehl-kopieren',
                                      textContent: 'Befehle kopieren', hidden: true });
      const befehl = el('pre', { id: 'serverbefehl', hidden: true, textContent: BEFEHLE });
      kopieren.addEventListener('click', async () => {
        const hinweis = document.getElementById('e-updatehinweis');
        try {
          await navigator.clipboard.writeText(BEFEHLE);
          kopieren.textContent = 'kopiert';
          setTimeout(() => { kopieren.textContent = 'Befehle kopieren'; }, 1500);
        } catch (e2) {
          // Ohne HTTPS gibt der Browser die Zwischenablage nicht her - dann
          // wenigstens markieren, damit Strg+C reicht.
          const w = window.getSelection(); const r = document.createRange();
          r.selectNodeContents(befehl); w.removeAllRanges(); w.addRange(r);
          hinweis.textContent = 'Die Zwischenablage ist hier gesperrt (das gibt es '
            + 'nur über HTTPS) - die Befehle sind markiert, Strg+C genügt.';
        }
      });
      knopf.addEventListener('click', async () => {
        const hinweis = document.getElementById('e-updatehinweis');
        hinweis.textContent = 'wird nachgesehen …';
        try {
          // Auf Knopfdruck wirklich nachsehen, nicht den Zwischenspeicher zeigen.
          const f = await hol('/fassung?frisch=1');
          document.getElementById('e-verfuegbar').textContent = f.neueste || '—';
          const dort = document.getElementById('e-version');
          // Zwei Nummern, und beide gehen jemanden etwas an: die Serverschicht
          // und die Oberflaeche darin. Sie laufen absichtlich getrennt - nicht
          // jede Aenderung hier betrifft die Oberflaeche.
          if (dort && f.laeuft) {
            dort.textContent = f.oberflaeche ? `${f.laeuft} (Oberfläche ${f.oberflaeche})`
                                             : f.laeuft;
          }
          befehl.hidden = !f.neuer;
          kopieren.hidden = !f.neuer;
          jetzt.hidden = !f.neuer;
          hinweis.textContent = f.fehler ? f.fehler
            : (f.neuer ? `Es gibt ${f.neueste} - hier läuft ${f.laeuft}. Der Server kann `
                       + 'sich nicht selbst austauschen; auf dem Rechner, auf dem der '
                       + 'Container läuft:'
                       : `Hier läuft ${f.laeuft}, das ist die neueste.`);
        } catch (e2) { hinweis.textContent = e2.message; }
      });
      // Der eigentliche Knopf. Ein Container kann sich nicht selbst durch ein
      // neues Image ersetzen - aber er kann seinen Inhalt erneuern und sich
      // neu starten lassen. Genau das passiert hier; den Docker-Socket
      // braucht dafuer niemand.
      const jetzt = el('button', { type: 'button', id: 'e-jetzt',
                                   textContent: 'Jetzt aktualisieren', hidden: true });
      jetzt.addEventListener('click', async () => {
        const hinweis = document.getElementById('e-updatehinweis');
        jetzt.disabled = true;
        const melden = (t) => { hinweis.textContent = t; };
        try {
          if (!await updateStarten(melden)) jetzt.disabled = false;
        } catch (f) {
          hinweis.textContent = f.message;
          jetzt.disabled = false;
        }
      });


      version.append(el('p', { className: 'knoepfe' }, [knopf, jetzt, kopieren]), befehl);
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

  /* ------------------------------------------------------- Profil statt Zahnrad

     Am eigenen Rechner gibt es nur einen Menschen, deshalb steht unten in der
     Leiste ein Zahnrad. Auf dem Server ist die wichtigere Frage "wer bin ich
     hier gerade" - also steht dort jetzt Name und Profil, und die
     Einstellungen haengen darin.

     Das Zahnrad wird nur versteckt, nicht entfernt: ein Dutzend Stellen in der
     gemeinsamen Oberflaeche zeigen auf #zahnrad, und der Punkt "Einstellungen"
     im Menue klickt es einfach an. So bleibt der Weg dorthin genau einer. */

  /* ------------------------------------------------------------------ Ablage

     Wo die Notizen liegen. Eingehaengt wird beim Start, nicht hier - der
     Serverprozess hat die Rechte dafuer abgelegt. Diese Seite stellt nur ein
     und sagt, was beim letzten Start dabei herauskam. */

  /* ---------------------------------------------------------------- Designs

     Die Oberflaeche haengt an neun Farbnamen - mehr braucht ein Design nicht.
     "system" setzt nichts und laesst damit hell/dunkel beim Betriebssystem,
     so wie es vorher war; alle anderen ueberschreiben die Namen am <html>.

     Gemerkt wird die Wahl beim Benutzer, nicht im Browser: wer sich woanders
     anmeldet, soll seine Oberflaeche wiedererkennen. Zusaetzlich liegt sie in
     localStorage, aber nur, damit beim naechsten Laden nicht erst das alte
     Design aufblitzt, bevor die Antwort des Servers da ist. */

  const DESIGNS = {
    system: { name: 'Wie das Betriebssystem', farben: null },
    hell: {
      name: 'Hell',
      farben: {
        '--papier': '#fffefb', '--linie': '#e3e0d8', '--schrift': '#1f1d1a',
        '--matt': '#78736a', '--leiste': '#f4f1ea', '--flaeche': '#f7f5f0',
        '--akzent': '#7a5cff', '--warnung': '#b23b2e', '--kasten-rand': '#d8d4ca',
      },
    },
    dunkel: {
      name: 'Dunkel',
      farben: {
        '--papier': '#1b1a18', '--linie': '#332f2a', '--schrift': '#e8e4dc',
        '--matt': '#938d83', '--leiste': '#121110', '--flaeche': '#232220',
        '--akzent': '#9d86ff', '--warnung': '#ff8d7e', '--kasten-rand': '#3a3631',
      },
    },
    mitternacht: {
      name: 'Mitternacht',
      farben: {
        '--papier': '#0f1420', '--linie': '#243049', '--schrift': '#dce6f5',
        '--matt': '#7e8da8', '--leiste': '#080c14', '--flaeche': '#172033',
        '--akzent': '#4f9dff', '--warnung': '#ff7b6b', '--kasten-rand': '#2b3a56',
      },
    },
    sepia: {
      name: 'Sepia',
      farben: {
        '--papier': '#f6ecd9', '--linie': '#ddcdaf', '--schrift': '#3b2f21',
        '--matt': '#8a7557', '--leiste': '#efe2c9', '--flaeche': '#f1e5cd',
        '--akzent': '#a4601f', '--warnung': '#9c3320', '--kasten-rand': '#d3c0a0',
      },
    },
    wald: {
      name: 'Wald',
      farben: {
        '--papier': '#121a16', '--linie': '#27362d', '--schrift': '#dfeae2',
        '--matt': '#82998b', '--leiste': '#0c120f', '--flaeche': '#1a2520',
        '--akzent': '#5fd39a', '--warnung': '#ff9178', '--kasten-rand': '#2e4036',
      },
    },
    flieder: {
      name: 'Flieder',
      farben: {
        '--papier': '#1a1626', '--linie': '#342b4d', '--schrift': '#e9e2f7',
        '--matt': '#9b8fba', '--leiste': '#120f1b', '--flaeche': '#231d33',
        '--akzent': '#b388ff', '--warnung': '#ff8da8', '--kasten-rand': '#3c3157',
      },
    },
    kontrast: {
      name: 'Starker Kontrast',
      farben: {
        '--papier': '#000000', '--linie': '#6f6f6f', '--schrift': '#ffffff',
        '--matt': '#cfcfcf', '--leiste': '#000000', '--flaeche': '#161616',
        '--akzent': '#ffd400', '--warnung': '#ff6a5a', '--kasten-rand': '#8a8a8a',
      },
    },
  };

  // Eigene Farben: was zuletzt eingestellt war. Steht getrennt von DESIGNS,
  // weil es nicht fest ist, sondern vom Benutzer kommt.
  let eigeneFarben = {};

  function themaAnwenden(welches, farben) {
    const wurzel = document.documentElement;
    if (farben) eigeneFarben = Object.assign({}, eigeneFarben, farben);
    const design = welches === 'eigene'
      ? { name: 'Eigene Farben', farben: eigeneFarben }
      : (DESIGNS[welches] || DESIGNS.system);
    // Erst die Namen einer vorigen Wahl wegnehmen, sonst bleibt bei "system"
    // die letzte Farbe stehen.
    for (const schluessel of Object.keys(DESIGNS.hell.farben)) {
      wurzel.style.removeProperty(schluessel);
    }
    if (design.farben) {
      for (const [schluessel, wert] of Object.entries(design.farben)) {
        wurzel.style.setProperty(schluessel, wert);
      }
    }
    const kasten = document.getElementById('p-eigene');
    if (kasten) kasten.hidden = welches !== 'eigene';
    wurzel.dataset.thema = welches;
    try { localStorage.setItem('notizmappe-thema', welches); } catch (f) { /* egal */ }
  }

  // So frueh wie moeglich, damit beim Laden nicht erst das alte Design
  // aufblitzt. Der Server bestaetigt gleich darauf - oder korrigiert.
  try {
    const gemerkt = localStorage.getItem('notizmappe-thema');
    if (gemerkt && DESIGNS[gemerkt]) themaAnwenden(gemerkt);
  } catch (f) { /* ohne localStorage eben nicht */ }

  async function themaLaden() {
    let d;
    try { d = await hol('/aussehen'); } catch (f) { return; }
    if (d.farben && Object.keys(d.farben).length) eigeneFarben = d.farben;
    if (d.thema) themaAnwenden(d.thema);
    const wahl = document.getElementById('p-thema');
    if (wahl) wahl.value = d.thema;
    farbfelderFuellen();
  }

  // Die neun Namen mit Klartext - "--kasten-rand" sagt niemandem etwas.
  const FARBNAMEN = [
    ['--papier', 'Hintergrund'], ['--schrift', 'Schrift'],
    ['--leiste', 'Leisten'], ['--flaeche', 'Eingabefelder'],
    ['--linie', 'Linien'], ['--matt', 'Nebentext'],
    ['--akzent', 'Akzent'], ['--warnung', 'Warnung'],
    ['--kasten-rand', 'Kastenrand'],
  ];

  function farbfelderFuellen() {
    for (const [schluessel] of FARBNAMEN) {
      const feld = document.getElementById('f' + schluessel);
      if (feld) feld.value = eigeneFarben[schluessel] || '#888888';
    }
  }

  // Was gerade zu sehen ist, als Ausgangspunkt nehmen - sonst fängt man bei
  // neun grauen Feldern an und muss alles von Hand suchen.
  function farbenVomAktuellen() {
    const gelesen = getComputedStyle(document.documentElement);
    const aus = {};
    for (const [schluessel] of FARBNAMEN) {
      aus[schluessel] = nachHex(gelesen.getPropertyValue(schluessel).trim());
    }
    return aus;
  }

  function nachHex(wert) {
    if (/^#[0-9a-fA-F]{6}$/.test(wert)) return wert.toLowerCase();
    const treffer = wert.match(/rgba?\(([^)]+)\)/);
    if (!treffer) return '#888888';
    const teile = treffer[1].split(',').map((t) => parseInt(t, 10));
    return '#' + teile.slice(0, 3)
      .map((z) => Math.max(0, Math.min(255, z || 0)).toString(16).padStart(2, '0')).join('');
  }

  /* Doppelklick auf einen Strich: markieren, verschieben, loeschen.

     Der erste Versuch hat Zeiger-Ereignisse nachgestellt, um die vorhandene
     Lasso-Logik zu benutzen. Das ist an drei Annahmen gescheitert - und selbst
     repariert blieb es auf den Zeichnen-Reiter beschraenkt, weil das Blatt nur
     dort Zeiger faengt.

     Deshalb jetzt geradeheraus: den getroffenen Strich selbst ausrechnen,
     gewaehlt setzen, neu malen. Das geht im Start-Reiter genauso, braucht
     keinen Moduswechsel und keine nachgestellten Ereignisse. */

  /* ---- Striche glaetten -------------------------------------------------

     Eine mit der Maus gezogene Linie zittert. Drueben wird Punkt fuer Punkt
     mit lineTo gemalt, jedes Zittern steht also im Bild - und in der Datei.

     Deshalb hier zwei Schritte, erst wenn der Strich fertig ist:
     1. ausduennen - Punkte, die kaum von der Geraden ihrer Nachbarn
        abweichen, fliegen raus (Ramer-Douglas-Peucker). Das nimmt das
        Zittern weg und macht die Datei kleiner.
     2. runden - die verbliebenen Ecken werden abgeschnitten (Chaikin).
        Anfang und Ende bleiben liegen, sonst wandert der Strich.

     Beides laeuft auf den Punkten, nicht beim Malen: so sieht der Desktop
     spaeter dasselbe, und am Zeichnen drueben ist nichts geaendert. */

  const GLATT_SCHLUESSEL = 'notizmappe.glaetten';
  const GLATT_STUFEN = ['aus', 'leicht', 'stark'];

  function glattStufe() {
    try {
      const g = localStorage.getItem(GLATT_SCHLUESSEL);
      return GLATT_STUFEN.includes(g) ? g : 'leicht';
    } catch (f) { return 'leicht'; }
  }

  // Abstand eines Punktes von der Geraden a-b.
  function abstand(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const laenge = Math.hypot(dx, dy);
    if (laenge < 1e-6) return Math.hypot(px - ax, py - ay);
    return Math.abs(dy * px - dx * py + bx * ay - by * ax) / laenge;
  }

  function ausduennen(p, luft) {
    const anzahl = p.length / 3;
    if (anzahl < 3) return p.slice();
    const behalten = new Uint8Array(anzahl);
    behalten[0] = behalten[anzahl - 1] = 1;
    // Ohne Rekursion, damit ein langer Strich nicht den Stapel sprengt.
    const offen = [[0, anzahl - 1]];
    while (offen.length) {
      const [a, b] = offen.pop();
      if (b - a < 2) continue;
      let weit = -1, wo = -1;
      for (let i = a + 1; i < b; i++) {
        const d = abstand(p[i * 3], p[i * 3 + 1], p[a * 3], p[a * 3 + 1], p[b * 3], p[b * 3 + 1]);
        if (d > weit) { weit = d; wo = i; }
      }
      if (weit > luft) { behalten[wo] = 1; offen.push([a, wo], [wo, b]); }
    }
    const raus = [];
    for (let i = 0; i < anzahl; i++) {
      if (behalten[i]) raus.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    }
    return raus;
  }

  function ecken_runden(p, radius) {
    const anzahl = p.length / 3;
    if (anzahl < 3) return p.slice();
    const raus = [p[0], p[1], p[2]];
    for (let i = 0; i < anzahl - 1; i++) {
      const a = i * 3, b = (i + 1) * 3;
      // Wie weit in die Strecke hinein abgeschnitten wird. Das klassische
      // Viertel nimmt bei langen Strecken ganze Ecken weg - eine mit Absicht
      // gezogene Ecke soll aber eine Ecke bleiben. Deshalb hoechstens so
      // viele Bildpunkte, wie der Radius erlaubt.
      const laenge = Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1]);
      const t = laenge > 1e-6 ? Math.min(0.25, radius / laenge) : 0.25;
      raus.push(p[a] + (p[b] - p[a]) * t, p[a + 1] + (p[b + 1] - p[a + 1]) * t,
                p[a + 2] + (p[b + 2] - p[a + 2]) * t);
      raus.push(p[b] - (p[b] - p[a]) * t, p[b + 1] - (p[b + 1] - p[a + 1]) * t,
                p[b + 2] - (p[b + 2] - p[a + 2]) * t);
    }
    raus.push(p[p.length - 3], p[p.length - 2], p[p.length - 1]);
    return raus;
  }

  function geglaettet(p, stufe) {
    if (stufe === 'aus' || !p || p.length < 9) return p;
    const stark = stufe === 'stark';
    let neu = ausduennen(p, stark ? 1.4 : 1.0);
    // Jeder Durchgang halbiert den Knick an einer Ecke. Zwei waren zu wenig -
    // gemessen blieben Knicke von 35 Grad stehen, und genau die sieht man als
    // Kanten. Mit vier bis fuenf sind es unter 20 beziehungsweise 5 Grad.
    const runden = stark ? 5 : 4;
    for (let i = 0; i < runden; i++) {
      // Nicht ueber die Grenze drueben hinaus wachsen lassen: ab MAX_PUNKTE
      // faengt dort ein neuer Strich an.
      if (neu.length * 2 > 1400 * 3) break;
      neu = ecken_runden(neu, stark ? 4 : 3);
    }
    // Nach dem Runden liegen viele Punkte fast auf einer Geraden. Die koennen
    // weg - sonst hat ein geglaetteter Strich mehr Punkte als der gezogene.
    // Nur ganz knapp: mit 0.25 waehlt das Ausduennen wieder die Ausreisser und
    // zieht gerade Strecken dazwischen - gemessen war das Wackeln danach so
    // gross wie vorher. Auch 0.12 holt noch Kanten zurueck; was hier
    // weggeworfen wird, weicht jetzt um weniger als ein Zwanzigstel Bildpunkt
    // ab und ist auf keinem Bildschirm zu sehen.
    neu = ausduennen(neu, stark ? 0.04 : 0.05);
    // Genauso runden wie drueben beim Ablegen - zwei Nachkommastellen beim
    // Druck, eine bei den Punkten. Sonst blaeht das Glaetten die Datei auf.
    return neu.map((w, i) => (i % 3 === 2 ? Math.round(w * 100) / 100
                                          : Math.round(w * 10) / 10));
  }

  const GRIFFE = ['no', 'n', 'nw', 'o', 'w', 'so', 's', 'sw'];
  /* Welche Kante beim Ziehen stehen bleibt: am Nordwest-Griff bleibt die
     Suedost-Ecke liegen, sonst wandert die Zeichnung beim Groesserziehen
     mit davon. Fehlt eine Achse, wird in der Richtung nicht skaliert. */
  const ANKER = {
    nw: { x: 'x2', y: 'y2' }, no: { x: 'x1', y: 'y2' },
    sw: { x: 'x2', y: 'y1' }, so: { x: 'x1', y: 'y1' },
    n: { y: 'y2' }, s: { y: 'y1' }, w: { x: 'x2' }, o: { x: 'x1' },
  };
  let rahmen = null;
  let rahmenUhr = null;
  let letzteStelle = null;

  /* Auf dem Blatt liegen zwei verschiedene Dinge: Striche in der Zeichnung und
     Kaesten (Text, Bild, Tabelle) als eigene Elemente der Oberflaeche. Drueben
     kennt die Auswahl nur Striche - deshalb hier eine zweite Liste, und alles,
     was mit der Auswahl passiert, muss beide bedienen. Sonst markiert Strg+A
     scheinbar "alles" und laesst die Texte liegen. */
  const wahlKaesten = [];

  function alleKaesten() {
    const grund = document.getElementById('flaeche');
    return grund ? Array.from(grund.querySelectorAll('.kasten')) : [];
  }

  function kastenDaten(k) {
    try {
      if (typeof elemente === 'undefined' || !k) return null;
      return elemente.find((x) => x.id === k.dataset.id) || null;
    } catch (f) { return null; }
  }

  // Die Kaesten liegen im selben Bezugssystem wie strichGrenzen: #flaeche wird
  // als Ganzes gezoomt, die Zahlen darin sind ungezoomt.
  function kastenGrenzen(k) {
    return { x1: k.offsetLeft, y1: k.offsetTop,
             x2: k.offsetLeft + k.offsetWidth, y2: k.offsetTop + k.offsetHeight };
  }

  function kaestenZeigen() {
    for (const k of alleKaesten()) k.classList.toggle('mitgewaehlt', wahlKaesten.includes(k));
  }

  function auswahlLeeren() {
    const wahl = malWahl();
    if (wahl) wahl.length = 0;
    wahlKaesten.length = 0;
    kaestenZeigen();
  }

  function etwasGewaehlt() {
    const wahl = malWahl();
    return (wahl && wahl.length > 0) || wahlKaesten.length > 0;
  }

  function malWahl() {
    try { return typeof gewaehlt === 'undefined' ? null : gewaehlt; }
    catch (f) { return null; }
  }

  function malGrenzen() {
    try { return typeof strichGrenzen === 'function' ? strichGrenzen : null; }
    catch (f) { return null; }
  }

  function malZeichnung() {
    try { return typeof zeichnung === 'undefined' ? null : zeichnung; }
    catch (f) { return null; }
  }

  function malZoom() {
    try { return typeof zoom === 'undefined' ? 1 : (zoom || 1); }
    catch (f) { return 1; }
  }

  function neuMalen() {
    try { if (typeof allesMalen === 'function') allesMalen(); } catch (f) { /* egal */ }
  }

  function gemerkt() {
    try { if (typeof angefasst === 'function') angefasst(); } catch (f) { /* egal */ }
  }

  function malsagen(text) {
    const zeile = document.getElementById('m-hinweis');
    if (zeile) {
      zeile.textContent = text;
      if (text) setTimeout(() => { if (zeile.textContent === text) zeile.textContent = ''; }, 5000);
      return;
    }
    console.log('[notizmappe] ' + text);
  }

  // Dieselbe Rechnung wie stelle() drueben: gegen #flaeche, geteilt durch den
  // Zoom. Ohne das liegt alles daneben, sobald jemand hineinzoomt.
  function stelleHier(ev) {
    const flaeche = document.getElementById('flaeche');
    if (!flaeche) return null;
    const r = flaeche.getBoundingClientRect();
    const z = malZoom();
    return { x: (ev.clientX - r.left) / z, y: (ev.clientY - r.top) / z };
  }

  function strichTrifft(st, x, y, nah) {
    // Punkte liegen flach als x, y, Druck - deshalb in Dreierschritten.
    const reichweite = nah + (st.d || 2);
    for (let i = 0; i < st.p.length; i += 3) {
      if (Math.abs(st.p[i] - x) <= reichweite && Math.abs(st.p[i + 1] - y) <= reichweite) {
        return true;
      }
    }
    return false;
  }

  // Alle Striche an dieser Stelle, der oberste zuerst. Mehrere, weil sich
  // Striche ueberlagern und man auch an den darunter herankommen muss.
  function stricheBei(x, y) {
    const z = malZeichnung();
    const liste = [];
    if (!z || !z.striche) return liste;
    // Von hinten: was zuletzt gemalt wurde, liegt oben.
    for (let i = z.striche.length - 1; i >= 0; i--) {
      if (strichTrifft(z.striche[i], x, y, 10)) liste.push(z.striche[i]);
    }
    return liste;
  }

  // Ein Strich gehoert dazu, sobald einer seiner Punkte im Rahmen liegt. Nach
  // den Grenzen zu gehen waere ungenau: ein langer schraeger Strich hat einen
  // riesigen Kasten und wuerde mitgehen, obwohl er gar nicht hineinragt.
  function strichImKasten(st, k) {
    for (let i = 0; i < st.p.length; i += 3) {
      if (st.p[i] >= k.x1 && st.p[i] <= k.x2 && st.p[i + 1] >= k.y1 && st.p[i + 1] <= k.y2) {
        return true;
      }
    }
    return false;
  }

  function zusammenhaengend(saat) {
    // Nur noch auf Knopfdruck: was sich beruehrt, dazunehmen. Von allein
    // passiert das nicht mehr - sonst bekommt man einen einzelnen Strich
    // einer Zeichnung nie zu fassen.
    const z = malZeichnung();
    const grenzenVon = malGrenzen();
    if (!z || !grenzenVon) return saat.slice();
    const drin = saat.slice();
    let gewachsen = true;
    while (gewachsen) {
      gewachsen = false;
      for (const st of z.striche) {
        if (drin.includes(st)) continue;
        const a = grenzenVon(st);
        if (drin.some((b) => ueberlappt(a, grenzenVon(b)))) { drin.push(st); gewachsen = true; }
      }
    }
    return drin;
  }

  function ueberlappt(a, b) {
    const luft = 4;
    return a.x1 - luft <= b.x2 && a.x2 + luft >= b.x1
        && a.y1 - luft <= b.y2 && a.y2 + luft >= b.y1;
  }

  function glaettenAnschalten() {
    if (document.body.dataset.glaetten === 'ja') return;
    document.body.dataset.glaetten = 'ja';
    let vorher = -1;

    // Nicht am Ereignis festmachen, ob ein Strich fertig wurde, sondern an der
    // Zahl der Striche: drueben legt auch ein zu langer Strich mitten in der
    // Bewegung ab, und der Radierer loest dasselbe Ereignis aus.
    document.addEventListener('pointerdown', function () {
      const z = malZeichnung();
      vorher = z && z.striche ? z.striche.length : -1;
    }, true);

    const nachsehen = function () {
      const z = malZeichnung();
      if (!z || !z.striche || vorher < 0 || z.striche.length <= vorher) { vorher = -1; return; }
      const stufe = glattStufe();
      const neue = z.striche.slice(vorher);
      vorher = -1;
      if (stufe === 'aus') return;
      for (const st of neue) st.p = geglaettet(st.p, stufe);
      neuMalen();
      gemerkt();
    };
    for (const art of ['pointerup', 'pointercancel']) {
      // Erst danach: drueben legt der Strich im selben Ereignis ab.
      document.addEventListener(art, () => setTimeout(nachsehen, 0), true);
    }
  }

  function markierenAnschalten() {
    if (document.body.dataset.markieren === 'ja') return;
    document.body.dataset.markieren = 'ja';

    document.addEventListener('dblclick', function (ev) {
      // Nicht in Text hineinfunken: ein Doppelklick dort waehlt ein Wort aus.
      if (ev.target && ev.target.closest
          && ev.target.closest('.text, input, select, textarea, button, #band, #dateischirm')) {
        return;
      }
      const wahl = malWahl();
      if (!wahl) return;
      const p = stelleHier(ev);
      if (!p) return;
      const treffer = stricheBei(p.x, p.y);
      if (!treffer.length) return;
      ev.preventDefault();
      ev.stopPropagation();

      if (ev.shiftKey || ev.ctrlKey || ev.metaKey) {
        // Dazunehmen oder wieder abwaehlen, ohne die uebrige Wahl zu verlieren.
        const schon = wahl.indexOf(treffer[0]);
        if (schon >= 0) wahl.splice(schon, 1); else wahl.push(treffer[0]);
      } else if (wahlKaesten.length) {
        // Erst die Kaesten los, sonst haengt der Rahmen noch am halben Zettel.
        auswahlLeeren();
        wahl.push(treffer[0]);
      } else {
        // Zweimal an dieselbe Stelle: den naechsten darunter nehmen. So kommt
        // man an einen Strich heran, ueber dem ein anderer liegt.
        let naechster = treffer[0];
        const nochmal = letzteStelle && Math.abs(letzteStelle.x - p.x) < 12
                        && Math.abs(letzteStelle.y - p.y) < 12;
        if (nochmal && wahl.length === 1) {
          const wo = treffer.indexOf(wahl[0]);
          if (wo >= 0) naechster = treffer[(wo + 1) % treffer.length];
        }
        wahl.length = 0;
        wahl.push(naechster);
      }
      letzteStelle = { x: p.x, y: p.y };
      neuMalen();
      rahmenZeichnen();
      if (wahl.length === 1 && treffer.length > 1) {
        malsagen('1 Strich markiert - nochmal doppelklicken nimmt den darunter.');
      } else {
        malsagen(`${wahl.length} ${wahl.length === 1 ? 'Strich' : 'Striche'} markiert - `
                 + 'ziehen verschiebt, Griffe ändern die Größe, ✕ löscht.');
      }
    }, true);

    /* Rahmen aufziehen. Das Lasso drueben kann das auch - aber nur im
       Zeichnen-Reiter, weil das Blatt sonst keine Zeiger faengt. Hier wird
       deshalb selbst gerechnet, wie beim Doppelklick.

       Angefasst wird nur der leere Grund: liegt der Zeiger auf dem Blatt,
       zeichnet drueben das Werkzeug, und dem wird nicht dazwischengefunkt. */

    /* Woran ein Rahmen nicht anfangen darf. Ein ganzer Kasten gehoert dazu:
       an seinem Griff haengt drueben das Verschieben, und wer ihn anfasste,
       zog gleichzeitig einen Rahmen auf - der Kasten wanderte, und darueber
       lag eine gestrichelte Auswahl. Auch sonst faengt man auf einem Kasten
       keine Auswahl an: Bild, Tabelle und Modell sind Dinge, nicht Grund. */
    const BAND_NICHT = '#malblatt, .kasten, .text, input, select, textarea, button, '
      + '#band, #dateischirm, #malrahmen, #minileiste, #rechtsmenue';

    function bandErlaubt(ziel) {
      if (!ziel || !ziel.closest) return true;
      return !ziel.closest(BAND_NICHT);
    }
    let band = null;
    let bandkasten = null;

    document.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0 || ev.pointerType !== 'mouse') return;
      if (!malZeichnung() || !malWahl()) return;
      if (!bandErlaubt(ev.target)) return;
      const grund = document.getElementById('flaeche');
      if (!grund || !grund.contains(ev.target)) return;
      const p = stelleHier(ev);
      if (!p) return;
      band = { x: p.x, y: p.y, auf: false, dazu: ev.shiftKey || ev.ctrlKey || ev.metaKey };
    });

    document.addEventListener('pointermove', function (ev) {
      if (!band) return;
      const p = stelleHier(ev);
      if (!p) return;
      // Erst ab ein paar Bildpunkten ein Rahmen - sonst flackert bei jedem
      // Klick kurz einer auf.
      if (!band.auf && Math.abs(p.x - band.x) < 4 && Math.abs(p.y - band.y) < 4) return;
      band.auf = true;
      const grund = document.getElementById('flaeche');
      if (!bandkasten || bandkasten.parentElement !== grund) {
        bandkasten = el('div', { id: 'malband' });
        grund.append(bandkasten);
      }
      bandkasten.hidden = false;
      bandkasten.style.left = Math.min(band.x, p.x) + 'px';
      bandkasten.style.top = Math.min(band.y, p.y) + 'px';
      bandkasten.style.width = Math.abs(p.x - band.x) + 'px';
      bandkasten.style.height = Math.abs(p.y - band.y) + 'px';
    });

    // Derselbe Grund wie beim Rahmen: ohne das bleibt ein abgebrochener
    // Zeiger als angefangener Rahmen stehen und zieht beim naechsten
    // Mausweg einen auf, den niemand angefangen hat.
    document.addEventListener('pointercancel', function () {
      if (!band) return;
      band = null;
      if (bandkasten) bandkasten.hidden = true;
    });

    document.addEventListener('pointerup', function (ev) {
      if (!band) return;
      const auf = band.auf, dazu = band.dazu, start = band;
      band = null;
      if (bandkasten) bandkasten.hidden = true;
      if (!auf) return;                       // ein Klick, kein Rahmen
      const p = stelleHier(ev);
      const wahl = malWahl();
      const z = malZeichnung();
      if (!p || !wahl || !z) return;
      const kasten = { x1: Math.min(start.x, p.x), y1: Math.min(start.y, p.y),
                       x2: Math.max(start.x, p.x), y2: Math.max(start.y, p.y) };
      if (!dazu) auswahlLeeren();
      for (const st of z.striche) {
        if (wahl.includes(st)) continue;
        if (strichImKasten(st, kasten)) wahl.push(st);
      }
      // Ein Kasten gehoert dazu, wenn der Rahmen ihn beruehrt - ihn ganz
      // einschliessen zu muessen waere bei einem breiten Absatz laestig.
      for (const k of alleKaesten()) {
        if (wahlKaesten.includes(k)) continue;
        const b = kastenGrenzen(k);
        if (b.x1 <= kasten.x2 && b.x2 >= kasten.x1
            && b.y1 <= kasten.y2 && b.y2 >= kasten.y1) wahlKaesten.push(k);
      }
      kaestenZeigen();
      letzteStelle = null;
      neuMalen();
      rahmenZeichnen();
      malsagen(etwasGewaehlt() ? wasMarkiert() + ' - ziehen verschiebt, '
                                 + 'Griffe ändern die Größe, ✕ löscht.'
                               : 'Nichts in diesem Rahmen.');
    });

    /* Strg+A. Im Text kann der Browser das selbst - dort nicht hineinfunken,
       sonst markiert es statt der Zeilen das ganze Blatt. Ausserhalb gibt es
       nichts, was es taete: dann alle Striche. */
    document.addEventListener('keydown', function (ev) {
      if (!(ev.ctrlKey || ev.metaKey) || (ev.key || '').toLowerCase() !== 'a') return;
      if (ev.target && ev.target.closest
          && ev.target.closest('[contenteditable], input, textarea')) return;
      const wahl = malWahl();
      const z = malZeichnung();
      const kaesten = alleKaesten();
      if (!wahl || !z) return;
      if (!(z.striche && z.striche.length) && !kaesten.length) return;
      ev.preventDefault();
      auswahlLeeren();
      for (const st of (z.striche || [])) wahl.push(st);
      // Texte, Bilder und Tabellen sind keine Striche - ohne sie markiert
      // "alles" nur die Zeichnung und laesst den halben Zettel liegen.
      for (const k of kaesten) wahlKaesten.push(k);
      kaestenZeigen();
      letzteStelle = null;
      neuMalen();
      rahmenZeichnen();
      malsagen(wasMarkiert() + ' - ziehen verschiebt, ✕ löscht.');
    });

    // Ein Klick daneben hebt die Markierung auf - sonst bleibt der Rahmen
    // stehen und man weiss nicht, warum Entf noch etwas loescht.
    document.addEventListener('pointerdown', function (ev) {
      if (!etwasGewaehlt()) return;
      // Mit Umschalt wird dazugenommen - dann darf hier nichts geleert werden,
      // sonst zieht man einen Rahmen auf eine leere Auswahl.
      if (ev.shiftKey || ev.ctrlKey || ev.metaKey) return;
      if (ev.target && ev.target.closest && ev.target.closest('#malrahmen')) return;
      const p = stelleHier(ev);
      if (p && stricheBei(p.x, p.y).length) return;
      letzteStelle = null;
      auswahlLeeren();
      neuMalen();
      rahmenZeichnen();
    }, true);

    /* Entf. Drueben gibt es das auch, aber nur im Zeichnen-Reiter: der
       Tastenweg steigt aus, sobald die Malleiste versteckt ist - und im
       Start-Reiter ist sie das. Deshalb hier selbst, vorher und fuer beides;
       das Weiterreichen wird gestoppt, damit nichts zweimal loescht. */
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Delete' && ev.key !== 'Backspace') return;
      if (ev.target && ev.target.closest
          && ev.target.closest('.text, input, select, textarea, [contenteditable]')) return;
      if (!etwasGewaehlt()) return;
      ev.preventDefault();
      ev.stopPropagation();
      auswahlLoeschen();
    }, true);

    // Escape raeumt drueben die Striche ab - die Kaesten kennt es nicht.
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape' || !wahlKaesten.length) return;
      auswahlLeeren();
      neuMalen();
      rahmenZeichnen();
    });
  }

  function wasMarkiert() {
    const wahl = malWahl();
    const striche = wahl ? wahl.length : 0;
    const teile = [];
    if (striche) teile.push(`${striche} ${striche === 1 ? 'Strich' : 'Striche'}`);
    if (wahlKaesten.length) {
      teile.push(`${wahlKaesten.length} ${wahlKaesten.length === 1 ? 'Kasten' : 'Kästen'}`);
    }
    return (teile.join(' und ') || 'Nichts') + ' markiert';
  }

  function auswahlErweitern() {
    const wahl = malWahl();
    if (!wahl) { malsagen('Die Auswahl ist von hier aus nicht erreichbar.'); return; }
    if (!wahl.length) { malsagen('Nichts markiert - auf einen Strich doppelklicken.'); return; }
    const alle = zusammenhaengend(wahl);
    wahl.length = 0;
    for (const st of alle) wahl.push(st);
    letzteStelle = null;
    neuMalen();
    rahmenZeichnen();
    malsagen(`${wahl.length} ${wahl.length === 1 ? 'Strich' : 'Striche'} markiert.`);
  }

  function auswahlLoeschen() {
    const wahl = malWahl();
    const z = malZeichnung();
    if (!wahl || !z) { malsagen('Die Auswahl ist von hier aus nicht erreichbar.'); return; }
    if (!etwasGewaehlt()) {
      malsagen('Nichts markiert - auf einen Strich doppelklicken oder einen Rahmen aufziehen.');
      return;
    }
    const striche = wahl.length;
    const kaesten = wahlKaesten.length;
    z.striche = z.striche.filter((st) => !wahl.includes(st));
    // Kaesten nicht selbst aus dem Baum nehmen: kastenWeg raeumt auch elemente
    // auf und meldet die Aenderung - sonst ist der Text beim naechsten Laden
    // wieder da.
    for (const k of wahlKaesten.slice()) {
      try { kastenWeg(k.dataset.id); } catch (f) { k.remove(); }
    }
    auswahlLeeren();
    gemerkt();
    neuMalen();
    rahmenZeichnen();
    const teile = [];
    if (striche) teile.push(`${striche} ${striche === 1 ? 'Strich' : 'Striche'}`);
    if (kaesten) teile.push(`${kaesten} ${kaesten === 1 ? 'Kasten' : 'Kästen'}`);
    malsagen(teile.join(' und ') + ' gelöscht.');
  }

  /* Die Kaesten stehen in zwei Welten: als Zahl in elemente (das wird
     gespeichert) und als Stil am Element (das sieht man). Beides muss mit,
     sonst springt der Kasten beim naechsten Laden zurueck. */
  function kaestenSchieben(dx, dy) {
    for (const k of wahlKaesten) {
      const e = kastenDaten(k);
      if (!e) continue;
      e.x = Math.max(0, Math.round(e.x + dx));
      e.y = Math.max(0, Math.round(e.y + dy));
      k.style.left = e.x + 'px';
      k.style.top = e.y + 'px';
    }
  }

  /* Der Rahmen. Er haengt an #flaeche, weil strichGrenzen() in genau diesem
     Bezugssystem rechnet - als Kind skaliert er beim Zoomen mit. */
  function rahmenAnschalten() {
    if (rahmenUhr) return;
    rahmenUhr = setInterval(rahmenZeichnen, 150);
  }

  function rahmenBauen(grund) {
    const kasten = el('div', { id: 'malrahmen' });
    for (const ecke of GRIFFE) {
      kasten.append(el('span', { className: 'malgriff malgriff-' + ecke }));
    }
    const weg = el('button', { type: 'button', className: 'malweg', title: 'Löschen',
                               textContent: '✕' });
    weg.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    weg.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      auswahlLoeschen();
    });
    kasten.append(weg);

    // Ziehen verschiebt die markierten Striche - im Start-Reiter genauso wie
    // im Zeichnen-Reiter, weil hier nichts vom Werkzeug abhaengt.
    let zieht = null;
    let zerrt = null;
    kasten.addEventListener('pointerdown', function (ev) {
      const wahl = malWahl() || [];
      if (!etwasGewaehlt()) return;
      const p = stelleHier(ev);
      if (!p) return;
      const griff = ev.target && ev.target.classList
                    && ev.target.classList.contains('malgriff')
                    ? GRIFFE.find((g) => ev.target.classList.contains('malgriff-' + g))
                    : null;
      if (griff) {
        const g0 = wahlGrenzen();
        if (!g0) return;
        // Die Urpunkte einmal wegsichern: jede Bewegung rechnet von dort aus
        // neu. Schrittweise skalieren wuerde Rundungsfehler aufschaukeln.
        zerrt = {
          griff, g0,
          vorher: wahl.map((st) => ({ st, p: st.p.slice(), d: st.d })),
          kaesten: wahlKaesten.map((k) => {
            const e = kastenDaten(k);
            return e ? { k, e, x: e.x, y: e.y, b: e.b } : null;
          }).filter(Boolean),
        };
      } else {
        zieht = { x: p.x, y: p.y };
      }
      kasten.setPointerCapture(ev.pointerId);
      ev.stopPropagation();
    });
    kasten.addEventListener('pointermove', function (ev) {
      const p = stelleHier(ev);
      if (!p) return;
      if (zerrt) { groesseZiehen(p); return; }
      if (!zieht) return;
      const wahl = malWahl() || [];
      const dx = p.x - zieht.x, dy = p.y - zieht.y;
      zieht.x = p.x; zieht.y = p.y;
      for (const st of wahl) {
        for (let i = 0; i < st.p.length; i += 3) { st.p[i] += dx; st.p[i + 1] += dy; }
      }
      kaestenSchieben(dx, dy);
      neuMalen();
      rahmenZeichnen();
    });
    function losgelassen() {
      if (!zieht && !zerrt) return;
      zieht = null;
      zerrt = null;
      letzteStelle = null;
      gemerkt();
    }
    kasten.addEventListener('pointerup', losgelassen);
    // Bricht der Zeiger ab - der Browser nimmt den Fang weg, ein Stift wird
    // abgesetzt, ein Fenster kommt dazwischen -, kommt nie ein pointerup. Der
    // Rahmen zog danach ohne gedrueckte Taste weiter, und das Verschobene war
    // nicht gemerkt.
    kasten.addEventListener('pointercancel', losgelassen);

    function groesseZiehen(p) {
      const { x: sx, y: sy } = zerrfaktor(zerrt.griff, zerrt.g0, p);
      const dick = (sx.f + sy.f) / 2;
      for (const alt of zerrt.vorher) {
        const neu = alt.st.p;
        for (let i = 0; i < neu.length; i += 3) {
          neu[i] = sx.anker + (alt.p[i] - sx.anker) * sx.f;
          neu[i + 1] = sy.anker + (alt.p[i + 1] - sy.anker) * sy.f;
        }
        if (alt.d) alt.st.d = Math.max(1, alt.d * dick);
      }
      // Kaesten wandern mit und werden breiter - die Schriftgroesse bleibt.
      // Text mitzuskalieren klingt richtig, macht aber aus einem Absatz beim
      // kleinsten Ziehen unleserliche Krumen.
      for (const alt of zerrt.kaesten) {
        alt.e.x = Math.max(0, Math.round(sx.anker + (alt.x - sx.anker) * sx.f));
        alt.e.y = Math.max(0, Math.round(sy.anker + (alt.y - sy.anker) * sy.f));
        alt.e.b = Math.max(40, Math.round(alt.b * sx.f));
        alt.k.style.left = alt.e.x + 'px';
        alt.k.style.top = alt.e.y + 'px';
        alt.k.style.width = alt.e.b + 'px';
      }
      neuMalen();
      rahmenZeichnen();
    }
    grund.append(kasten);
    return kasten;
  }

  /* Um wie viel sich die Auswahl streckt, wenn ein Griff an die Stelle p
     gezogen wird: je Achse der feste Punkt und der Faktor dazu. Steht hier
     ausserhalb des Rahmens, damit die Rechnung ohne Browser pruefbar ist -
     ein verdrehtes Vorzeichen sieht man ihr sonst nicht an. */
  function zerrfaktor(griff, g0, p) {
    const achse = ANKER[griff] || {};
    const je = (welche, jetzt) => {
      const nameAnker = achse[welche];
      if (!nameAnker) return { anker: 0, f: 1 };
      const anker = g0[nameAnker];
      const kante = g0[nameAnker === welche + '1' ? welche + '2' : welche + '1'];
      const weite = kante - anker;
      if (Math.abs(weite) < 1) return { anker, f: 1 };
      // Nicht umklappen und nicht auf null zusammenfallen lassen - daraus
      // kaeme man ohne Rueckgaengig nicht mehr heraus.
      const f = (jetzt - anker) / weite;
      return { anker, f: Math.max(f, 6 / Math.abs(weite)) };
    };
    return { x: je('x', p.x), y: je('y', p.y) };
  }

  function wahlGrenzen() {
    const wahl = malWahl();
    const grenzenVon = malGrenzen();
    let g = null;
    const dazu = (e) => {
      g = g ? { x1: Math.min(g.x1, e.x1), y1: Math.min(g.y1, e.y1),
                x2: Math.max(g.x2, e.x2), y2: Math.max(g.y2, e.y2) }
            : { x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 };
    };
    try {
      if (wahl && grenzenVon) for (const st of wahl) dazu(grenzenVon(st));
      for (const k of wahlKaesten) dazu(kastenGrenzen(k));
    } catch (f) { return null; }
    return g;
  }

  function rahmenZeichnen() {
    const grund = document.getElementById('flaeche');
    const g = wahlGrenzen();
    if (!grund || !g) { if (rahmen) rahmen.hidden = true; return; }

    if (!rahmen || rahmen.parentElement !== grund) rahmen = rahmenBauen(grund);
    const luft = 8;
    rahmen.hidden = false;
    rahmen.style.left = (g.x1 - luft) + 'px';
    rahmen.style.top = (g.y1 - luft) + 'px';
    rahmen.style.width = (g.x2 - g.x1 + luft * 2) + 'px';
    rahmen.style.height = (g.y2 - g.y1 + luft * 2) + 'px';
  }

  function glattKnopfBauen(zeug) {
    const knopf = el('button', { type: 'button', id: 'm-glatt', textContent: '∿' });
    const zeigen = () => {
      const stufe = glattStufe();
      knopf.classList.toggle('an', stufe !== 'aus');
      knopf.dataset.stufe = stufe;
      knopf.title = ({ aus: 'Glätten aus - klicken für leicht',
                       leicht: 'Glätten leicht - klicken für stark',
                       stark: 'Glätten stark - klicken für aus' }[stufe])
                    + ' (mit Markierung: die markierten Striche glätten)';
    };
    knopf.addEventListener('click', function () {
      // Ist etwas markiert, gilt der Knopf dem Markierten: so kommt auch ein
      // schon gemalter Strich noch zu seiner Rundung. Sonst waere das Glaetten
      // nur fuer alles Kuenftige da.
      const wahl = malWahl();
      if (wahl && wahl.length) {
        const stufe = glattStufe() === 'aus' ? 'leicht' : glattStufe();
        for (const st of wahl) st.p = geglaettet(st.p, stufe);
        neuMalen();
        rahmenZeichnen();
        gemerkt();
        malsagen(`${wahl.length} ${wahl.length === 1 ? 'Strich' : 'Striche'} geglättet `
                 + `(${stufe}). Ohne Markierung stellt der Knopf die Stufe um.`);
        return;
      }
      const jetzt = GLATT_STUFEN[(GLATT_STUFEN.indexOf(glattStufe()) + 1) % GLATT_STUFEN.length];
      try { localStorage.setItem(GLATT_SCHLUESSEL, jetzt); } catch (f) { /* dann eben nur jetzt */ }
      zeigen();
      malsagen({ aus: 'Glätten aus - Striche bleiben, wie gezogen.',
                 leicht: 'Glätten leicht - Zittern raus, Form bleibt.',
                 stark: 'Glätten stark - deutlich runder, feine Ecken gehen verloren.' }[jetzt]);
    });
    zeigen();
    zeug.append(knopf);
    return knopf;
  }

  function strichMarkierenBauen() {
    markierenAnschalten();
    rahmenAnschalten();
    glaettenAnschalten();

    const zeug = document.getElementById('malzeug');
    if (!zeug || document.getElementById('m-loeschen')) return;
    const loeschen = el('button', { type: 'button', id: 'm-loeschen',
                                    title: 'Markierte Striche löschen', textContent: '🗑' });
    loeschen.addEventListener('click', auswahlLoeschen);
    const gruppe = el('button', { type: 'button', id: 'm-gruppe',
                                  title: 'Alles Zusammenhängende dazunehmen',
                                  textContent: '⛓' });
    gruppe.addEventListener('click', auswahlErweitern);
    const lasso = zeug.querySelector('.malwerkzeug[data-werkzeug="lasso"]');
    const trenner = el('span', { className: 'trenner' });
    if (lasso && lasso.nextSibling) {
      zeug.insertBefore(trenner, lasso.nextSibling);
      zeug.insertBefore(gruppe, trenner.nextSibling);
      zeug.insertBefore(loeschen, gruppe.nextSibling);
    } else {
      zeug.append(trenner, gruppe, loeschen);
    }
    glattKnopfBauen(zeug);
  }

  /* Das eigene Profil ist ein Fenster, kein Reiter.

     Als Reiter lag es neben der Benutzerverwaltung in der Datei-Ebene - zwei
     Dinge nebeneinander, die nichts miteinander zu tun haben: dort geht es um
     andere Leute, hier um einen selbst. Und wer nur sein Passwort aendern
     will, musste dafuer die ganze Datei-Ebene aufmachen. */
  function profilfenster() {
    const vorhanden = document.getElementById('profilfenster');
    if (vorhanden) return vorhanden;

    const zu = el('button', { type: 'button', id: 'profilzu', title: 'Schließen',
                              textContent: '✕' });
    const fenster = el('dialog', { id: 'profilfenster' }, [
      el('div', { id: 'profilkopfzeile' }, [el('h2', { textContent: 'Mein Profil' }), zu]),
    ]);
    zu.addEventListener('click', () => fenster.close());
    // Klick auf den dunklen Rand schliesst auch - das Fenster selbst faengt
    // seine eigenen Klicks ab.
    fenster.addEventListener('click', function (ev) {
      if (ev.target === fenster) fenster.close();
    });
    document.body.append(fenster);
    return fenster;
  }

  function profilOeffnen() {
    const fenster = profilfenster();
    if (!fenster) return;
    profilDatenLaden();
    if (typeof fenster.showModal === 'function') fenster.showModal();
    else fenster.setAttribute('open', 'open');
  }

  /* -------------------------------------------------------------- Mein Profil

     Getrennt von der Verwaltung, weil es zwei verschiedene Dinge sind: dort
     geht es um andere Leute, hier um einen selbst. Wer kein Verwalter ist,
     hatte bisher ueberhaupt keine Stelle, an der er sein eigenes Passwort
     aendern konnte. */

  function profilBearbeitenBauen() {
    const seite = profilfenster();
    if (!seite || document.getElementById('profilteil')) return;

    const wer = el('p', { className: 'zeile2' }, [
      el('span', { textContent: 'Angemeldet als' }),
      el('code', { id: 'p-ich', textContent: '…' }),
    ]);
    const rolle = el('p', { className: 'zeile2' }, [
      el('span', { textContent: 'Rolle' }),
      el('span', { id: 'p-rolle', textContent: '…' }),
    ]);
    const zwei = el('p', { className: 'zeile2' }, [
      el('span', { textContent: 'Zwei Schritte beim Anmelden' }),
      el('span', { id: 'p-zwei', textContent: '…' }),
    ]);

    const alt = el('input', { type: 'password', id: 'p-alt',
                              placeholder: 'Bisheriges Passwort' });
    const neu1 = el('input', { type: 'password', id: 'p-neu',
                               placeholder: 'Neues Passwort (mind. 8 Zeichen)' });
    const neu2 = el('input', { type: 'password', id: 'p-neu2',
                               placeholder: 'Noch einmal' });
    const hinweis = el('p', { className: 'hinweis', id: 'p-hinweis' });
    const aendern = el('button', { type: 'button', textContent: 'Passwort ändern' });
    aendern.addEventListener('click', async () => {
      if (neu1.value !== neu2.value) {
        hinweis.textContent = 'Die beiden neuen Passwörter sind nicht gleich.';
        return;
      }
      hinweis.textContent = 'wird geändert …';
      try {
        const d = await hol('/profil/passwort', { alt: alt.value, neu: neu1.value });
        hinweis.textContent = d.hinweis || 'Geändert.';
        alt.value = neu1.value = neu2.value = '';
      } catch (f) { hinweis.textContent = f.message; }
    });

    /* Die eigene Adresse. Freiwillig und mit genau einem Zweck - deshalb
       steht der Zweck auch daneben: wer nicht weiss, wofuer eine Adresse
       gebraucht wird, traegt zu Recht keine ein. */
    const email = el('input', { type: 'email', id: 'p-email',
                                placeholder: 'name@beispiel.de', autocomplete: 'email' });
    const emailHinweis = el('p', { className: 'hinweis', id: 'p-emailhinweis' });
    const emailSichern = el('button', { type: 'button', textContent: 'Adresse speichern' });
    emailSichern.addEventListener('click', async () => {
      emailHinweis.textContent = 'wird gespeichert …';
      try {
        const d = await hol('/profil/email', { email: email.value });
        emailHinweis.textContent = d.hinweis || '';
      } catch (f) { emailHinweis.textContent = f.message; }
    });

    /* Bescheid, wenn jemand an der eigenen Tuer ruettelt. Hoechstens eine
       Nachricht je Viertelstunde - sonst wird daraus Spam, und Spam klickt
       man weg, auch den echten Einbruch. */
    const melde = el('select', { id: 'p-melde' });
    for (const [wert, text] of [['fehler', 'nur bei fehlgeschlagenen Versuchen'],
                                ['alle', 'bei jeder Anmeldung'],
                                ['aus', 'gar nicht']]) {
      melde.append(el('option', { value: wert, textContent: text }));
    }
    melde.addEventListener('change', async () => {
      emailHinweis.textContent = 'wird gespeichert …';
      try {
        const d = await hol('/profil/meldung', { art: melde.value });
        emailHinweis.textContent = d.hinweis || '';
      } catch (f) { emailHinweis.textContent = f.message; }
    });

    const abmelden = el('button', { type: 'button', textContent: 'Abmelden' });
    abmelden.addEventListener('click', function () { location.href = '/abmelden'; });

    const thema = el('select', { id: 'p-thema' });
    for (const [wert, d] of Object.entries(DESIGNS)) {
      thema.append(el('option', { value: wert, textContent: d.name }));
    }
    thema.append(el('option', { value: 'eigene', textContent: 'Eigene Farben' }));

    // Neun Farbwähler. Sie erscheinen nur bei "Eigene Farben" - vorher wären
    // sie nur Beiwerk, das von der Wahl ablenkt.
    const felder = [];
    for (const [schluessel, klartext] of FARBNAMEN) {
      const feld = el('input', { type: 'color', id: 'f' + schluessel });
      feld.addEventListener('input', function () {
        eigeneFarben[schluessel] = feld.value;
        themaAnwenden('eigene');            // sofort sehen, was man tut
      });
      feld.addEventListener('change', eigeneSichern);
      felder.push(el('label', { className: 'farbwahl' },
                     [feld, el('span', { textContent: klartext })]));
    }
    const kasten = el('div', { id: 'p-eigene', hidden: true }, [
      el('p', { className: 'hinweis', textContent:
        'Die Farben starten bei dem Design, das gerade an war - von dort aus '
        + 'ändern ist einfacher, als bei neun grauen Feldern anzufangen.' }),
      el('div', { className: 'farbgitter' }, felder),
    ]);

    async function eigeneSichern() {
      try {
        await hol('/aussehen', { thema: 'eigene', farben: eigeneFarben });
      } catch (f) { document.getElementById('p-hinweis').textContent = f.message; }
    }

    thema.addEventListener('change', async () => {
      if (thema.value === 'eigene' && !Object.keys(eigeneFarben).length) {
        eigeneFarben = farbenVomAktuellen();
        farbfelderFuellen();
      }
      themaAnwenden(thema.value);          // sofort sichtbar, nicht erst nach der Antwort
      if (thema.value === 'eigene') { eigeneSichern(); return; }
      try { await hol('/aussehen', { thema: thema.value, farben: eigeneFarben }); } catch (f) {
        document.getElementById('p-hinweis').textContent = f.message;
      }
    });

    seite.append(el('section', { id: 'profilteil' }, [
      wer, rolle, zwei,
      el('h3', { textContent: 'Aussehen', style: 'margin-top:14px' }),
      el('p', { className: 'hinweis', textContent:
        'Gilt für deinen Zugang, nicht für den Server - andere behalten ihr '
        + 'eigenes Design.' }),
      el('p', { className: 'ordnerzeile' }, [thema]),
      kasten,
      el('h3', { textContent: 'E-Mail', style: 'margin-top:14px' }),
      el('p', { className: 'hinweis', id: 'p-emailzweck', textContent:
        'Nur dafür da, ein vergessenes Passwort zurückzusetzen. Ohne Adresse '
        + 'geht das nicht - dann hilft nur ein Verwalter.' }),
      el('p', { className: 'ordnerzeile' }, [email, emailSichern]),
      el('p', { className: 'zeile2' }, [
        el('span', { textContent: 'Nachricht bei Anmeldeversuchen' }), melde]),
      emailHinweis,
      el('h3', { textContent: 'Passwort ändern', style: 'margin-top:14px' }),
      el('p', { className: 'hinweis', textContent:
        'Das bisherige Passwort wird abgefragt - sonst könnte jemand an einem '
        + 'offen stehenden Rechner in zwei Klicks den Zugang übernehmen. Danach '
        + 'sind alle anderen Sitzungen abgemeldet.' }),
      el('p', { className: 'ordnerzeile' }, [alt]),
      el('p', { className: 'ordnerzeile' }, [neu1, neu2]),
      el('p', { className: 'knoepfe' }, [aendern]),
      hinweis,
      el('h3', { textContent: 'Sitzung', style: 'margin-top:14px' }),
      el('p', { className: 'knoepfe' }, [abmelden]),
    ]));
  }

  async function profilDatenLaden() {
    let d;
    try { d = await hol('/profil'); } catch (f) { return; }
    const setz = (id, wert) => {
      const k = document.getElementById(id);
      if (k) k.textContent = wert;
    };
    setz('p-ich', d.ich);
    setz('p-rolle', d.rolle);
    setz('p-zwei', d.zwei ? 'eingeschaltet' : 'aus');
    const email = document.getElementById('p-email');
    if (email) email.value = d.email || '';
    const melde = document.getElementById('p-melde');
    if (melde) melde.value = d.melde || 'fehler';
    const zweck = document.getElementById('p-emailzweck');
    // Ohne eingerichteten Mailversand waere die Adresse ein Feld, das nichts
    // tut. Dann lieber sagen, woran es liegt.
    if (zweck && !d.post_an) {
      zweck.textContent = 'Auf diesem Server ist noch kein Mailversand eingerichtet - '
        + 'bis dahin kann auch mit Adresse nichts zurückgesetzt werden. '
        + (d.darf_verwalten ? 'Einrichten lässt sich das unter Optionen.'
                            : 'Das kann nur ein Verwalter einrichten.');
    }
    themaLaden();
  }

  /* Wo die Notizen liegen, steht unter System. Vorher war das ein eigener
     Reiter "Speicher" - einer zu viel: es ist dieselbe Frage wie "was ist das
     hier fuer eine Installation", und die Seite dafuer gibt es schon. */
  function ablageBauen() {
    const seite = systemseite();
    if (!seite || document.getElementById('ablageteil')) return;

    const art = el('select', { id: 'ablage-art' });
    for (const [wert, text] of [['lokal', 'Im Docker-Volume (Standard)'],
                                ['ordner', 'Ordner auf diesem Rechner'],
                                ['smb', 'SMB-Freigabe (NAS, Windows)'],
                                ['nfs', 'NFS-Freigabe']]) {
      art.append(el('option', { value: wert, textContent: text }));
    }
    const wirt = el('input', { type: 'text', id: 'ablage-wirt', placeholder: 'nas.fritz.box' });
    const freigabe = el('input', { type: 'text', id: 'ablage-freigabe', placeholder: 'notizmappe' });
    const pfad = el('input', { type: 'text', id: 'ablage-pfad', placeholder: '/volume1/notizmappe' });
    const benutzer = el('input', { type: 'text', id: 'ablage-benutzer',
                                   placeholder: 'Benutzer auf der NAS', autocapitalize: 'none' });
    const passwort = el('input', { type: 'password', id: 'ablage-passwort',
                                   placeholder: 'Passwort' });
    const sichern = el('button', { type: 'button', textContent: 'Speichern' });
    const stand = el('p', { id: 'ablage-stand', className: 'zeile2' });
    const hinweis = el('p', { id: 'ablage-hinweis', className: 'hinweis' });

    const zeileSmb = el('p', { className: 'ordnerzeile', id: 'ablage-smb' },
                        [freigabe, benutzer, passwort]);
    // Wer eine Freigabe hat, auf der schon anderes liegt, will seine Notizen
    // in einem Unterordner und nicht mitten hinein.
    const unter = el('input', { type: 'text', id: 'ablage-unter',
                                placeholder: 'Unterordner (optional), z. B. notizmappe' });
    const zeileUnter = el('p', { className: 'ordnerzeile', id: 'ablage-unterzeile' }, [unter]);
    const zeileNfs = el('p', { className: 'ordnerzeile', id: 'ablage-nfs' }, [pfad]);

    // Eigener Weg, weil er ohne Sonderrechte auskommt: hier wird nichts
    // eingehängt, der Server schreibt beim nächsten Start einfach dorthin.
    const ordner = el('input', { type: 'text', id: 'ablage-ordner',
                                 placeholder: '/platten/notizen' });
    const ordnerPruefen = el('button', { type: 'button', textContent: 'Ordner prüfen' });
    ordnerPruefen.addEventListener('click', async () => {
      hinweis.textContent = 'wird geprüft …';
      try {
        const d = await hol('/ablage/pruefen', { pfad: ordner.value });
        hinweis.textContent = d.text;
      } catch (f) { hinweis.textContent = f.message; }
    });
    const zeileOrdner = el('p', { className: 'ordnerzeile', id: 'ablage-ordnerzeile' },
                           [ordner, ordnerPruefen]);

    function zeigen() {
      const a = art.value;
      wirt.hidden = a === 'lokal' || a === 'ordner';
      zeileSmb.hidden = a !== 'smb';
      zeileNfs.hidden = a !== 'nfs';
      zeileOrdner.hidden = a !== 'ordner';
      zeileUnter.hidden = a === 'lokal';
    }
    art.addEventListener('change', zeigen);

    sichern.addEventListener('click', async () => {
      hinweis.textContent = 'wird gespeichert …';
      try {
        const d = await hol('/ablage', {
          art: art.value, wirt: wirt.value, freigabe: freigabe.value,
          pfad: art.value === 'ordner' ? ordner.value : pfad.value,
          unterordner: unter.value,
          benutzer: benutzer.value, passwort: passwort.value,
        });
        passwort.value = '';
        hinweis.textContent = d.hinweis || '';
        standZeigen(d);
      } catch (f) { hinweis.textContent = f.message; }
    });

    const teil = el('section', { id: 'ablageteil' }, [
      el('h3', { textContent: 'Wo die Notizen liegen' }),
      stand,
      el('p', { className: 'ordnerzeile' }, [art, wirt]),
      zeileSmb, zeileNfs, zeileOrdner, zeileUnter,
      el('p', { className: 'knoepfe' }, [sichern]),
      hinweis,
      el('p', { className: 'hinweis', textContent:
        'Eingehängt wird beim Start des Containers, nicht sofort - der laufende '
        + 'Server hat die Rechte dafür abgelegt. Nach dem Speichern also '
        + 'docker compose restart notizmappe.' }),
    ]);
    seite.append(teil);
    zeigen();
    ablageLaden();
  }

  function standZeigen(d) {
    const stand = document.getElementById('ablage-stand');
    if (!stand) return;
    stand.textContent = '';
    let text;
    if (d.art === 'lokal') text = 'im Volume ' + d.ziel;
    else if (d.art === 'ordner') text = d.eingehaengt ? d.pfad
                                                      : `${d.pfad} eingestellt, noch nicht aktiv`;
    else if (d.eingehaengt) text = `${d.wirt} ist eingehängt auf ${d.ziel}`;
    else text = `${d.wirt} eingestellt, aber nicht eingehängt`;
    stand.append(el('span', { textContent: 'Gerade' }),
                 el('code', { textContent: text }));
    const h = document.getElementById('ablage-hinweis');
    if (h && d.meldung && !d.eingehaengt && d.art !== 'lokal') h.textContent = d.meldung;
  }

  async function ablageLaden() {
    let d;
    try { d = await hol('/ablage'); } catch (f) { return; }
    const art = document.getElementById('ablage-art');
    if (!art) return;
    art.value = d.art || 'lokal';
    for (const [id, wert] of [['ablage-wirt', d.wirt], ['ablage-freigabe', d.freigabe],
                              ['ablage-pfad', d.art === 'nfs' ? d.pfad : ''],
                              ['ablage-ordner', d.art === 'ordner' ? d.pfad : ''],
                              ['ablage-unter', d.unterordner],
                              ['ablage-benutzer', d.benutzer]]) {
      const k = document.getElementById(id);
      if (k && wert) k.value = wert;
    }
    art.dispatchEvent(new Event('change'));
    standZeigen(d);
  }

  function profilBauen() {
    const zahnrad = document.getElementById('zahnrad');
    const leiste = zahnrad && zahnrad.parentElement;
    if (!leiste || document.getElementById('profilknopf')) return;
    zahnrad.hidden = true;

    const kreis = el('span', { id: 'profilbild', textContent: '·' });
    const name = el('span', { id: 'profilname', textContent: 'angemeldet' });
    const knopf = el('button', { type: 'button', id: 'profilknopf',
                                 title: 'Profil und Einstellungen' }, [kreis, name]);
    const menue = el('div', { id: 'profilmenue', hidden: true });

    function punkt(text, tun) {
      const k = el('button', { type: 'button', className: 'profilpunkt', textContent: text });
      k.addEventListener('click', function () { menue.hidden = true; tun(); });
      return k;
    }

    // Nur das Eigene. Die Benutzerverwaltung steht in der Datei-Ebene unter
    // "Optionen" und nur dort - sie gehoert zum Server, nicht zum eigenen
    // Zugang, und zwei Wege zur selben Seite sind einer zu viel.
    menue.append(
      el('p', { id: 'profilkopf' }, [
        el('strong', { id: 'profilwer', textContent: '…' }),
        el('span', { id: 'profilrolle', className: 'hinweis' }),
      ]),
      punkt('Mein Profil', profilOeffnen),
      punkt('Abmelden', function () { location.href = '/abmelden'; }),
    );

    knopf.addEventListener('click', function (ev) {
      ev.stopPropagation();
      menue.hidden = !menue.hidden;
    });
    document.addEventListener('click', function (ev) {
      if (!menue.hidden && !menue.contains(ev.target)) menue.hidden = true;
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') menue.hidden = true;
    });

    leiste.append(knopf, menue);
    profilFuellen();
  }

  async function profilFuellen() {
    const wer = document.getElementById('profilwer');
    if (!wer) return;
    let d;
    try { d = await hol('/verwaltung'); } catch (f) { return; }
    if (!d.ich) return;
    meinName = d.ich;
    document.getElementById('profilname').textContent = d.ich;
    document.getElementById('profilbild').textContent = d.ich.slice(0, 1).toUpperCase();
    wer.textContent = d.ich;
    const rechte = d.meine_rechte || [];
    document.getElementById('profilrolle').textContent =
      rechte.indexOf('benutzer') >= 0 ? 'Verwalter'
        : (rechte.indexOf('schreiben') >= 0 ? 'Benutzer' : 'Gast');
  }

  /* Mailversand. Steht unter Optionen bei der Verwaltung, nicht im Profil: es
     ist eine Einstellung des Servers, keine des eigenen Zugangs. Nur Verwalter sehen
     sie - fuer alle anderen antwortet /post mit 403, und dann verschwindet
     der ganze Abschnitt wieder. */
  function postBauen() {
    if (!optionentafel() || document.getElementById('postteil')) return;

    const an = el('input', { type: 'checkbox', id: 'po-an' });
    const server = el('input', { type: 'text', id: 'po-server', placeholder: 'mail.example.de' });
    const port = el('input', { type: 'number', id: 'po-port', value: '587', min: '1', max: '65535' });
    const sicherheit = el('select', { id: 'po-sicherheit' });
    for (const [wert, text] of [['starttls', 'STARTTLS (meist Port 587)'],
                                ['ssl', 'SSL (meist Port 465)'],
                                ['keine', 'ohne Verschlüsselung']]) {
      sicherheit.append(el('option', { value: wert, textContent: text }));
    }
    const benutzer = el('input', { type: 'text', id: 'po-benutzer',
                                   placeholder: 'Anmeldename beim Mailserver',
                                   autocomplete: 'off' });
    const passwort = el('input', { type: 'password', id: 'po-passwort',
                                   placeholder: 'Passwort', autocomplete: 'new-password' });
    const absender = el('input', { type: 'email', id: 'po-absender',
                                   placeholder: 'notizmappe@example.de' });
    const stelle = el('input', { type: 'text', id: 'po-stelle',
                                 placeholder: 'https://notizen.example.de' });
    const hinweis = el('p', { className: 'hinweis', id: 'po-hinweis' });
    const sichern = el('button', { type: 'button', textContent: 'Speichern' });
    const testen = el('button', { type: 'button', textContent: 'Testnachricht an mich' });

    sichern.addEventListener('click', async () => {
      hinweis.textContent = 'wird gespeichert …';
      try {
        const d = await hol('/post', {
          an: an.checked, server: server.value, port: Number(port.value) || 0,
          sicherheit: sicherheit.value, benutzer: benutzer.value,
          passwort: passwort.value, absender: absender.value, stelle: stelle.value,
        });
        passwort.value = '';
        passwort.placeholder = d.passwort_da ? 'unverändert' : 'Passwort';
        hinweis.textContent = d.hinweis || 'Gespeichert.';
      } catch (f) { hinweis.textContent = f.message; }
    });
    testen.addEventListener('click', async () => {
      hinweis.textContent = 'wird verschickt … das kann einen Moment dauern.';
      try {
        const d = await hol('/post/probe', {});
        hinweis.textContent = d.hinweis || 'Abgeschickt.';
      } catch (f) { hinweis.textContent = f.message; }
    });

    const zeile = (text, feld) => el('p', { className: 'zeile2' },
                                     [el('span', { textContent: text }), feld]);
    optionAnhaengen(el('section', { id: 'postteil' }, [
      el('h3', { textContent: 'Mailversand' }),
      el('p', { className: 'hinweis', textContent:
        'Nur für eines da: einen Link zum Zurücksetzen des Passworts zu '
        + 'verschicken. Das Passwort des Mailkontos liegt dabei im Klartext im '
        + 'Datenordner - der Server muss sich damit anmelden können. Wer an die '
        + 'Datei kommt, hat das Mailkonto.' }),
      zeile('Einschalten', an),
      zeile('Mailserver', server),
      zeile('Port', port),
      zeile('Verschlüsselung', sicherheit),
      zeile('Anmeldename', benutzer),
      zeile('Passwort', passwort),
      zeile('Absender', absender),
      zeile('Adresse dieses Servers', stelle),
      el('p', { className: 'hinweis', textContent:
        'Die Adresse steht im Link der Mail. Sie wird hier eingetragen und '
        + 'nicht aus der Anfrage geraten - sonst könnte jemand den Server dazu '
        + 'bringen, einen Link auf seinen eigenen Rechner zu verschicken.' }),
      el('p', { className: 'knoepfe' }, [sichern, testen]),
      hinweis,
    ]));
    postLaden();
  }

  async function postLaden() {
    const teil = document.getElementById('postteil');
    if (!teil) return;
    let d;
    try { d = await hol('/post'); } catch (f) { teil.remove(); optionenReiterBauen(); return; }
    document.getElementById('po-an').checked = !!d.an;
    document.getElementById('po-server').value = d.server || '';
    document.getElementById('po-port').value = d.port || 587;
    document.getElementById('po-sicherheit').value = d.sicherheit || 'starttls';
    document.getElementById('po-benutzer').value = d.benutzer || '';
    document.getElementById('po-passwort').placeholder = d.passwort_da ? 'unverändert' : 'Passwort';
    document.getElementById('po-absender').value = d.absender || '';
    document.getElementById('po-stelle').value = d.stelle || '';
  }

  function abschnittBauen() {
    if (!optionentafel() || document.getElementById('serververwaltung')) return;

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

    const abschnitt = el('section', { id: 'serververwaltung', hidden: true }, [
      el('h3', { textContent: 'Benutzer und Rollen' }),
      el('div', { id: 'v-benutzer' }),
      el('p', { className: 'ordnerzeile' }, [neuerName, neuesPw, neueRolle]),
      el('p', { className: 'knoepfe' }, [anlegen]),
      el('h3', { textContent: 'Zwei Schritte beim Anmelden', style: 'margin-top:14px' }),
      el('div', { id: 'v-zwei' }),
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
      el('h3', { textContent: 'Was die Rollen bedeuten', style: 'margin-top:14px' }),
      el('div', { id: 'v-rollen' }),
      el('p', { className: 'hinweis', textContent:
        'Mehr Rollen gibt es bewusst nicht. Wer einspringen können soll, wird einfach '
        + 'auch Verwalter; wer in einem Projekt mehr oder weniger darf, wird dort '
        + 'eingestellt.' }),
      el('p', { className: 'hinweis', id: 'v-meldung' }),
      el('p', { className: 'hinweis', textContent:
        'Die Rechte werden am Server durchgesetzt, nicht nur in der Oberfläche. '
        + 'Ein Zugang zu entfernen löscht keine Notizen - die liegen weiter im Datenordner.' }),
    ]);
    optionAnhaengen(abschnitt);
    nachH3Teilen(abschnitt);
    // Die Meldezeile gehoert in keinen Reiter: "Zugang entfernt" soll man auch
    // dann noch lesen, wenn man weiterschaltet - im letzten Unterabschnitt
    // steckte sie sonst fest.
    const meldung = document.getElementById('v-meldung');
    if (meldung) abschnitt.append(meldung);

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
    };
    const alt = verwaltungLaden;
    verwaltungLaden = async function () {
      await alt();
      fuellen();
      // Erst jetzt steht fest, welche Abschnitte dieser Mensch sehen darf -
      // also erst jetzt stehen die Reiter fest.
      optionenReiterBauen();
    };

    // Eingesetzte Elemente bringen ihre Gestaltung selbst mit. Sonst nehmen sie
    // die Standarddarstellung des Browsers - weisse Felder und Knoepfe in einer
    // dunklen Oberflaeche, und das sieht aus wie hineingefallen.
    const stil = document.createElement('style');
    stil.textContent = `
      #serververwaltung { max-width: 760px; }

      /* Reiterleiste der Einstellungen. Sieht aus wie die Reiter oben im
         Band - derselbe Handgriff, dieselben Farbnamen. */
      #optionenreiter {
        display: flex; flex-wrap: wrap; gap: 2px; margin: 0 0 18px;
        border-bottom: 1px solid var(--linie);
      }
      #optionenreiter button {
        background: none; border: 1px solid transparent; border-bottom: none;
        color: var(--matt); padding: 7px 13px; margin-bottom: -1px;
        border-radius: 8px 8px 0 0; font: inherit; font-size: 13px; cursor: pointer;
      }
      #optionenreiter button:hover { color: var(--schrift); background: var(--flaeche); }
      #optionenreiter button[aria-selected="true"] {
        color: var(--schrift); background: var(--papier);
        border-color: var(--linie); border-bottom-color: var(--papier);
      }
      .reiterzu { display: none !important; }

      /* Profil unten in der Leiste. Alles ueber die Farbnamen der Oberflaeche -
         eigene Farben hier waeren genau der weisse Fleck, der vorher auffiel. */
      /* Ohne das haengt sich das aufgeklappte Menue an den naechsten
         positionierten Vorfahren - und das waere irgendwo weit oben. */
      .fussrechts { position: relative; }
      #profilknopf {
        display: inline-flex; align-items: center; gap: 6px;
        height: 28px; padding: 0 8px 0 3px;
        border: 1px solid var(--linie); border-radius: 14px;
        background: var(--papier); color: var(--schrift);
        cursor: pointer; font-size: 12px; max-width: 150px;
      }
      #profilknopf:hover { border-color: var(--akzent); }
      #profilbild {
        width: 22px; height: 22px; border-radius: 50%;
        background: var(--akzent); color: var(--papier);
        display: inline-flex; align-items: center; justify-content: center;
        font-size: 11px; font-weight: 700; flex: 0 0 auto;
      }
      #profilname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      /* Die Leiste sitzt ganz unten - das Menue klappt deshalb nach oben auf. */
      #profilmenue {
        position: absolute; bottom: 36px; right: 8px; z-index: 40;
        min-width: 170px; padding: 4px;
        background: var(--papier); color: var(--schrift);
        border: 1px solid var(--linie); border-radius: 8px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, .28);
      }
      #profilkopf {
        margin: 0; padding: 6px 8px 8px;
        border-bottom: 1px solid var(--linie); display: grid; gap: 1px;
      }
      #profilkopf .hinweis { font-size: 11px; }
      .profilpunkt {
        display: block; width: 100%; text-align: left;
        padding: 7px 8px; margin: 1px 0;
        background: none; border: 0; border-radius: 6px;
        color: var(--schrift); cursor: pointer; font-size: 13px;
      }
      .profilpunkt:hover { background: var(--flaeche); }

      /* Der Speicher-Reiter ist eine eigene Seite, kein #einstellungen - die
         Regeln von drueben greifen dort also nicht, und ein nacktes <select>
         nimmt die Browserfarben. Auf dunklem Grund steht dann ein weisser
         Kasten mitten in der Seite. Also dieselben Farben wie die Felder in
         den Einstellungen, ueber dieselben Namen. */
      #ablageteil .ordnerzeile { display: flex; gap: 8px; margin: 10px 0 4px; flex-wrap: wrap; }
      #ablageteil input[type="text"],
      #ablageteil input[type="password"],
      #ablageteil select {
        flex: 1; min-width: 0; padding: 4px 8px;
        border: 1px solid var(--linie); border-radius: 6px;
        background: var(--papier); color: var(--schrift);
        font: inherit; font-size: 13px;
      }
      #ablageteil select { flex: 0 0 auto; min-width: 220px; cursor: pointer; }
      /* Die Liste, die aufklappt, faerbt das Betriebssystem - ohne das steht
         sie wieder weiss da. */
      #ablageteil select option { background: var(--papier); color: var(--schrift); }
      #ablageteil input:focus, #ablageteil select:focus {
        outline: none; border-color: var(--akzent);
      }
      #ablageteil button {
        border: 1px solid var(--linie); background: var(--leiste); color: var(--schrift);
        border-radius: 6px; padding: 5px 10px; cursor: pointer; font-size: 13px;
      }
      #ablageteil button:hover { border-color: var(--akzent); }
      #ablageteil .hinweis { color: var(--matt); font-size: 12px; margin: 8px 0 0; }
      #ablageteil h3 { margin: 0 0 10px; }
      /* Das Profilfenster. Farben aus der Oberflaeche - ein <dialog> bringt
         sonst Weiss und einen hellen Rand mit. */
      #profilfenster {
        width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 64px);
        padding: 0 20px 20px; border: 1px solid var(--linie); border-radius: 12px;
        background: var(--papier); color: var(--schrift);
        box-shadow: 0 12px 48px rgba(0, 0, 0, .45);
      }
      #profilfenster::backdrop { background: rgba(0, 0, 0, .5); }
      #profilkopfzeile {
        position: sticky; top: 0; z-index: 1;
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; padding: 16px 0 10px; background: var(--papier);
        border-bottom: 1px solid var(--linie);
      }
      #profilkopfzeile h2 { margin: 0; font-size: 16px; }
      #profilzu {
        width: 28px; height: 28px; padding: 0; line-height: 1;
        border: 1px solid var(--linie); border-radius: 50%;
        background: var(--leiste); color: var(--schrift); cursor: pointer;
      }
      #profilzu:hover { border-color: var(--akzent); }
      #profilteil .ordnerzeile { display: flex; gap: 8px; margin: 10px 0 4px; flex-wrap: wrap; }
      /* Auch das E-Mail-Feld: die Regel galt nur fuer Passwortfelder, und ein
         weisses Feld in der dunklen Oberflaeche ist genau der Fleck, der hier
         schon zweimal aufgefallen ist. */
      #profilteil input[type="password"], #profilteil input[type="email"] {
        flex: 1; min-width: 0; padding: 4px 8px;
        border: 1px solid var(--linie); border-radius: 6px;
        background: var(--papier); color: var(--schrift);
        font: inherit; font-size: 13px;
      }
      #profilteil input:focus { outline: none; border-color: var(--akzent); }
      #profilteil button {
        border: 1px solid var(--linie); background: var(--leiste); color: var(--schrift);
        border-radius: 6px; padding: 5px 10px; cursor: pointer; font-size: 13px;
      }
      #profilteil button:hover { border-color: var(--akzent); }
      #profilteil .hinweis { color: var(--matt); font-size: 12px; margin: 8px 0 0; }
      #profilteil select {
        padding: 4px 8px; min-width: 220px;
        border: 1px solid var(--linie); border-radius: 6px;
        background: var(--papier); color: var(--schrift);
        font: inherit; font-size: 13px; cursor: pointer;
      }
      #profilteil select option { background: var(--papier); color: var(--schrift); }
      .farbgitter {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 8px; margin: 10px 0 0;
      }
      .farbwahl {
        display: flex; align-items: center; gap: 8px;
        padding: 5px 8px; border: 1px solid var(--linie); border-radius: 6px;
        background: var(--flaeche); font-size: 12px; cursor: pointer;
      }
      .farbwahl input[type="color"] {
        width: 30px; height: 24px; padding: 0; border: 1px solid var(--linie);
        border-radius: 4px; background: none; cursor: pointer;
      }
      /* Rahmen mit Griffen - wie man es aus Textverarbeitungen kennt.
         Ziehen am Rahmen verschiebt, Ziehen am Griff aendert die Groesse;
         drehen geht noch nicht. */
      #malrahmen {
        position: absolute; z-index: 20; cursor: move;
        border: 1px dashed var(--schrift);
        background: color-mix(in srgb, var(--akzent) 6%, transparent);
        touch-action: none; user-select: none; -webkit-user-select: none;
      }
      .malgriff {
        position: absolute; width: 9px; height: 9px;
        background: var(--papier); border: 1px solid var(--schrift);
      }
      /* Ein markierter Kasten muss auch markiert aussehen. .aktiv gibt es
         drueben schon fuers Schreiben - deshalb ein eigener Name. */
      .kasten.mitgewaehlt { outline: 1px dashed var(--akzent); outline-offset: 2px; }
      #malband {
        position: absolute; z-index: 19; pointer-events: none;
        border: 1px dashed var(--akzent);
        background: color-mix(in srgb, var(--akzent) 10%, transparent);
      }
      .malgriff-nw, .malgriff-so { cursor: nwse-resize; }
      .malgriff-no, .malgriff-sw { cursor: nesw-resize; }
      .malgriff-n, .malgriff-s { cursor: ns-resize; }
      .malgriff-w, .malgriff-o { cursor: ew-resize; }
      .malgriff-nw { left: -5px; top: -5px; }
      .malgriff-n  { left: calc(50% - 5px); top: -5px; }
      .malgriff-no { right: -5px; top: -5px; }
      .malgriff-w  { left: -5px; top: calc(50% - 5px); }
      .malgriff-o  { right: -5px; top: calc(50% - 5px); }
      .malgriff-sw { left: -5px; bottom: -5px; }
      .malgriff-s  { left: calc(50% - 5px); bottom: -5px; }
      .malgriff-so { right: -5px; bottom: -5px; }
      .malweg {
        position: absolute; right: -11px; top: -26px;
        width: 22px; height: 22px; padding: 0; line-height: 1;
        border: 1px solid var(--linie); border-radius: 50%;
        background: var(--papier); color: var(--schrift);
        cursor: pointer; font-size: 12px;
      }
      .malweg:hover { border-color: var(--warnung); color: var(--warnung); }
      #m-loeschen, #m-gruppe { font-size: 14px; }
      #m-glatt { font-size: 15px; }
      #m-glatt[data-stufe="stark"] { font-weight: 700; }
      /* In der Oberflaeche heisst die Klasse fuers Schieben .schiebt, gesetzt
         wird aber .zieht - die Hand bekommt damit nie pointer-events und tut
         gar nichts. Hier geradegerueckt, bis es drueben behoben ist. */
      #malblatt.zieht { pointer-events: auto; cursor: grab; }
      #ablage-stand code { color: var(--schrift); }
      #serververwaltung h3 {
        margin: 22px 0 8px; font-size: 13px; text-transform: uppercase;
        letter-spacing: .04em; color: var(--matt); font-weight: 600;
      }
      #serververwaltung .zeile2 {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; margin: 6px 0; padding-bottom: 6px;
        border-bottom: 1px solid var(--linie);
      }
      #serververwaltung .zeile2 span:last-child { display: flex; gap: 6px; flex: 0 0 auto; }
      #profilteil .zeile2 {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; margin: 10px 0 4px;
      }
      #postteil { max-width: 760px; }
      #postteil input[type="text"], #postteil input[type="email"],
      #postteil input[type="password"], #postteil input[type="number"],
      #postteil select {
        border: 1px solid var(--linie); border-radius: 6px; padding: 5px 8px;
        background: var(--flaeche, var(--papier)); color: var(--schrift);
        font: inherit; font-size: 13px; min-width: 220px;
      }
      #postteil option { background: var(--papier); color: var(--schrift); }
      #postteil button {
        border: 1px solid var(--linie); background: var(--leiste); color: var(--schrift);
        border-radius: 6px; padding: 5px 10px; cursor: pointer; font: inherit; font-size: 13px;
      }
      #postteil button:hover { border-color: var(--akzent); }
      #postteil .zeile2 {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; margin: 6px 0; padding-bottom: 6px;
        border-bottom: 1px solid var(--linie);
      }
      #postteil .hinweis { color: var(--matt); font-size: 12px; margin: 8px 0 0; }
      #postteil .knoepfe { display: flex; gap: 8px; margin-top: 12px; }
      #serververwaltung .hinweis {
        color: var(--matt); font-size: 12px; margin: 8px 0 0; max-width: 640px;
      }
      #serververwaltung button {
        border: 1px solid var(--linie); background: var(--leiste); color: var(--schrift);
        border-radius: 6px; padding: 5px 10px; cursor: pointer; font: inherit; font-size: 13px;
      }
      #serververwaltung button:hover { border-color: var(--akzent); }
      #serververwaltung button:disabled {
        opacity: .45; cursor: default; border-color: var(--linie);
      }
      #serververwaltung input[type="text"], #serververwaltung input[type="password"],
      #serververwaltung select {
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
      #serververwaltung .rollenwozu { color: var(--matt); font-size: 12px;
        max-width: 430px; text-align: right; }
      #serververwaltung h4 { margin: 14px 0 6px; font-size: 13px; }
      #serververwaltung .qrkasten {
        display: inline-block; background: #fff; padding: 6px; border-radius: 8px;
        border: 1px solid var(--linie); line-height: 0;
      }
      #serververwaltung .qrkasten svg { width: 190px; height: 190px; }
      #serververwaltung .geheimnis {
        display: inline-block; font-family: ui-monospace, monospace; font-size: 13px;
        letter-spacing: .08em; background: var(--flaeche, var(--papier));
        border: 1px dashed var(--linie); border-radius: 6px; padding: 6px 10px; user-select: all;
      }
      #serververwaltung .notfallcodes {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
        gap: 6px; margin: 8px 0; max-width: 560px;
      }
      #serververwaltung .notfallcodes code {
        font-family: ui-monospace, monospace; font-size: 13px; letter-spacing: .06em;
        background: var(--flaeche, var(--papier)); border: 1px solid var(--linie);
        border-radius: 6px; padding: 5px 8px; text-align: center; user-select: all;
      }
      #v-meldung { color: var(--matt); font-size: 12px; margin-top: 10px; }
      /* Der Balken sitzt ueber allem, aber unten rechts - nicht im Weg und
         nicht zu uebersehen. */
      #updatebalken {
        position: fixed; right: 16px; bottom: 16px; z-index: 60;
        display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
        max-width: min(460px, calc(100vw - 32px));
        padding: 10px 12px; border-radius: 10px;
        border: 1px solid var(--akzent); background: var(--papier);
        color: var(--schrift); font-size: 13px;
        box-shadow: 0 6px 24px rgba(0, 0, 0, .35);
      }
      #updatebalken button {
        border: 1px solid var(--linie); background: var(--leiste); color: var(--schrift);
        border-radius: 6px; padding: 5px 10px; cursor: pointer; font: inherit; font-size: 13px;
      }
      #u-jetzt { border-color: var(--akzent); }
      #u-jetzt:hover:not(:disabled) { background: var(--akzent); color: var(--papier); }
      #updatebalken button:disabled { opacity: .6; cursor: default; }
      #u-text { flex: 1 1 200px; }`;
    document.head.append(stil);
  }

  /* ---- Updates -----------------------------------------------------------

     Nach dem Neustart ist der Server ein paar Sekunden weg.

     Hier auf "antwortet wieder" zu warten, waere falsch - und zwar auf eine
     Art, die wie ein fehlgeschlagenes Update aussieht: der alte Prozess lebt
     noch gut eine Sekunde weiter und antwortet brav. Die Seite laedt dann neu,
     waehrend noch die alte Fassung laeuft, und man sieht unveraendert die alte
     Nummer. Deshalb wird auf die FASSUNG gewartet, nicht auf ein Lebenszeichen. */
  function updateWarten(fassung, melden) {
    let versuche = 0;
    melden(`Fassung ${fassung} liegt bereit, der Server startet neu …`);
    const uhr = setInterval(async () => {
      versuche += 1;
      try {
        const antwort = await fetch('/fassung', { cache: 'no-store' });
        if (antwort.ok) {
          const d = await antwort.json();
          if (d.laeuft === fassung) { clearInterval(uhr); location.reload(); return; }
        }
      } catch (f) { /* noch unterwegs, das ist der Normalfall */ }
      if (versuche > 40) {
        clearInterval(uhr);
        melden('Der Server ist nicht mit der neuen Fassung zurückgekommen. '
               + 'Er läuft weiter mit der alten - nachsehen lohnt sich im Protokoll '
               + 'des Containers.');
      }
    }, 1500);
  }

  async function updateStarten(melden) {
    melden('wird geholt und geprüft … das dauert einen Moment.');
    const d = await hol('/aktualisieren', {});
    if (d.getan) { updateWarten(d.fassung, melden); return true; }
    melden(d.hinweis || 'Es gab nichts zu holen.');
    return false;
  }

  /* Von allein sagen, dass es etwas Neues gibt. Vorher stand die Auskunft nur
     in den Einstellungen unter "Nach Updates sehen" - wer nicht nachsieht,
     erfaehrt nichts und bleibt auf einer alten Fassung sitzen.

     Der Balken sagt nicht nur Bescheid, er bringt den Knopf gleich mit: eine
     Meldung, die ein Problem nur beschreibt, nimmt einem die Arbeit nicht ab. */
  const UPDATE_WEG = 'notizmappe.updateweg';

  function updateBalken(f) {
    const schon = document.getElementById('updatebalken');
    if (schon) schon.remove();
    const melden = (t) => { const z = document.getElementById('u-text'); if (z) z.textContent = t; };
    const text = el('span', { id: 'u-text',
                              textContent: `Fassung ${f.neueste} ist da - hier läuft ${f.laeuft}.` });
    const jetzt = el('button', { type: 'button', id: 'u-jetzt', textContent: 'Jetzt aktualisieren' });
    const weg = el('button', { type: 'button', id: 'u-spaeter', title: 'Für diese Fassung nicht mehr fragen',
                               textContent: 'Später' });
    const balken = el('div', { id: 'updatebalken' }, [text, jetzt, weg]);
    jetzt.addEventListener('click', async () => {
      jetzt.disabled = weg.disabled = true;
      try { if (!await updateStarten(melden)) jetzt.disabled = false; }
      catch (fehler) { melden(fehler.message); jetzt.disabled = false; }
      weg.disabled = false;
    });
    weg.addEventListener('click', () => {
      try { localStorage.setItem(UPDATE_WEG, f.neueste); } catch (e2) { /* dann eben nur jetzt */ }
      balken.remove();
    });
    document.body.append(balken);
  }

  function updateHinweisBauen() {
    const nachsehen = async () => {
      try {
        // Ohne frisch=1: der Server haelt die Antwort vier Minuten. So landet
        // nicht jede Nachfrage bei GitHub, und trotzdem ist sie nie aelter
        // als der Takt hier.
        const f = await hol('/fassung');
        if (!f || !f.neuer) return;
        let weg = null;
        try { weg = localStorage.getItem(UPDATE_WEG); } catch (e2) { /* egal */ }
        if (weg === f.neueste) return;
        updateBalken(f);
      } catch (fehler) { /* nicht angemeldet oder kein Netz - dann eben nicht */ }
    };
    // Nicht sofort: erst soll die Oberflaeche stehen.
    setTimeout(nachsehen, 4000);
    /* Und dann alle fuenf Minuten. Sechs Stunden waren zu selten: wer die
       Seite einmal geladen hat und offen laesst, erfaehrt einen halben Tag
       lang nichts - und wer sie direkt nach einem Update laedt, bekommt die
       Antwort "das ist die neueste" und sieht danach nie wieder nach.
       Der Server haelt die Antwort vier Minuten, es landet also hoechstens
       jede fuenfte Minute eine Anfrage bei GitHub. */
    setInterval(nachsehen, 5 * 60 * 1000);
  }

  /* ------------------------------------------------------- Die Formatleiste

     Zwei Reihen, so wie in OneNote: Schriftart, Groesse, Formatvorlage,
     Einzug, Aufgabe und Kategorie oben; F K U, Marker, Farbe, Listen, Format
     uebertragen und Loeschen unten.

     Gebaut wird sie einmal und zweimal benutzt: in der schwebenden Leiste,
     die beim Markieren aufgeht, und unten im Rechtsklick-Menue. Zwei
     Leisten, die dasselbe tun sollen, sind eine zu viel - eine davon ist
     eines Tages anders.

     Gerechnet wird wieder nichts selbst: aufAuswahl() drueben setzt das
     Format, hervorheben() den Marker. Was hier steht, ist die Bedienung.

     Drei Sachen gehen bewusst anders als bei OneNote, weil die Ablage nur
     bestimmte Auszeichnungen annimmt (kein freies CSS, siehe reinigen.py):
     der Marker hat eine Farbe statt fuenf, die Groessen sind die sieben, die
     <font size> kennt, und ein Haken ist ein Zeichen im Text - keine
     Kontrollkaestchen-Auszeichnung, die beim Speichern wieder herausfiele. */

  const FL_VORLAGEN = [['<p>', 'Normal'], ['<h1>', 'Überschrift 1'],
                       ['<h2>', 'Überschrift 2'], ['<h3>', 'Überschrift 3'],
                       ['<blockquote>', 'Zitat'], ['<pre>', 'Code']];
  // Diese Zeichen landen im Text, nicht nur in der Leiste - also solche, die
  // jede Schrift hat. Ein Kaestchen mitten im Satz waere schlimmer als kein
  // Zeichen.
  const FL_KATEGORIEN = [['☐', 'Aufgabe'], ['★', 'Wichtig'], ['⚑', 'Fahne'],
                         ['✔', 'Erledigt'], ['✘', 'Verworfen']];
  const FL_GROESSEN = [['1', '8'], ['2', '10'], ['3', '12'], ['4', '14'],
                       ['5', '18'], ['6', '24'], ['7', '36']];
  /* Die Nummerierungsbibliothek. Welche Zaehlung und was davor und dahinter
     steht, sagt der Wert selbst: '1)' sind Ziffern mit Klammer, '(a)' kleine
     Buchstaben in Klammern. Daraus wird beides gebaut - die Vorschau im Menue
     und die Regel im Stylesheet. Dieselbe Liste steht in web/listen.py; was
     dort nicht drinsteht, faellt beim Speichern heraus. */
  const FL_NUMMERN = ['1.', '1)', 'a)', 'A.',
                      '1.)', 'I.', 'A)', '(1)', '(a)',
                      'a.', '1-', '1', 'A', 'a',
                      'i.', 'i)'];
  const FL_ZAEHLER = { '1': 'decimal', a: 'lower-alpha', A: 'upper-alpha',
                       i: 'lower-roman', I: 'upper-roman' };
  const FL_ZIFFERN = { '1': ['1', '2', '3'], a: ['a', 'b', 'c'], A: ['A', 'B', 'C'],
                       i: ['i', 'ii', 'iii'], I: ['I', 'II', 'III'] };

  /* Dasselbe fuer die Aufzaehlung: das Zeichen ist der Wert. Nur Zeichen aus
     der Grundebene - ein Emoji faellt in Schriften aus, die es nicht haben,
     und dann steht ein Kaestchen in der Liste. */
  const FL_ZEICHEN = ['●', '○', '•', '◦', '◉',
                      '✦', '◆', '◇', '❖', '⋄',
                      '■', '□', '▪', '▫', '◼',
                      '▶', '▸', '‣', '→', '⇒',
                      '›', '➢', '✱', '✸', '❉',
                      '–', '—', '✓', '✗', '★',
                      '☺', '☎', '✉', '♦', '♥'];

  function nrTeile(art) {
    const i = String(art).search(/[1aAiI]/);
    if (i < 0) return null;
    return { typ: art.charAt(i), vorne: art.slice(0, i), hinten: art.slice(i + 1) };
  }

  function nrProbe(art) {
    const t = nrTeile(art);
    if (!t) return [];
    return FL_ZIFFERN[t.typ].map(function (z) { return t.vorne + z + t.hinten; });
  }

  function listenRegeln() {
    let text = '';
    FL_NUMMERN.forEach(function (art, i) {
      const t = nrTeile(art);
      text += `@counter-style nz${i} { system: extends ${FL_ZAEHLER[t.typ]};`
            + ` prefix: "${t.vorne}"; suffix: "${t.hinten} "; }\n`
            + `ol[data-art="${art}"] { list-style-type: nz${i}; }\n`;
    });
    FL_ZEICHEN.forEach(function (z, i) {
      // cyclic mit einem einzigen Zeichen: das steht dann vor jeder Zeile.
      text += `@counter-style az${i} { system: cyclic; symbols: "${z}";`
            + ` suffix: " "; }\n`
            + `ul[data-art="${z}"] { list-style-type: az${i}; }\n`;
    });
    return text;
  }

  // Die Liste, in der die Markierung steht - oder nichts.
  function listeUm(tag) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    let k = sel.getRangeAt(0).startContainer;
    if (k && k.nodeType !== 1) k = k.parentElement;
    return k && k.closest ? k.closest(tag) : null;
  }

  /* Eine Art setzen heisst: notfalls erst eine Liste daraus machen. Ohne das
     waere die halbe Bibliothek wirkungslos, solange der Absatz noch keine
     Liste ist - und genau so greift man danach hinein. */
  function artSetzen(tag, befehl, wert) {
    const liste = listeUm(tag);
    if (!wert) {                      // "Keine": die Liste wieder weg
      if (liste) flBefehl(befehl);
      return;
    }
    if (!liste) flBefehl(befehl);
    const neue = listeUm(tag);
    if (!neue) return;
    neue.setAttribute('data-art', wert);
    gemerkt();
  }

  function flNummerSetzen(art) { artSetzen('ol', 'insertOrderedList', art); }
  function flPunktSetzen(zeichen) { artSetzen('ul', 'insertUnorderedList', zeichen); }

  let flPinsel = null;            // gemerktes Format beim Uebertragen

  /* Symbole als Strich, nicht als Zeichen. Pfeile, Schild und Pinsel gibt es
     nicht in jeder Schrift - fehlen sie, zeigt der Browser ein Kaestchen, und
     eine Leiste voller Kaestchen sagt niemandem etwas. Gezeichnet ist immer
     da, und es nimmt die Farbe der Schrift mit. */
  function flBild(inhalt) {
    return '<svg class="fl-bild" viewBox="0 0 16 16" width="15" height="15" '
         + 'fill="none" stroke="currentColor" stroke-width="1.4" '
         + 'stroke-linecap="round" stroke-linejoin="round">' + inhalt + '</svg>';
  }
  const FL_EINZUG_RAUS = flBild('<path d="M2 3h12M6 6h8M6 10h8M2 13h12"/>'
                                + '<path d="M4.5 6.5 2 8l2.5 1.5"/>');
  const FL_EINZUG_REIN = flBild('<path d="M2 3h12M6 6h8M6 10h8M2 13h12"/>'
                                + '<path d="M1.5 6.5 4 8l-2.5 1.5"/>');
  // Die beiden Listenknoepfe zeigen eine Liste, nicht nur ihr Zeichen: ein
  // einzelner Punkt neben einer "1." sagt nicht, dass es um Absaetze geht.
  const FL_ZEILEN = '<path d="M6 3.5h8M6 8h8M6 12.5h8"/>';
  const FL_PUNKTLISTE = flBild(FL_ZEILEN
      + '<circle cx="2.6" cy="3.5" r="1.2" fill="currentColor" stroke="none"/>'
      + '<circle cx="2.6" cy="8" r="1.2" fill="currentColor" stroke="none"/>'
      + '<circle cx="2.6" cy="12.5" r="1.2" fill="currentColor" stroke="none"/>');
  const FL_NUMMERNLISTE = flBild(FL_ZEILEN
      + '<text x="0" y="5.4" font-size="5.6" fill="currentColor" stroke="none">1</text>'
      + '<text x="0" y="9.9" font-size="5.6" fill="currentColor" stroke="none">2</text>'
      + '<text x="0" y="14.4" font-size="5.6" fill="currentColor" stroke="none">3</text>');
  const FL_SCHILD = flBild('<path d="M8.5 1.5H14v5.5L7 14 2 9z"/>'
                           + '<circle cx="11.2" cy="4.6" r=".9"/>');
  const FL_PINSEL = flBild('<path d="M11 2.5 13.5 5 7 11.5 4.5 9z"/>'
                           + '<path d="M4.5 9 3 12.5 6.5 11"/>');

  function flBefehl(was, wert) {
    try {
      if (typeof aufAuswahl === 'function') aufAuswahl(was, wert);
    } catch (f) { console.error('[notizmappe] Format:', f); }
  }

  function flTaste(inhalt, titel, tun, stand) {
    const k = el('button', { type: 'button', className: 'fl-taste', title: titel });
    k.innerHTML = inhalt;
    if (stand) k.dataset.stand = stand;
    k.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      tun(k);
    });
    return k;
  }

  /* Ein kleines Klappmenue - im Kasten der Leiste, nicht am Koerper: alles
     ausserhalb schliesst drueben die schwebende Leiste und das Rechtsklick-
     Menue, und dann waere die Liste weg, bevor man sie anklicken kann. */
  function flKlappe(wirt, titel, inhalt, eintraege, tun) {
    const knopf = flTaste(inhalt + '<span class="fl-pfeil">▾</span>', titel, function (k) {
      const alte = wirt.querySelector('.fl-liste');
      if (alte) {
        alte.remove();
        if (alte.dataset.von === titel) return;      // derselbe Knopf: zu
      }
      const liste = el('div', { className: 'fl-liste' });
      liste.dataset.von = titel;
      for (const [wert, name, zeichen] of eintraege) {
        const z = el('button', { type: 'button', className: 'fl-eintrag' }, [
          el('span', { className: 'fl-probe', textContent: zeichen || '' }),
          el('span', { textContent: name }),
        ]);
        if (zeichen && zeichen.charAt(0) === '#') {
          z.firstChild.style.background = zeichen;
          z.firstChild.textContent = '';
          z.firstChild.classList.add('fl-tupfer');
        }
        z.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          liste.remove();
          tun(wert);
        });
        liste.append(z);
      }
      const r = k.getBoundingClientRect();
      const w = wirt.getBoundingClientRect();
      liste.style.left = Math.max(0, r.left - w.left) + 'px';
      liste.style.top = (r.bottom - w.top + 2) + 'px';
      wirt.append(liste);
    });
    knopf.classList.add('fl-mitpfeil');
    return knopf;
  }

  /* Haken und Kategorien sind Zeichen am Zeilenanfang. Eine eigene
     Auszeichnung (etwa ein input type=checkbox) faellt beim Speichern wieder
     heraus - die Ablage nimmt nur die Auszeichnungen an, die der Editor
     selbst setzt. Ein Zeichen ueberlebt jeden Weg, auch den nach drueben. */
  function flZeichenSetzen(zeichen) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    const feld = (r.startContainer.nodeType === 1 ? r.startContainer
                                                  : r.startContainer.parentElement);
    if (!feld || !feld.closest('[contenteditable]')) return;
    const anfang = r.cloneRange();
    anfang.collapse(true);
    sel.removeAllRanges();
    sel.addRange(anfang);
    try {
      document.execCommand('insertText', false, zeichen + ' ');
    } catch (f) { /* dann eben nicht */ }
  }

  /* Ein Klick auf einen Haken im Text setzt ihn um. Das ist der Teil, der aus
     dem Zeichen eine Aufgabe macht. */
  function flHakenAnschalten() {
    const grund = document.getElementById('flaeche');
    if (!grund || grund.dataset.haken === 'ja') return;
    grund.dataset.haken = 'ja';
    grund.addEventListener('click', function (ev) {
      const feld = ev.target.closest && ev.target.closest('.text');
      if (!feld) return;
      const stelle = document.caretRangeFromPoint
        ? document.caretRangeFromPoint(ev.clientX, ev.clientY) : null;
      if (!stelle || stelle.startContainer.nodeType !== 3) return;
      const text = stelle.startContainer.nodeValue || '';
      const i = stelle.startOffset;
      for (const [auf, zu] of [['☐', '☑'], ['☑', '☐']]) {
        for (const stern of [i - 1, i]) {
          if (text.charAt(stern) !== auf) continue;
          stelle.startContainer.nodeValue =
            text.slice(0, stern) + zu + text.slice(stern + 1);
          const e = kastenDaten(feld.closest('.kasten'));
          if (e) e.html = feld.innerHTML;
          gemerkt();
          return;
        }
      }
    });
  }

  /* Format uebertragen: einmal klicken merkt, was an der Stelle gilt; die
     naechste Markierung bekommt es. Mehr macht der Pinsel in OneNote auch
     nicht. */
  function flPinselNehmen(knopf) {
    if (flPinsel) { flPinsel = null; flPinselZeigen(); return; }
    const lies = (was) => {
      try { return document.queryCommandState(was); } catch (f) { return false; }
    };
    const wert = (was) => {
      try { return String(document.queryCommandValue(was) || ''); } catch (f) { return ''; }
    };
    flPinsel = {
      bold: lies('bold'), italic: lies('italic'), underline: lies('underline'),
      strikeThrough: lies('strikeThrough'),
      fontName: wert('fontName').replace(/^['"]|['"]$/g, ''),
      fontSize: wert('fontSize'), foreColor: wert('foreColor'),
    };
    flPinselZeigen();
  }

  function flPinselZeigen() {
    for (const k of document.querySelectorAll('.fl-taste[data-stand="pinsel"]')) {
      k.classList.toggle('an', !!flPinsel);
    }
  }

  function flPinselAnschalten() {
    document.addEventListener('mouseup', function () {
      if (!flPinsel) return;
      setTimeout(function () {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.anchorNode) return;
        const knoten = sel.anchorNode.nodeType === 1 ? sel.anchorNode
                                                     : sel.anchorNode.parentElement;
        if (!knoten || !knoten.closest('[contenteditable]')) return;
        const p = flPinsel;
        flPinsel = null;
        flPinselZeigen();
        flBefehl('removeFormat');
        for (const was of ['bold', 'italic', 'underline', 'strikeThrough']) {
          if (p[was]) flBefehl(was);
        }
        if (p.fontName) flBefehl('fontName', p.fontName);
        if (p.fontSize) flBefehl('fontSize', p.fontSize);
        if (p.foreColor) flBefehl('foreColor', p.foreColor);
      }, 0);
    });
  }

  function flFarben() {
    const aus = [];
    for (const k of document.querySelectorAll('#farben button[data-farbe]')) {
      aus.push([k.dataset.farbe, k.title || k.dataset.farbe, k.dataset.farbe]);
    }
    return aus;
  }

  // Drei Zeilen Vorschau - so steht es spaeter da.
  function nrKachel(art) {
    return nrProbe(art).map(function (z) {
      return el('span', { className: 'fl-kzeile' }, [
        el('span', { className: 'fl-knr', textContent: z }),
        el('span', { className: 'fl-kstrich' }),
      ]);
    });
  }

  function azKachel(zeichen) {
    return [el('span', { className: 'fl-kzeichen', textContent: zeichen })];
  }

  /* Dieselbe Mechanik wie das Klappmenue, nur als Gitter mit Vorschau: ein
     paar Zeilen "1. 2. 3." sagen mehr als ihr Name. */
  function flGalerie(wirt, titel, inhalt, arten, tun, bauen) {
    const knopf = flTaste(inhalt + '<span class="fl-pfeil">▾</span>', titel, function (k) {
      const alte = wirt.querySelector('.fl-liste');
      if (alte) {
        alte.remove();
        if (alte.dataset.von === titel) return;      // derselbe Knopf: zu
      }
      const kasten = el('div', { className: 'fl-liste fl-galerie' });
      kasten.dataset.von = titel;
      kasten.append(el('p', { className: 'fl-galkopf', textContent: titel }));
      const gitter = el('div', { className: 'fl-gitter' });
      for (const art of [''].concat(arten)) {
        const kachel = el('button', { type: 'button', className: 'fl-kachel' },
          art ? bauen(art) : [el('span', { className: 'fl-keine', textContent: 'Keine' })]);
        kachel.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          kasten.remove();
          tun(art);
        });
        gitter.append(kachel);
      }
      kasten.append(gitter);
      wirt.append(kasten);
      // Das Gitter ist breiter als die Leiste. Es darf ueber ihren Rand
      // hinausragen, nur nicht aus dem Fenster.
      const k2 = k.getBoundingClientRect();
      const w = wirt.getBoundingClientRect();
      const b = kasten.getBoundingClientRect();
      const links = Math.max(8, Math.min(k2.left, window.innerWidth - b.width - 8));
      const oben = Math.max(8, Math.min(k2.bottom + 2, window.innerHeight - b.height - 8));
      kasten.style.left = (links - w.left) + 'px';
      kasten.style.top = (oben - w.top) + 'px';
    });
    knopf.classList.add('fl-mitpfeil');
    return knopf;
  }

  /* Knopf und Pfeil gehoeren zusammen: links die Liste an- und ausschalten,
     rechts die Bibliothek. Getrennt standen vier Knoepfe nebeneinander, und
     keiner sagte, dass je zwei dasselbe meinen. */
  function flGeteilt(knopf, pfeil) {
    pfeil.classList.add('fl-nurpfeil');
    return el('span', { className: 'fl-geteilt' }, [knopf, pfeil]);
  }

  function formatleisteBauen() {
    const wirt = el('div', { className: 'formatleiste' });

    const art = el('select', { className: 'fl-art', title: 'Schriftart' });
    art.addEventListener('change', function () { flBefehl('fontName', art.value); });
    const groesse = el('select', { className: 'fl-groesse', title: 'Schriftgröße' });
    for (const [wert, text] of FL_GROESSEN) {
      // 12 ist die Groesse, in der geschrieben wird - ohne das stand hier 8,
      // die erste der Liste.
      groesse.append(el('option', { value: wert, textContent: text,
                                    selected: wert === '3' }));
    }
    groesse.addEventListener('change', function () { flBefehl('fontSize', groesse.value); });

    const reihe1 = el('div', { className: 'fl-reihe' }, [
      art, groesse,
      el('span', { className: 'fl-trenner' }),
      flKlappe(wirt, 'Formatvorlage', '<span class="fl-sinn">¶</span>',
               FL_VORLAGEN.map(([w, n]) => [w, n, '']),
               function (w) { flBefehl('formatBlock', w); }),
      flTaste(FL_EINZUG_RAUS, 'Einzug verkleinern',
              function () { flBefehl('outdent'); }),
      flTaste(FL_EINZUG_REIN, 'Einzug vergrößern',
              function () { flBefehl('indent'); }),
      el('span', { className: 'fl-trenner' }),
      flTaste('<span class="fl-haken">☑</span>', 'Aufgabe (zum Abhaken)',
              function () { flZeichenSetzen('☐'); }),
      flKlappe(wirt, 'Kategorie', FL_SCHILD,
               FL_KATEGORIEN.map(([z, n]) => [z, n, z]),
               function (z) { flZeichenSetzen(z); }),
    ]);

    const reihe2 = el('div', { className: 'fl-reihe' }, [
      flTaste('<b>F</b>', 'Fett (Strg+B)', function () { flBefehl('bold'); }, 'bold'),
      flTaste('<i>K</i>', 'Kursiv (Strg+I)', function () { flBefehl('italic'); }, 'italic'),
      flTaste('<u>U</u>', 'Unterstrichen (Strg+U)',
              function () { flBefehl('underline'); }, 'underline'),
      flTaste('<s>S</s>', 'Durchgestrichen',
              function () { flBefehl('strikeThrough'); }, 'strikeThrough'),
      el('span', { className: 'fl-trenner' }),
      flTaste('<span class="fl-marker">A</span>', 'Hervorheben', function () {
        try { if (typeof hervorheben === 'function') hervorheben(); } catch (f) { /* egal */ }
      }),
      flKlappe(wirt, 'Schriftfarbe', '<span class="fl-buchstabe">A</span>',
               flFarben(), function (farbe) { flBefehl('foreColor', farbe); }),
      el('span', { className: 'fl-trenner' }),
      flGeteilt(
        flTaste(FL_PUNKTLISTE, 'Aufzählung',
                function () { flBefehl('insertUnorderedList'); }, 'insertUnorderedList'),
        flGalerie(wirt, 'Aufzählungszeichenbibliothek', '',
                  FL_ZEICHEN, flPunktSetzen, azKachel)),
      flGeteilt(
        flTaste(FL_NUMMERNLISTE, 'Nummerierung',
                function () { flBefehl('insertOrderedList'); }, 'insertOrderedList'),
        flGalerie(wirt, 'Nummerierungsbibliothek', '',
                  FL_NUMMERN, flNummerSetzen, nrKachel)),
      el('span', { className: 'fl-trenner' }),
      flTaste(FL_PINSEL, 'Format übertragen',
              flPinselNehmen, 'pinsel'),
      flTaste('<span class="fl-weg">✕</span>', 'Formatierung entfernen', function () {
        flBefehl('removeFormat');
        try { if (typeof hervorhebungWeg === 'function') hervorhebungWeg(); } catch (f) { /* egal */ }
      }),
    ]);

    wirt.append(reihe1, reihe2);
    flSchriftenSpiegeln(wirt);      // gleich, nicht erst beim ersten Auffrischen
    // Ein Klick in die Leiste darf die Markierung nicht kosten - sonst
    // formatiert der Knopf nichts. Auswahlfelder brauchen den Fokus, sonst
    // klappen sie nicht auf.
    wirt.addEventListener('mousedown', function (ev) {
      if (ev.target.tagName !== 'SELECT') ev.preventDefault();
    });
    return wirt;
  }

  /* Was an der Markierung schon gilt, anzeigen - und die Schriftliste
     nachziehen, die der Server erst nachlaedt. */
  /* Die Schriftliste steht drueben und wird vom Server nachgeladen - sie ist
     also erst spaeter vollstaendig. Deshalb jedes Mal nachsehen, ob sie
     gewachsen ist. */
  function flSchriftenSpiegeln(wirt) {
    const art = wirt && wirt.querySelector('.fl-art');
    const echt = document.querySelector('#minialt select[data-befehl="fontName"]')
              || document.querySelector('#minileiste select[data-befehl="fontName"]')
              || document.getElementById('schriftart');
    if (!art || !echt || !echt.options.length
        || art.options.length === echt.options.length) return;
    const stand = art.value;
    art.textContent = '';
    // Mit den Gruppen: die Favoriten stehen drueben in einer eigenen, und
    // ohne sie waeren sie irgendwo in der Liste - gerade die, die man sucht.
    for (const kind of echt.children) {
      if (kind.tagName === 'OPTGROUP') {
        const g = el('optgroup', { label: kind.label });
        for (const o of kind.children) {
          g.append(el('option', { value: o.value, textContent: o.textContent }));
        }
        art.append(g);
      } else {
        art.append(el('option', { value: kind.value, textContent: kind.textContent }));
      }
    }
    if (stand) art.value = stand;
  }

  function formatleisteFrischen(wirt) {
    if (!wirt) return;
    flSchriftenSpiegeln(wirt);
    const klappe = wirt.querySelector('.fl-liste');
    if (klappe) klappe.remove();
    for (const [waehler, befehl] of [['.fl-art', 'fontName'], ['.fl-groesse', 'fontSize']]) {
      const feld = wirt.querySelector(waehler);
      if (!feld) continue;
      try {
        const wert = String(document.queryCommandValue(befehl) || '')
          .replace(/^['"]|['"]$/g, '');
        const treffer = Array.from(feld.options).find(function (o) {
          return o.value === wert || o.value.toLowerCase() === wert.toLowerCase();
        });
        if (treffer) feld.value = treffer.value;
      } catch (f) { /* nicht jede Webansicht kann das */ }
    }
    for (const k of wirt.querySelectorAll('.fl-taste[data-stand]')) {
      const befehl = k.dataset.stand;
      if (befehl === 'pinsel') { k.classList.toggle('an', !!flPinsel); continue; }
      let an = false;
      try { an = document.queryCommandState(befehl); } catch (f) { /* egal */ }
      k.classList.toggle('an', !!an);
    }
  }

  /* Die schwebende Leiste drueben bekommt denselben Inhalt. Ihre eigenen
     Knoepfe bleiben stehen, nur versteckt: an ihnen haengen drueben die
     Schriftliste und die Farben, und von dort werden sie hier gespiegelt. */
  function minileisteUmbauen() {
    const leiste = document.getElementById('minileiste');
    if (!leiste || leiste.querySelector('.formatleiste')) return;
    const alt = el('div', { id: 'minialt', hidden: true });
    while (leiste.firstChild) alt.append(leiste.firstChild);
    const neu = formatleisteBauen();
    leiste.append(alt, neu);
    document.addEventListener('selectionchange', function () {
      if (!leiste.hidden) formatleisteFrischen(neu);
    });
    // Beim Ziehen mit der Maus geht die Leiste erst beim Loslassen auf - und
    // dabei kommt kein selectionchange mehr. Deshalb am Zustand der Leiste
    // selbst haengen: wird sie sichtbar, wird sie auch aufgefrischt.
    if (window.MutationObserver) {
      new MutationObserver(function () {
        if (!leiste.hidden) formatleisteFrischen(neu);
      }).observe(leiste, { attributes: true, attributeFilter: ['hidden'] });
    }
  }

  function formatleistenBauen() {
    minileisteUmbauen();
    flHakenAnschalten();
    flPinselAnschalten();
    const stil = document.createElement('style');
    stil.textContent = `
      .formatleiste { position: relative; padding: 4px 5px; }
      .formatleiste .fl-reihe {
        display: flex; align-items: center; gap: 1px;
      }
      .formatleiste .fl-reihe + .fl-reihe { margin-top: 3px; }
      .formatleiste select {
        height: 24px; border: 1px solid var(--linie); border-radius: 3px;
        background: var(--papier); color: var(--schrift); font-size: 12px;
      }
      .formatleiste .fl-art { flex: 1; min-width: 86px; max-width: 150px; }
      .formatleiste .fl-groesse { width: 56px; margin-left: 2px; }
      .fl-taste {
        min-width: 26px; height: 24px; padding: 0 4px; border: 1px solid transparent;
        border-radius: 3px; background: none; color: var(--schrift);
        font: inherit; font-size: 12px; line-height: 1; cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center; gap: 1px;
      }
      .fl-taste:hover { background: var(--flaeche); border-color: var(--linie); }
      .fl-taste.an { background: color-mix(in srgb, var(--akzent) 25%, transparent); }
      .fl-pfeil { font-size: 9px; opacity: .7; }
      .fl-sinn { font-size: 13px; }
      .fl-bild { display: block; }
      .fl-haken { color: var(--akzent); font-size: 13px; }
      .fl-weg { opacity: .6; }
      .fl-marker { background: #ffe680; color: #1f1d1a; padding: 0 3px; border-radius: 2px; }
      .fl-buchstabe { border-bottom: 3px solid var(--warnung); line-height: 1.1; }
      .formatleiste .fl-trenner {
        width: 1px; height: 16px; background: var(--linie); margin: 0 3px;
      }
      .fl-liste {
        position: absolute; z-index: 60; min-width: 150px; padding: 4px;
        background: var(--leiste); border: 1px solid var(--linie);
        border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.35);
      }
      .fl-eintrag {
        display: flex; align-items: center; gap: 8px; width: 100%;
        padding: 5px 8px; border: 0; border-radius: 4px; background: none;
        color: var(--schrift); font: inherit; font-size: 13px; cursor: pointer;
        text-align: left;
      }
      .fl-eintrag:hover { background: var(--flaeche); }
      .fl-probe { width: 16px; text-align: center; }
      .fl-tupfer { height: 12px; border-radius: 50%; border: 1px solid var(--linie); }
      .fl-galerie { padding: 8px; }
      .fl-galkopf { margin: 0 0 6px; font-size: 12px; color: var(--matt); }
      .fl-gitter {
        display: grid; grid-template-columns: repeat(5, 68px); gap: 6px;
      }
      .fl-kachel {
        display: flex; flex-direction: column; justify-content: center; gap: 3px;
        height: 62px; padding: 6px; border: 1px solid var(--linie);
        border-radius: 3px; background: var(--papier); color: var(--schrift);
        font: inherit; font-size: 11px; cursor: pointer;
      }
      .fl-kachel:hover { border-color: var(--betont, #7a5cff); }
      .fl-kzeile { display: flex; align-items: center; gap: 4px; }
      .fl-knr { min-width: 18px; text-align: right; }
      .fl-kstrich { flex: 1; height: 1px; background: var(--schrift); opacity: .5; }
      .fl-keine { font-size: 12px; text-align: center; }
      .fl-geteilt { display: inline-flex; align-items: center; }
      .fl-geteilt .fl-taste { border-radius: 3px 0 0 3px; }
      .fl-geteilt .fl-nurpfeil {
        min-width: 13px; padding: 0; border-radius: 0 3px 3px 0;
      }
      .fl-nurpfeil .fl-pfeil { font-size: 9px; opacity: .8; }
      .fl-kzeichen {
        display: block; width: 100%; font-size: 22px; line-height: 1;
        text-align: center;
      }
    `
    + listenRegeln();
    document.head.append(stil);
  }

  /* --------------------------------------- Rechtsklick: Formatieren gleich mit

     Drueben ist das Rechtsklick-Menue eine Liste mit vier Punkten, und zum
     Formatieren gibt es eine eigene Leiste, die bei einer Markierung aufgeht.
     In OneNote ist beides ein Menue: oben zwei Reihen Format, darunter die
     Punkte. Genau so sieht es hier jetzt aus.

     Gerechnet wird dabei nichts selbst. Geklickt wird auf die Funktionen
     drueben - aufAuswahl(), hervorheben(), hervorhebungWeg() -, und die
     Schriftliste und die Farben werden aus der vorhandenen Leiste gespiegelt.
     Zwei Stellen, die Fett setzen, waeren eine zu viel: eine davon ist eines
     Tages anders. */

  let rmImText = false;
  // Fuer die Fusszeile des Menues. Beides steht schon in Antworten, die der
  // Stellvertreter ohnehin holt - hier nur gemerkt.
  let meinName = '';
  let meinBereich = '';

  function rechtsmenueZu() {
    const menue = document.getElementById('rechtsmenue');
    if (menue) menue.hidden = true;
  }

  /* Beim Rechtsklick ist die schwebende Leiste zu viel: dieselben Knoepfe
     stehen eine Zeile tiefer noch einmal im Menue. Einmal zumachen genuegt
     nicht - drueben macht der Mausknopf sie weg und das Loslassen wieder hin,
     und das Loslassen kommt vor dem Menue. Deshalb bleibt sie zu, solange das
     Menue offen ist. Geht es zu, gelten wieder die Regeln von drueben: die
     naechste Markierung holt sie zurueck. */
  function minileisteWeg() {
    const leiste = document.getElementById('minileiste');
    if (leiste) leiste.hidden = true;
  }

  function minileisteHueten() {
    const leiste = document.getElementById('minileiste');
    const menue = document.getElementById('rechtsmenue');
    if (!leiste || !menue || !window.MutationObserver) return;
    new MutationObserver(function () {
      if (!menue.hidden && !leiste.hidden) leiste.hidden = true;
    }).observe(leiste, { attributes: true, attributeFilter: ['hidden'] });
  }

  function rechtsmenueBauen() {
    const menue = document.getElementById('rechtsmenue');
    if (!menue || document.getElementById('rm-format')) return;

    // Die vier Punkte drueben bekommen ihr Zeichen davor - geaendert wird an
    // ihnen sonst nichts, sie haengen weiter an ihrem data-tun.
    for (const [was, zeichen] of [['ausschneiden', '✂'], ['kopieren', '⧉'],
                                  ['einfuegen', '📋'], ['alles', '⬚']]) {
      const knopf = menue.querySelector(`button[data-tun="${was}"]`);
      if (!knopf || knopf.querySelector('.rm-zeichen')) continue;
      knopf.classList.add('rm-punkt');
      knopf.insertBefore(el('span', { className: 'rm-zeichen', textContent: zeichen }),
                         knopf.firstChild);
    }

    // Der Link gehoert zum Text, nicht zur Zwischenablage - deshalb unten,
    // hinter einem Strich. Mehr als http, https und mailto nimmt die Ablage
    // ohnehin nicht an; alles andere faellt beim Speichern wieder heraus.
    const link = el('button', { type: 'button', id: 'rm-link',
                                className: 'rm-punkt' }, [
      el('span', { className: 'rm-zeichen', textContent: '🔗' }),
      el('span', { textContent: 'Link …  (Strg+K)' }),
    ]);
    link.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      rechtsmenueZu();
      linkSetzen();
    });
    menue.append(el('div', { className: 'rm-strich' }), link);

    // Wer wann - so weit wir es wirklich wissen. Die Seite merkt sich, wann
    // sie zuletzt geaendert wurde, aber nicht von wem; in einem Projekt waere
    // ein Name hier also geraten.
    menue.append(el('p', { id: 'rm-wer', className: 'rm-fuss' }));

    // Unten die Leiste - dieselbe wie die schwebende beim Markieren.
    const block = el('div', { id: 'rm-format' }, [formatleisteBauen()]);
    menue.append(block);

    // Ein Klick ins Menue darf die Markierung nicht kosten - sonst tut der
    // Knopf nichts. Bei Auswahlfeldern nicht: die brauchen den Fokus.
    menue.addEventListener('mousedown', function (ev) {
      if (ev.target.tagName !== 'SELECT') ev.preventDefault();
    });

    document.addEventListener('contextmenu', function (ev) {
      if (ev.target.closest && ev.target.closest('#einstellungen')) return;
      rmImText = !!(ev.target.closest && ev.target.closest('[contenteditable]'));
      minileisteWeg();
      // Nach dem Aufbau drueben: dort wird das Menue sichtbar gemacht und
      // gestellt. Was hier dazukommt, aendert die Hoehe - also noch einmal
      // nachruecken.
      setTimeout(function () { rechtsmenueFrischen(ev.clientX, ev.clientY); }, 0);
    });

    document.addEventListener('keydown', function (ev) {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k'
          && document.activeElement && document.activeElement.closest
          && document.activeElement.closest('[contenteditable]')) {
        ev.preventDefault();
        linkSetzen();
      }
    });

    minileisteHueten();

    const stil = document.createElement('style');
    stil.textContent = `
      #rechtsmenue { padding: 0; min-width: 236px; }
      #rechtsmenue > button { display: flex; align-items: center; gap: 10px; width: 100%; }
      .rm-zeichen { width: 16px; text-align: center; opacity: .75; font-size: 13px; }
      .rm-strich { height: 1px; background: var(--linie); margin: 4px 0; }
      .rm-fuss {
        margin: 0; padding: 6px 10px 8px; color: var(--matt); font-size: 11px;
        border-top: 1px solid var(--linie);
      }
      .rm-fuss:empty { display: none; }
      #rm-format {
        border-top: 1px solid var(--linie); background: var(--leiste);
        border-radius: 0 0 8px 8px;
      }
      .rm-aus { opacity: .45; pointer-events: none; }
    `;
    document.head.append(stil);
  }

  function linkSetzen() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      malsagen('Erst den Text markieren, der zum Link werden soll.');
      return;
    }
    const merk = sel.getRangeAt(0).cloneRange();
    const adresse = prompt('Adresse des Links:', 'https://');
    if (!adresse) return;
    if (!/^(https?:\/\/|mailto:)/i.test(adresse)) {
      malsagen('Nur http://, https:// und mailto: - anderes wird beim Speichern verworfen.');
      return;
    }
    // Der Dialog kostet die Markierung, also zurueckholen.
    sel.removeAllRanges();
    sel.addRange(merk);
    flBefehl('createLink', adresse);
  }

  function rechtsmenueFrischen(x, y) {
    const menue = document.getElementById('rechtsmenue');
    const block = document.getElementById('rm-format');
    if (!menue || !block || menue.hidden) return;
    // Auf der leeren Flaeche ist kein Text da, den die Leiste aendern koennte.
    // Trotzdem steht sie da: ein Menue, das mal lang und mal kurz ist, springt
    // einem unter der Maus weg. Sie ist dann blass und nimmt keine Klicks an -
    // so wie die vier Punkte drueben, die dort auch ausgegraut sind.
    block.hidden = false;
    block.classList.toggle('rm-aus', !rmImText);
    const link = document.getElementById('rm-link');
    if (link) {
      link.hidden = false;
      link.classList.toggle('rm-aus', !rmImText);
    }
    if (rmImText) formatleisteFrischen(block.querySelector('.formatleiste'));
    const wer = document.getElementById('rm-wer');
    if (wer) wer.textContent = rmFusszeile();
    const b = menue.getBoundingClientRect();
    menue.style.left = Math.max(4, Math.min(x, window.innerWidth - b.width - 8)) + 'px';
    menue.style.top = Math.max(4, Math.min(y, window.innerHeight - b.height - 8)) + 'px';
  }


  function rmFusszeile() {
    let zeit = null;
    try { zeit = offen && offen.mtime ? new Date(offen.mtime * 1000) : null; }
    catch (f) { zeit = null; }
    if (!zeit) return '';
    const wann = zeit.toLocaleString('de-DE', { day: '2-digit', month: '2-digit',
                                                year: 'numeric', hour: '2-digit',
                                                minute: '2-digit' });
    // Der Name nur dort, wo er stimmt: in den eigenen Notizen war es man
    // selbst. In einem Projekt schreiben mehrere, und wer zuletzt - das merkt
    // sich die Seite nicht.
    return (meinBereich ? 'Zuletzt geändert am ' : (meinName || 'Zuletzt geändert') + ' am ')
           + wann;
  }

  /* ------------------------------------------------- Platinen (Gerber-ZIP)

     Ein Gerber-Paket ist kein Modell, sondern ein Stapel Zeichnungen: je eine
     Datei fuer Kupfer oben, Kupfer unten, Bestueckungsdruck, Umriss, dazu die
     Bohrdatei. Uebereinandergelegt ergibt das die Platine - von oben und von
     unten.

     Kein gekipptes 3D und kein Foto: die Koerper der Bauteile stehen in
     keiner dieser Dateien. Die holt JLCPCB aus seiner eigenen Bibliothek
     ueber die Bauteilnummer. Hier steht nur, was wirklich in der Datei steht.

     Wieder ohne fremde Bibliothek: ein ZIP ist ein Verzeichnis am Ende der
     Datei, auspacken kann der Browser selbst (DecompressionStream), und
     Gerber ist eine Textsprache mit einer Handvoll Befehlen. */

  const PCB_MAX_EINTRAEGE = 300;
  const PCB_MAX_ENTPACKT = 40 * 1024 * 1024;   // je Datei
  const PCB_MAX_STUECKE = 400000;              // Striche und Flaechen gesamt
  const PCB_BOGEN = 24;                        // Ecken je Viertelkreis

  /* --- ZIP ---------------------------------------------------------------- */

  async function entpacken(roh) {
    if (!window.DecompressionStream) {
      throw new Error('dieser Browser kann kein ZIP auspacken');
    }
    const strom = new Blob([roh]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(strom).arrayBuffer());
  }

  /* Gelesen wird ueber das Verzeichnis am Ende, nicht der Reihe nach durch
     die Datei: nur dort steht sicher, wie lang ein Eintrag gepackt ist. Im
     lokalen Kopf darf die Laenge fehlen (dann steht sie hinter den Daten). */
  async function zipLesen(puffer) {
    const b = new Uint8Array(puffer);
    const sicht = new DataView(puffer);
    let e = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) {
      if (sicht.getUint32(i, true) === 0x06054b50) { e = i; break; }
    }
    if (e < 0) throw new Error('kein ZIP-Verzeichnis gefunden');
    const anzahl = sicht.getUint16(e + 10, true);
    let p = sicht.getUint32(e + 16, true);
    const aus = [];
    for (let i = 0; i < anzahl && i < PCB_MAX_EINTRAEGE; i++) {
      if (p + 46 > b.length || sicht.getUint32(p, true) !== 0x02014b50) break;
      const art = sicht.getUint16(p + 10, true);
      const klein = sicht.getUint32(p + 20, true);
      const gross = sicht.getUint32(p + 24, true);
      const nl = sicht.getUint16(p + 28, true);
      const xl = sicht.getUint16(p + 30, true);
      const kl = sicht.getUint16(p + 32, true);
      const wo = sicht.getUint32(p + 42, true);
      const name = new TextDecoder().decode(b.slice(p + 46, p + 46 + nl));
      p += 46 + nl + xl + kl;
      if (gross > PCB_MAX_ENTPACKT) continue;        // Packbombe
      if (name.endsWith('/') || wo + 30 > b.length) continue;
      if (sicht.getUint32(wo, true) !== 0x04034b50) continue;
      const anfang = wo + 30 + sicht.getUint16(wo + 26, true)
                   + sicht.getUint16(wo + 28, true);
      const roh = b.slice(anfang, anfang + klein);
      let daten = null;
      if (art === 0) daten = roh;
      else if (art === 8) daten = await entpacken(roh);
      else continue;                                  // andere Packart: selten
      aus.push({ name: name, daten: daten });
    }
    return aus;
  }

  /* --- Welche Datei ist welche Lage? --------------------------------------

     Die Endung sagt es meistens (GTL, GBL, GTO, GKO, DRL), aber nicht jedes
     Programm haelt sich daran - KiCad schreibt "F_Cu.gbr", EasyEDA
     "Gerber_TopLayer.GTL". Deshalb beides: erst die Endung, dann der Name. */
  const PCB_LAGEN = [
    ['bohren', /\.(drl|xln|tap|nc)$/i, /drill|bohr|npth|\bpth\b/i],
    ['umriss', /\.(gko|gm1|gm2|gml)$/i, /outline|edge[._-]?cuts|boardoutline|profile|contour/i],
    ['kupfer-oben', /\.(gtl|cmp)$/i, /top[._-]?(layer|copper)|f[._-]cu|copper[._-]?top/i],
    ['kupfer-unten', /\.(gbl|sol)$/i, /bottom[._-]?(layer|copper)|b[._-]cu|copper[._-]?bottom/i],
    ['druck-oben', /\.(gto|plc)$/i, /top[._-]?(silk|overlay)|f[._-]silk/i],
    ['druck-unten', /\.(gbo|pls)$/i, /bottom[._-]?(silk|overlay)|b[._-]silk/i],
    ['lot-oben', /\.(gts|stc)$/i, /top[._-]?(solder)?mask|f[._-]mask/i],
    ['lot-unten', /\.(gbs|sts)$/i, /bottom[._-]?(solder)?mask|b[._-]mask/i],
  ];

  function lageVon(name) {
    const kurz = String(name || '').replace(/^.*\//, '');
    for (const [lage, endung] of PCB_LAGEN) if (endung.test(kurz)) return lage;
    for (const [lage, , wort] of PCB_LAGEN) if (wort.test(kurz)) return lage;
    // Eine .txt ohne sprechenden Namen kann die Bohrdatei sein - das sagt
    // ihr Inhalt, nicht ihr Name. Entschieden wird das beim Lesen.
    if (/\.(txt|gbr|ger|art|pho)$/i.test(kurz)) return 'unklar';
    return null;
  }

  /* --- Gerber lesen -------------------------------------------------------

     Gerber ist eine Folge von Befehlen, jeder mit * abgeschlossen; was
     zwischen zwei % steht, sind Einstellungen (Format, Einheit, Blenden).
     Gezeichnet wird mit einer "Blende" (aperture): D01 zieht damit einen
     Strich, D03 drueckt sie einmal ab, D02 setzt nur den Stift um.

     Herauskommt eine flache Liste aus Strichen, Abdruecken und Flaechen, alle
     in Millimetern. Was davon spaeter welche Farbe bekommt, entscheidet die
     Lage, nicht diese Funktion. */
  function gerberLesen(text) {
    const blenden = {};
    const stuecke = [];
    let nullen = 'L';
    let nach = 6;
    let ganz = 3;
    let maß = 1;                  // 1 = mm, 25.4 = Zoll
    let blende = null;
    let modus = 1;                // G01 gerade, G02/G03 Bogen
    let mehrquadrant = true;      // G75
    let loeschen = false;         // LPC: wegnehmen statt auftragen
    let x = 0;
    let y = 0;
    let flaeche = null;           // laeuft gerade ein G36-Bereich?
    let zug = null;

    function koord(s) {
      const minus = s.charAt(0) === '-';
      let ziffern = s.replace(/^[+-]/, '');
      // Fehlende Nullen stehen vorn (L) oder hinten (T). Steht es hinten,
      // ist "1" nicht 0,000001 sondern 1,0 - der haeufigste Lesefehler.
      if (nullen === 'T') ziffern = ziffern.padEnd(ganz + nach, '0');
      const wert = parseInt(ziffern, 10) / Math.pow(10, nach);
      return (minus ? -wert : wert) * maß;
    }

    function parameter(teil) {
      let m = /^FS([LT])[AI]X(\d)(\d)Y\d\d/.exec(teil);
      if (m) { nullen = m[1]; ganz = +m[2]; nach = +m[3]; return; }
      if (/^MOIN/.test(teil)) { maß = 25.4; return; }
      if (/^MOMM/.test(teil)) { maß = 1; return; }
      if (/^LPC/.test(teil)) { loeschen = true; return; }
      if (/^LPD/.test(teil)) { loeschen = false; return; }
      m = /^ADD(\d+)([A-Za-z_$][\w$.-]*)(?:,(.*))?$/.exec(teil);
      if (m) {
        const werte = (m[3] || '').split('X').map(parseFloat)
          .filter(function (w) { return w === w; });
        blenden[+m[1]] = { form: m[2], werte: werte.map(function (w) { return w * maß; }) };
      }
      // AM (eigene Blendenformen) und der Rest bleiben aussen vor: fuer das
      // Bild genuegt die Groesse, und die steht in der ersten Zahl.
    }

    function groesse(b) {
      if (!b) return 0.15 * maß;
      if (b.form === 'R' || b.form === 'O') {
        return Math.min(b.werte[0] || 0, b.werte[1] || b.werte[0] || 0) || 0.15;
      }
      return b.werte[0] || 0.15;
    }

    function bogen(x0, y0, x1, y1, i, j, uhrzeiger) {
      const mx = x0 + i;
      const my = y0 + j;
      const r = Math.hypot(x0 - mx, y0 - my);
      let a0 = Math.atan2(y0 - my, x0 - mx);
      let a1 = Math.atan2(y1 - my, x1 - mx);
      let d = a1 - a0;
      if (uhrzeiger) { while (d > 0) d -= 2 * Math.PI; } else { while (d < 0) d += 2 * Math.PI; }
      // Voller Kreis: Anfang gleich Ende. Dann ist die Drehung nicht null,
      // sondern einmal herum - sonst faellt der Kreis weg.
      if (Math.abs(d) < 1e-9 && Math.hypot(x1 - x0, y1 - y0) < 1e-9) {
        d = uhrzeiger ? -2 * Math.PI : 2 * Math.PI;
      }
      const n = Math.max(2, Math.ceil(Math.abs(d) / (Math.PI / 2) * PCB_BOGEN));
      const punkte = [];
      for (let k = 1; k <= n; k++) {
        const a = a0 + d * (k / n);
        punkte.push([mx + r * Math.cos(a), my + r * Math.sin(a)]);
      }
      return punkte;
    }

    function hin(zx, zy, i, j) {
      if (modus === 1) return [[zx, zy]];
      return bogen(x, y, zx, zy, i, j, modus === 2);
    }

    function kommando(b) {
      if (/^G0*4/.test(b) || /^M0/.test(b)) return;     // Kommentar, Ende
      if (/^G0*36/.test(b)) { flaeche = []; return; }
      if (/^G0*37/.test(b)) {
        if (flaeche && flaeche.length > 2) {
          stuecke.push({ t: 'flaeche', punkte: flaeche, weg: loeschen });
        }
        flaeche = null;
        return;
      }
      let m = /^G0*([0-9]+)/.exec(b);
      if (m) {
        const n = +m[1];
        if (n === 1 || n === 2 || n === 3) modus = n;
        else if (n === 74) mehrquadrant = false;
        else if (n === 75) mehrquadrant = true;
      }
      m = /D0*(\d+)\s*$/.exec(b);
      let tun = 0;
      if (m) {
        const d = +m[1];
        if (d >= 10) { blende = d; if (!/[XY]/.test(b)) return; } else tun = d;
      }
      const nx = /X([+-]?\d+)/.exec(b);
      const ny = /Y([+-]?\d+)/.exec(b);
      const ni = /I([+-]?\d+)/.exec(b);
      const nj = /J([+-]?\d+)/.exec(b);
      if (!nx && !ny && !tun) return;
      const zx = nx ? koord(nx[1]) : x;
      const zy = ny ? koord(ny[1]) : y;
      const i = ni ? koord(ni[1]) : 0;
      const j = nj ? koord(nj[1]) : 0;
      if (stuecke.length > PCB_MAX_STUECKE) return;
      if (tun === 1) {
        const weg = hin(zx, zy, i, j);
        if (flaeche) {
          if (!flaeche.length) flaeche.push([x, y]);
          for (const p of weg) flaeche.push(p);
        } else {
          if (!zug || zug.weg !== loeschen || zug.breite !== groesse(blenden[blende])
              || zug.punkte[zug.punkte.length - 1][0] !== x
              || zug.punkte[zug.punkte.length - 1][1] !== y) {
            zug = { t: 'zug', punkte: [[x, y]], breite: groesse(blenden[blende]),
                    eckig: (blenden[blende] || {}).form === 'R', weg: loeschen };
            stuecke.push(zug);
          }
          for (const p of weg) zug.punkte.push(p);
        }
      } else if (tun === 3) {
        stuecke.push({ t: 'abdruck', x: zx, y: zy, blende: blenden[blende] || null,
                       weg: loeschen });
        zug = null;
      } else {
        zug = null;                       // D02: der Stift setzt neu an
        if (flaeche && flaeche.length > 2) {
          stuecke.push({ t: 'flaeche', punkte: flaeche, weg: loeschen });
          flaeche = [];
        }
      }
      x = zx;
      y = zy;
    }

    let p = 0;
    while (p < text.length) {
      // Zeilenumbrueche zuerst weg: steht einer vor dem %, sucht die
      // Befehlsseite sonst das naechste * - und das steht im Parameterblock.
      if (/\s/.test(text.charAt(p))) { p++; continue; }
      if (text.charAt(p) === '%') {
        const ende = text.indexOf('%', p + 1);
        if (ende < 0) break;
        for (const teil of text.slice(p + 1, ende).split('*')) {
          if (teil.trim()) parameter(teil.trim());
        }
        p = ende + 1;
      } else {
        const ende = text.indexOf('*', p);
        if (ende < 0) break;
        const b = text.slice(p, ende).trim();
        if (b) kommando(b);
        p = ende + 1;
      }
    }
    return stuecke;
  }

  /* --- Bohrdatei (Excellon) ----------------------------------------------

     Viel aelter und viel schlampiger als Gerber: die Einheit steht irgendwo
     im Kopf, und ob die Koordinate "3175" nun 3,175 mm oder 31,75 mm heisst,
     steht oft gar nicht da. Steht ein Punkt drin, ist alles klar - sonst
     gilt die uebliche Annahme (metrisch drei Nachkommastellen). */
  function bohrLesen(text) {
    const werkzeuge = {};
    const loecher = [];
    let maß = 1;
    let nach = 3;
    let jetzt = 0;

    function zahl(s) {
      if (s.indexOf('.') >= 0) return parseFloat(s) * maß;
      const minus = s.charAt(0) === '-';
      const ziffern = s.replace(/^[+-]/, '');
      const wert = parseInt(ziffern, 10) / Math.pow(10, nach);
      return (minus ? -wert : wert) * maß;
    }

    for (const zeile of String(text).split(/\r?\n/)) {
      const z = zeile.trim();
      if (!z || z.charAt(0) === ';') continue;
      if (/^(METRIC|M71)/.test(z)) { maß = 1; nach = 3; continue; }
      if (/^(INCH|M72)/.test(z)) { maß = 25.4; nach = 4; continue; }
      let m = /^T(\d+)[^C]*C\s*([\d.]+)/.exec(z);
      if (m) { werkzeuge[+m[1]] = parseFloat(m[2]) * maß; continue; }
      m = /^T(\d+)\s*$/.exec(z);
      if (m) { jetzt = +m[1]; continue; }
      m = /X([+-]?[\d.]+)\s*Y([+-]?[\d.]+)/.exec(z);
      if (m) {
        loecher.push({ x: zahl(m[1]), y: zahl(m[2]), d: werkzeuge[jetzt] || 0.3 });
      }
    }
    return loecher;
  }

  function istBohrdatei(text) {
    return /^\s*(M48|;.*(drill|Excellon))/i.test(text) || /^T\d+C[\d.]/m.test(text);
  }

  /* --- Aus den Dateien eine Platine machen -------------------------------- */

  const PCB_SEITEN = {
    oben: { kupfer: 'kupfer-oben', druck: 'druck-oben' },
    unten: { kupfer: 'kupfer-unten', druck: 'druck-unten' },
  };

  function textVon(daten) {
    return new TextDecoder('utf-8', { fatal: false }).decode(daten);
  }

  function platinePacken(dateien) {
    const lagen = {};
    const loecher = [];
    const namen = [];
    for (const d of dateien) {
      const lage = lageVon(d.name);
      if (!lage) continue;
      const text = textVon(d.daten);
      if (lage === 'bohren' || (lage === 'unklar' && istBohrdatei(text))) {
        for (const l of bohrLesen(text)) loecher.push(l);
        namen.push(d.name);
        continue;
      }
      if (lage === 'unklar') continue;
      const stuecke = gerberLesen(text);
      if (!stuecke.length) continue;
      lagen[lage] = (lagen[lage] || []).concat(stuecke);
      namen.push(d.name);
    }
    return { lagen: lagen, loecher: loecher, namen: namen,
             umriss: umrissNaehen(lagen['umriss'] || []) };
  }

  /* Der Umriss kommt als lose Striche, nicht als Flaeche: vier Linien, oder
     bei abgerundeten Ecken ein Dutzend Stuecke. Zum Fuellen muessen sie erst
     wieder zu einem Ring werden - also Ende an Anfang naehen. */
  function umrissNaehen(stuecke) {
    const nah = function (a, b) {
      return Math.abs(a[0] - b[0]) < 0.02 && Math.abs(a[1] - b[1]) < 0.02;
    };
    const offen = [];
    for (const s of stuecke) {
      if (s.t === 'flaeche') offen.push(s.punkte.slice());
      else if (s.t === 'zug' && s.punkte.length > 1) offen.push(s.punkte.slice());
    }
    const ringe = [];
    while (offen.length) {
      let kette = offen.pop();
      let weiter = true;
      while (weiter) {
        weiter = false;
        for (let i = 0; i < offen.length; i++) {
          const k = offen[i];
          const vorn = kette[0];
          const hinten = kette[kette.length - 1];
          if (nah(hinten, k[0])) kette = kette.concat(k.slice(1));
          else if (nah(hinten, k[k.length - 1])) kette = kette.concat(k.slice().reverse().slice(1));
          else if (nah(vorn, k[k.length - 1])) kette = k.slice(0, -1).concat(kette);
          else if (nah(vorn, k[0])) kette = k.slice().reverse().slice(0, -1).concat(kette);
          else continue;
          offen.splice(i, 1);
          weiter = true;
          break;
        }
      }
      if (kette.length > 2) ringe.push(kette);
    }
    return ringe;
  }

  function pcbRahmen(platine) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const nimm = function (x, y) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    };
    for (const ring of platine.umriss) for (const p of ring) nimm(p[0], p[1]);
    if (!platine.umriss.length) {
      for (const lage of Object.keys(platine.lagen)) {
        for (const s of platine.lagen[lage]) {
          if (s.t === 'abdruck') nimm(s.x, s.y);
          else for (const p of s.punkte) nimm(p[0], p[1]);
        }
      }
      for (const l of platine.loecher) nimm(l.x, l.y);
    }
    if (!(x1 > x0)) return null;
    return { x0: x0, y0: y0, x1: x1, y1: y1, breit: x1 - x0, hoch: y1 - y0 };
  }

  /* --- Malen --------------------------------------------------------------

     Alles in Millimetern: die Umrechnung macht die Matrix der Zeichenflaeche.
     Dadurch stimmt auch die Strichbreite ohne Nachrechnen, und die Unterseite
     ist nur ein gespiegeltes Vorzeichen. */

  function pcbPfad(ctx, punkte, zu) {
    ctx.beginPath();
    ctx.moveTo(punkte[0][0], punkte[0][1]);
    for (let i = 1; i < punkte.length; i++) ctx.lineTo(punkte[i][0], punkte[i][1]);
    if (zu) ctx.closePath();
  }

  function abdruckMalen(ctx, s) {
    const b = s.blende || { form: 'C', werte: [0.2] };
    const w = b.werte || [];
    if (b.form === 'R' || b.form === 'O') {
      const bx = w[0] || 0.2;
      const by = w[1] || bx;
      if (b.form === 'O' && ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(s.x - bx / 2, s.y - by / 2, bx, by, Math.min(bx, by) / 2);
        ctx.fill();
      } else {
        ctx.fillRect(s.x - bx / 2, s.y - by / 2, bx, by);
      }
      return;
    }
    if (b.form === 'P' && w.length >= 2) {
      const r = (w[0] || 0.2) / 2;
      const ecken = Math.max(3, Math.round(w[1] || 6));
      const dreh = (w[2] || 0) * Math.PI / 180;
      ctx.beginPath();
      for (let i = 0; i < ecken; i++) {
        const a = dreh + i * 2 * Math.PI / ecken;
        const px = s.x + r * Math.cos(a);
        const py = s.y + r * Math.sin(a);
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.arc(s.x, s.y, (w[0] || 0.2) / 2, 0, 2 * Math.PI);
    ctx.fill();
  }

  function lageMalen(ctx, stuecke, farbe) {
    if (!stuecke || !stuecke.length) return;
    ctx.save();
    ctx.fillStyle = farbe;
    ctx.strokeStyle = farbe;
    ctx.lineJoin = 'round';
    for (const s of stuecke) {
      // LPC heisst: hier wird wieder weggenommen, was schon da war - so
      // entstehen Freistellungen im Kupfer. Mit "destination-out" macht das
      // die Zeichenflaeche selbst.
      ctx.globalCompositeOperation = s.weg ? 'destination-out' : 'source-over';
      if (s.t === 'zug') {
        ctx.lineWidth = Math.max(s.breite, 0.02);
        ctx.lineCap = s.eckig ? 'butt' : 'round';
        pcbPfad(ctx, s.punkte, false);
        ctx.stroke();
      } else if (s.t === 'flaeche') {
        pcbPfad(ctx, s.punkte, true);
        ctx.fill();
      } else {
        abdruckMalen(ctx, s);
      }
    }
    ctx.restore();
  }

  const PCB_FARBEN = {
    traeger: '#0d5c38', traegerRand: '#0a3f27',
    kupfer: '#d8a93c', druck: '#f2f4f5', loch: '#0b0c0d',
  };

  function platineZeichnen(z) {
    const c = z.bild;
    if (!c || !z.platine) return;
    const kasten = z.wo.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const br = Math.max(1, Math.round(kasten.width * dpr));
    const ho = Math.max(1, Math.round(kasten.height * dpr));
    if (c.width !== br || c.height !== ho) { c.width = br; c.height = ho; }
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, br, ho);
    const r = z.rahmen;
    if (!r) return;
    const rand = 1.0;                                  // mm Luft ringsum
    const k = Math.min(br / (r.breit + 2 * rand), ho / (r.hoch + 2 * rand)) * z.zoom;
    const mx = (r.x0 + r.x1) / 2;
    const my = (r.y0 + r.y1) / 2;
    const spiegel = z.seite === 'unten' ? -1 : 1;
    // y zeigt in Gerber nach oben, auf der Zeichenflaeche nach unten.
    ctx.setTransform(k * spiegel, 0, 0, -k, br / 2 + z.ox, ho / 2 + z.oy);
    ctx.translate(-mx, -my);

    // Der Traeger: die Ringe des Umrisses als ein Pfad, mit Evenodd - dann
    // bleiben Ausschnitte innen auch Ausschnitte.
    ctx.save();
    if (z.platine.umriss.length) {
      ctx.beginPath();
      for (const ring of z.platine.umriss) {
        ctx.moveTo(ring[0][0], ring[0][1]);
        for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i][0], ring[i][1]);
        ctx.closePath();
      }
      ctx.fillStyle = PCB_FARBEN.traeger;
      ctx.fill('evenodd');
      ctx.lineWidth = 0.15;
      ctx.strokeStyle = PCB_FARBEN.traegerRand;
      ctx.stroke();
      ctx.clip('evenodd');
    } else {
      ctx.fillStyle = PCB_FARBEN.traeger;
      ctx.fillRect(r.x0, r.y0, r.breit, r.hoch);
    }

    const seite = PCB_SEITEN[z.seite] || PCB_SEITEN.oben;
    lageMalen(ctx, z.platine.lagen[seite.kupfer], PCB_FARBEN.kupfer);
    // Die Bohrungen sitzen durch die ganze Platine - also nach dem Kupfer
    // und vor dem Aufdruck.
    ctx.fillStyle = PCB_FARBEN.loch;
    for (const l of z.platine.loecher) {
      ctx.beginPath();
      ctx.arc(l.x, l.y, Math.max(l.d, 0.05) / 2, 0, 2 * Math.PI);
      ctx.fill();
    }
    lageMalen(ctx, z.platine.lagen[seite.druck], PCB_FARBEN.druck);
    ctx.restore();
  }

  /* --- Der Kasten ---------------------------------------------------------- */

  // Das Fenster ist so breit wie der Kasten - also so breit wie die Zeile
  // darunter. Nur die Hoehe richtet sich nach der Platine: ein langes schmales
  // Brett bekommt ein hohes Fenster, ein flaches ein flaches, und ein festes
  // 4:3 wuerde beiden nicht passen.
  function pcbFenster(r, platz) {
    const form = r.breit / Math.max(r.hoch, 0.01);
    const hoch = Math.max(90, Math.min(340, platz / Math.max(form, 0.01)));
    return { breit: platz, hoch: Math.round(hoch) };
  }

  async function platineStarten(z) {
    if (z.laeuft) return;
    z.laeuft = true;
    let puffer;
    try {
      puffer = await modellHolen(z.datei);
    } catch (f) {
      kachelBehalten(z, 'Platine ließ sich nicht holen: ' + f.message);
      return;
    }
    let dateien;
    try {
      dateien = await zipLesen(puffer);
    } catch (f) {
      kachelBehalten(z, 'ZIP ließ sich nicht öffnen: ' + f.message
                        + ' (' + puffer.byteLength + ' Byte)');
      return;
    }
    let platine;
    try {
      platine = platinePacken(dateien);
    } catch (f) {
      kachelBehalten(z, 'Gerber ließ sich nicht lesen: ' + f.message);
      return;
    }
    if (!platine.namen.length) {
      // Die meisten ZIPs sind einfach ZIPs. Darunter eine rote Zeile zu
      // setzen, waere Laerm: niemand hat hier eine Platine erwartet. Anders,
      // wenn Gerber-Dateien drin sind und trotzdem nichts dabei herauskommt -
      // dann will man wissen, warum.
      const gerber = dateien.filter(function (d) {
        const l = lageVon(d.name);
        return l && l !== 'unklar';
      });
      if (!gerber.length) { kachelBehalten(z, ''); return; }
      const liste = gerber.slice(0, 4).map(function (d) { return d.name; }).join(', ');
      kachelBehalten(z, 'Gerber gefunden, aber keine Linie darin (' + liste + ')');
      return;
    }
    z.platine = platine;
    z.rahmen = pcbRahmen(platine);
    if (!z.rahmen) {
      kachelBehalten(z, 'Die Gerber-Dateien sind leer - keine einzige Linie darin.');
      return;
    }
    const platz = (z.wo.parentElement && z.wo.parentElement.clientWidth)
                  || z.wo.clientWidth || 320;
    const f = pcbFenster(z.rahmen, platz);
    z.wo.style.width = f.breit + 'px';
    z.wo.style.height = f.hoch + 'px';

    const zaehler = z.kasten.querySelector('.dzahl');
    if (zaehler) {
      zaehler.textContent = z.rahmen.breit.toFixed(1).replace('.', ',') + ' × '
        + z.rahmen.hoch.toFixed(1).replace('.', ',') + ' mm · '
        + platine.loecher.length + ' Bohrungen';
    }
    if (!platine.lagen['kupfer-unten'] && !platine.lagen['druck-unten']) {
      const knopf = z.wo.querySelector('.pcbseite');
      if (knopf) knopf.hidden = true;        // einseitig: nichts zum Wenden
    }
    platineZeichnen(z);
  }

  function platineGriffe(z) {
    const c = z.bild;
    let zieht = false;
    let zx = 0;
    let zy = 0;
    c.addEventListener('pointerdown', function (ev) {
      zieht = true;
      zx = ev.clientX;
      zy = ev.clientY;
      c.setPointerCapture(ev.pointerId);
      ev.stopPropagation();           // nicht den Kasten mitziehen
      ev.preventDefault();
    });
    c.addEventListener('pointermove', function (ev) {
      if (!zieht) return;
      const dpr = window.devicePixelRatio || 1;
      z.ox += (ev.clientX - zx) * dpr;
      z.oy += (ev.clientY - zy) * dpr;
      zx = ev.clientX;
      zy = ev.clientY;
      platineZeichnen(z);
    });
    const los = function (ev) {
      zieht = false;
      try { c.releasePointerCapture(ev.pointerId); } catch (f) { /* egal */ }
    };
    c.addEventListener('pointerup', los);
    c.addEventListener('pointercancel', los);
    c.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      z.zoom = Math.max(0.3, Math.min(40, z.zoom * (ev.deltaY > 0 ? 0.88 : 1.14)));
      platineZeichnen(z);
    }, { passive: false });
    c.addEventListener('dblclick', function (ev) {
      ev.stopPropagation();
      z.zoom = 1;
      z.ox = 0;
      z.oy = 0;
      platineZeichnen(z);
    });
  }

  function platineKasten(kasten, datei) {
    kasten.dataset.modell = 'ja';
    kasten.classList.add('kasten-pcb');
    const bild = el('canvas', {});
    const lade = el('p', { className: 'lade', textContent: 'Platine wird gelesen …' });
    const seite = el('button', { type: 'button', className: 'pcbseite',
                                 title: 'Auf die andere Seite sehen',
                                 textContent: 'Unterseite' });
    const wo = el('div', { className: 'modell pcb' }, [bild, lade, seite]);
    const kachel = kasten.querySelector('.datei');
    if (kachel) {
      kachel.before(wo);
      kachel.append(el('span', { className: 'dzahl', textContent: '…' }));
    } else {
      kasten.append(wo);
    }

    const z = { kasten: kasten, wo: wo, bild: bild, datei: datei, platine: null,
                rahmen: null, seite: 'oben', zoom: 1, ox: 0, oy: 0, laeuft: false };
    seite.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      z.seite = z.seite === 'oben' ? 'unten' : 'oben';
      seite.textContent = z.seite === 'oben' ? 'Unterseite' : 'Oberseite';
      platineZeichnen(z);
    });
    platineGriffe(z);

    const sehen = new IntersectionObserver(function (treffer) {
      for (const t of treffer) {
        if (!t.isIntersecting) continue;
        sehen.disconnect();
        platineStarten(z).then(function () { lade.remove(); },
                               function (f) {
                                 lade.remove();
                                 kachelBehalten(z, 'Platine: ' + f.message);
                               });
      }
    }, { rootMargin: '200px' });
    sehen.observe(wo);
    if (window.ResizeObserver) {
      new ResizeObserver(function () { platineZeichnen(z); }).observe(wo);
    }
  }

  /* ----------------------------------------------------------- 3D-Anhaenge

     Eine .stl kam bisher als 📎-Kachel in die Notiz: man sah den Namen und
     musste sie herunterladen, um zu wissen, was drin ist. Jetzt steht das
     Modell da und laesst sich drehen.

     Bewusst kein neuer Elementtyp: der Kasten bleibt ein Datei-Kasten, nur
     sein Inhalt wird ausgetauscht. Am Format der Notizen aendert sich damit
     nichts - dieselbe Seite zeigt im Fenster-Programm weiter die Kachel, und
     eine alte Fassung stolpert nicht ueber etwas Unbekanntes.

     Und bewusst ohne fremde Bibliothek: STL ist Kopf, Anzahl, 50 Byte je
     Dreieck, OBJ sind Zeilen mit v und f. Fuer "graues Modell drehen" braucht
     es Matrizen, ein Licht von oben und sonst nichts. */

  const MODELL_ARTEN = ['stl', 'obj', 'fbx'];
  // Mehr als eine Handvoll 3D-Flaechen gibt der Browser pro Seite nicht her.
  // Also leben nur die zuletzt benutzten; die anderen stehen als Standbild da
  // und wachen beim Klick wieder auf.
  const MODELL_LEBENDIG = [];
  const MODELL_MAX_LEBENDIG = 4;
  // Darueber bleibt die Kachel stehen, statt den Browser minutenlang
  // einzulesen.
  const MODELL_MAX_DREIECKE = 3000000;
  // So weit weg, dass die Kugel um das Teil (Radius 1 nach dem Skalieren) in
  // jeder Drehung ins Bild passt: 1 / sin(halber Oeffnungswinkel), plus Luft.
  const MODELL_WEG = 3.6;
  const MODELL_WINKEL = 0.6;        // Oeffnungswinkel der Kamera, im Bogenmass
  const MODELL_SCHIEB_MAX = 4;      // so weit darf der Drehpunkt hoechstens weg

  function modellArt(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name || '');
    const art = m ? m[1].toLowerCase() : '';
    return MODELL_ARTEN.indexOf(art) >= 0 ? art : null;
  }

  /* Die Bytes kommen ueber dieselbe Stelle wie der Download: /anhang prueft
     die Anmeldung und liefert rohe Bytes. */
  async function modellHolen(datei) {
    const felder = new URLSearchParams({
      notizbuch: offen.notizbuch, abschnitt: offen.abschnitt,
      name: offen.name, datei: datei,
    });
    const antwort = await fetch('/anhang?' + felder.toString(), { credentials: 'same-origin' });
    if (!antwort.ok) {
      let text = 'Der Server antwortet mit ' + antwort.status;
      try {
        const d = await antwort.json();
        if (d && d.fehler) text = d.fehler;
      } catch (f) { /* dann der Satz von oben */ }
      throw new Error(text);
    }
    return antwort.arrayBuffer();
  }

  /* --- Einlesen ----------------------------------------------------------- */

  function stlLesen(puffer) {
    /* Binaer oder Text? Nicht nach dem Wort "solid" am Anfang - binaere
       Dateien aus manchen Programmen fangen auch damit an. Zuerst die Laenge:
       passt sie aufs Byte, ist die Sache klar. Tut sie das nicht, hat eine
       binaere Datei hinten etwas angehaengt oder ihr Kopf zaehlt falsch;
       dann entscheidet, ob im Anfang ueberhaupt STL-Text steht. */
    if (puffer.byteLength >= 84) {
      const sicht = new DataView(puffer);
      const zahl = sicht.getUint32(80, true);
      if (84 + zahl * 50 === puffer.byteLength) return stlBinaer(sicht, zahl);
      const probe = new TextDecoder('utf-8', { fatal: false }).decode(puffer.slice(0, 1024));
      if (!/facet\s+normal|outer\s+loop|vertex\s/.test(probe) && zahl > 0) {
        // Was wirklich da ist, zaehlt - nicht, was im Kopf steht.
        const passen = Math.floor((puffer.byteLength - 84) / 50);
        return stlBinaer(sicht, Math.min(zahl, passen));
      }
    }
    return stlText(new TextDecoder().decode(puffer));
  }

  /* Fuer die Fehlerzeile. Ohne diese drei Angaben heisst es "geht nicht", und
     dann wird geraten statt nachgesehen. */
  function kopfschau(puffer) {
    const anfang = new TextDecoder('utf-8', { fatal: false })
      .decode(puffer.slice(0, 12)).replace(/[^ -~]/g, '.');
    const zahl = puffer.byteLength >= 84
      ? new DataView(puffer).getUint32(80, true) : '?';
    return puffer.byteLength + ' Byte, Anfang „' + anfang + '", Kopfzahl ' + zahl;
  }

  function stlBinaer(sicht, zahl) {
    const punkte = new Float32Array(zahl * 9);
    let z = 0;
    for (let d = 0; d < zahl; d++) {
      // 12 Byte Normale ueberspringen: sie steht oft auf 0 oder zeigt falsch.
      // Gerechnet wird sie gleich sowieso aus den Ecken.
      let p = 84 + d * 50 + 12;
      for (let i = 0; i < 9; i++, p += 4) punkte[z++] = sicht.getFloat32(p, true);
    }
    return punkte;
  }

  function stlText(text) {
    const zahlen = [];
    const muster = /vertex\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)/g;
    let t;
    while ((t = muster.exec(text))) {
      zahlen.push(Number(t[1]), Number(t[2]), Number(t[3]));
      if (zahlen.length > MODELL_MAX_DREIECKE * 9) break;
    }
    return new Float32Array(zahlen.slice(0, Math.floor(zahlen.length / 9) * 9));
  }

  function objLesen(puffer) {
    const ecken = [];
    const punkte = [];
    for (const zeile of new TextDecoder().decode(puffer).split('\n')) {
      const z = zeile.trim();
      if (z.charCodeAt(0) === 118 && z.charCodeAt(1) === 32) {          // "v "
        const t = z.split(/\s+/);
        ecken.push(Number(t[1]), Number(t[2]), Number(t[3]));
      } else if (z.charCodeAt(0) === 102 && z.charCodeAt(1) === 32) {   // "f "
        const t = z.split(/\s+/).slice(1).map(function (s) {
          // "7", "7/3", "7//2" - gebraucht wird nur die erste Zahl. Negative
          // Nummern zaehlen vom Ende her.
          const n = parseInt(s.split('/')[0], 10);
          return n < 0 ? ecken.length / 3 + n : n - 1;
        });
        // Vielecke als Faecher: ein n-Eck wird zu n-2 Dreiecken.
        for (let i = 1; i + 1 < t.length; i++) {
          for (const k of [t[0], t[i], t[i + 1]]) {
            punkte.push(ecken[k * 3], ecken[k * 3 + 1], ecken[k * 3 + 2]);
          }
        }
      }
    }
    return new Float32Array(punkte);
  }

  /* --- FBX ---------------------------------------------------------------

     FBX ist keine Datei mit einem Teil, sondern eine Szene: mehrere Objekte,
     jedes mit eigener Lage, Drehung und Groesse, dazu ein Elternbaum. Wer das
     weglaesst, legt bei einem Avatar alle Teile uebereinander in den
     Nullpunkt.

     Zwei Fassungen, ein Baum: binaer sind es geschachtelte Datensaetze mit
     zlib-gepackten Zahlenfeldern (das entpackt der Browser selbst), Text ist
     derselbe Baum in geschweiften Klammern. Danach arbeitet alles weitere auf
     derselben Form {name, werte, kinder}.

     Herausgeholt werden nur Vertices und PolygonVertexIndex. Nicht gelesen:
     Materialien, Texturen, Knochen, Animation, und von den Lagen die
     Exoten - andere Drehreihenfolgen als XYZ, Dreh- und Skalierpunkte,
     Vererbungsarten. Bei einem normalen Export aus Blender oder Fusion steht
     das Teil damit richtig; bei einer Szene aus Maya kann etwas schief
     stehen. */

  const FBX_MAGIE = 'Kaydara FBX Binary';

  async function fbxLesen(puffer) {
    const kopf = new TextDecoder('utf-8', { fatal: false }).decode(puffer.slice(0, 20));
    const baum = kopf.indexOf(FBX_MAGIE) === 0
      ? await fbxBinaer(puffer)
      : fbxText(new TextDecoder('utf-8', { fatal: false }).decode(puffer));
    return fbxNetz(baum);
  }

  async function auspacken(roh) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('dieser Browser kann FBX nicht entpacken (DecompressionStream fehlt)');
    }
    const strom = new Blob([roh]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(strom).arrayBuffer());
  }

  async function fbxBinaer(puffer) {
    const sicht = new DataView(puffer);
    // Ab Fassung 7500 sind die Zeiger 64 Bit breit.
    const breit = sicht.getUint32(23, true) >= 7500;
    const wurzel = { name: '', werte: [], kinder: [] };
    let stelle = 27;
    while (stelle + (breit ? 25 : 13) <= puffer.byteLength) {
      const k = await fbxKnoten(sicht, puffer, stelle, breit);
      if (!k) break;
      wurzel.kinder.push(k.knoten);
      stelle = k.ende;
    }
    return wurzel;
  }

  async function fbxKnoten(sicht, puffer, stelle, breit) {
    const lang = (p) => (breit ? Number(sicht.getBigUint64(p, true)) : sicht.getUint32(p, true));
    const kopf = breit ? 25 : 13;
    const ende = lang(stelle);
    if (!ende) return null;                       // Schlussmarke
    const zahl = lang(stelle + (breit ? 8 : 4));
    const wertebytes = lang(stelle + (breit ? 16 : 8));
    const namelaenge = sicht.getUint8(stelle + (breit ? 24 : 12));
    let p = stelle + kopf;
    const name = new TextDecoder().decode(new Uint8Array(puffer, p, namelaenge));
    p += namelaenge;
    const werte = [];
    for (let i = 0; i < zahl; i++) {
      const w = await fbxWert(sicht, puffer, p);
      werte.push(w.wert);
      p = w.ende;
    }
    // Nicht mitzaehlen, sondern ausrechnen: so bringt ein Wert, den wir nicht
    // kennen, nicht den ganzen Baum durcheinander.
    p = stelle + kopf + namelaenge + wertebytes;
    const kinder = [];
    while (p + kopf <= ende) {
      const k = await fbxKnoten(sicht, puffer, p, breit);
      if (!k) break;
      kinder.push(k.knoten);
      p = k.ende;
    }
    return { knoten: { name, werte, kinder }, ende };
  }

  async function fbxWert(sicht, puffer, p) {
    const art = String.fromCharCode(sicht.getUint8(p));
    p += 1;
    if (art === 'Y') return { wert: sicht.getInt16(p, true), ende: p + 2 };
    if (art === 'C') return { wert: !!sicht.getUint8(p), ende: p + 1 };
    if (art === 'I') return { wert: sicht.getInt32(p, true), ende: p + 4 };
    if (art === 'F') return { wert: sicht.getFloat32(p, true), ende: p + 4 };
    if (art === 'D') return { wert: sicht.getFloat64(p, true), ende: p + 8 };
    if (art === 'L') return { wert: Number(sicht.getBigInt64(p, true)), ende: p + 8 };
    if (art === 'S' || art === 'R') {
      const n = sicht.getUint32(p, true);
      const roh = new Uint8Array(puffer, p + 4, n);
      return { wert: art === 'S' ? new TextDecoder().decode(roh) : roh, ende: p + 4 + n };
    }
    const laenge = sicht.getUint32(p, true);
    const packung = sicht.getUint32(p + 4, true);
    const bytes = sicht.getUint32(p + 8, true);
    let roh = new Uint8Array(puffer, p + 12, bytes);
    if (packung === 1) roh = await auspacken(roh);
    return { wert: fbxFeld(art, roh, laenge), ende: p + 12 + bytes };
  }

  function fbxFeld(art, roh, laenge) {
    // Eine frische Kopie: ein Feld mitten im Puffer liegt sonst schief fuer
    // 8-Byte-Zahlen, und dann wirft der Browser.
    const b = roh.slice().buffer;
    if (art === 'd') return new Float64Array(b, 0, laenge);
    if (art === 'f') return new Float32Array(b, 0, laenge);
    if (art === 'i') return new Int32Array(b, 0, laenge);
    if (art === 'l') return Array.from(new BigInt64Array(b, 0, laenge), Number);
    if (art === 'b') return new Uint8Array(b, 0, laenge);
    return [];
  }

  function fbxText(text) {
    const wurzel = { name: '', werte: [], kinder: [] };
    const stapel = [wurzel];
    for (let zeile of text.split('\n')) {
      const strich = zeile.indexOf(';');
      if (strich >= 0) zeile = zeile.slice(0, strich);
      zeile = zeile.trim();
      if (!zeile) continue;
      if (zeile.charAt(0) === '}') { if (stapel.length > 1) stapel.pop(); continue; }
      const auf = zeile.charAt(zeile.length - 1) === '{';
      if (auf) zeile = zeile.slice(0, -1).trim();
      const jetzt = stapel[stapel.length - 1];
      const doppel = zeile.indexOf(':');
      if (doppel < 0) {
        // Lange Zahlenreihen stehen ueber mehrere Zeilen - die Fortsetzung
        // gehoert zum zuletzt angefangenen Knoten.
        const letzte = jetzt.kinder[jetzt.kinder.length - 1];
        if (letzte) for (const w of fbxWerteText(zeile)) letzte.werte.push(w);
        continue;
      }
      const knoten = { name: zeile.slice(0, doppel).trim(),
                       werte: fbxWerteText(zeile.slice(doppel + 1)), kinder: [] };
      jetzt.kinder.push(knoten);
      if (auf) stapel.push(knoten);
    }
    return wurzel;
  }

  function fbxWerteText(stueck) {
    const werte = [];
    const muster = /"([^"]*)"|(-?\d[\d.eE+-]*)/g;
    let t;
    while ((t = muster.exec(stueck))) {
      if (t[1] !== undefined) { werte.push(t[1]); continue; }
      const zahl = Number(t[2]);
      werte.push(Number.isNaN(zahl) ? t[2] : zahl);
    }
    return werte;
  }

  function fbxKind(knoten, name) {
    return knoten ? knoten.kinder.find(function (k) { return k.name === name; }) : null;
  }

  function fbxFeldVon(knoten) {
    if (!knoten) return null;
    for (const w of knoten.werte) {
      if (w && typeof w === 'object' && typeof w.length === 'number') return w;
    }
    const a = fbxKind(knoten, 'a');      // so steht ein Feld in der Textfassung
    return a ? a.werte : null;
  }

  function fbxEigenschaft(modell, wie, standard) {
    const p = fbxKind(modell, 'Properties70') || fbxKind(modell, 'Properties60');
    if (!p) return standard;
    for (const e of p.kinder) {
      if ((e.name !== 'P' && e.name !== 'Property') || e.werte[0] !== wie) continue;
      const zahlen = e.werte.filter(function (w) { return typeof w === 'number'; });
      if (zahlen.length >= 3) return zahlen.slice(-3);
    }
    return standard;
  }

  function matDrehZ(w) {
    const c = Math.cos(w), s = Math.sin(w), m = matEinheit();
    m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m;
  }
  function matSkalaXYZ(s) {
    const m = matEinheit(); m[0] = s[0]; m[5] = s[1]; m[10] = s[2]; return m;
  }
  // Eulerwinkel in Grad, Reihenfolge XYZ - zuerst um X, zuletzt um Z.
  function matDrehGrad(g) {
    const b = Math.PI / 180;
    return matMal(matDrehZ(g[2] * b), matMal(matDrehY(g[1] * b), matDrehX(g[0] * b)));
  }

  function fbxModellLage(modell) {
    const t = fbxEigenschaft(modell, 'Lcl Translation', [0, 0, 0]);
    const r = fbxEigenschaft(modell, 'Lcl Rotation', [0, 0, 0]);
    const s = fbxEigenschaft(modell, 'Lcl Scaling', [1, 1, 1]);
    const vor = fbxEigenschaft(modell, 'PreRotation', [0, 0, 0]);
    return matMal(matSchieben(t[0], t[1], t[2]),
                  matMal(matDrehGrad(vor), matMal(matDrehGrad(r), matSkalaXYZ(s))));
  }

  function fbxGeoLage(modell) {
    const t = fbxEigenschaft(modell, 'GeometricTranslation', [0, 0, 0]);
    const r = fbxEigenschaft(modell, 'GeometricRotation', [0, 0, 0]);
    const s = fbxEigenschaft(modell, 'GeometricScaling', [1, 1, 1]);
    return matMal(matSchieben(t[0], t[1], t[2]),
                  matMal(matDrehGrad(r), matSkalaXYZ(s)));
  }

  /* Von der Geometrie zum Modell, von dort nach oben: jede Lage multipliziert
     sich auf. Die Geometrie-Lage gilt nur am eigenen Modell, sie wird nicht
     vererbt. */
  function fbxLage(nummer, eltern, modelle) {
    let m = null;
    let id = eltern.get(nummer);
    let tiefe = 0;
    while (id !== undefined && tiefe++ < 64) {
      const modell = modelle.get(id);
      if (modell) {
        const lage = m === null ? matMal(fbxModellLage(modell), fbxGeoLage(modell))
                                : fbxModellLage(modell);
        m = m === null ? lage : matMal(lage, m);
      }
      id = eltern.get(id);
    }
    return m;
  }

  function punkteWandeln(punkte, m) {
    const raus = new Float32Array(punkte.length);
    for (let i = 0; i < punkte.length; i += 3) {
      const x = punkte[i], y = punkte[i + 1], z = punkte[i + 2];
      raus[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
      raus[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      raus[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
    return raus;
  }

  function fbxGeometrie(g) {
    const ecken = fbxFeldVon(fbxKind(g, 'Vertices'));
    const liste = fbxFeldVon(fbxKind(g, 'PolygonVertexIndex'));
    if (!ecken || !liste || !ecken.length) return null;
    const raus = [];
    let vieleck = [];
    for (let i = 0; i < liste.length; i++) {
      let n = liste[i];
      const schluss = n < 0;
      // Die letzte Ecke eines Vielecks steht negativ da - so merkt man, wo es
      // aufhoert.
      if (schluss) n = -n - 1;
      vieleck.push(n);
      if (!schluss) continue;
      for (let k = 1; k + 1 < vieleck.length; k++) {
        for (const e of [vieleck[0], vieleck[k], vieleck[k + 1]]) {
          raus.push(ecken[e * 3], ecken[e * 3 + 1], ecken[e * 3 + 2]);
        }
      }
      vieleck = [];
    }
    return new Float32Array(raus);
  }

  function fbxNetz(baum) {
    const objekte = fbxKind(baum, 'Objects');
    if (!objekte) return new Float32Array(0);

    const eltern = new Map();
    const verbindungen = fbxKind(baum, 'Connections');
    for (const c of (verbindungen ? verbindungen.kinder : [])) {
      if (c.name !== 'C' && c.name !== 'Connect') continue;
      if (c.werte[0] !== 'OO') continue;      // nur Objekt an Objekt
      eltern.set(Number(c.werte[1]), Number(c.werte[2]));
    }
    const modelle = new Map();
    for (const k of objekte.kinder) {
      if (k.name === 'Model') modelle.set(Number(k.werte[0]), k);
    }

    const stuecke = [];
    let laenge = 0;
    for (const g of objekte.kinder) {
      if (g.name !== 'Geometry') continue;
      let punkte = fbxGeometrie(g);
      if (!punkte || !punkte.length) continue;
      const lage = fbxLage(Number(g.werte[0]), eltern, modelle);
      if (lage) punkte = punkteWandeln(punkte, lage);
      stuecke.push(punkte);
      laenge += punkte.length;
    }
    if (stuecke.length === 1) return stuecke[0];
    const alles = new Float32Array(laenge);
    let p = 0;
    for (const s of stuecke) { alles.set(s, p); p += s.length; }
    return alles;
  }

  /* Normalen je Dreieck aus den Ecken, dazu Mitte und Groesse. Flach
     schattiert: jede Ecke bekommt die Normale ihres Dreiecks, damit Kanten
     Kanten bleiben - bei einem gedruckten Teil will man sie sehen. */
  function netzBauen(punkte) {
    const dreiecke = Math.floor(punkte.length / 9);
    const normalen = new Float32Array(dreiecke * 9);
    let xa = Infinity, ya = Infinity, za = Infinity;
    let xb = -Infinity, yb = -Infinity, zb = -Infinity;
    for (let d = 0; d < dreiecke; d++) {
      const i = d * 9;
      const ux = punkte[i + 3] - punkte[i], uy = punkte[i + 4] - punkte[i + 1],
            uz = punkte[i + 5] - punkte[i + 2];
      const vx = punkte[i + 6] - punkte[i], vy = punkte[i + 7] - punkte[i + 1],
            vz = punkte[i + 8] - punkte[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (let k = 0; k < 3; k++) {
        normalen[i + k * 3] = nx; normalen[i + k * 3 + 1] = ny; normalen[i + k * 3 + 2] = nz;
        const x = punkte[i + k * 3], y = punkte[i + k * 3 + 1], z = punkte[i + k * 3 + 2];
        if (x < xa) xa = x; if (x > xb) xb = x;
        if (y < ya) ya = y; if (y > yb) yb = y;
        if (z < za) za = z; if (z > zb) zb = z;
      }
    }
    if (!dreiecke) return { punkte, normalen, dreiecke: 0, mitte: [0, 0, 0], radius: 1 };
    const mitte = [(xa + xb) / 2, (ya + yb) / 2, (za + zb) / 2];
    // Der Radius der Kugel um das Teil, nicht die laengste Kante: sonst haengt
    // beim Drehen eine Ecke aus dem Bild.
    const kugel = Math.sqrt((xb - xa) * (xb - xa) + (yb - ya) * (yb - ya)
                            + (zb - za) * (zb - za)) / 2;
    return { punkte, normalen, dreiecke, mitte, radius: Math.max(kugel, 1e-6) };
  }

  /* --- Matrizen (spaltenweise, so wie WebGL sie will) --------------------- */

  function matEinheit() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }
  function matMal(a, b) {
    const m = new Float32Array(16);
    for (let s = 0; s < 4; s++) {
      for (let z = 0; z < 4; z++) {
        let w = 0;
        for (let i = 0; i < 4; i++) w += a[i * 4 + z] * b[s * 4 + i];
        m[s * 4 + z] = w;
      }
    }
    return m;
  }
  function matPerspektive(winkel, seite, nah, fern) {
    const f = 1 / Math.tan(winkel / 2);
    const m = new Float32Array(16);
    m[0] = f / seite; m[5] = f;
    m[10] = (fern + nah) / (nah - fern); m[11] = -1;
    m[14] = (2 * fern * nah) / (nah - fern);
    return m;
  }
  function matSchieben(x, y, z) {
    const m = matEinheit(); m[12] = x; m[13] = y; m[14] = z; return m;
  }
  function matSkala(s) {
    const m = matEinheit(); m[0] = s; m[5] = s; m[10] = s; return m;
  }
  function matDrehX(w) {
    const c = Math.cos(w), s = Math.sin(w), m = matEinheit();
    m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m;
  }
  function matDrehY(w) {
    const c = Math.cos(w), s = Math.sin(w), m = matEinheit();
    m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m;
  }
  // Der 3x3-Teil fuer die Normalen. Drehen allein veraendert ihre Richtung
  // nicht ungleichmaessig, also reicht die Drehung selbst.
  function mat3Von(m) {
    return new Float32Array([m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]);
  }

  /* --- Zeichnen ----------------------------------------------------------- */

  const MODELL_ECKPUNKT = [
    'attribute vec3 aOrt;',
    'attribute vec3 aNorm;',
    'uniform mat4 uMvp;',
    'uniform mat3 uDreh;',
    'varying vec3 vNorm;',
    'void main() {',
    '  vNorm = uDreh * aNorm;',
    '  gl_Position = uMvp * vec4(aOrt, 1.0);',
    '}',
  ].join('\n');

  const MODELL_FLAECHE = [
    'precision mediump float;',
    'varying vec3 vNorm;',
    'void main() {',
    // Viele STL-Dateien haben Dreiecke verkehrt herum. Statt sie zu
    // reparieren, wird die Normale zum Betrachter gedreht - dann sieht die
    // Flaeche von beiden Seiten richtig aus.
    '  vec3 n = normalize(vNorm);',
    '  if (!gl_FrontFacing) n = -n;',
    '  vec3 licht = normalize(vec3(0.35, 0.75, 0.55));',
    '  float hell = 0.30 + 0.70 * max(dot(n, licht), 0.0);',
    '  float kante = 0.10 * pow(1.0 - abs(n.z), 3.0);',
    '  gl_FragColor = vec4(vec3(0.63, 0.64, 0.70) * hell + kante, 1.0);',
    '}',
  ].join('\n');

  function glBauen(bild) {
    // alpha: die Flaeche bleibt hinter dem Modell durchsichtig, damit der
    // Kasten seine eigene Farbe behaelt - hell wie dunkel, ohne dass hier
    // eine Farbe nachgebaut wird.
    const gl = bild.getContext('webgl', { alpha: true, antialias: true,
                                          premultipliedAlpha: true });
    if (!gl) return null;
    const bauen = (art, quelle) => {
      const t = gl.createShader(art);
      gl.shaderSource(t, quelle);
      gl.compileShader(t);
      if (!gl.getShaderParameter(t, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(t) || 'Shader ging nicht');
      }
      return t;
    };
    const programm = gl.createProgram();
    gl.attachShader(programm, bauen(gl.VERTEX_SHADER, MODELL_ECKPUNKT));
    gl.attachShader(programm, bauen(gl.FRAGMENT_SHADER, MODELL_FLAECHE));
    gl.linkProgram(programm);
    if (!gl.getProgramParameter(programm, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(programm) || 'Programm ging nicht');
    }
    gl.useProgram(programm);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    return {
      gl,
      ort: gl.getAttribLocation(programm, 'aOrt'),
      norm: gl.getAttribLocation(programm, 'aNorm'),
      mvp: gl.getUniformLocation(programm, 'uMvp'),
      dreh: gl.getUniformLocation(programm, 'uDreh'),
    };
  }

  function netzHochladen(z) {
    const gl = z.glz.gl;
    z.pufferOrt = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, z.pufferOrt);
    gl.bufferData(gl.ARRAY_BUFFER, z.netz.punkte, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(z.glz.ort);
    gl.vertexAttribPointer(z.glz.ort, 3, gl.FLOAT, false, 0, 0);

    z.pufferNorm = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, z.pufferNorm);
    gl.bufferData(gl.ARRAY_BUFFER, z.netz.normalen, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(z.glz.norm);
    gl.vertexAttribPointer(z.glz.norm, 3, gl.FLOAT, false, 0, 0);
  }

  function modellZeichnen(z) {
    if (!z.glz || !z.netz) return;
    const gl = z.glz.gl;
    const breit = Math.max(1, Math.round(z.bild.clientWidth * (window.devicePixelRatio || 1)));
    const hoch = Math.max(1, Math.round(z.bild.clientHeight * (window.devicePixelRatio || 1)));
    if (z.bild.width !== breit || z.bild.height !== hoch) {
      z.bild.width = breit; z.bild.height = hoch;
    }
    gl.viewport(0, 0, breit, hoch);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Der Drehpunkt sitzt normalerweise in der Mitte des Teils. Mit
    // Umschalt-Ziehen wandert er - und weil er vor der Drehung abgezogen
    // wird, dreht sich danach wirklich um den neuen Punkt.
    const grund = matMal(matSchieben(-z.punkt[0], -z.punkt[1], -z.punkt[2]),
                  matMal(matSkala(1 / z.netz.radius),
                         matSchieben(-z.netz.mitte[0], -z.netz.mitte[1], -z.netz.mitte[2])));
    const dreh = matMal(matDrehX(z.hoehe), matDrehY(z.seite));
    const sicht = matSchieben(0, 0, -z.weg);
    const ferne = matPerspektive(MODELL_WINKEL, breit / hoch, 0.05, 100);
    gl.uniformMatrix4fv(z.glz.mvp, false,
                        matMal(ferne, matMal(sicht, matMal(dreh, grund))));
    gl.uniformMatrix3fv(z.glz.dreh, false, mat3Von(dreh));
    gl.drawArrays(gl.TRIANGLES, 0, z.netz.dreiecke * 3);
  }

  /* Umschalt-Ziehen schiebt den Drehpunkt, nicht nur das Bild: sonst sieht
     man das Teil zwar von der Seite, dreht aber weiter um seine alte Mitte
     und kommt an eine Ecke nie heran.

     Gerechnet wird in Bildpunkten: wie weit ist bei diesem Abstand eine
     Bildschirmhoehe? So viel wandert das Teil, wenn man ueber die ganze
     Flaeche zieht. Die Verschiebung steht in der Sicht, der Drehpunkt im
     Modell - dazwischen liegt die Drehung, also wird sie zurueckgerechnet
     (bei einer Drehung heisst umgekehrt: vertauscht). */
  function punktSchieben(z, dx, dy, hoehePx) {
    const sichtbar = 2 * Math.tan(MODELL_WINKEL / 2) * z.weg;
    const vx = (dx / hoehePx) * sichtbar;
    const vy = -(dy / hoehePx) * sichtbar;
    const m = matMal(matDrehX(z.hoehe), matDrehY(z.seite));
    z.punkt = [z.punkt[0] - (m[0] * vx + m[1] * vy),
               z.punkt[1] - (m[4] * vx + m[5] * vy),
               z.punkt[2] - (m[8] * vx + m[9] * vy)];
    // Nicht beliebig weit: sonst ist das Teil aus dem Bild geschoben und man
    // findet es ohne Doppelklick nicht wieder.
    const weit = Math.sqrt(z.punkt[0] * z.punkt[0] + z.punkt[1] * z.punkt[1]
                           + z.punkt[2] * z.punkt[2]);
    if (weit > MODELL_SCHIEB_MAX) {
      const f = MODELL_SCHIEB_MAX / weit;
      z.punkt = [z.punkt[0] * f, z.punkt[1] * f, z.punkt[2] * f];
    }
  }

  /* --- Am Leben halten ---------------------------------------------------- */

  function modellEinfrieren(z) {
    if (!z.glz) return;
    // Erst zeichnen, dann abfotografieren: ohne preserveDrawingBuffer ist das
    // Bild sonst leer.
    modellZeichnen(z);
    let standbild = null;
    try { standbild = z.bild.toDataURL('image/png'); } catch (f) { /* dann eben nicht */ }
    const verlust = z.glz.gl.getExtension('WEBGL_lose_context');
    if (verlust) verlust.loseContext();
    z.glz = null; z.pufferOrt = null; z.pufferNorm = null;
    const i = MODELL_LEBENDIG.indexOf(z);
    if (i >= 0) MODELL_LEBENDIG.splice(i, 1);
    // Auch wenn kein Standbild herauskam, muss hier etwas Anklickbares
    // stehen. Vorher blieb in dem Fall die Flaeche mit verlorenem Zeichner
    // liegen: ein schwarzes Feld, das sich nicht mehr dreht und aus dem es
    // keinen Weg zurueck gab.
    const ruhig = standbild
      ? el('img', { className: 'standbild', src: standbild, alt: z.datei,
                    title: 'Angehalten - zum Drehen anklicken' })
      : el('div', { className: 'standbild leerbild',
                    textContent: 'Angehalten - zum Drehen anklicken',
                    title: 'Angehalten - zum Drehen anklicken' });
    z.bild.replaceWith(ruhig);
    z.bild = ruhig;
    ruhig.addEventListener('click', function () { modellWecken(z); });
  }

  function platzSchaffen(ausser) {
    // Vorher, nicht hinterher: ein Browser gibt nur eine Handvoll 3D-Flaechen
    // je Seite her. Wer erst aufmacht und dann aufraeumt, bekommt beim einen
    // zu viel gar keine mehr - und dann war das Modell endgueltig weg, obwohl
    // es eben noch lief.
    while (MODELL_LEBENDIG.length >= MODELL_MAX_LEBENDIG) {
      const alt = MODELL_LEBENDIG.find(function (z) { return z !== ausser; });
      if (!alt) return;
      modellEinfrieren(alt);
    }
  }

  function modellWecken(z) {
    if (z.glz || !z.netz) return;
    platzSchaffen(z);
    const bild = el('canvas', {});
    z.bild.replaceWith(bild);
    z.bild = bild;
    let klage = '';
    try {
      z.glz = glBauen(bild);
    } catch (f) {
      z.glz = null;
      klage = f.message;
    }
    if (!z.glz) {
      kachelBehalten(z, klage ? 'Die 3D-Fläche ging nicht auf: ' + klage
                              : 'Dieser Browser zeichnet kein 3D (WebGL fehlt oder ist aus).');
      return;
    }
    netzHochladen(z);
    drehenAnbieten(z);
    MODELL_LEBENDIG.push(z);
    modellZeichnen(z);
  }

  /* --- Bedienung ---------------------------------------------------------- */

  function drehenAnbieten(z) {
    const bild = z.bild;
    bild.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      // Sonst faengt die Flaeche darunter an, einen Rahmen zu ziehen, und der
      // Kasten wandert.
      ev.stopPropagation();
      ev.preventDefault();
      bild.setPointerCapture(ev.pointerId);
      // Umschalt entscheidet beim Anfassen, nicht waehrenddessen: sonst
      // springt die Bewegung, wenn man die Taste mitten im Ziehen loslaesst.
      const schieben = ev.shiftKey;
      z.wo.classList.add(schieben ? 'schiebt' : 'dreht');
      let x = ev.clientX, y = ev.clientY;
      const bewegen = function (e2) {
        if (schieben) {
          punktSchieben(z, e2.clientX - x, e2.clientY - y, z.bild.clientHeight || 1);
        } else {
          z.seite += (e2.clientX - x) * 0.01;
          z.hoehe += (e2.clientY - y) * 0.01;
          // Nicht ueber den Kopf: sonst steht das Teil kopf und man findet
          // nicht zurueck.
          z.hoehe = Math.max(-1.5, Math.min(1.5, z.hoehe));
        }
        x = e2.clientX; y = e2.clientY;
        modellZeichnen(z);
      };
      const los = function () {
        bild.removeEventListener('pointermove', bewegen);
        bild.removeEventListener('pointerup', los);
        bild.removeEventListener('pointercancel', los);
        z.wo.classList.remove('dreht');
        z.wo.classList.remove('schiebt');
      };
      bild.addEventListener('pointermove', bewegen);
      bild.addEventListener('pointerup', los);
      bild.addEventListener('pointercancel', los);
    });
    bild.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();          // nicht die ganze Seite zoomen
      z.weg = Math.max(1.3, Math.min(14, z.weg * (ev.deltaY > 0 ? 1.12 : 0.89)));
      modellZeichnen(z);
    }, { passive: false });
    bild.addEventListener('dblclick', function (ev) {
      ev.stopPropagation();
      z.seite = 0.6; z.hoehe = -0.5; z.weg = MODELL_WEG; z.punkt = [0, 0, 0];
      modellZeichnen(z);
    });
  }

  /* --- Aufbau ------------------------------------------------------------- */

  function kachelBehalten(z, warum) {
    // Die Kachel tut weiter, was sie immer getan hat - herunterladen. Der
    // Grund steht aber sichtbar darunter und nicht nur im Tooltip: sonst
    // steht da eine Kachel wie frueher und niemand weiss, warum kein Modell
    // kommt. In der Notiz gespeichert wird davon nichts.
    if (z.wo && z.wo.parentElement) z.wo.remove();
    z.kasten.classList.remove('kasten-3d');
    z.kasten.classList.remove('kasten-pcb');
    const zaehler = z.kasten.querySelector('.dzahl');
    if (zaehler) zaehler.remove();
    if (!warum) return;
    z.kasten.title = warum;
    const alt = z.kasten.querySelector('.modellfehler');
    if (alt) alt.remove();
    z.kasten.append(el('p', { className: 'modellfehler', textContent: warum }));
    console.error('[notizmappe] 3D: ' + warum);
  }

  async function modellStarten(z) {
    if (z.laeuft) return;
    z.laeuft = true;
    let puffer;
    try {
      puffer = await modellHolen(z.datei);
    } catch (f) {
      kachelBehalten(z, 'Modell ließ sich nicht holen: ' + f.message);
      return;
    }
    let punkte;
    try {
      punkte = z.art === 'fbx' ? await fbxLesen(puffer)
             : z.art === 'obj' ? objLesen(puffer) : stlLesen(puffer);
    } catch (f) {
      kachelBehalten(z, 'Modell ließ sich nicht lesen: ' + f.message
                        + ' (' + kopfschau(puffer) + ')');
      return;
    }
    if (!punkte.length) {
      kachelBehalten(z, 'Keine Dreiecke gefunden (' + kopfschau(puffer) + ')');
      return;
    }
    if (punkte.length / 9 > MODELL_MAX_DREIECKE) {
      kachelBehalten(z, 'Zu groß zum Anzeigen: '
                        + Math.round(punkte.length / 9).toLocaleString('de-DE')
                        + ' Dreiecke.');
      return;
    }
    z.netz = netzBauen(punkte);
    const zaehler = z.kasten.querySelector('.dzahl');
    if (zaehler) {
      zaehler.textContent = z.netz.dreiecke.toLocaleString('de-DE') + ' Dreiecke';
    }
    modellWecken(z);
  }

  function modellKasten(kasten) {
    if (kasten.dataset.modell || !offen) return;
    const eintrag = (elemente || []).find(function (x) { return x.id === kasten.dataset.id; });
    const datei = eintrag ? eintrag.datei : '';
    const art = modellArt(datei);
    if (!art) {
      // Ein ZIP kann ein Gerber-Paket sein - das sagt erst sein Inhalt.
      if (/\.zip$/i.test(datei || '')) platineKasten(kasten, datei);
      else kasten.dataset.modell = 'nein';
      return;
    }
    if (!window.WebGLRenderingContext) { kasten.dataset.modell = 'nein'; return; }
    kasten.dataset.modell = 'ja';
    kasten.classList.add('kasten-3d');

    const bild = el('canvas', {});
    const lade = el('p', { className: 'lade', textContent: 'Modell wird geladen …' });
    const wo = el('div', { className: 'modell' }, [bild, lade]);
    // Vor die Kachel: die bleibt als Fusszeile stehen und kann weiter
    // herunterladen.
    const kachel = kasten.querySelector('.datei');
    if (kachel) {
      kachel.before(wo);
      kachel.append(el('span', { className: 'dzahl', textContent: '…' }));
    } else {
      kasten.append(wo);
    }

    const z = { kasten, wo, bild, datei, art, netz: null, glz: null,
                seite: 0.6, hoehe: -0.5, weg: MODELL_WEG, punkt: [0, 0, 0],
                laeuft: false };

    // Erst laden, wenn das Modell ins Bild rollt: zehn Anhaenge auf einer
    // Seite waeren sonst zehn Dateien auf einmal.
    const sehen = new IntersectionObserver(function (treffer) {
      for (const t of treffer) {
        if (!t.isIntersecting) continue;
        sehen.disconnect();
        modellStarten(z).then(function () { lade.remove(); },
                              function () { lade.remove(); });
      }
    }, { rootMargin: '200px' });
    sehen.observe(wo);

    if (window.ResizeObserver) {
      new ResizeObserver(function () { modellZeichnen(z); }).observe(wo);
    }
  }

  function modelleNachsehen() {
    for (const k of document.querySelectorAll('.kasten-datei:not([data-modell])')) {
      try { modellKasten(k); } catch (f) { console.error('[notizmappe] 3D:', f); }
    }
  }

  function modelleBauen() {
    if (!window.IntersectionObserver) return;
    const stil = document.createElement('style');
    stil.textContent = `
      .kasten-3d .modell {
        position: relative; width: 100%; aspect-ratio: 4 / 3;
        background: var(--flaeche); border: 1px solid var(--kasten-rand);
        border-radius: 6px; overflow: hidden;
      }
      .kasten-3d .modell canvas, .kasten-3d .modell .standbild {
        position: absolute; inset: 0; width: 100%; height: 100%;
        display: block; touch-action: none; cursor: grab;
      }
      .kasten-3d .modell.dreht canvas { cursor: grabbing; }
      .kasten-3d .modell.schiebt canvas { cursor: move; }
      .kasten-3d .modell .leerbild {
        display: flex; align-items: center; justify-content: center;
        text-align: center; color: var(--matt); font-size: 12px; padding: 8px;
      }
      .kasten-3d .modell .lade {
        position: absolute; inset: 0; margin: 0; display: flex;
        align-items: center; justify-content: center;
        color: var(--matt); font-size: 12px; pointer-events: none;
      }
      .kasten-3d .datei { margin-top: 6px; }
      .kasten-3d .datei .zeichen { display: none; }
      .kasten-3d .dzahl { color: var(--matt); font-size: 11px; white-space: nowrap; }
      .kasten-pcb .modell {
        /* Ohne position: relative haengt die Zeichenflaeche am Kasten statt am
           Fenster - und wird ueber dessen ganze Breite gezerrt. */
        position: relative; overflow: hidden;
        aspect-ratio: 4 / 3; background: #101214; border-radius: 4px;
        margin: 0 auto; max-width: 100%;
      }
      .kasten-pcb .modell canvas {
        position: absolute; inset: 0; width: 100%; height: 100%;
        display: block; touch-action: none; cursor: grab;
      }
      .kasten-pcb .pcbseite {
        position: absolute; right: 5px; top: 5px; z-index: 2;
        padding: 2px 7px; border: 1px solid rgba(232,234,236,.25); border-radius: 4px;
        background: rgba(16,18,20,.55); color: #e8eaec; font: inherit;
        font-size: 11px; cursor: pointer; opacity: .35; transition: opacity .12s;
      }
      .kasten-pcb:hover .pcbseite, .kasten-pcb .pcbseite:focus { opacity: 1; }
      /* Unter einer Platine steht kein Kaestchen mit Rahmen, sondern eine
         ruhige Zeile - sonst wiegt die Beschriftung mehr als das Bild. */
      .kasten-pcb .datei {
        margin-top: 5px; padding: 0; border: 0; background: transparent;
        justify-content: center; gap: 5px; font-size: 11px; color: var(--matt);
      }
      .kasten-pcb .datei:hover { border-color: transparent; }
      .kasten-pcb .datei:hover .dname { text-decoration: underline; }
      .kasten-pcb .datei .zeichen { display: none; }
      .kasten-pcb .datei .dname {
        flex: 0 1 auto; min-width: 0; color: var(--matt);
      }
      .kasten-pcb .datei .dgroesse { font-size: 11px; }
      .kasten-pcb .datei .dzahl { white-space: nowrap; }
      .kasten-pcb .datei .dgroesse::before, .kasten-pcb .datei .dzahl::before {
        content: "· ";
      }
      .kasten .modellfehler {
        margin: 4px 0 0; color: var(--warnung); font-size: 11px; line-height: 1.4;
      }
    `;
    document.head.append(stil);
    modelleNachsehen();
    // Die Kaesten entstehen erst, wenn eine Seite geladen ist - und bei jedem
    // Seitenwechsel neu.
    // Nur die Kaesten selbst, ohne subtree: die haengen direkt an der
    // Flaeche. Mit subtree liefe das bei jedem Tastendruck in einem Textkasten
    // mit - contenteditable aendert dabei staendig Knoten.
    const beobachter = new MutationObserver(modelleNachsehen);
    beobachter.observe(flaeche || document.body, { childList: true });
  }

  // Beim Öffnen der Einstellungen neu laden - Rollen können sich geändert haben.
  window.addEventListener('DOMContentLoaded', function () {
    // Jeder Schritt fuer sich. Vorher lief das als eine Kette: ein Fehler im
    // ersten liess alle folgenden ausfallen - lautlos, und der letzte war
    // ausgerechnet der Speicher-Reiter. Jetzt faellt hoechstens einer aus, und
    // man sieht welcher.
    for (const [name, tun] of [['Einstellungen', einstellungenAnpassen],
                               ['Verwaltung', abschnittBauen],
                               ['Bereichswahl', bereichBauen],
                               ['Profil', profilBauen],
                               ['Mein Profil', profilBearbeitenBauen],
                               ['Aussehen', themaLaden],
                               ['Ablage', ablageBauen],
                               ['Striche markieren', strichMarkierenBauen],
                               ['Mailversand', postBauen],
                               ['Update-Hinweis', updateHinweisBauen],
                               ['Optionen-Reiter', optionenReiterBauen],
                               ['3D-Anhänge', modelleBauen],
                               ['Formatleiste', formatleistenBauen],
                               ['Rechtsklick', rechtsmenueBauen],
                               ['Bereiche laden', bereicheLaden],
                               ['Verwaltung laden', verwaltungLaden]]) {
      try {
        tun();
      } catch (f) {
        console.error('[notizmappe] ' + name + ' ließ sich nicht aufbauen:', f);
      }
    }
    const zahnrad = document.getElementById('zahnrad');
    if (zahnrad) zahnrad.addEventListener('click', function () { setTimeout(verwaltungLaden, 50); });
  });

  window.pywebview = { api: stellvertreter, platform: 'server' };
  // mappe.js sieht zuerst selbst nach und hört zusätzlich auf dieses Ereignis.
  window.addEventListener('DOMContentLoaded', function () {
    window.dispatchEvent(new Event('pywebviewready'));
  });
})();
