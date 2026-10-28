// GGM Assets: a dispatched asset must show as in transit and be receivable at the
// destination; receiving it moves it to that site's block in the sheet.
// Replays the KHAKHUNDA case (RJ26GA4678 / 4679 sent from SANWARIYA on 17 Oct).
const vm = require('vm'), fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', '..', 'assets');
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };

/* ---------- fake sheets ---------- */
const grid = (rows, cols) => Array.from({ length: rows }, () => Array(cols).fill(''));
const book = {
  'Present Assets List': grid(120, 21),
  'Asset Transfer Form': [Array(16).fill('h')],
  'Asset Receiving Form': [Array(8).fill('h')],
  'History': grid(5, 9)
};
function sheet(name) {
  const g = () => book[name];
  const pad = (r, c) => { while (g().length < r) g().push(Array(g()[0].length).fill('')); g().forEach(x => { while (x.length < c) x.push(''); }); };
  return {
    getName: () => name,
    getRange: (r, c, nr, nc) => ({
      getValues: () => { pad(r + (nr || 1) - 1, c + (nc || 1) - 1); return g().slice(r - 1, r - 1 + (nr || 1)).map(x => x.slice(c - 1, c - 1 + (nc || 1))); },
      getDisplayValues() { return this.getValues().map(x => x.map(String)); },
      setValues: v => { pad(r + v.length - 1, c + v[0].length - 1); v.forEach((x, i) => x.forEach((y, j) => { g()[r - 1 + i][c - 1 + j] = y; })); },
      clearContent: () => { for (let i = r - 1; i < r - 1 + nr && i < g().length; i++) for (let j = c - 1; j < c - 1 + nc; j++) g()[i][j] = ''; },
      getValue: () => (g()[r - 1] || [])[c - 1]
    }),
    getDataRange() { return this.getRange(1, 1, g().length, g()[0].length); },
    getLastRow: () => g().length, getMaxRows: () => g().length,
    appendRow: row => g().push(row.slice()), deleteRow: r => g().splice(r - 1, 1),
    clearContents: () => { book[name] = [['', '', '']]; }
  };
}
const cacheBox = {}; let vehOpens = 0;
const ss = { insertSheet: n => { book[n] = [['', '', '']]; return sheet(n); }, getSheetByName: n => (book[n] ? sheet(n) : null), getSpreadsheetTimeZone: () => 'Asia/Kolkata' };
const ctx = vm.createContext({ console, JSON, Math, Date, String, Number, Object, Array, isNaN,
  SpreadsheetApp: { openById: id => { if (id === '194PebQBGqTmdrLgrPnpmne_kLCCyQdlKP1a1IzdG2Pw') vehOpens++; return ss; }, flush: () => {} },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  Utilities: { formatDate: d => new Date(d).toISOString(), computeDigest: (a, str) => Array.from(str).map(c => c.charCodeAt(0) % 256),
               base64Encode: b => Buffer.from(b).toString('base64'), DigestAlgorithm: { MD5: 'md5' } },
  CacheService: { getScriptCache: () => ({ get: k => (k in cacheBox ? cacheBox[k] : null), put: (k, v) => { cacheBox[k] = String(v); } }) } });
vm.runInContext(fs.readFileSync(path.join(DIR, 'Code.js'), 'utf8'), ctx);
const R = c => vm.runInContext(c, ctx);
R(`assetsSession_ = function (tok) { var s = tok.toUpperCase(); return { boss: s === 'BOSS', site: s, who: s }; };
   saveMultipleImagesToDrive_ = function () { return ''; };`);

/* ---------- the sheet as in the screenshot ---------- */
const P = book['Present Assets List'];
const COL = { DUMPERS: 7 };                         // C=3 is EXCAVATOR ... G=7 DUMPERS (1-based)
P[24][COL.DUMPERS - 1] = 'RJ26GA4678 (MAHINDRA BLAZO 25 6X4 6C)';   // SANWARIYA block starts row 25
P[25][COL.DUMPERS - 1] = 'RJ26GA4679 (MAHINDRA BLAZO 25 6X4 6C)';
P[42][COL.DUMPERS - 1] = 'RJ26GA5930 (TATA MOTORS)';               // KHAKHUNDA block starts row 43
const tRow = (when, src, cat, name, dst) => { const r = Array(16).fill(''); r[0] = new Date(when); r[1] = 'x'; r[2] = src; r[3] = cat; r[8] = name; r[12] = dst; return r; };
const rRow = (when, dst, name, cat) => { const r = Array(8).fill(''); r[0] = new Date(when); r[1] = 'x'; r[2] = dst; r[3] = name; r[7] = cat; return r; };
book['Asset Transfer Form'].push(
  tRow('2026-09-23T17:00', 'KHAKHUNDA', 'DUMPERS', 'RJ26GA4679 (MAHINDRA BLAZO 25 6X4 6C)', 'SANWARIYA'),
  tRow('2026-10-17T11:42', 'SANWARIYA', 'DUMPERS', 'RJ26GA4678 (MAHINDRA BLAZO 25 6X4 6C)', 'KHAKHUNDA'),
  tRow('2026-10-17T11:43', 'SANWARIYA', 'DUMPERS', 'RJ26GA4679 (MAHINDRA BLAZO 25 6X4 6C)', 'KHAKHUNDA'));
