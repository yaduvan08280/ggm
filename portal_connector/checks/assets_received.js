// GGM Assets: every movement shows when it was received, or "Pending" while it is on the way
// (12 Nov 2026: only the transfer date was visible). The History tab pairs each transfer with
// the first receipt of that asset after it - by time, not by count.
process.env.TZ = 'Asia/Kolkata';
const vm = require('vm'), fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', '..', 'assets');
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };

/* ---------- server: the History tab ---------- */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = n => String(n).padStart(2, '0');
const fmt = d => { d = new Date(d); const h = d.getHours(); return pad(d.getDate()) + '-' + MON[d.getMonth()] + '-' + d.getFullYear() + ' | ' + pad(h % 12 || 12) + ':' + pad(d.getMinutes()) + ' ' + (h < 12 ? 'AM' : 'PM'); };
const at = (day, h) => new Date(2026, 10, day, h, 0);
const tRow = (when, asset, from, to, driver, photos) => { const r = Array(16).fill(''); r[0] = when; r[1] = 'tonk.user'; r[2] = from; r[4] = asset; r[12] = to; r[13] = driver || 'RAMESH'; r[14] = photos || ''; r[15] = 'handle with care'; return r; };
const rRow = (when, asset, site, photos) => { const r = Array(8).fill(''); r[0] = when; r[1] = 'newai.user'; r[2] = site; r[3] = asset; r[4] = 'SURESH'; r[5] = 'ok'; r[6] = photos || ''; return r; };
const PH1 = 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view', PH2 = 'https://drive.google.com/open?id=1ZyXwVuTsRqPoNmLkJiHgFeDcBa98765';
const book = {
  'Asset Transfer Form': [Array(16).fill('h'),
    tRow(at(1, 9), 'DUMPER A', 'TONK', 'NEWAI'),
    tRow(at(5, 9), 'DUMPER A', 'NEWAI', 'KHAKHUNDA'),       // never received: Pending
    tRow(at(3, 10), 'PUMP B', 'SANWARIYA', 'NEWAI', 'KALU', PH1)],
  'Asset Receiving Form': [Array(8).fill('h'),
    rRow(at(1, 8), 'DUMPER A', 'TONK'),                       // a receipt with no transfer before it
    rRow(at(2, 9), 'DUMPER A', 'NEWAI'),
    rRow(at(3, 10), 'PUMP B', 'NEWAI', PH2)],                  // same moment as its transfer
  'Cancelled Transfers': [Array(12).fill('h'),
    [at(4, 12), 'tonk.user', 'JCB C', 'JCB', 'TONK', 'NEWAI', 'MOHAN', at(4, 11), 'tonk.user', '', '', 'wrong asset picked']],
  History: Array.from({ length: 5 }, () => Array(9).fill(''))
};
function sheet(name) {
  const g = book[name];
  return {
    getDataRange: () => ({ getValues: () => g.map(r => r.slice()) }),
    getMaxRows: () => g.length, getLastRow: () => g.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => g.slice(r - 1, r - 1 + nr).map(row => { const o = row.slice(c - 1, c - 1 + nc); while (o.length < nc) o.push(''); return o; }),
      clearContent() { for (let i = r - 1; i < r - 1 + nr && i < g.length; i++) for (let j = c - 1; j < c - 1 + nc; j++) g[i][j] = ''; },
      setValues(v) { v.forEach((row, i) => { while (g.length < r + i) g.push(Array(9).fill('')); row.forEach((x, j) => { g[r - 1 + i][c - 1 + j] = x; }); }); }
    })
  };
}
const ss = { getSheetByName: n => (book[n] ? sheet(n) : null), getSpreadsheetTimeZone: () => 'Asia/Kolkata' };
const ctx = vm.createContext({ console, JSON, Math, Date, String, Number, Object, Array, isNaN,
  SpreadsheetApp: { openById: () => ss }, Utilities: { formatDate: d => fmt(d) } });
vm.runInContext(fs.readFileSync(path.join(DIR, 'Code.js'), 'utf8'), ctx);
vm.runInContext('updateHistorySafe()', ctx);
const hist = book.History.slice(5).filter(r => r[1] || r[6]).map(r => r.slice(1));
const find = (asset, sent) => hist.find(r => r[1] === asset && r[0] === fmt(sent));

