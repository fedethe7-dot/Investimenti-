'use strict';
/* Portafoglio di Federico: investimenti, simulatore, mutui e prestiti. Dati sul dispositivo, sync col Foglio Google. */
(() => {
  'use strict';
  // ---------------------------------------------------------------- regole fiscali
  // bollo: 'si' = 0,2% del valore · 'bfp' = 0,2% solo oltre 5.000 € · 'cc' = 34,20 € oltre 5.000 € · 'no'
  // fonte: interessi già pagati al netto dalla banca (nessuna tassa all'uscita)
  const TIPI = {
    etf:      { nome: 'ETF / fondi',                    aliq: 0.26,  bollo: 'si',  modo: 'acc' },
    azioni:   { nome: 'Azioni',                         aliq: 0.26,  bollo: 'si',  modo: 'acc' },
    btp:      { nome: 'Titoli di Stato (BTP, BOT)',     aliq: 0.125, bollo: 'si',  modo: 'ced' },
    obbl:     { nome: 'Obbligazioni di società',        aliq: 0.26,  bollo: 'si',  modo: 'ced' },
    deposito: { nome: 'Conto deposito',                 aliq: 0.26,  bollo: 'si',  modo: 'ced', fonte: true },
    bfp:      { nome: 'Buoni fruttiferi postali',       aliq: 0.125, bollo: 'bfp', modo: 'acc' },
    crypto:   { nome: 'Criptovalute',                   aliq: 0.33,  bollo: 'si',  modo: 'acc' },
    conto:    { nome: 'Liquidità su conto corrente',    aliq: 0.26,  bollo: 'cc',  modo: 'ced', fonte: true },
    pensione: { nome: 'Fondo pensione',                 aliq: 0.20,  bollo: 'no',  modo: 'ced', fonte: true },
    altro:    { nome: 'Altro',                          aliq: 0.26,  bollo: 'si',  modo: 'acc' },
  };
  const BOLLO = 0.002, BOLLO_CC = 34.2, SOGLIA = 5000;

  // ---------------------------------------------------------------- utilità
  const $ = (id) => document.getElementById(id);
  const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const eur2 = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (x, d = 1) => (x >= 0 ? '' : '−') + Math.abs(x * 100).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
  const segno = (x, f = eur) => (x > 0 ? '+' : x < 0 ? '−' : '') + f.format(Math.abs(x));
  const cls = (x) => (x > 0.005 ? 'gain' : x < -0.005 ? 'loss' : '');
  const oggi = () => new Date().toISOString().slice(0, 10);
  const dataIt = (s) => s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '';
  function parseNum(s) {
    s = String(s ?? '').trim().replace(/[€\s]/g, '');
    if (!s) return NaN;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    return Number(s);
  }
  const fmtIn = (n) => Number.isFinite(n) ? n.toLocaleString('it-IT', { maximumFractionDigits: 2 }) : '';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('portafoglio.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('portafoglio.' + k, JSON.stringify(v)); } catch { /* niente */ } },
  };

  // ---------------------------------------------------------------- schede
  const tabs = document.querySelectorAll('nav.tabs button');
  function apriTab(t) {
    tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    for (const k of ['port', 'sim', 'mut', 'sto', 'tax', 'set']) $('v-' + k).hidden = k !== t;
    store.set('tab', t);
    if (t === 'sim') simula();
    if (t === 'sto') renderStorico();
  }
  tabs.forEach((b) => b.addEventListener('click', () => apriTab(b.dataset.tab)));

  // ---------------------------------------------------------------- dati
  let investimenti = [];       // [{id, nome, tipo, isin, movimenti:[{id,data,tipo,importo}], valori:[{data,valore}]}]
  // Archivio sul dispositivo: { inv: {id: {agg, del, data, sync}}, calc: {...} }
  // agg = ora dell'ultima modifica (vince la più recente), sync = già inviato al Foglio Google.
  let archivio = (() => { const a = store.get('dati', null); return a && a.inv && a.calc ? a : { inv: {}, calc: {} }; })();
  function scriviArchivio(kind, id, data, del) {
    archivio[kind][id] = { agg: Date.now(), del: !!del, data: del ? null : data, sync: false };
    salvaArchivio(); programmaSync();
  }
  function salvaArchivio() {
    try { localStorage.setItem('portafoglio.dati', JSON.stringify(archivio)); }
    catch { avviso('Memoria del dispositivo piena: scarica un backup e libera spazio.'); }
  }
  function caricaDaArchivio() {
    investimenti = Object.entries(archivio.inv).filter(([, r]) => !r.del && r.data).map(([id, r]) => ({ id, ...JSON.parse(JSON.stringify(r.data)) }));
    calcoli = Object.entries(archivio.calc).filter(([, r]) => !r.del && r.data).map(([id, r]) => ({ id, ...JSON.parse(JSON.stringify(r.data)) }));
  }
  let aperto = store.get('aperto', null);
  let pending = Promise.resolve();

  function calcola(inv) {
    const t = TIPI[inv.tipo] || TIPI.altro;
    let versato = 0;
    for (const m of inv.movimenti || []) versato += m.tipo === 'prelievo' ? -m.importo : m.importo;
    const vals = [...(inv.valori || [])].sort((a, b) => a.data.localeCompare(b.data));
    const ultimo = vals[vals.length - 1];
    const valore = ultimo ? ultimo.valore : versato;
    const lordo = valore - versato;
    const tasse = t.fonte ? 0 : Math.max(0, lordo) * t.aliq;
    let bollo = 0;
    if (t.bollo === 'si') bollo = valore * BOLLO;
    else if (t.bollo === 'cc') bollo = valore > SOGLIA ? BOLLO_CC : 0;
    return { t, versato, valore, lordo, tasse, netto: valore - tasse, bollo, vals, aggiornato: ultimo ? ultimo.data : null };
  }

  function salva(inv) {
    const body = JSON.parse(JSON.stringify(inv));
    delete body.id;
    scriviArchivio('inv', inv.id, body, false);
  }
  function elimina(inv) {
    investimenti = investimenti.filter((x) => x.id !== inv.id);
    render();
    scriviArchivio('inv', inv.id, null, true);
  }
  const nuovoId = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // ---------------------------------------------------------------- riepilogo
  function renderTiles() {
    let vers = 0, val = 0, tasse = 0, bollo = 0, bfpTot = 0;
    for (const inv of investimenti) {
      const c = calcola(inv);
      vers += c.versato; val += c.valore; tasse += c.tasse; bollo += c.bollo;
      if (c.t.bollo === 'bfp') bfpTot += c.valore;
    }
    if (bfpTot > SOGLIA) bollo += bfpTot * BOLLO;
    const lordo = val - vers, netto = val - tasse;
    const g = netto - vers;
    $('tiles').innerHTML = `
      <div class="tile hero"><span class="lbl">Netto se vendi oggi</span><span class="val">${eur.format(netto)}</span>
        <span class="note">${investimenti.length ? (tasse > 0 ? 'dopo ' + eur.format(tasse) + ' di tasse' : 'nessuna tassa da pagare oggi') : 'aggiungi il primo investimento'}</span></div>
      <div class="tile"><span class="lbl">Hai messo</span><span class="val">${eur.format(vers)}</span><span class="note">versamenti meno prelievi</span></div>
      <div class="tile"><span class="lbl">Vale oggi</span><span class="val">${eur.format(val)}</span>
        <span class="note ${cls(lordo)}">${vers ? segno(lordo) + ' lordo · ' + pct(lordo / vers) : '—'}</span></div>
      <div class="tile"><span class="lbl">Guadagno netto</span><span class="val ${cls(g)}">${segno(g)}</span>
        <span class="note">${vers ? pct(g / vers) + ' su quanto hai messo' : '—'}</span></div>
      <div class="tile"><span class="lbl">Bollo stimato</span><span class="val">${eur.format(bollo)}</span><span class="note">all'anno, con i valori di oggi</span></div>`;
  }

  function sparkline(vals) {
    if (vals.length < 2) return '<svg width="90" height="28" aria-hidden="true"></svg>';
    const ys = vals.map((v) => v.valore), mn = Math.min(...ys), mx = Math.max(...ys), r = mx - mn || 1;
    const pts = ys.map((y, i) => `${(i / (ys.length - 1)) * 86 + 2},${26 - ((y - mn) / r) * 22}`).join(' ');
    const up = ys[ys.length - 1] >= ys[0];
    const last = pts.split(' ').pop().split(',');
    return `<svg width="90" height="28" viewBox="0 0 90 28" aria-label="Andamento"><polyline points="${pts}" fill="none" stroke="var(${up ? '--gain' : '--loss'})" stroke-width="1.6" stroke-linejoin="round"/><circle cx="${last[0]}" cy="${last[1]}" r="2.4" fill="var(${up ? '--gain' : '--loss'})"/></svg>`;
  }

  function linkPrezzo(isin) {
    if (!isin) return '';
    const q = encodeURIComponent(isin + ' quotazione');
    return `<a href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener" style="color:var(--accent)">Controlla prezzo ↗</a>`;
  }

  function renderList() {
    const el = $('list');
    if (!investimenti.length) {
      el.innerHTML = `<div class="empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>
        <p><b style="color:var(--fg)">Ancora nessun investimento.</b><br>Aggiungi ETF, BTP, conto deposito o altro: ti basta quanto hai messo e quanto vale oggi.</p></div>`;
      return;
    }
    const ord = [...investimenti].sort((a, b) => calcola(b).valore - calcola(a).valore);
    el.innerHTML = `<div class="list-head"><span>Investimento</span><span>Hai messo</span><span>Vale oggi</span><span>Netto</span><span></span></div>` +
      ord.map((inv) => {
        const c = calcola(inv);
        const open = aperto === inv.id;
        return `<div class="inv" data-id="${inv.id}">
          <button class="inv-head" data-act="toggle" aria-expanded="${open}">
            <span><span class="inv-name">${esc(inv.nome)}</span><br><span class="pill">${esc(c.t.nome)}</span></span>
            <span class="cell c-vers"><span class="k">Hai messo</span><span class="num">${eur.format(c.versato)}</span></span>
            <span class="cell"><span class="k">Vale oggi</span><span class="num">${eur.format(c.valore)}</span><span class="num small ${cls(c.lordo)}">${c.versato ? pct(c.lordo / c.versato) : ''}</span></span>
            <span class="cell"><span class="k">Netto</span><span class="num">${eur.format(c.netto)}</span><span class="small muted">${c.aggiornato ? dataIt(c.aggiornato) : ''}</span></span>
            <span class="spark" style="text-align:right">${sparkline(c.vals)}</span>
          </button>
          ${open ? dettaglio(inv, c) : ''}
        </div>`;
      }).join('');
  }

  function dettaglio(inv, c) {
    const movs = [...(inv.movimenti || [])].sort((a, b) => b.data.localeCompare(a.data));
    const vals = [...c.vals].reverse();
    const nota = c.t.fonte
      ? `Interessi già pagati al netto dalla banca: nessuna tassa quando ritiri.`
      : `Se vendi oggi paghi il ${pct(c.t.aliq, c.t.aliq === 0.125 ? 1 : 0)} sul guadagno: ${eur2.format(c.tasse)}.` + (c.lordo < 0 ? ` Sei in perdita: niente tasse, e la minusvalenza (${eur.format(-c.lordo)}) è recuperabile per 4 anni.` : '');
    return `<div class="inv-body">
      <p class="small">${nota} ${linkPrezzo(inv.isin)}</p>
      <div class="sub-grid">
        <form class="box" data-act="valore">
          <h3>Aggiorna il valore</h3>
          <div class="grid-form" style="grid-template-columns:1fr 1fr">
            <label class="f">Data<input type="date" name="data" value="${oggi()}" required></label>
            <label class="f">Valore totale (€)<input type="text" inputmode="decimal" class="num" name="valore" placeholder="${fmtIn(c.valore)}" required></label>
          </div>
          <button class="primary" type="submit">Salva valore</button>
          <div class="hist">${vals.map((v) => `<div><span>${dataIt(v.data)}</span><span class="num">${eur2.format(v.valore)}</span><button type="button" data-act="delval" data-d="${v.data}" aria-label="Elimina valore del ${dataIt(v.data)}">✕</button></div>`).join('') || '<span class="small muted">Nessun valore inserito: per ora vale quanto hai messo.</span>'}</div>
        </form>
        <form class="box" data-act="mov">
          <h3>Versamenti e prelievi</h3>
          <div class="grid-form" style="grid-template-columns:1fr 1fr">
            <label class="f">Data<input type="date" name="data" value="${oggi()}" required></label>
            <label class="f">Importo (€)<input type="text" inputmode="decimal" class="num" name="importo" required></label>
          </div>
          <div class="row-actions">
            <button class="primary" type="submit" name="tipo" value="versamento">+ Versamento</button>
            <button type="submit" name="tipo" value="prelievo">− Prelievo</button>
          </div>
          <div class="hist">${movs.map((m) => `<div><span>${dataIt(m.data)} · ${m.tipo}</span><span class="num ${m.tipo === 'prelievo' ? 'loss' : ''}">${m.tipo === 'prelievo' ? '−' : ''}${eur2.format(m.importo)}</span><button type="button" data-act="delmov" data-m="${m.id}" aria-label="Elimina movimento">✕</button></div>`).join('')}</div>
        </form>
        <form class="box" data-act="info">
          <h3>Dati</h3>
          <label class="f">Nome<input type="text" name="nome" value="${esc(inv.nome)}" required></label>
          <label class="f">Tipo<select name="tipo">${opzioniTipi(inv.tipo)}</select></label>
          <label class="f">ISIN o ticker<input type="text" name="isin" value="${esc(inv.isin || '')}"></label>
          <div class="row-actions">
            <button type="submit">Salva dati</button>
            <button type="button" class="danger" data-act="del">Elimina investimento</button>
            <button type="button" class="link" data-act="sim">Simula questo →</button>
          </div>
        </form>
      </div>
    </div>`;
  }

  function opzioniTipi(sel) {
    return Object.entries(TIPI).map(([k, t]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${t.nome} · ${pct(t.aliq, t.aliq === 0.125 ? 1 : 0)}</option>`).join('');
  }

  function render() { renderTiles(); renderList(); }

  // ---------------------------------------------------------------- interazioni portafoglio
  $('n-tipo').innerHTML = opzioniTipi('etf');
  $('n-data').value = oggi();
  const hintTipo = () => {
    const t = TIPI[$('n-tipo').value];
    $('n-hint').textContent = `Tasse sul guadagno: ${pct(t.aliq, t.aliq === 0.125 ? 1 : 0)}` +
      (t.bollo === 'si' ? ' · bollo 0,2% l\'anno' : t.bollo === 'cc' ? ' · bollo 34,20 € se oltre 5.000 €' : t.bollo === 'bfp' ? ' · bollo 0,2% se i buoni superano 5.000 €' : '') +
      (t.fonte ? ' · interessi già netti' : '');
  };
  $('n-tipo').addEventListener('change', hintTipo); hintTipo();
  $('btnNew').addEventListener('click', () => { $('newForm').hidden = false; $('n-nome').focus(); });
  $('btnCancelNew').addEventListener('click', () => { $('newForm').hidden = true; });
  $('newForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const imp = parseNum($('n-importo').value);
    if (!(imp > 0)) { $('n-importo').focus(); $('n-hint').textContent = 'Scrivi quanto hai messo, ad esempio 1.000 o 1500,50.'; return; }
    const val = parseNum($('n-valore').value);
    const data = $('n-data').value || oggi();
    const inv = {
      id: nuovoId(), nome: $('n-nome').value.trim() || 'Investimento', tipo: $('n-tipo').value, isin: $('n-isin').value.trim(),
      creato: new Date().toISOString(),
      movimenti: [{ id: nuovoId(), data, tipo: 'versamento', importo: imp }],
      valori: Number.isFinite(val) ? [{ data: oggi(), valore: val }] : [],
    };
    investimenti.push(inv);
    aperto = inv.id; store.set('aperto', aperto);
    e.target.reset(); $('n-data').value = oggi(); hintTipo();
    $('newForm').hidden = true;
    render(); salva(inv);
  });

  $('list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.tagName === 'FORM') return;
    const box = btn.closest('.inv');
    const inv = investimenti.find((x) => x.id === box?.dataset.id);
    if (!inv) return;
    const act = btn.dataset.act;
    if (act === 'toggle') { aperto = aperto === inv.id ? null : inv.id; store.set('aperto', aperto); renderList(); }
    else if (act === 'delval') { inv.valori = inv.valori.filter((v) => v.data !== btn.dataset.d); render(); salva(inv); }
    else if (act === 'delmov') { inv.movimenti = inv.movimenti.filter((m) => m.id !== btn.dataset.m); render(); salva(inv); }
    else if (act === 'del') {
      if (!btn.classList.contains('sure')) { btn.classList.add('sure'); btn.textContent = 'Conferma: elimina tutto'; setTimeout(() => { if (btn.isConnected) { btn.classList.remove('sure'); btn.textContent = 'Elimina investimento'; } }, 4000); return; }
      elimina(inv);
    } else if (act === 'sim') {
      const c = calcola(inv);
      $('s-cap').value = fmtIn(Math.round(c.valore)); $('s-mese').value = '0'; $('s-tipo').value = inv.tipo;
      impostaModo(c.t.modo); aggiornaNotaTipo(); apriTab('sim');
    }
  });
  $('list').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target, act = f.dataset.act;
    const inv = investimenti.find((x) => x.id === f.closest('.inv')?.dataset.id);
    if (!inv) return;
    if (act === 'valore') {
      const v = parseNum(f.valore.value); if (!Number.isFinite(v) || v < 0) { f.valore.focus(); return; }
      inv.valori = (inv.valori || []).filter((x) => x.data !== f.data.value).concat({ data: f.data.value, valore: v });
    } else if (act === 'mov') {
      const v = parseNum(f.importo.value); if (!(v > 0)) { f.importo.focus(); return; }
      inv.movimenti = (inv.movimenti || []).concat({ id: nuovoId(), data: f.data.value, tipo: e.submitter?.value === 'prelievo' ? 'prelievo' : 'versamento', importo: v });
    } else if (act === 'info') {
      inv.nome = f.nome.value.trim() || inv.nome; inv.tipo = f.tipo.value; inv.isin = f.isin.value.trim();
    }
    render(); salva(inv);
  });

  // ---------------------------------------------------------------- simulatore
  let modo = 'acc';
  $('s-tipo').innerHTML = opzioniTipi('etf');
  function impostaModo(m) { modo = m; $('m-acc').setAttribute('aria-pressed', String(m === 'acc')); $('m-ced').setAttribute('aria-pressed', String(m === 'ced')); }
  function aggiornaNotaTipo() {
    const t = TIPI[$('s-tipo').value];
    $('s-tipoNote').textContent = `Tasse ${pct(t.aliq, t.aliq === 0.125 ? 1 : 0)} sul guadagno` +
      (t.bollo === 'si' ? ', bollo 0,2% l\'anno sul valore' : t.bollo === 'cc' ? ', bollo 34,20 € l\'anno oltre 5.000 €' : t.bollo === 'bfp' ? ', bollo 0,2% oltre 5.000 €' : ', niente bollo') + '.';
  }
  $('s-tipo').addEventListener('change', () => { impostaModo(TIPI[$('s-tipo').value].modo); aggiornaNotaTipo(); simula(); });
  $('m-acc').addEventListener('click', () => { impostaModo('acc'); simula(); });
  $('m-ced').addEventListener('click', () => { impostaModo('ced'); simula(); });
  for (const id of ['s-rate', 's-anni', 's-infl']) $(id).addEventListener('input', simula);
  for (const id of ['s-cap', 's-mese']) $(id).addEventListener('input', simula);
  $('s-save').addEventListener('click', () => {
    const p = parametriSim(); const righe = calcolaSim(p); const f = righe[righe.length - 1];
    const tipo = $('s-tipo').value;
    salvaCalcolo({
      id: nuovoId(), tipo: 'sim', nome: $('s-nome').value.trim() || 'Simulazione ' + lettera('sim'), banca: '', note: TIPI[tipo].nome, data: new Date().toISOString(),
      input: { r: Number($('s-rate').value), anni: p.anni, infl: Number($('s-infl').value), cap: p.cap, mese: p.mese, tipo, modo: p.modo },
      ris: { versato: f.versato, lordo: f.lordo, tasse: f.tasse, bollo: f.bollo, netto: f.netto },
    });
    $('s-nome').value = '';
  });
  $('s-fromPort').addEventListener('click', () => {
    const tot = investimenti.reduce((s, inv) => s + calcola(inv).valore, 0);
    $('s-cap').value = fmtIn(Math.round(tot)); simula();
  });

  /** Simulazione mese per mese. Restituisce le righe annuali e i totali finali. */
  function calcolaSim({ cap, mese, anni, r, t, modo }) {
    const rm = Math.pow(1 + r, 1 / 12) - 1;
    let valore = cap, versato = cap, tasseAnnue = 0, bollo = 0;
    const righe = [];
    for (let y = 1; y <= anni; y++) {
      let interessi = 0;
      for (let m = 0; m < 12; m++) {
        const i = valore * rm; valore += i; interessi += i;
        valore += mese; versato += mese;
      }
      if (modo === 'ced' && interessi > 0) { const tx = interessi * t.aliq; valore -= tx; tasseAnnue += tx; }
      if (t.bollo === 'si' || (t.bollo === 'bfp' && valore > SOGLIA)) bollo += Math.max(0, valore) * BOLLO;
      else if (t.bollo === 'cc' && valore > SOGLIA) bollo += BOLLO_CC;
      const uscita = modo === 'acc' ? Math.max(0, valore - versato) * t.aliq : 0;
      righe.push({ anno: y, versato, lordo: valore, tasse: tasseAnnue + uscita, bollo, netto: valore - uscita - bollo });
    }
    return righe;
  }

  /** Rendimento annuo netto equivalente (stessi versamenti, stesso risultato, senza tasse né bollo). */
  function rendimentoEquivalente(cap, mese, anni, netto) {
    const fv = (r) => { const rm = Math.pow(1 + r, 1 / 12) - 1; let v = cap; for (let k = 0; k < anni * 12; k++) v = v * (1 + rm) + mese; return v; };
    let lo = -0.99, hi = 1;
    for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (fv(m) > netto) hi = m; else lo = m; }
    return (lo + hi) / 2;
  }

  function parametriSim() {
    return {
      r: Number($('s-rate').value) / 100, anni: Number($('s-anni').value), infl: Number($('s-infl').value) / 100,
      cap: Math.max(0, parseNum($('s-cap').value) || 0), mese: Math.max(0, parseNum($('s-mese').value) || 0),
      t: TIPI[$('s-tipo').value], modo,
    };
  }
  function simula() {
    const { r, anni, infl, cap, mese, t } = parametriSim();
    // interesse composto spiegato con 100 €
    const passi = [0, 1, 2, 3].map((k) => 100 * Math.pow(1 + r, k));
    $('s-compound').innerHTML = `<b>Interesse composto</b><span class="steps">${passi.map((x, k) => `${k ? '<span class="arr">→</span>' : ''}<span>${x.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</span>`).join('')}</span>
      <span class="muted">100 € al ${pct(r)} dopo 1, 2 e 3 anni: ogni anno gli interessi fruttano anche sugli interessi già presi. In ${anni} anni diventano ${eur2.format(100 * Math.pow(1 + r, anni))}.</span>`;
    $('o-rate').textContent = pct(r); $('o-anni').textContent = anni + (anni === 1 ? ' anno' : ' anni'); $('o-infl').textContent = pct(infl);
    store.set('sim', { r: $('s-rate').value, anni, infl: $('s-infl').value, cap: $('s-cap').value, mese: $('s-mese').value, tipo: $('s-tipo').value, modo });

    const righe = calcolaSim({ cap, mese, anni, r, t, modo });
    const f = righe[righe.length - 1];
    const gain = f.netto - f.versato;
    const reale = f.netto / Math.pow(1 + infl, anni);
    const eq = rendimentoEquivalente(cap, mese, anni, f.netto);

    $('r-netto').textContent = eur.format(f.netto);
    $('r-nettoNote').textContent = `tra ${anni} ${anni === 1 ? 'anno' : 'anni'} · come ${eur.format(reale)} di oggi`;
    $('r-vers').textContent = eur.format(f.versato);
    $('r-versNote').textContent = mese ? `${eur.format(cap)} + ${eur.format(mese)} al mese` : 'tutto all\'inizio';
    $('r-gain').textContent = segno(gain); $('r-gain').className = 'val ' + cls(gain);
    $('r-gainNote').textContent = `rendimento netto ${pct(eq)} l'anno`;

    const tasse = f.tasse;
    const gainLordo = f.lordo - f.versato + (modo === 'ced' ? tasse : 0);
    $('r-break').innerHTML = `
      <div><span>Soldi che versi</span><span class="num">${eur.format(f.versato)}</span></div>
      <div><span>Guadagno lordo</span><span class="num ${cls(gainLordo)}">${segno(gainLordo)}</span></div>
      <div><span>Tasse sul guadagno (${pct(t.aliq, t.aliq === 0.125 ? 1 : 0)}${modo === 'ced' ? ', ogni anno' : ', alla vendita'})</span><span class="num loss">−${eur.format(tasse)}</span></div>
      <div><span>Imposta di bollo in ${anni} ${anni === 1 ? 'anno' : 'anni'}</span><span class="num loss">−${eur.format(f.bollo)}</span></div>
      <div class="tot"><span>Ti resta in tasca</span><span class="num">${eur.format(f.netto)}</span></div>
      <div><span class="muted">Potere d'acquisto in euro di oggi (inflazione ${pct(infl)})</span><span class="num muted">${eur.format(reale)}</span></div>`;

    // confronto tra le due modalità
    const altro = calcolaSim({ cap, mese, anni, r, t, modo: modo === 'acc' ? 'ced' : 'acc' });
    const diff = f.netto - altro[altro.length - 1].netto;
    $('r-compare').textContent = Math.abs(diff) < 1 || r <= 0 ? '' : modo === 'acc'
      ? `Con l'accumulo le tasse le paghi solo alla fine: rispetto a interessi tassati ogni anno ti restano ${eur.format(diff)} in più.`
      : `Se lo stesso rendimento fosse ad accumulo (tasse solo alla vendita) avresti ${eur.format(-diff)} in più.`;

    $('r-table').innerHTML = `<thead><tr><th>Anno</th><th>Versato</th><th>Valore lordo</th><th>Tasse</th><th>Bollo</th><th>Netto</th></tr></thead><tbody>` +
      righe.map((x) => `<tr><td>${x.anno}</td><td class="num">${eur.format(x.versato)}</td><td class="num">${eur.format(x.lordo)}</td><td class="num">${eur.format(x.tasse)}</td><td class="num">${eur.format(x.bollo)}</td><td class="num"><b>${eur.format(x.netto)}</b></td></tr>`).join('') + '</tbody>';

    disegnaGrafico(cap, righe);
  }

  function disegnaGrafico(cap, righe) {
    const W = 640, H = 260, L = 64, R = 14, T = 14, B = 30;
    const serie = [{ anno: 0, versato: cap, lordo: cap, netto: cap }, ...righe];
    const maxY = Math.max(1, ...serie.map((s) => Math.max(s.lordo, s.versato, s.netto)));
    const minY = Math.min(0, ...serie.map((s) => Math.min(s.lordo, s.netto)));
    const passo = (() => { const raw = (maxY - minY) / 4; const p = Math.pow(10, Math.floor(Math.log10(raw))); for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * p) return m * p; return 10 * p; })();
    const top = Math.ceil(maxY / passo) * passo, bot = Math.floor(minY / passo) * passo;
    const n = serie.length - 1;
    const x = (i) => L + (i / Math.max(1, n)) * (W - L - R);
    const y = (v) => T + (1 - (v - bot) / (top - bot)) * (H - T - B);
    const poly = (k) => serie.map((s, i) => `${x(i).toFixed(1)},${y(s[k]).toFixed(1)}`).join(' ');
    const breve = (v) => Math.abs(v) >= 1e6 ? (v / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 1 }) + ' mln' : Math.abs(v) >= 1000 ? (v / 1000).toLocaleString('it-IT', { maximumFractionDigits: 0 }) + 'k' : String(Math.round(v));
    let grid = '';
    for (let v = bot; v <= top + 1e-6; v += passo) grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${breve(v)} €</text>`;
    const ogni = n <= 12 ? 1 : n <= 24 ? 2 : 5;
    let xt = '';
    for (let i = 0; i <= n; i += ogni) xt += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${i}</text>`;
    const area = `${x(0)},${y(Math.max(bot, 0))} ${poly('netto')} ${x(n)},${y(Math.max(bot, 0))}`;
    const fin = serie[n];
    $('chart').innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Andamento di valore lordo, netto e versato negli anni">
      ${grid}${xt}
      <polygon points="${area}" fill="var(--accent)" opacity="0.12"/>
      <polyline points="${poly('lordo')}" fill="none" stroke="var(--chart-gross)" stroke-width="2" stroke-dasharray="5 4"/>
      <polyline points="${poly('versato')}" fill="none" stroke="var(--muted)" stroke-width="1.5"/>
      <polyline points="${poly('netto')}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>
      <circle cx="${x(n)}" cy="${y(fin.netto)}" r="4" fill="var(--accent)"/>
    </svg>`;
  }

  // ---------------------------------------------------------------- avvisi brevi
  let toastT = 0;
  function avviso(testo) {
    const t = $('toast'); t.textContent = testo; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3200);
  }

  // ---------------------------------------------------------------- storico (dati)
  let calcoli = [];            // [{id, tipo:'mutuo'|'prestito'|'sim', nome, banca, note, data, input, ris}]
  function salvaCalcolo(c) {
    const body = JSON.parse(JSON.stringify(c)); delete body.id;
    calcoli = calcoli.filter((x) => x.id !== c.id).concat(c);
    renderStorico();
    scriviArchivio('calc', c.id, body, false);
    avviso('Salvato nello storico: ' + c.nome);
  }
  function eliminaCalcolo(id) {
    calcoli = calcoli.filter((x) => x.id !== id); scelti.delete(id); renderStorico();
    scriviArchivio('calc', id, null, true);
  }
  const lettera = (tipo) => {
    const n = calcoli.filter((c) => c.tipo === tipo).length;
    return String.fromCharCode(65 + (n % 26)) + (n >= 26 ? Math.floor(n / 26) + 1 : '');
  };

  // ---------------------------------------------------------------- mutuo e finanziamenti
  const ESEMPI = {
    mutuo: { prezzo: 200000, anticipo: 40000, tan: 3.2, durata: 25, tipoTasso: 'fisso', maxi: 0, istr: 800, perizia: 350, incasso: 2, ass: 150, imp: 0, prima: true, notaio: 3500, agenzia: 0, impAcq: 2100 },
    prestito: { prezzo: 22000, anticipo: 4000, tan: 6.9, durata: 60, tipoTasso: 'fisso', maxi: 0, istr: 300, perizia: 0, incasso: 3, ass: 0, imp: 16, prima: false, notaio: 0, agenzia: 0, impAcq: 600 },
  };
  let kTipo = 'mutuo';
  const kIn = { prezzo: 'k-prezzo', anticipo: 'k-anticipo', maxi: 'k-maxi', istr: 'k-istr', perizia: 'k-perizia', incasso: 'k-incasso', ass: 'k-ass', imp: 'k-imp', notaio: 'k-notaio', agenzia: 'k-agenzia', impAcq: 'k-impAcq' };

  function impostaTipoPrestito(tipo, valori) {
    kTipo = tipo;
    $('k-mutuo').setAttribute('aria-pressed', String(tipo === 'mutuo'));
    $('k-prestito').setAttribute('aria-pressed', String(tipo === 'prestito'));
    const m = tipo === 'mutuo';
    $('k-legBene').textContent = m ? 'La casa' : 'Il bene (auto, moto, altro)';
    $('k-durata').min = m ? 5 : 6; $('k-durata').max = m ? 40 : 120; $('k-durata').step = m ? 1 : 6;
    $('k-periziaBox').hidden = !m; $('k-primaBox').hidden = !m; $('k-tipoTassoBox').hidden = !m;
    $('k-maxiBox').hidden = m; $('k-impBox').hidden = m;
    $('k-assLbl').firstChild.textContent = m ? 'Assicurazione incendio obbligatoria (€ l\'anno)' : 'Assicurazione nel finanziamento (€ al mese)';
    $('k-notaioLbl').hidden = !m; $('k-agenziaLbl').hidden = !m; $('k-impAcqHint').hidden = !m;
    $('k-impAcqLbl').firstChild.textContent = m ? 'Imposte d\'acquisto (€)' : 'Passaggio, messa su strada, IPT (€)';
    $('k-legAcq').textContent = m ? 'Spese per comprare (non vanno alla banca)' : 'Altre spese per il bene (non vanno alla finanziaria)';
    const v = valori || ESEMPI[tipo];
    for (const [k, id] of Object.entries(kIn)) $(id).value = fmtIn(v[k] ?? 0);
    $('k-tan').value = v.tan; $('k-durata').value = v.durata; $('k-tipoTasso').value = v.tipoTasso || 'fisso'; $('k-prima').checked = !!v.prima;
    $('k-esempio').hidden = !!valori;
    if (!valori) { $('k-nome').value = ''; $('k-banca').value = ''; $('k-note').value = ''; }
    calcolaPrestitoUI();
  }

  function leggiInputPrestito() {
    const n = (id) => Math.max(0, parseNum($(id).value) || 0);
    const v = { tipo: kTipo };
    for (const [k, id] of Object.entries(kIn)) v[k] = n(id);
    v.tan = Number($('k-tan').value); v.durata = Number($('k-durata').value); v.tipoTasso = $('k-tipoTasso').value; v.prima = $('k-prima').checked;
    return v;
  }

  /** Rata alla francese con eventuale maxirata, spese, TAEG e piano mese per mese. */
  function calcolaPrestito(v) {
    const mutuo = v.tipo === 'mutuo';
    const mesi = mutuo ? v.durata * 12 : v.durata;
    const importo = Math.max(0, v.prezzo - v.anticipo);
    const i = v.tan / 100 / 12;
    const maxi = mutuo ? 0 : Math.min(v.maxi, importo);
    const pvMaxi = maxi / Math.pow(1 + i, mesi);
    const rata = mesi ? (i ? (importo - pvMaxi) * i / (1 - Math.pow(1 + i, -mesi)) : (importo - maxi) / mesi) : 0;
    const impostaBanca = mutuo ? importo * (v.prima ? 0.0025 : 0.02) : v.imp;
    const speseIniziali = v.istr + (mutuo ? v.perizia : 0) + impostaBanca;
    const assMese = mutuo ? v.ass / 12 : v.ass;
    const piano = []; let residuo = importo, intTot = 0;
    for (let k = 1; k <= mesi; k++) {
      const int = residuo * i, cap = rata - int; residuo -= cap; intTot += int;
      piano.push({ n: k, rata, interessi: int, capitale: cap, residuo: Math.max(0, residuo), extra: v.incasso + assMese });
    }
    if (maxi > 0 && piano.length) piano[piano.length - 1].maxirata = maxi;
    const ricorrenti = (v.incasso + assMese) * mesi;
    const totaleBanca = rata * mesi + maxi + speseIniziali + ricorrenti;
    const speseAcquisto = v.notaio + v.agenzia + v.impAcq;
    const costoFinale = v.anticipo + totaleBanca + speseAcquisto;
    // TAEG: tasso che rende uguali il netto ricevuto e tutto quello che paghi
    const ricevuto = importo - speseIniziali, uscita = rata + v.incasso + assMese;
    const npv = (r) => { let s = ricevuto; for (let k = 1; k <= mesi; k++) s -= uscita / Math.pow(1 + r, k); s -= maxi / Math.pow(1 + r, mesi); return s; };
    let lo = -0.5 / 12, hi = 1, taeg = NaN;
    if (importo > 0 && mesi > 0 && npv(lo) * npv(hi) < 0) { for (let k = 0; k < 100; k++) { const m = (lo + hi) / 2; if (npv(m) > 0) hi = m; else lo = m; } taeg = Math.pow(1 + (lo + hi) / 2, 12) - 1; }
    return { mesi, importo, rata, maxi, impostaBanca, speseIniziali, ricorrenti, interessi: intTot, totaleBanca, speseAcquisto, costoFinale, taeg, piano, assMese };
  }

  function calcolaPrestitoUI() {
    const v = leggiInputPrestito();
    const r = calcolaPrestito(v);
    const m = v.tipo === 'mutuo';
    $('o-tan').textContent = pct(v.tan / 100, 2);
    $('o-durata').textContent = m ? `${v.durata} anni` : `${v.durata} mesi (${(v.durata / 12).toLocaleString('it-IT', { maximumFractionDigits: 1 })} anni)`;
    $('k-importo').textContent = eur.format(r.importo);
    $('k-ltv').textContent = v.prezzo ? `(${pct(r.importo / v.prezzo, 0)} del prezzo${m && r.importo / v.prezzo > 0.8 ? ': oltre l\'80% molte banche chiedono garanzie o tassi più alti' : ''})` : '';
    $('q-rata').textContent = eur2.format(r.rata);
    $('q-rataNote').textContent = `${r.mesi} rate${r.maxi ? ` + maxirata ${eur.format(r.maxi)}` : ''}${v.incasso || r.assMese ? ` · con spese ${eur2.format(r.rata + v.incasso + r.assMese)}` : ''}`;
    $('q-taeg').textContent = Number.isFinite(r.taeg) ? pct(r.taeg, 2) : '—';
    $('q-int').textContent = eur.format(r.interessi);
    $('q-intNote').textContent = r.importo ? `${pct(r.interessi / r.importo, 0)} di quanto chiedi in prestito` : '';
    $('q-titCosto').textContent = m ? 'Quanto ti costa davvero la casa' : 'Quanto ti costa davvero';
    $('q-prezzo').textContent = eur.format(v.prezzo);
    $('q-costo').textContent = eur.format(r.costoFinale);
    $('q-extra').textContent = r.costoFinale > v.prezzo ? `(+${eur.format(r.costoFinale - v.prezzo)})` : '';
    const parti = [
      ['Prezzo', v.prezzo, 'var(--accent)'],
      ['Interessi', r.interessi, 'var(--loss)'],
      ['Spese banca', r.speseIniziali + r.ricorrenti, 'var(--spese)'],
      ['Spese d\'acquisto', r.speseAcquisto, 'var(--chart-gross)'],
    ].filter((p) => p[1] > 0);
    const tot = parti.reduce((a, p) => a + p[1], 0) || 1;
    $('q-stack').innerHTML = parti.map((p) => `<div style="width:${(p[1] / tot) * 100}%;background:${p[2]}"></div>`).join('');
    $('q-legend').innerHTML = parti.map((p) => `<span><i style="background:${p[2]}"></i>${p[0]} <b class="num">${eur.format(p[1])}</b></span>`).join('');
    $('q-break').innerHTML = `
      <div><span>Anticipo tuo</span><span class="num">${eur.format(v.anticipo)}</span></div>
      <div><span>Rate (${r.mesi} × ${eur2.format(r.rata)})</span><span class="num">${eur.format(r.rata * r.mesi)}</span></div>
      ${r.maxi ? `<div><span>Maxirata finale</span><span class="num">${eur.format(r.maxi)}</span></div>` : ''}
      <div><span>Istruttoria${m ? ' e perizia' : ''}</span><span class="num">${eur.format(v.istr + (m ? v.perizia : 0))}</span></div>
      <div><span>${m ? `Imposta sostitutiva (${v.prima ? '0,25%' : '2%'})` : 'Bollo o imposta'}</span><span class="num">${eur.format(r.impostaBanca)}</span></div>
      <div><span>Incasso rata e assicurazione</span><span class="num">${eur.format(r.ricorrenti)}</span></div>
      <div><span>${m ? 'Notaio, agenzia e imposte d\'acquisto' : 'Altre spese per il bene'}</span><span class="num">${eur.format(r.speseAcquisto)}</span></div>
      <div class="tot"><span>Costo finale</span><span class="num">${eur.format(r.costoFinale)}</span></div>
      ${m && v.tipoTasso === 'variabile' ? '<div><span class="muted">Tasso variabile: la rata cambierà con l\'Euribor. Il calcolo usa il tasso di oggi per tutta la durata.</span></div>' : ''}`;
    // ammortamento per anno
    const anni = [];
    for (const p of r.piano) {
      const a = Math.ceil(p.n / 12);
      if (!anni[a]) anni[a] = { anno: a, rate: 0, interessi: 0, capitale: 0, residuo: 0 };
      anni[a].rate += p.rata + (p.maxirata || 0); anni[a].interessi += p.interessi; anni[a].capitale += p.capitale + (p.maxirata || 0); anni[a].residuo = p.maxirata ? 0 : p.residuo;
    }
    $('q-amm').innerHTML = `<thead><tr><th>Anno</th><th>Pagato</th><th>Di cui interessi</th><th>Di cui capitale</th><th>Debito che resta</th></tr></thead><tbody>` +
      anni.filter(Boolean).map((a) => `<tr><td>${a.anno}</td><td class="num">${eur.format(a.rate)}</td><td class="num">${eur.format(a.interessi)}</td><td class="num">${eur.format(a.capitale)}</td><td class="num">${eur.format(a.residuo)}</td></tr>`).join('') + '</tbody>';
    store.set('prestito', { tipo: kTipo, v });
    return { v, r };
  }

  $('k-mutuo').addEventListener('click', () => impostaTipoPrestito('mutuo'));
  $('k-prestito').addEventListener('click', () => impostaTipoPrestito('prestito'));
  $('k-reset').addEventListener('click', () => impostaTipoPrestito(kTipo));
  $('mutForm').addEventListener('input', calcolaPrestitoUI);
  $('mutForm').addEventListener('change', calcolaPrestitoUI);
  $('mutForm').addEventListener('submit', (e) => e.preventDefault());
  $('k-save').addEventListener('click', () => {
    const { v, r } = calcolaPrestitoUI();
    const nome = $('k-nome').value.trim() || (kTipo === 'mutuo' ? 'Mutuo ' : 'Finanziamento ') + lettera(kTipo);
    salvaCalcolo({
      id: nuovoId(), tipo: kTipo, nome, banca: $('k-banca').value.trim(), note: $('k-note').value.trim(), data: new Date().toISOString(),
      input: v,
      ris: { mesi: r.mesi, importo: r.importo, rata: r.rata, maxi: r.maxi, taeg: r.taeg, interessi: r.interessi, speseIniziali: r.speseIniziali, ricorrenti: r.ricorrenti, speseAcquisto: r.speseAcquisto, totaleBanca: r.totaleBanca, costoFinale: r.costoFinale },
    });
    $('k-nome').value = '';
  });

  // ---------------------------------------------------------------- storico (vista)
  const scelti = new Set();
  const TIPO_CALC = { mutuo: 'Mutuo', prestito: 'Finanziamento', sim: 'Simulazione' };
  function riassunto(c) {
    const i = c.input || {}, r = c.ris || {};
    if (c.tipo === 'sim') return [['Rendimento', pct((i.r || 0) / 100)], ['Anni', i.anni], ['Versi', eur.format(r.versato || 0)], ['Netto finale', eur.format(r.netto || 0)]];
    return [['Prezzo', eur.format(i.prezzo || 0)], ['Rata', eur2.format(r.rata || 0)], ['TAN', pct((i.tan || 0) / 100, 2)], ['TAEG', Number.isFinite(r.taeg) ? pct(r.taeg, 2) : '—'], ['Costo finale', eur.format(r.costoFinale || 0)]];
  }
  function renderStorico() {
    const el = $('sto-list');
    $('sto-count').textContent = calcoli.length ? `${calcoli.length} salvat${calcoli.length === 1 ? 'o' : 'i'}` : '';
    if (!calcoli.length) {
      el.innerHTML = `<div class="empty"><p><b style="color:var(--fg)">Lo storico è vuoto.</b><br>Nel calcolo di un mutuo, di un finanziamento o nel simulatore premi "Salva nello storico": qui ritrovi tutte le richieste per confrontarle.</p></div>`;
      $('sto-cmpBox').hidden = true; return;
    }
    const ord = [...calcoli].sort((a, b) => (b.data || '').localeCompare(a.data || ''));
    el.innerHTML = ord.map((c) => `<div class="calc" data-id="${c.id}">
        <input type="checkbox" aria-label="Confronta ${esc(c.nome)}" ${scelti.has(c.id) ? 'checked' : ''} data-act="pick">
        <div style="display:grid;gap:4px;min-width:0">
          <span><span class="title">${esc(c.nome)}</span> <span class="pill">${TIPO_CALC[c.tipo] || c.tipo}</span></span>
          <span class="small muted">${dataIt((c.data || '').slice(0, 10))}${c.banca ? ' · ' + esc(c.banca) : ''}${c.note ? ' · ' + esc(c.note) : ''}</span>
          <span class="facts">${riassunto(c).map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join('')}</span>
        </div>
        <div class="row-actions acts">
          <button type="button" data-act="open">Apri</button>
          <button type="button" class="danger" data-act="del">Elimina</button>
        </div>
      </div>`).join('');
    renderConfronto();
  }
  function renderConfronto() {
    const sel = calcoli.filter((c) => scelti.has(c.id));
    const box = $('sto-cmpBox');
    if (sel.length < 2) { box.hidden = true; return; }
    const tipi = new Set(sel.map((c) => c.tipo === 'sim' ? 'sim' : 'prestito'));
    if (tipi.size > 1) { box.hidden = false; $('sto-cmp').innerHTML = '<tbody><tr><td>Per confrontare scegli calcoli dello stesso tipo: solo mutui e finanziamenti, oppure solo simulazioni.</td></tr></tbody>'; return; }
    box.hidden = false;
    const righe = sel[0].tipo === 'sim'
      ? [['Rendimento', (c) => c.input.r / 100, (x) => pct(x), 'max'], ['Anni', (c) => c.input.anni, (x) => x, ''], ['Capitale iniziale', (c) => c.input.cap, (x) => eur.format(x), ''], ['Al mese', (c) => c.input.mese, (x) => eur.format(x), ''],
         ['Versi in totale', (c) => c.ris.versato, (x) => eur.format(x), ''], ['Tasse', (c) => c.ris.tasse, (x) => eur.format(x), 'min'], ['Netto finale', (c) => c.ris.netto, (x) => eur.format(x), 'max']]
      : [['Banca', (c) => c.banca || '—', (x) => esc(x), ''], ['Prezzo', (c) => c.input.prezzo, (x) => eur.format(x), ''], ['Chiedi in prestito', (c) => c.ris.importo, (x) => eur.format(x), ''],
         ['Durata', (c) => c.ris.mesi, (x) => x % 12 ? x + ' mesi' : x / 12 + ' anni', ''], ['TAN', (c) => c.input.tan / 100, (x) => pct(x, 2), 'min'], ['TAEG', (c) => c.ris.taeg, (x) => Number.isFinite(x) ? pct(x, 2) : '—', 'min'],
         ['Rata', (c) => c.ris.rata, (x) => eur2.format(x), 'min'], ['Interessi totali', (c) => c.ris.interessi, (x) => eur.format(x), 'min'], ['Spese banca', (c) => c.ris.speseIniziali + c.ris.ricorrenti, (x) => eur.format(x), 'min'],
         ['Totale alla banca', (c) => c.ris.totaleBanca, (x) => eur.format(x), 'min'], ['Costo finale', (c) => c.ris.costoFinale, (x) => eur.format(x), 'min']];
    $('sto-cmp').innerHTML = `<thead><tr><th></th>${sel.map((c) => `<th>${esc(c.nome)}</th>`).join('')}</tr></thead><tbody>` +
      righe.map(([lbl, get, fmt, best]) => {
        const vals = sel.map((c) => { try { return get(c); } catch { return null; } });
        const nums = vals.filter((x) => typeof x === 'number' && Number.isFinite(x));
        const target = best === 'min' ? Math.min(...nums) : best === 'max' ? Math.max(...nums) : null;
        const diversi = new Set(nums).size > 1;
        return `<tr><td>${lbl}</td>${vals.map((x) => `<td class="num${best && diversi && x === target ? ' best' : ''}">${x === null ? '—' : fmt(x)}</td>`).join('')}</tr>`;
      }).join('') + '</tbody>';
  }
  $('sto-list').addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    const c = calcoli.find((x) => x.id === t.closest('.calc')?.dataset.id); if (!c) return;
    if (t.dataset.act === 'pick') { if (t.checked) scelti.add(c.id); else scelti.delete(c.id); renderConfronto(); }
    else if (t.dataset.act === 'del') {
      if (!t.classList.contains('sure')) { t.classList.add('sure'); t.textContent = 'Conferma'; setTimeout(() => { if (t.isConnected) { t.classList.remove('sure'); t.textContent = 'Elimina'; } }, 4000); return; }
      eliminaCalcolo(c.id);
    } else if (t.dataset.act === 'open') {
      if (c.tipo === 'sim') {
        const i = c.input; $('s-rate').value = i.r; $('s-anni').value = i.anni; $('s-infl').value = i.infl; $('s-cap').value = fmtIn(i.cap); $('s-mese').value = fmtIn(i.mese);
        if (TIPI[i.tipo]) $('s-tipo').value = i.tipo; impostaModo(i.modo); aggiornaNotaTipo(); apriTab('sim');
      } else {
        impostaTipoPrestito(c.tipo, c.input); $('k-nome').value = c.nome + ' (copia)'; $('k-banca').value = c.banca || ''; $('k-note').value = c.note || ''; apriTab('mut');
      }
    }
  });

  // ---------------------------------------------------------------- Excel
  async function scaricaExcel() {
    if (!window.XLSX) { avviso('Il modulo Excel non è ancora scaricato: apri l\'app una volta con internet e riprova.'); return; }
    const X = window.XLSX, wb = X.utils.book_new();
    const EUR = '#,##0.00 "€"', PCT = '0.00%';
    const foglio = (nome, righe, formati = {}) => {
      const ws = X.utils.aoa_to_sheet(righe);
      const range = X.utils.decode_range(ws['!ref'] || 'A1');
      for (let R = 1; R <= range.e.r; R++) for (let C = 0; C <= range.e.c; C++) {
        const cell = ws[X.utils.encode_cell({ r: R, c: C })];
        if (cell && cell.t === 'n' && formati[C]) cell.z = formati[C];
      }
      ws['!cols'] = (righe[0] || []).map((_, C) => ({ wch: Math.min(40, Math.max(10, ...righe.map((r) => String(r[C] ?? '').length + 2))) }));
      let n = nome.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31), k = 2;
      while (wb.SheetNames.includes(n)) n = nome.slice(0, 28) + ' ' + k++;
      X.utils.book_append_sheet(wb, ws, n);
    };
    // portafoglio
    const port = [['Investimento', 'Tipo', 'ISIN', 'Aliquota', 'Hai messo', 'Valore oggi', 'Aggiornato il', 'Guadagno lordo', 'Rendimento', 'Tasse se vendi', 'Netto', 'Bollo annuo']];
    for (const inv of investimenti) {
      const c = calcola(inv);
      port.push([inv.nome, c.t.nome, inv.isin || '', c.t.aliq, c.versato, c.valore, c.aggiornato ? dataIt(c.aggiornato) : '', c.lordo, c.versato ? c.lordo / c.versato : 0, c.tasse, c.netto, c.bollo]);
    }
    foglio('Portafoglio', port, { 3: PCT, 4: EUR, 5: EUR, 7: EUR, 8: PCT, 9: EUR, 10: EUR, 11: EUR });
    const mov = [['Investimento', 'Data', 'Tipo', 'Importo']];
    for (const inv of investimenti) for (const m of inv.movimenti || []) mov.push([inv.nome, dataIt(m.data), m.tipo, m.tipo === 'prelievo' ? -m.importo : m.importo]);
    foglio('Versamenti', mov, { 3: EUR });
    const val = [['Investimento', 'Data', 'Valore']];
    for (const inv of investimenti) for (const v of [...(inv.valori || [])].sort((a, b) => a.data.localeCompare(b.data))) val.push([inv.nome, dataIt(v.data), v.valore]);
    foglio('Storico valori', val, { 2: EUR });
    // simulazione corrente
    const sp = parametriSim();
    const sr = calcolaSim(sp);
    const sim = [['Simulazione', ''], ['Tipo', TIPI[$('s-tipo').value].nome], ['Rendimento annuo lordo', sp.r], ['Capitale iniziale', sp.cap], ['Versamento mensile', sp.mese], ['Anni', sp.anni], ['Modalità', sp.modo === 'acc' ? 'Accumulo (tasse alla vendita)' : 'Interessi tassati ogni anno'], [],
      ['Anno', 'Versato', 'Valore lordo', 'Tasse', 'Bollo', 'Netto se vendi']];
    for (const x of sr) sim.push([x.anno, x.versato, x.lordo, x.tasse, x.bollo, x.netto]);
    foglio('Simulazione', sim, { 1: EUR, 2: EUR, 3: EUR, 4: EUR, 5: EUR });
    // storico
    const sto = [['Data', 'Nome', 'Tipo', 'Banca', 'Prezzo', 'Anticipo', 'Prestito', 'TAN', 'TAEG', 'Durata (mesi)', 'Rata', 'Maxirata', 'Interessi', 'Spese banca', 'Spese acquisto', 'Totale alla banca', 'Costo finale', 'Note']];
    for (const c of [...calcoli].filter((c) => c.tipo !== 'sim').sort((a, b) => (a.data || '').localeCompare(b.data || ''))) {
      const i = c.input, r = c.ris;
      sto.push([dataIt((c.data || '').slice(0, 10)), c.nome, TIPO_CALC[c.tipo], c.banca || '', i.prezzo, i.anticipo, r.importo, i.tan / 100, Number.isFinite(r.taeg) ? r.taeg : '', r.mesi, r.rata, r.maxi || 0, r.interessi, r.speseIniziali + r.ricorrenti, r.speseAcquisto, r.totaleBanca, r.costoFinale, c.note || '']);
    }
    foglio('Mutui e prestiti', sto, { 4: EUR, 5: EUR, 6: EUR, 7: PCT, 8: PCT, 10: EUR, 11: EUR, 12: EUR, 13: EUR, 14: EUR, 15: EUR, 16: EUR });
    const sims = [['Data', 'Nome', 'Tipo', 'Rendimento', 'Anni', 'Capitale iniziale', 'Al mese', 'Versato', 'Tasse', 'Bollo', 'Netto finale']];
    for (const c of calcoli.filter((c) => c.tipo === 'sim')) sims.push([dataIt((c.data || '').slice(0, 10)), c.nome, TIPI[c.input.tipo]?.nome || '', c.input.r / 100, c.input.anni, c.input.cap, c.input.mese, c.ris.versato, c.ris.tasse, c.ris.bollo, c.ris.netto]);
    foglio('Simulazioni salvate', sims, { 3: PCT, 5: EUR, 6: EUR, 7: EUR, 8: EUR, 9: EUR, 10: EUR });
    // ammortamenti: calcolo aperto + ogni richiesta salvata
    const amm = (nome, v) => {
      const r = calcolaPrestito(v);
      const rows = [['Rata n.', 'Rata', 'Interessi', 'Capitale', 'Debito residuo', 'Spese (incasso + assicurazione)', 'Maxirata']];
      for (const p of r.piano) rows.push([p.n, p.rata, p.interessi, p.capitale, p.residuo, p.extra, p.maxirata || 0]);
      foglio(nome, rows, { 1: EUR, 2: EUR, 3: EUR, 4: EUR, 5: EUR, 6: EUR });
    };
    amm('Amm. calcolo aperto', leggiInputPrestito());
    for (const c of calcoli.filter((c) => c.tipo !== 'sim')) amm('Amm. ' + c.nome, c.input);

    const buf = X.write(wb, { type: 'array', bookType: 'xlsx' });
    const filename = `portafoglio_${oggi()}.xlsx`;
    scaricaFile(filename, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    avviso('Excel scaricato: ' + filename);
  }
  function scaricaFile(nome, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  $('btnExcel').addEventListener('click', scaricaExcel);

  // ---------------------------------------------------------------- avvio
  (function ripristina() {
    const s = store.get('sim', null);
    if (s) {
      if (s.r !== undefined) $('s-rate').value = s.r;
      if (s.anni) $('s-anni').value = s.anni;
      if (s.infl !== undefined) $('s-infl').value = s.infl;
      if (s.cap !== undefined) $('s-cap').value = s.cap;
      if (s.mese !== undefined) $('s-mese').value = s.mese;
      if (s.tipo && TIPI[s.tipo]) $('s-tipo').value = s.tipo;
      impostaModo(s.modo === 'ced' ? 'ced' : 'acc');
    } else impostaModo(TIPI[$('s-tipo').value].modo);
    aggiornaNotaTipo();
  })();
  caricaDaArchivio();
  render();
  simula();
  (function ripristinaPrestito() {
    const p = store.get('prestito', null);
    impostaTipoPrestito(p && (p.tipo === 'prestito' || p.tipo === 'mutuo') ? p.tipo : 'mutuo', p ? p.v : null);
  })();
  renderStorico();
  apriTab(store.get('tab', 'port'));

  // ---------------------------------------------------------------- sincronizzazione con il Foglio Google
  const conf = () => store.get('sync', { url: '', token: '' });
  let syncTimer = 0, inSync = false, ultimaSync = store.get('ultimaSync', null), erroreSync = '';
  function programmaSync() { clearTimeout(syncTimer); syncTimer = setTimeout(() => sincronizza(false), 1500); statoSync(); }
  const daInviare = () => ['inv', 'calc'].reduce((n, k) => n + Object.values(archivio[k]).filter((r) => !r.sync).length, 0);
  function statoSync(testo) {
    const { url } = conf();
    const el = $('syncStato'), t = $('syncTesto');
    el.classList.remove('ok', 'err');
    let msg;
    if (testo) msg = testo;
    else if (!url) msg = 'Solo su questo dispositivo';
    else if (erroreSync) { msg = navigator.onLine === false ? 'Offline: sincronizzo appena torni online' : 'Non sincronizzato'; el.classList.add('err'); }
    else if (daInviare()) msg = 'Modifiche da sincronizzare…';
    else { msg = ultimaSync ? 'Sincronizzato ' + new Date(ultimaSync).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : 'Collegato'; el.classList.add('ok'); }
    t.textContent = msg;
    $('c-stato').textContent = !url ? 'Non collegato: i dati restano solo su questo dispositivo.'
      : erroreSync ? 'Ultimo tentativo non riuscito: ' + erroreSync
      : ultimaSync ? 'Collegato. Ultima sincronizzazione: ' + new Date(ultimaSync).toLocaleString('it-IT') : 'Collegato.';
  }
  async function sincronizza(manuale) {
    const { url, token } = conf();
    if (!url || !token) { if (manuale) avviso('Prima collega il Foglio Google in Impostazioni.'); statoSync(); return false; }
    if (inSync) { programmaSync(); return false; }
    inSync = true; statoSync('Sincronizzo…');
    try {
      const items = [];
      for (const kind of ['inv', 'calc']) for (const [id, r] of Object.entries(archivio[kind])) if (!r.sync) items.push({ kind, id, agg: r.agg, del: !!r.del, data: r.data });
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token, action: 'sync', items }) });
      let out;
      try { out = await res.json(); } catch { throw new Error('risposta non valida: controlla l\'indirizzo dell\'app web'); }
      if (!out.ok) throw new Error(out.error === 'TOKEN' ? 'codice segreto sbagliato' : (out.error || 'errore del Foglio'));
      for (const it of items) { const r = archivio[it.kind][it.id]; if (r && r.agg === it.agg) r.sync = true; }
      for (const it of out.items || []) {
        if (!archivio[it.kind]) continue;
        const r = archivio[it.kind][it.id];
        if (!r || it.agg > r.agg) archivio[it.kind][it.id] = { agg: it.agg, del: !!it.del, data: it.del ? null : it.data, sync: true };
      }
      salvaArchivio(); caricaDaArchivio(); render(); renderStorico();
      ultimaSync = Date.now(); store.set('ultimaSync', ultimaSync); erroreSync = '';
      if (manuale) avviso('Sincronizzato con il Foglio Google');
      return true;
    } catch (e) {
      erroreSync = navigator.onLine === false ? 'sei offline' : (e && e.message ? e.message : 'connessione non riuscita');
      if (manuale) avviso('Sincronizzazione non riuscita: ' + erroreSync);
      return false;
    } finally {
      inSync = false; statoSync();
    }
  }
  (function impostazioni() {
    const c = conf();
    $('c-url').value = c.url || ''; $('c-token').value = c.token || '';
    $('c-save').addEventListener('click', async () => {
      const url = $('c-url').value.trim(), token = $('c-token').value.trim();
      if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) { avviso('L\'indirizzo deve iniziare con https://script.google.com/ e finire con /exec'); $('c-url').focus(); return; }
      if (!token) { avviso('Incolla il codice segreto'); $('c-token').focus(); return; }
      store.set('sync', { url, token }); erroreSync = '';
      // al primo collegamento si invia tutto quello che c'è su questo dispositivo
      for (const k of ['inv', 'calc']) for (const r of Object.values(archivio[k])) r.sync = false;
      salvaArchivio();
      if (await sincronizza(true)) apriTab('port');
    });
    $('c-sync').addEventListener('click', () => sincronizza(true));
    $('syncStato').addEventListener('click', () => { if (conf().url) sincronizza(true); else apriTab('set'); });
    $('c-off').addEventListener('click', (e) => {
      const b = e.currentTarget;
      if (!b.classList.contains('sure')) { b.classList.add('sure'); b.textContent = 'Conferma: scollega'; setTimeout(() => { b.classList.remove('sure'); b.textContent = 'Scollega'; }, 4000); return; }
      store.set('sync', { url: '', token: '' }); $('c-url').value = ''; $('c-token').value = ''; erroreSync = ''; statoSync();
      b.classList.remove('sure'); b.textContent = 'Scollega';
      avviso('Scollegato: i dati restano su questo dispositivo.');
    });
    $('b-exp').addEventListener('click', () => {
      scaricaFile(`backup_portafoglio_${oggi()}.json`, new Blob([JSON.stringify({ app: 'portafoglio', versione: 1, creato: new Date().toISOString(), archivio }, null, 1)], { type: 'application/json' }));
    });
    $('b-imp').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        const d = JSON.parse(await f.text());
        const a = d && d.archivio;
        if (!a || !a.inv || !a.calc) throw new Error();
        let n = 0;
        for (const k of ['inv', 'calc']) for (const [id, r] of Object.entries(a[k])) {
          const mio = archivio[k][id];
          if (!mio || r.agg > mio.agg) { archivio[k][id] = { agg: r.agg, del: !!r.del, data: r.data, sync: false }; n++; }
        }
        salvaArchivio(); caricaDaArchivio(); render(); renderStorico(); programmaSync();
        avviso(n ? `Ripristinati ${n} elementi dal backup` : 'Il backup non contiene niente di più recente');
      } catch { avviso('Questo file non è un backup del Portafoglio.'); }
    });
  })();
  window.addEventListener('online', () => sincronizza(false));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sincronizza(false); });
  statoSync();
  sincronizza(false);
})();
