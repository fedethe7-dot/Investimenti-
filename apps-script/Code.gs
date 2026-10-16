/**
 * Portafoglio di Federico: sincronizzazione con questo Foglio Google.
 *
 * Il foglio "Dati" contiene una riga per ogni investimento o calcolo salvato (in formato tecnico):
 * non modificarlo a mano. I fogli "Investimenti" e "Calcoli" sono una copia leggibile,
 * riscritta a ogni sincronizzazione.
 *
 * Installazione: incolla questo file, esegui "setup", poi Distribuisci › Nuova distribuzione › App web
 * (Esegui come: Me · Chi ha accesso: Chiunque). Ogni richiesta senza il codice segreto viene rifiutata.
 */

var FOGLIO_DATI = 'Dati';
var INTESTAZIONE = ['tipo', 'id', 'aggiornato', 'cancellato', 'dati', 'aggiornato_il'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Investimenti')
    .addItem('Mostra codice segreto', 'mostraCodice')
    .addItem('Crea un nuovo codice segreto', 'nuovoCodice')
    .addToUi();
}

/** Da eseguire una volta dall'editor: prepara il foglio e crea il codice segreto. */
function setup() {
  foglioDati_();
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN')) props.setProperty('TOKEN', Utilities.getUuid().replace(/-/g, ''));
  Logger.log('Codice segreto: ' + props.getProperty('TOKEN'));
  try { mostraCodice(); } catch (e) { /* eseguito dall'editor: il codice è nel registro */ }
}

function mostraCodice() {
  var t = PropertiesService.getScriptProperties().getProperty('TOKEN') || '(esegui prima setup)';
  SpreadsheetApp.getUi().alert('Codice segreto da incollare nell\'app (Impostazioni):\n\n' + t);
}

function nuovoCodice() {
  PropertiesService.getScriptProperties().setProperty('TOKEN', Utilities.getUuid().replace(/-/g, ''));
  mostraCodice();
}

function doGet() {
  return json_({ ok: true, app: 'portafoglio', messaggio: 'App web attiva. Usa questo indirizzo nelle Impostazioni dell\'app.' });
}

function doPost(e) {
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token || req.token !== token) return json_({ ok: false, error: 'TOKEN' });
    if (req.action === 'sync') return json_({ ok: true, items: sync_(req.items || []) });
    return json_({ ok: false, error: 'Azione sconosciuta' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/** Unisce le modifiche arrivate dall'app (vince la più recente) e restituisce tutto. */
function sync_(items) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = foglioDati_();
    var n = sh.getLastRow() - 1;
    var righe = n > 0 ? sh.getRange(2, 1, n, INTESTAZIONE.length).getValues() : [];
    var pos = {};
    righe.forEach(function (r, i) { pos[r[0] + '|' + r[1]] = i; });
    var cambiato = false;
    items.forEach(function (it) {
      if (!it || (it.kind !== 'inv' && it.kind !== 'calc') || !it.id) return;
      var k = it.kind + '|' + it.id;
      var riga = [it.kind, String(it.id), Number(it.agg) || 0, it.del ? true : false, it.del ? '' : JSON.stringify(it.data || {}), new Date()];
      if (riga[4].length > 49000) throw new Error('Elemento troppo grande per il foglio: ' + it.id);
      if (pos[k] === undefined) { pos[k] = righe.length; righe.push(riga); cambiato = true; }
      else if (Number(righe[pos[k]][2]) < riga[2]) { righe[pos[k]] = riga; cambiato = true; }
    });
    if (cambiato && righe.length) {
      sh.getRange(2, 1, righe.length, INTESTAZIONE.length).setValues(righe);
      try { aggiornaFogliLeggibili_(righe); } catch (e) { /* la copia leggibile non deve bloccare la sincronizzazione */ }
    }
    return righe.map(function (r) {
      var data = null;
      if (!r[3] && r[4]) { try { data = JSON.parse(r[4]); } catch (e) { data = null; } }
      return { kind: r[0], id: String(r[1]), agg: Number(r[2]) || 0, del: r[3] === true || r[3] === 'TRUE', data: data };
    });
  } finally {
    lock.releaseLock();
  }
}

function aggiornaFogliLeggibili_(righe) {
  var ss = SpreadsheetApp.getActive();
  var inv = [['Investimento', 'Tipo', 'ISIN', 'Hai messo', 'Ultimo valore', 'Data valore']];
  var calc = [['Data', 'Nome', 'Tipo', 'Banca', 'Prezzo', 'TAN %', 'TAEG %', 'Rata', 'Costo finale', 'Netto finale (simulazioni)', 'Note']];
  righe.forEach(function (r) {
    if (r[3] === true || r[3] === 'TRUE' || !r[4]) return;
    var d; try { d = JSON.parse(r[4]); } catch (e) { return; }
    if (r[0] === 'inv') {
      var versato = 0; (d.movimenti || []).forEach(function (m) { versato += m.tipo === 'prelievo' ? -m.importo : m.importo; });
      var vals = (d.valori || []).slice().sort(function (a, b) { return a.data < b.data ? -1 : 1; });
      var u = vals[vals.length - 1];
      inv.push([d.nome || '', d.tipo || '', d.isin || '', versato, u ? u.valore : versato, u ? u.data : '']);
    } else {
      var i = d.input || {}, s = d.ris || {};
      calc.push([(d.data || '').slice(0, 10), d.nome || '', d.tipo || '', d.banca || '', i.prezzo || '', d.tipo === 'sim' ? i.r : i.tan,
        s.taeg ? Math.round(s.taeg * 10000) / 100 : '', s.rata || '', s.costoFinale || '', s.netto || '', d.note || '']);
    }
  });
  scriviFoglio_(ss, 'Investimenti', inv);
  scriviFoglio_(ss, 'Calcoli', calc);
}

function scriviFoglio_(ss, nome, valori) {
  var sh = ss.getSheetByName(nome) || ss.insertSheet(nome);
  sh.clearContents();
  sh.getRange(1, 1, valori.length, valori[0].length).setValues(valori);
  sh.getRange(1, 1, 1, valori[0].length).setFontWeight('bold');
  sh.setFrozenRows(1);
}

function foglioDati_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(FOGLIO_DATI);
  if (!sh) {
    sh = ss.insertSheet(FOGLIO_DATI);
    sh.getRange(1, 1, 1, INTESTAZIONE.length).setValues([INTESTAZIONE]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
