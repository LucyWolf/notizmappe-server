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
    let band = null;
    let bandkasten = null;

    document.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0 || ev.pointerType !== 'mouse') return;
      if (!malZeichnung() || !malWahl()) return;
      if (ev.target && ev.target.closest
          && ev.target.closest('#malblatt, .text, input, select, textarea, button, '
                               + '#band, #dateischirm, #malrahmen, #minileiste, #rechtsmenue')) {
        return;
      }
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
    kasten.addEventListener('pointerup', function () {
      if (!zieht && !zerrt) return;
      zieht = null;
      zerrt = null;
      letzteStelle = null;
      gemerkt();
    });

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

  const MODELL_ARTEN = ['stl', 'obj'];
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

  function modellArt(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name || '');
    const art = m ? m[1].toLowerCase() : '';
    return MODELL_ARTEN.indexOf(art) >= 0 ? art : null;
  }

  /* --- Einlesen ----------------------------------------------------------- */

  function stlLesen(puffer) {
    /* Binaer oder Text? Die Laenge entscheidet und nicht das Wort "solid" am
       Anfang: binaere Dateien aus manchen Programmen fangen auch damit an. */
    if (puffer.byteLength >= 84) {
      const sicht = new DataView(puffer);
      const zahl = sicht.getUint32(80, true);
      if (84 + zahl * 50 === puffer.byteLength) return stlBinaer(sicht, zahl);
    }
    return stlText(new TextDecoder().decode(puffer));
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

    const grund = matMal(matSkala(1 / z.netz.radius),
                         matSchieben(-z.netz.mitte[0], -z.netz.mitte[1], -z.netz.mitte[2]));
    const dreh = matMal(matDrehX(z.hoehe), matDrehY(z.seite));
    const sicht = matSchieben(0, 0, -z.weg);
    const ferne = matPerspektive(0.6, breit / hoch, 0.05, 100);
    gl.uniformMatrix4fv(z.glz.mvp, false,
                        matMal(ferne, matMal(sicht, matMal(dreh, grund))));
    gl.uniformMatrix3fv(z.glz.dreh, false, mat3Von(dreh));
    gl.drawArrays(gl.TRIANGLES, 0, z.netz.dreiecke * 3);
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
    if (standbild) {
      const ruhig = el('img', { className: 'standbild', src: standbild, alt: z.datei,
                                title: 'Angehalten - zum Drehen anklicken' });
      z.bild.replaceWith(ruhig);
      z.bild = ruhig;
      ruhig.addEventListener('click', function () { modellWecken(z); });
    }
  }

  function platzSchaffen(ausser) {
    while (MODELL_LEBENDIG.length > MODELL_MAX_LEBENDIG) {
      const alt = MODELL_LEBENDIG.find(function (z) { return z !== ausser; });
      if (!alt) return;
      modellEinfrieren(alt);
    }
  }

  function modellWecken(z) {
    if (z.glz || !z.netz) return;
    const bild = el('canvas', {});
    z.bild.replaceWith(bild);
    z.bild = bild;
    try {
      z.glz = glBauen(bild);
    } catch (f) {
      z.glz = null;
    }
    if (!z.glz) { kachelBehalten(z, 'Dieser Browser zeichnet kein 3D.'); return; }
    netzHochladen(z);
    drehenAnbieten(z);
    MODELL_LEBENDIG.push(z);
    platzSchaffen(z);
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
      z.wo.classList.add('dreht');
      let x = ev.clientX, y = ev.clientY;
      const bewegen = function (e2) {
        z.seite += (e2.clientX - x) * 0.01;
        z.hoehe += (e2.clientY - y) * 0.01;
        // Nicht ueber den Kopf: sonst steht das Teil kopf und man findet nicht
        // zurueck.
        z.hoehe = Math.max(-1.5, Math.min(1.5, z.hoehe));
        x = e2.clientX; y = e2.clientY;
        modellZeichnen(z);
      };
      const los = function () {
        bild.removeEventListener('pointermove', bewegen);
        bild.removeEventListener('pointerup', los);
        bild.removeEventListener('pointercancel', los);
        z.wo.classList.remove('dreht');
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
      z.seite = 0.6; z.hoehe = -0.5; z.weg = MODELL_WEG;
      modellZeichnen(z);
    });
  }

  /* --- Aufbau ------------------------------------------------------------- */

  function kachelBehalten(z, warum) {
    // Keine Meldung in die Notiz schreiben, die nur sagt, dass etwas nicht
    // geht: die Kachel tut, was sie immer getan hat, und der Grund steht im
    // Tooltip.
    if (z.wo && z.wo.parentElement) z.wo.remove();
    z.kasten.classList.remove('kasten-3d');
    if (warum) z.kasten.title = warum;
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
      punkte = z.art === 'obj' ? objLesen(puffer) : stlLesen(puffer);
    } catch (f) {
      kachelBehalten(z, 'Modell ließ sich nicht lesen: ' + f.message);
      return;
    }
    if (!punkte.length || punkte.length / 9 > MODELL_MAX_DREIECKE) {
      kachelBehalten(z, punkte.length ? 'Modell ist zu groß zum Anzeigen.'
                                      : 'In der Datei stehen keine Dreiecke.');
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
    if (!art) { kasten.dataset.modell = 'nein'; return; }
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
                seite: 0.6, hoehe: -0.5, weg: MODELL_WEG, laeuft: false };

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
    if (!window.WebGLRenderingContext || !window.IntersectionObserver) return;
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
      .kasten-3d .modell .lade {
        position: absolute; inset: 0; margin: 0; display: flex;
        align-items: center; justify-content: center;
        color: var(--matt); font-size: 12px; pointer-events: none;
      }
      .kasten-3d .datei { margin-top: 6px; }
      .kasten-3d .datei .zeichen { display: none; }
      .kasten-3d .dzahl { color: var(--matt); font-size: 11px; white-space: nowrap; }
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
