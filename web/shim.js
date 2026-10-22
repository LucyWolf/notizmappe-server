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

  function kontoseite() {
    return document.querySelector('.dateiseite[data-punkt="konto"]');
  }

  function einstellungenAnpassen() {
    // "Konto" ist am Server die Benutzerseite. Was dort für den eigenen
    // Rechner steht - "Verbindung einrichten", "hier gibt es kein Konto" -
    // ist hier sinnlos; es verschwindet, bleibt aber im Gerüst stehen, damit
    // die gemeinsame Oberfläche weiter darauf zeigen darf.
    const konto = kontoseite();
    // Die Sperre gegen ein zweites Durchlaufen hing vorher an einem Abschnitt
    // "Angemeldet", der hier stand. Der ist weg - wer angemeldet ist und was
    // er darf, steht unten im Profil, und zweimal braucht das niemand. Also
    // eine eigene Marke, statt die Sperre an etwas Sichtbares zu haengen.
    if (!konto || konto.dataset.angepasst === 'ja') return;
    konto.dataset.angepasst = 'ja';
    for (const kind of Array.from(konto.children)) {
      if (kind.tagName !== 'H2') kind.hidden = true;
    }

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
        hinweis.textContent = 'wird geholt und geprüft … das dauert einen Moment.';
        try {
          const d = await hol('/aktualisieren', {});
          hinweis.textContent = d.hinweis || '';
          if (d.getan) warten(d.fassung);
          else jetzt.disabled = false;
        } catch (f) {
          hinweis.textContent = f.message;
          jetzt.disabled = false;
        }
      });

      // Nach dem Neustart ist der Server ein paar Sekunden weg.
      //
      // Hier auf "antwortet wieder" zu warten, waere falsch - und zwar auf eine
      // Art, die wie ein fehlgeschlagenes Update aussieht: der alte Prozess
      // lebt noch gut eine Sekunde weiter und antwortet brav. Die Seite laedt
      // dann neu, waehrend noch die alte Fassung laeuft, und man sieht
      // unveraendert die alte Nummer.
      //
      // Deshalb wird auf die FASSUNG gewartet, nicht auf ein Lebenszeichen.
      function warten(fassung) {
        const hinweis = document.getElementById('e-updatehinweis');
        let versuche = 0;
        hinweis.textContent = `Fassung ${fassung} liegt bereit, der Server startet neu …`;
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
            hinweis.textContent = 'Der Server ist nicht mit der neuen Fassung '
              + 'zurückgekommen. Im Protokoll nachsehen: '
              + 'docker compose logs --tail 40 notizmappe';
          }
        }, 1500);
      }

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
    kontrast: {
      name: 'Starker Kontrast',
      farben: {
        '--papier': '#000000', '--linie': '#6f6f6f', '--schrift': '#ffffff',
        '--matt': '#cfcfcf', '--leiste': '#000000', '--flaeche': '#161616',
        '--akzent': '#ffd400', '--warnung': '#ff6a5a', '--kasten-rand': '#8a8a8a',
      },
    },
  };

  function themaAnwenden(welches) {
    const wurzel = document.documentElement;
    const design = DESIGNS[welches] || DESIGNS.system;
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
    if (d.thema) themaAnwenden(d.thema);
    const wahl = document.getElementById('p-thema');
    if (wahl) wahl.value = d.thema;
  }

  function profilseite() {
    const vorhanden = document.querySelector('.dateiseite[data-punkt="profil"]');
    if (vorhanden) return vorhanden;
    const leiste = document.getElementById('dateileiste');
    const konto = kontoseite();
    if (!leiste || !konto) return null;

    const reiter = el('button', { type: 'button', className: 'dateipunkt',
                                  textContent: 'Mein Profil' });
    reiter.dataset.punkt = 'profil';
    leiste.insertBefore(reiter, leiste.querySelector('.dateipunkt[data-punkt="konto"]'));

    const seite = el('section', { className: 'dateiseite', hidden: true }, [
      el('h2', { textContent: 'Mein Profil' }),
    ]);
    seite.dataset.punkt = 'profil';
    konto.parentElement.insertBefore(seite, konto);
    return seite;
  }

  /* -------------------------------------------------------------- Mein Profil

     Getrennt von der Verwaltung, weil es zwei verschiedene Dinge sind: dort
     geht es um andere Leute, hier um einen selbst. Wer kein Verwalter ist,
     hatte bisher ueberhaupt keine Stelle, an der er sein eigenes Passwort
     aendern konnte. */

  function profilBearbeitenBauen() {
    const seite = profilseite();
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

    const abmelden = el('button', { type: 'button', textContent: 'Abmelden' });
    abmelden.addEventListener('click', function () { location.href = '/abmelden'; });

    const thema = el('select', { id: 'p-thema' });
    for (const [wert, d] of Object.entries(DESIGNS)) {
      thema.append(el('option', { value: wert, textContent: d.name }));
    }
    thema.addEventListener('change', async () => {
      themaAnwenden(thema.value);          // sofort sichtbar, nicht erst nach der Antwort
      try { await hol('/aussehen', { thema: thema.value }); } catch (f) {
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
    profilDatenLaden();
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
    themaLaden();
  }

  function speicherseite() {
    /* Einen eigenen Reiter in der Datei-Ebene anlegen. Die Umschaltung drueben
       arbeitet ueber die Klassen und data-punkt, nicht ueber eine feste Liste -
       ein zusaetzlicher Reiter fuegt sich damit von allein ein. */
    const vorhanden = document.querySelector('.dateiseite[data-punkt="speicher"]');
    if (vorhanden) return vorhanden;
    const leiste = document.getElementById('dateileiste');
    const konto = kontoseite();
    if (!leiste || !konto) return null;

    const reiter = el('button', { type: 'button', className: 'dateipunkt',
                                  textContent: 'Speicher' });
    reiter.dataset.punkt = 'speicher';
    const optionen = leiste.querySelector('.dateipunkt[data-punkt="optionen"]');
    leiste.insertBefore(reiter, optionen || null);

    const seite = el('section', { className: 'dateiseite', hidden: true }, [
      el('h2', { textContent: 'Speicher' }),
    ]);
    seite.dataset.punkt = 'speicher';
    konto.parentElement.insertBefore(seite, konto.nextSibling);
    return seite;
  }

  function ablageBauen() {
    const seite = speicherseite();
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
                                 title: 'Konto und Einstellungen' }, [kreis, name]);
    const menue = el('div', { id: 'profilmenue', hidden: true });

    function punkt(text, tun) {
      const k = el('button', { type: 'button', className: 'profilpunkt', textContent: text });
      k.addEventListener('click', function () { menue.hidden = true; tun(); });
      return k;
    }

    function dateiPunktOeffnen(welcher) {
      // Erst die Datei-Ebene aufmachen (das kann nur die Oberflaeche selbst,
      // ueber das versteckte Zahnrad), dann auf den Reiter wechseln.
      zahnrad.click();
      const ziel = document.querySelector('.dateipunkt[data-punkt="' + welcher + '"]');
      if (ziel) ziel.click();
    }

    // Nur das Eigene. Benutzerverwaltung, Projekte und Einladungen sind
    // etwas anderes - die stehen unter "Konto" und gehen Gaeste nichts an.
    menue.append(
      el('p', { id: 'profilkopf' }, [
        el('strong', { id: 'profilwer', textContent: '…' }),
        el('span', { id: 'profilrolle', className: 'hinweis' }),
      ]),
      punkt('Mein Profil', function () { dateiPunktOeffnen('profil'); }),
      el('p', { id: 'profil-verwalten', hidden: true },
         [punkt('Benutzer verwalten', function () { dateiPunktOeffnen('konto'); })]),
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
    const verwalten = document.getElementById('profil-verwalten');
    if (verwalten) verwalten.hidden = rechte.indexOf('benutzer') < 0;
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
    };
    const alt = verwaltungLaden;
    verwaltungLaden = async function () { await alt(); fuellen(); };

    // Eingesetzte Elemente bringen ihre Gestaltung selbst mit. Sonst nehmen sie
    // die Standarddarstellung des Browsers - weisse Felder und Knoepfe in einer
    // dunklen Oberflaeche, und das sieht aus wie hineingefallen.
    const stil = document.createElement('style');
    stil.textContent = `
      #serververwaltung { max-width: 760px; }

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
      #profilteil .ordnerzeile { display: flex; gap: 8px; margin: 10px 0 4px; flex-wrap: wrap; }
      #profilteil input[type="password"] {
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
      #profil-verwalten { margin: 0; }
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
      #v-meldung { color: var(--matt); font-size: 12px; margin-top: 10px; }`;
    document.head.append(stil);
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
                               ['Speicher', ablageBauen],
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