book['Asset Receiving Form'].push(rRow('2026-09-23T17:14', 'SANWARIYA', 'RJ26GA4679 (MAHINDRA BLAZO 25 6X4 6C)', 'DUMPERS'));

const A4678 = 'RJ26GA4678 (MAHINDRA BLAZO 25 6X4 6C)', A4679 = 'RJ26GA4679 (MAHINDRA BLAZO 25 6X4 6C)';
const status = () => R('getGlobalAssetStatus_()');

/* 1. the root cause */
let s = status();
t('dispatched 4678 is IN TRANSIT from SANWARIYA to KHAKHUNDA', s[A4678].status === 'IN_TRANSIT' && s[A4678].location === 'SANWARIYA' && s[A4678].dest === 'KHAKHUNDA');
t('dispatched 4679 too (its older receipt at SANWARIYA does not win)', s[A4679].status === 'IN_TRANSIT' && s[A4679].dest === 'KHAKHUNDA');
const kh = JSON.parse(R(`getDashboardDataUI('KHAKHUNDA')`));
t('KHAKHUNDA dashboard now lists both as incoming', kh.ok && kh.assets[A4678] && kh.assets[A4678].status === 'IN_TRANSIT' && kh.assets[A4679]);

/* 2. the sheet's transfer boxes */
R('runMasterSync()');
const sanK = P.slice(24, 39).map(r => r[10]).filter(Boolean), sanL = P.slice(24, 39).map(r => r[11]).filter(Boolean);
t('sheet: both now sit in SANWARIYA "Asset In Transfer" with "KHAKHUNDA"', sanK.length === 2 && sanL.every(x => x === 'KHAKHUNDA'));
t('sheet: and are gone from the SANWARIYA dumper column', !P.slice(24, 39).some(r => r[COL.DUMPERS - 1] === A4678 || r[COL.DUMPERS - 1] === A4679));

/* 3. receive at KHAKHUNDA */
t('another site cannot receive it', R(`processWebReceive('TONK', '${A4678}', 'TONK', 'DUMPERS')`).success === false);
t('KHAKHUNDA cannot receive it as if at TONK', /only receive at KHAKHUNDA/.test(R(`processWebReceive('KHAKHUNDA', '${A4678}', 'TONK', 'DUMPERS')`).message));
const rec = R(`processWebReceive('KHAKHUNDA', '${A4678}', 'KHAKHUNDA', 'DUMPERS', 'Ram', [], 'ok')`);
t('KHAKHUNDA receives 4678', rec.success === true);
s = status();
t('4678 is now AT BASE at KHAKHUNDA', s[A4678].status === 'AT_BASE' && s[A4678].location === 'KHAKHUNDA');
t('sheet: 4678 is in the KHAKHUNDA dumper column', P.slice(42, 58).some(r => r[COL.DUMPERS - 1] === A4678));
t('sheet: and out of the SANWARIYA transfer box (4679 still there)', P.slice(24, 39).map(r => r[10]).filter(Boolean).join() === A4679);
t('receiving it twice is refused', /nothing to receive/.test(R(`processWebReceive('KHAKHUNDA', '${A4678}', 'KHAKHUNDA', 'DUMPERS')`).message));

/* 4. dispatch rules */
t('cannot dispatch something already on its way', /already on its way/.test(R(`processWebTransfer('SANWARIYA', '${A4679}', 'DUMPERS', 'SANWARIYA', 'TONK')`).message));
t('cannot dispatch from a site it is not at', /is at KHAKHUNDA/.test(R(`processWebTransfer('BOSS', '${A4678}', 'DUMPERS', 'TONK', 'NEWAI')`).message));
const send = R(`processWebTransfer('KHAKHUNDA', '${A4678}', 'DUMPERS', 'KHAKHUNDA', 'NEWAI', 'Ram', [], '')`);
t('a normal dispatch works and shows in transit at once', send.success && status()[A4678].status === 'IN_TRANSIT' && status()[A4678].dest === 'NEWAI');