const a1 = find('DUMPER A', at(1, 9));
t('a transfer is paired with the receipt after it (not the earlier one)', a1 && a1[5] === fmt(at(2, 9)) && a1[7] === 'NEWAI');
const a2 = find('DUMPER A', at(5, 9));
t('a transfer not received yet has no receipt (the app shows Pending)', a2 && a2[5] === '-' && a2[3] === 'KHAKHUNDA');
t('a receipt with no transfer before it stays on its own row', hist.some(r => r[0] === '-' && r[6] === 'DUMPER A' && r[5] === fmt(at(1, 8))));
const b = find('PUMP B', at(3, 10));
t('a receipt stamped the same moment as its transfer counts as received', b && b[5] === fmt(at(3, 10)));
t('newest first', hist[0][0] === fmt(at(5, 9)));
t('History keeps who sent it, the driver, photos and remarks, and the same for the receipt', b && b[9] === 'tonk.user' && b[10] === 'KALU' && b[11] === PH1 && b[12] === 'handle with care' &&
  b[13] === 'newai.user' && b[14] === 'SURESH' && b[15] === PH2 && b[16] === 'ok' && book.History[4][10] === 'Sent By');
const cx = find('JCB C', at(4, 11));
t('a cancelled transfer stays in the log with when, who and why', cx && cx[5] === '-' && /\| tonk\.user \| wrong asset picked$/.test(cx[17]) && cx[10] === 'MOHAN');
t('photo links are read as Drive file ids', vm.runInContext(`photoIds_(${JSON.stringify(PH1 + ' \n ' + PH2)}).join()`, ctx) === '1AbCdEfGhIjKlMnOpQrStUvWxYz012345,1ZyXwVuTsRqPoNmLkJiHgFeDcBa98765');
const code = fs.readFileSync(path.join(DIR, 'Code.js'), 'utf8');
t('a transfer needs a driver name (server)', /if \(!String\(driverName \|\| ''\)\.trim\(\)\) return \{ success: false/.test(code));
t('cancelling needs a reason, is only for an asset on its way, and is recorded', /function cancelAssetTransfer\(token, assetName, reason\)/.test(code) && /reason\.length < 3/.test(code) &&
  /moving\.status !== 'IN_TRANSIT'/.test(code) && /cs\.appendRow\(\[new Date\(\), sess\.who, assetName/.test(code));
t('photos are only served for movements, behind the app sign-in', /function getAssetPhotos\(token, ids, full\) \{\n  assetsSession_\(token\);/.test(code) && /if \(!allowed\[id\]\)/.test(code));

/* ---------- the page ---------- */
const html = fs.readFileSync(path.join(DIR, 'Index.html'), 'utf8');
const fnSrc = name => { const i = html.indexOf('function ' + name + '('); let d = 0, j = html.indexOf('{', i); for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && --d === 0) break; } return html.slice(i, j + 1); };
const els = { historyBody: { innerHTML: '' }, histCount: { textContent: '' }, histFilterType: { value: '' }, histFilterLoc: { value: '' }, histSearch: { value: '' } };
const page = vm.createContext({ Date, Math, String, isNaN, document: { getElementById: id => els[id] || null } });
vm.runInContext(['daysSince', 'escH', 'shortDate', 'photoIdsOf', 'cancelInfo', 'photoStrip', 'mvCard', 'receivedHtml', 'renderHistoryTable'].map(fnSrc).join('\n') +
  '\nvar APP = { assets: {}, history: [] }; function getCatIcon() { return "fa-box"; }', page);
const P = c => vm.runInContext(c, page);
page.__h = hist; P('APP.history = __h');

const today = new Date(); const sent3 = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 3, 10, 0);
page.__r = [fmt(sent3), 'X', 'TONK', 'NEWAI', '', '-', '-', '-'];
t('not received: "Pending" with how long it has been on the way', /Pending &middot; 3 days/.test(P('receivedHtml(__r)')));
page.__r = [fmt(sent3), 'X', 'TONK', 'NEWAI', '', '05-Nov-2026 | 10:00 AM', 'X', 'NEWAI'];
t('received: the receiving date', /05-Nov-2026 \| 10:00 AM/.test(P('receivedHtml(__r)')) && !/Pending/.test(P('receivedHtml(__r)')));

P('renderHistoryTable()');
const rows = els.historyBody.innerHTML.split('<tr').slice(1);
t('History Logs: one row per movement with a Received On column', rows.length === hist.length && /Received On/.test(html) && /<th>Sent On<\/th>/.test(html));
t('…the open transfer shows Pending, the received ones their date', rows.some(r => /DUMPER A/.test(r) && /KHAKHUNDA/.test(r) && /Pending/.test(r)) &&
  rows.some(r => /DUMPER A/.test(r) && r.indexOf(fmt(at(2, 9))) > -1));
els.histFilterType.value = 'PENDING'; P('renderHistoryTable()');
t('filter "Not Received Yet" lists only pending ones', els.historyBody.innerHTML.split('<tr').length - 1 === 1 && /Pending/.test(els.historyBody.innerHTML));
els.histFilterType.value = 'RECEIVED'; P('renderHistoryTable()');
t('filter "Received" hides pending ones', !/Pending/.test(els.historyBody.innerHTML) && els.historyBody.innerHTML.split('<tr').length - 1 === hist.filter(r => r[5] !== '-' && !r[17]).length);
els.histFilterType.value = 'CANCELLED'; P('renderHistoryTable()');
t('filter "Cancelled" lists the cancelled one with its reason', els.historyBody.innerHTML.split('<tr').length - 1 === 1 && /wrong asset picked/.test(els.historyBody.innerHTML) && /JCB C/.test(els.historyBody.innerHTML));
els.histFilterType.value = ''; els.histSearch.value = 'kalu'; P('renderHistoryTable()');
t('search finds a movement by driver name', els.historyBody.innerHTML.split('<tr').length - 1 === 1 && /PUMP B/.test(els.historyBody.innerHTML));
const pumpCard = P(`mvCard(APP.history.find(r => r[1] === 'PUMP B'), '')`);
t('phone tile: asset, route, sent + received time, driver and both photos in one compact card', /PUMP B/.test(pumpCard) && /SANWARIYA/.test(pumpCard) && /KALU/.test(pumpCard) &&
  /03 Nov, 10:00 AM/.test(pumpCard) && (pumpCard.match(/class="ph"/g) || []).length === 2 && /Sent<\/span>/.test(pumpCard) && /Recv<\/span>/.test(pumpCard));
t('…the tile is plain text-safe (no HTML from the sheet runs)', !/<b>x<\/b>/.test(P(`mvCard(['01-Nov-2026 | 09:00 AM', 'A', 'TONK', 'NEWAI', '', '-', '-', '-', '', '', '<b>x</b>', '', '', '', '', '', '', ''], '')`)));
els.histSearch.value = '';
t('driver name is required on the transfer form', /<label class="form-label">Driver Name \/ Vehicle No\.<span class="req">\*<\/span>/.test(html) && /if \(!driver\) \{ toast/.test(html));
t('cancel asks for a reason and sends it', /id="cancelReason"/.test(html) && /cancelAssetTransfer\(assetsToken\(\), name, reason\)/.test(html) && /reason\.length < 3/.test(fnSrc('executeCancelTransfer')));
t('filter bars: search + a Filters button with the dropdowns folded away on phones', /id="histFilters"/.test(html) && /id="fleetFilters"/.test(html) && (html.match(/class="filter-toggle"/g) || []).length === 2 && /\.filter-row\.open \.filter-panel \{ display: grid; \}/.test(html));
t('dashboard list shows the received date (or Pending) under the sent date', /Received: ' \+ receivedHtml\(row\)/.test(fnSrc('renderLedger')) && /<th>Sent \/ Received<\/th>/.test(html));
t('asset details show Last Sent and Received On', /Last Sent/.test(fnSrc('showAssetDetail')) && /Received On/.test(fnSrc('showAssetDetail')));

console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
