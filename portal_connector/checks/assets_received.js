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
const tRow = (when, asset, from, to) => { const r = Array(16).fill(''); r[0] = when; r[2] = from; r[4] = asset; r[12] = to; return r; };
const rRow = (when, asset, site) => { const r = Array(8).fill(''); r[0] = when; r[2] = site; r[3] = asset; return r; };
const book = {
  'Asset Transfer Form': [Array(16).fill('h'),
    tRow(at(1, 9), 'DUMPER A', 'TONK', 'NEWAI'),
    tRow(at(5, 9), 'DUMPER A', 'NEWAI', 'KHAKHUNDA'),       // never received: Pending
    tRow(at(3, 10), 'PUMP B', 'SANWARIYA', 'NEWAI')],
  'Asset Receiving Form': [Array(8).fill('h'),
    rRow(at(1, 8), 'DUMPER A', 'TONK'),                       // a receipt with no transfer before it
    rRow(at(2, 9), 'DUMPER A', 'NEWAI'),
    rRow(at(3, 10), 'PUMP B', 'NEWAI')],                       // same moment as its transfer
  History: Array.from({ length: 5 }, () => Array(9).fill(''))
};
function sheet(name) {
  const g = book[name];
  return {
    getDataRange: () => ({ getValues: () => g.map(r => r.slice()) }),
    getMaxRows: () => g.length,
    getRange: (r, c, nr, nc) => ({
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

/* ---------- the page ---------- */
const html = fs.readFileSync(path.join(DIR, 'Index.html'), 'utf8');
const fnSrc = name => { const i = html.indexOf('function ' + name + '('); let d = 0, j = html.indexOf('{', i); for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && --d === 0) break; } return html.slice(i, j + 1); };
const els = { historyBody: { innerHTML: '' }, histCount: { textContent: '' }, histFilterType: { value: '' }, histFilterLoc: { value: '' }, histSearch: { value: '' } };
const page = vm.createContext({ Date, Math, String, isNaN, document: { getElementById: id => els[id] || null } });
vm.runInContext(['daysSince', 'receivedHtml', 'renderHistoryTable'].map(fnSrc).join('\n') +
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
t('filter "Received" hides pending ones', !/Pending/.test(els.historyBody.innerHTML) && els.historyBody.innerHTML.split('<tr').length - 1 === hist.length - 1);
t('dashboard list shows the received date (or Pending) under the sent date', /Received: ' \+ receivedHtml\(row\)/.test(fnSrc('renderLedger')) && /<th>Sent \/ Received<\/th>/.test(html));
t('asset details show Last Sent and Received On', /Last Sent/.test(fnSrc('showAssetDetail')) && /Received On/.test(fnSrc('showAssetDetail')));

console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