/* 5. cancel puts it back */
const can = R(`cancelAssetTransfer('KHAKHUNDA', '${A4678}')`);
s = status();
t('cancelling the dispatch puts it back at KHAKHUNDA', can.success && s[A4678].status === 'AT_BASE' && s[A4678].location === 'KHAKHUNDA');
t('an asset nobody moved stays where it is', s['RJ26GA5930 (TATA MOTORS)'].status === 'AT_BASE' && s['RJ26GA5930 (TATA MOTORS)'].location === 'KHAKHUNDA');

/* 6. vehicle details are kept between dashboard refreshes */
R('forgetVehicleDetails_()'); vehOpens = 0; R(`getDashboardDataUI('KHAKHUNDA')`); const first = vehOpens;
R(`getDashboardDataUI('KHAKHUNDA')`); R(`getDashboardDataUI('BOSS')`);
t('the vehicle spreadsheet is read once, not on every refresh (' + first + ' then ' + (vehOpens - first) + ')', first === 1 && vehOpens === 1);
R('forgetVehicleDetails_()'); R(`getDashboardDataUI('KHAKHUNDA')`);
t('adding an asset makes the next refresh read it again', vehOpens === 2);

/* 7. contractor vehicles (Contractors section, columns O-T) */
const CO = { EXCAVATOR: 15, DUMPERS: 19 };          // 1-based: O = 15 ... S = 19
P[3][CO.EXCAVATOR - 1] = 'VOLVO-EC210 (MAT.)';       // TONK contractor excavator, row 4
P[3][CO.DUMPERS - 1] = 'PREMA 1';
s = status();
t('existing contractor vehicles are read as CONTRACTOR at TONK', s['VOLVO-EC210 (MAT.)'].owner === 'CONTRACTOR' && s['PREMA 1'].location === 'TONK' && s['PREMA 1'].cat === 'DUMPERS');
t('own vehicles are marked OWN', s['RJ26GA5930 (TATA MOTORS)'].owner === 'OWN');
const addC = R(`processAddNewAsset('KHAKHUNDA', { name: 'RJ14GC1111 (CONTRACTOR TIPPER)', cat: 'DUMPERS', loc: 'KHAKHUNDA', ownership: 'CONTRACTOR', files: [] })`);
t('adding as Contractor puts it in the KHAKHUNDA Contractors dumper column', addC.success && P.slice(42, 58).some(r => r[CO.DUMPERS - 1] === 'RJ14GC1111 (CONTRACTOR TIPPER)') && !P.slice(42, 58).some(r => r[COL.DUMPERS - 1] === 'RJ14GC1111 (CONTRACTOR TIPPER)'));
t('…and it is remembered in the Asset Owners tab', (book['Asset Owners'] || []).some(r => r[0] === 'RJ14GC1111 (CONTRACTOR TIPPER)' && r[1] === 'CONTRACTOR'));
const addO = R(`processAddNewAsset('KHAKHUNDA', { name: 'RJ14GC2222 (OWN TIPPER)', cat: 'DUMPERS', loc: 'KHAKHUNDA', ownership: 'OWN', files: [] })`);
t('adding as Own vehicle puts it in the Own dumper column', addO.success && P.slice(42, 58).some(r => r[COL.DUMPERS - 1] === 'RJ14GC2222 (OWN TIPPER)'));
t('a contractor Misc. vehicle is refused (no Misc. column there)', /no Misc/.test(R(`processAddNewAsset('KHAKHUNDA', { name: 'PUMP X', cat: 'MISC.', loc: 'KHAKHUNDA', ownership: 'CONTRACTOR', files: [] })`).message));
const CT = 'RJ14GC1111 (CONTRACTOR TIPPER)';
R(`processWebTransfer('KHAKHUNDA', '${CT}', 'DUMPERS', 'KHAKHUNDA', 'NEWAI', 'Ram', [], '')`);
t('contractor vehicle in transit: in KHAKHUNDA transfer box, out of the Contractors column', P.slice(42, 58).some(r => r[10] === CT) && !P.slice(42, 58).some(r => r[CO.DUMPERS - 1] === CT));
t('…still known as CONTRACTOR while moving', status()[CT].owner === 'CONTRACTOR');
R(`processWebReceive('NEWAI', '${CT}', 'NEWAI', 'DUMPERS', 'Ram', [], '')`);
t('received at NEWAI → NEWAI Contractors column, not Own', P.slice(62, 78).some(r => r[CO.DUMPERS - 1] === CT) && !P.slice(62, 78).some(r => r[COL.DUMPERS - 1] === CT));
R(`processWebTransfer('NEWAI', '${CT}', 'DUMPERS', 'NEWAI', 'TONK', 'Ram', [], '')`);
R(`cancelAssetTransfer('NEWAI', '${CT}')`);
t('a cancelled contractor transfer goes back to the Contractors column', P.slice(62, 78).some(r => r[CO.DUMPERS - 1] === CT) && !P.slice(62, 78).some(r => r[COL.DUMPERS - 1] === CT) && status()[CT].status === 'AT_BASE');

/* 8. a full block is never silently cut short */
for (let r = 25; r <= 39; r++) P[r - 1][COL.DUMPERS - 1] = 'SAN-DUMP-' + r;     // SANWARIYA dumpers: all 15 rows full
book['Asset Transfer Form'] = [Array(16).fill('h')]; book['Asset Receiving Form'] = [Array(8).fill('h')];
R(`processWebTransfer('KHAKHUNDA', 'RJ14GC2222 (OWN TIPPER)', 'DUMPERS', 'KHAKHUNDA', 'SANWARIYA', 'Ram', [], '')`);
R(`processWebReceive('SANWARIYA', 'RJ14GC2222 (OWN TIPPER)', 'SANWARIYA', 'DUMPERS', 'Ram', [], '')`);
const sanD = P.slice(24, 39).map(r => r[COL.DUMPERS - 1]).filter(Boolean);
t('16 dumpers for a 15-row block: the block is left as it was, no name dropped', sanD.length === 15 && sanD.every(n => /^SAN-DUMP-/.test(n)));

/* 9. removing an asset (admin / boss only) */
const OWN1 = 'RJ26GA5930 (TATA MOTORS)';
t('a site login cannot remove', /Only the admin/.test(R(`removeAsset('KHAKHUNDA', '${OWN1}', 'sold')`).message));
t('a reason is required', /why it is being removed/.test(R(`removeAsset('BOSS', '${OWN1}', '  ')`).message));
R(`processWebTransfer('BOSS', 'PREMA 1', 'DUMPERS', 'TONK', 'NEWAI', 'Ram', [], '')`);
t('a vehicle on its way cannot be removed', /on its way to NEWAI/.test(R(`removeAsset('BOSS', 'PREMA 1', 'contract ended')`).message));
const rm = R(`removeAsset('BOSS', '${OWN1}', 'sold to scrap dealer')`);
t('the boss removes an own vehicle at base', rm.success && !status()[OWN1] && !P.slice(42, 58).some(r => r.indexOf(OWN1) > -1));
const logRow = (book['Removed Assets'] || []).find(r => r[1] === OWN1);
t('…and it is on record with who, site and reason', logRow && logRow[4] === 'KHAKHUNDA' && logRow[5] === 'BOSS' && logRow[6] === 'sold to scrap dealer' && logRow[3] === 'Own');
const rmC = R(`removeAsset('BOSS', 'VOLVO-EC210 (MAT.)', 'contract ended')`);
t('a contractor vehicle is removed from the Contractors column', rmC.success && !P.slice(3, 21).some(r => r[CO.EXCAVATOR - 1] === 'VOLVO-EC210 (MAT.)') && !(book['Asset Owners'] || []).some(r => r[0] === 'VOLVO-EC210 (MAT.)'));
t('removing it again says it is not there', /not in the asset list/.test(R(`removeAsset('BOSS', '${OWN1}', 'again')`).message));
book['Removed Assets'].forEach(r => { if (r[1] === OWN1) r[0] = new Date(Date.now() - 1000); });   // removal a moment ago
book['Asset Receiving Form'].push(rRow(new Date(Date.now() - 5000).toISOString(), 'KHAKHUNDA', OWN1, 'DUMPERS'));   // an old receipt
R(`processAddNewAsset('BOSS', { name: '${OWN1}', cat: 'DUMPERS', loc: 'TONK', ownership: 'OWN', files: [] })`);
t('added again at TONK, its old receipt at KHAKHUNDA does not move it back', status()[OWN1] && status()[OWN1].location === 'TONK');

console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
