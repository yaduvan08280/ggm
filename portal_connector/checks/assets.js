// GGM Assets: a dispatched asset must show as in transit and be receivable at the
// destination; receiving it moves it to that site's columns in the sheet.
// Replays the KHAKHUNDA case (RJ26GA4678 / 4679 sent from SANWARIYA on 17 Oct).
const vm = require('vm'), fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', '..', 'assets');
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };

/* ---------- fake sheets ---------- */
const grid = (rows, cols) => Array.from({ length: rows }, () => Array(cols).fill(''));
const SITES = ['TONK', 'SANWARIYA', 'KHAKHUNDA', 'NEWAI', 'AMARGARH', 'KACHOLA FACTORY'];
const OWNH = ['EXCAVATOR', 'TRACTORS', 'VAN & TANKERS', 'JCB', 'DUMPERS', 'CRAWLER/ COMP.', 'MISC.', 'Asset In Transfer', 'Transferred Location'];
const CONH = ['EXCAVATOR', 'TRACTORS', 'VAN & TANKERS', 'JCB', 'DUMPERS', 'CRAWLER/ COMP.'];
function siteTab(heads) {                       // row 2 site names, row 3 headings, data from row 4 (20 rows to start)
  const w = heads.length, g = grid(23, SITES.length * (w + 1));
  SITES.forEach((s, i) => { g[1][i * (w + 1)] = s; heads.forEach((h, j) => { g[2][i * (w + 1) + j] = h; }); });
  return g;
}
const book = {
  'Owned By Us': siteTab(OWNH),
  'Contractor Vehicles': siteTab(CONH),
  'Asset Transfer Form': [Array(16).fill('h')],
  'Asset Receiving Form': [Array(8).fill('h')],
  'History': grid(5, 9)
};
function sheet(name) {
  const g = () => book[name];
  const pad = (r, c) => { while (g().length < r) g().push(Array(g()[0].length).fill('')); g().forEach(x => { while (x.length < c) x.push(''); }); };
  const last = () => { for (let i = g().length; i > 0; i--) if (g()[i - 1].some(v => v !== '')) return i; return 0; };
  return {
    getName: () => name,
    getRange: (r, c, nr, nc) => ({
      getValues: () => { pad(r + (nr || 1) - 1, c + (nc || 1) - 1); return g().slice(r - 1, r - 1 + (nr || 1)).map(x => x.slice(c - 1, c - 1 + (nc || 1))); },
      getDisplayValues() { return this.getValues().map(x => x.map(String)); },
      setValues: v => { pad(r + v.length - 1, c + v[0].length - 1); v.forEach((x, i) => x.forEach((y, j) => { g()[r - 1 + i][c - 1 + j] = y; })); },
      setValue: v => { pad(r, c); g()[r - 1][c - 1] = v; },
      clearContent: () => { for (let i = r - 1; i < r - 1 + nr && i < g().length; i++) for (let j = c - 1; j < c - 1 + nc; j++) g()[i][j] = ''; },
      getValue: () => (g()[r - 1] || [])[c - 1]
    }),
    getDataRange() { return this.getRange(1, 1, g().length, g()[0].length); },
    getLastRow: () => /Owned|Contractor/.test(name) ? last() : g().length, getMaxRows: () => g().length,
    getLastColumn: () => g()[0].length,
    insertRowsAfter: (after, n) => { for (let i = 0; i < n; i++) g().push(Array(g()[0].length).fill('')); },
    appendRow: row => g().push(row.slice()), deleteRow: r => g().splice(r - 1, 1),
    clearContents: () => { book[name] = [['', '', '']]; }
  };
}
const cacheBox = {}; let vehOpens = 0;
const ss = { insertSheet: n => { book[n] = [['', '', '']]; return sheet(n); }, getSheetByName: n => (book[n] ? sheet(n) : null), getSpreadsheetTimeZone: () => 'Asia/Kolkata' };
const ctx = vm.createContext({ console, Logger: { log: () => {} }, JSON, Math, Date, String, Number, Object, Array, isNaN,
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
const colOf = (tab, site, head) => { const heads = tab === 'Owned By Us' ? OWNH : CONH; return SITES.indexOf(site) * (heads.length + 1) + heads.indexOf(head); };
const list = (tab, site, head) => book[tab].slice(3).map(r => r[colOf(tab, site, head)]).filter(Boolean);   // names in a column
const put = (tab, site, head, i, v) => { while (book[tab].length < 4 + i) book[tab].push(Array(book[tab][0].length).fill('')); book[tab][3 + i][colOf(tab, site, head)] = v; };
const OWN = 'Owned By Us', CON = 'Contractor Vehicles';
put(OWN, 'SANWARIYA', 'DUMPERS', 0, 'RJ26GA4678 (MAHINDRA BLAZO 25 6X4 6C)');
put(OWN, 'SANWARIYA', 'DUMPERS', 1, 'RJ26GA4679 (MAHINDRA BLAZO 25 6X4 6C)');
put(OWN, 'KHAKHUNDA', 'DUMPERS', 0, 'RJ26GA5930 (TATA MOTORS)');
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
const sanK = list(OWN, 'SANWARIYA', 'Asset In Transfer'), sanL = list(OWN, 'SANWARIYA', 'Transferred Location');
t('sheet: both now sit in SANWARIYA "Asset In Transfer" with "KHAKHUNDA"', sanK.length === 2 && sanL.every(x => x === 'KHAKHUNDA'));
t('sheet: and are gone from the SANWARIYA dumper column', !list(OWN, 'SANWARIYA', 'DUMPERS').some(n => n === A4678 || n === A4679));

/* 3. receive at KHAKHUNDA */
t('another site cannot receive it', R(`processWebReceive('TONK', '${A4678}', 'TONK', 'DUMPERS')`).success === false);
t('KHAKHUNDA cannot receive it as if at TONK', /only receive at KHAKHUNDA/.test(R(`processWebReceive('KHAKHUNDA', '${A4678}', 'TONK', 'DUMPERS')`).message));
const rec = R(`processWebReceive('KHAKHUNDA', '${A4678}', 'KHAKHUNDA', 'DUMPERS', 'Ram', [], 'ok')`);
t('KHAKHUNDA receives 4678', rec.success === true);
s = status();
t('4678 is now AT BASE at KHAKHUNDA', s[A4678].status === 'AT_BASE' && s[A4678].location === 'KHAKHUNDA');
t('sheet: 4678 is in the KHAKHUNDA dumper column', list(OWN, 'KHAKHUNDA', 'DUMPERS').includes(A4678));
t('sheet: and out of the SANWARIYA transfer box (4679 still there)', list(OWN, 'SANWARIYA', 'Asset In Transfer').join() === A4679);
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
put(CON, 'TONK', 'EXCAVATOR', 0, 'VOLVO-EC210 (MAT.)');
put(CON, 'TONK', 'DUMPERS', 0, 'PREMA 1');
s = status();
t('existing contractor vehicles are read as CONTRACTOR at TONK', s['VOLVO-EC210 (MAT.)'].owner === 'CONTRACTOR' && s['PREMA 1'].location === 'TONK' && s['PREMA 1'].cat === 'DUMPERS');
t('own vehicles are marked OWN', s['RJ26GA5930 (TATA MOTORS)'].owner === 'OWN');
const addC = R(`processAddNewAsset('KHAKHUNDA', { name: 'RJ14GC1111 (CONTRACTOR TIPPER)', cat: 'DUMPERS', loc: 'KHAKHUNDA', ownership: 'CONTRACTOR', files: [] })`);
t('adding as Contractor puts it in the KHAKHUNDA Contractors dumper column', addC.success && list(CON, 'KHAKHUNDA', 'DUMPERS').includes('RJ14GC1111 (CONTRACTOR TIPPER)') && !list(OWN, 'KHAKHUNDA', 'DUMPERS').includes('RJ14GC1111 (CONTRACTOR TIPPER)'));
t('…and it is remembered in the Asset Owners tab', (book['Asset Owners'] || []).some(r => r[0] === 'RJ14GC1111 (CONTRACTOR TIPPER)' && r[1] === 'CONTRACTOR'));
const addO = R(`processAddNewAsset('KHAKHUNDA', { name: 'RJ14GC2222 (OWN TIPPER)', cat: 'DUMPERS', loc: 'KHAKHUNDA', ownership: 'OWN', files: [] })`);
t('adding as Own vehicle puts it in the Own dumper column', addO.success && list(OWN, 'KHAKHUNDA', 'DUMPERS').includes('RJ14GC2222 (OWN TIPPER)'));
t('a contractor Misc. vehicle is refused (no Misc. column there)', /no Misc/.test(R(`processAddNewAsset('KHAKHUNDA', { name: 'PUMP X', cat: 'MISC.', loc: 'KHAKHUNDA', ownership: 'CONTRACTOR', files: [] })`).message));
const CT = 'RJ14GC1111 (CONTRACTOR TIPPER)';
R(`processWebTransfer('KHAKHUNDA', '${CT}', 'DUMPERS', 'KHAKHUNDA', 'NEWAI', 'Ram', [], '')`);
t('contractor vehicle in transit: in KHAKHUNDA transfer box, out of the Contractors column', list(OWN, 'KHAKHUNDA', 'Asset In Transfer').includes(CT) && !list(CON, 'KHAKHUNDA', 'DUMPERS').includes(CT));
t('…still known as CONTRACTOR while moving', status()[CT].owner === 'CONTRACTOR');
R(`processWebReceive('NEWAI', '${CT}', 'NEWAI', 'DUMPERS', 'Ram', [], '')`);
t('received at NEWAI → NEWAI Contractors column, not Own', list(CON, 'NEWAI', 'DUMPERS').includes(CT) && !list(OWN, 'NEWAI', 'DUMPERS').includes(CT));
R(`processWebTransfer('NEWAI', '${CT}', 'DUMPERS', 'NEWAI', 'TONK', 'Ram', [], '')`);
R(`cancelAssetTransfer('NEWAI', '${CT}')`);
t('a cancelled contractor transfer goes back to the Contractors column', list(CON, 'NEWAI', 'DUMPERS').includes(CT) && !list(OWN, 'NEWAI', 'DUMPERS').includes(CT) && status()[CT].status === 'AT_BASE');

/* 8. a long list just runs further down (no row limit any more) */
for (let i = 0; i < 40; i++) put(OWN, 'SANWARIYA', 'DUMPERS', i, 'SAN-DUMP-' + String(i).padStart(2, '0'));   // 40 dumpers, past the 20 rows the tab had
book['Asset Transfer Form'] = [Array(16).fill('h')]; book['Asset Receiving Form'] = [Array(8).fill('h')];
R(`processWebTransfer('KHAKHUNDA', 'RJ14GC2222 (OWN TIPPER)', 'DUMPERS', 'KHAKHUNDA', 'SANWARIYA', 'Ram', [], '')`);
R(`processWebReceive('SANWARIYA', 'RJ14GC2222 (OWN TIPPER)', 'SANWARIYA', 'DUMPERS', 'Ram', [], '')`);
const sanD = list(OWN, 'SANWARIYA', 'DUMPERS');
t('41 dumpers at SANWARIYA: all kept, the new one included', sanD.length === 41 && sanD.includes('RJ14GC2222 (OWN TIPPER)') && sanD.filter(n => /^SAN-DUMP-/.test(n)).length === 40);
t('...and the other sites were not touched', list(OWN, 'TONK', 'DUMPERS').length === 0 && list(CON, 'NEWAI', 'DUMPERS').includes(CT));
const addLong = R(`processAddNewAsset('SANWARIYA', { name: 'RJ14ZZ0001 (NEW)', cat: 'DUMPERS', loc: 'SANWARIYA', ownership: 'OWN', files: [] })`);
t('adding one more never says "no empty slot"', addLong.success && list(OWN, 'SANWARIYA', 'DUMPERS').includes('RJ14ZZ0001 (NEW)'));

/* 9. removing an asset (admin / boss only) */
const OWN1 = 'RJ26GA5930 (TATA MOTORS)';
t('a site login cannot remove', /Only the admin/.test(R(`removeAsset('KHAKHUNDA', '${OWN1}', 'sold')`).message));
t('a reason is required', /why it is being removed/.test(R(`removeAsset('BOSS', '${OWN1}', '  ')`).message));
R(`processWebTransfer('BOSS', 'PREMA 1', 'DUMPERS', 'TONK', 'NEWAI', 'Ram', [], '')`);
t('a vehicle on its way cannot be removed', /on its way to NEWAI/.test(R(`removeAsset('BOSS', 'PREMA 1', 'contract ended')`).message));
const rm = R(`removeAsset('BOSS', '${OWN1}', 'sold to scrap dealer')`);
t('the boss removes an own vehicle at base', rm.success && !status()[OWN1] && !OWNH.some(h => list(OWN, 'KHAKHUNDA', h).includes(OWN1)));
const logRow = (book['Removed Assets'] || []).find(r => r[1] === OWN1);
t('…and it is on record with who, site and reason', logRow && logRow[4] === 'KHAKHUNDA' && logRow[5] === 'BOSS' && logRow[6] === 'sold to scrap dealer' && logRow[3] === 'Own');
const rmC = R(`removeAsset('BOSS', 'VOLVO-EC210 (MAT.)', 'contract ended')`);
t('a contractor vehicle is removed from the Contractors column', rmC.success && !list(CON, 'TONK', 'EXCAVATOR').includes('VOLVO-EC210 (MAT.)') && !(book['Asset Owners'] || []).some(r => r[0] === 'VOLVO-EC210 (MAT.)'));
t('removing it again says it is not there', /not in the asset list/.test(R(`removeAsset('BOSS', '${OWN1}', 'again')`).message));
book['Removed Assets'].forEach(r => { if (r[1] === OWN1) r[0] = new Date(Date.now() - 1000); });   // removal a moment ago
book['Asset Receiving Form'].push(rRow(new Date(Date.now() - 5000).toISOString(), 'KHAKHUNDA', OWN1, 'DUMPERS'));   // an old receipt
R(`processAddNewAsset('BOSS', { name: '${OWN1}', cat: 'DUMPERS', loc: 'TONK', ownership: 'OWN', files: [] })`);
t('added again at TONK, its old receipt at KHAKHUNDA does not move it back', status()[OWN1] && status()[OWN1].location === 'TONK');

/* 10. a form that spells the category "TRACTOR" still files it under TRACTORS */
R(`processAddNewAsset('BOSS', { name: 'TR-1 TRACTOR', cat: 'TRACTORS', loc: 'TONK', ownership: 'OWN', files: [] })`);
R(`processWebTransfer('BOSS', 'TR-1 TRACTOR', 'TRACTOR', 'TONK', 'NEWAI', 'Ram', [], '')`);
book['Asset Receiving Form'].push(rRow(new Date(Date.now() + 1000).toISOString(), 'NEWAI', 'TR-1 TRACTOR', 'TRACTOR'));
R('runMasterSync()');
t('received as "TRACTOR" -> NEWAI TRACTORS column, not MISC.', list(OWN, 'NEWAI', 'TRACTORS').includes('TR-1 TRACTOR') && !list(OWN, 'NEWAI', 'MISC.').includes('TR-1 TRACTOR'));
vm.runInContext(fs.readFileSync(path.join(DIR, 'Migrate.js'), 'utf8'), ctx);
put(OWN, 'NEWAI', 'MISC.', 0, 'TR-2 OLD TRACTOR'); put(OWN, 'NEWAI', 'MISC.', 1, '5 HP PUMP');
book['Asset Receiving Form'].push(rRow('2026-09-23T17:28', 'NEWAI', 'TR-2 OLD TRACTOR', 'TRACTOR'), rRow('2026-09-28T15:35', 'NEWAI', '5 HP PUMP', 'MISC.'));
R('fixMiscCategories()');
t('one-time fix: a tractor parked in MISC. moves to TRACTORS', list(OWN, 'NEWAI', 'TRACTORS').includes('TR-2 OLD TRACTOR') && !list(OWN, 'NEWAI', 'MISC.').includes('TR-2 OLD TRACTOR'));
t('...a real Misc. item stays in MISC.', list(OWN, 'NEWAI', 'MISC.').includes('5 HP PUMP'));
t('...and the fix does nothing a second time', R('fixMiscCategories()') === '');

/* 11. health check: the sheet against the whole form history */
R(`processAddNewAsset('BOSS', { name: 'HC-1', cat: 'JCB', loc: 'TONK', ownership: 'OWN', files: [] })`);
let hp = R('healthCheck_()').filter(p => /HC-1/.test(p[1]));
t('health check: a freshly added vehicle has no problems', hp.length === 0);
R(`processWebTransfer('BOSS', 'HC-1', 'JCB', 'TONK', 'NEWAI', 'Ram', [], '')`);
hp = R('healthCheck_()').filter(p => /HC-1/.test(p[1]));
t('health check: a vehicle on its way (today) has no problems', hp.length === 0);
book['Asset Receiving Form'].push(rRow(new Date(Date.now() + 2000).toISOString(), 'SANWARIYA', 'HC-1', 'JCB'));   // Google form: wrong site
R('runMasterSync()');
const healthRows = () => (book['Health Check'] || []).slice(4).map(r => r[0] + ': ' + r[1]);
t('health check: received at a different site than it was sent to is reported', healthRows().some(x => /different site/.test(x) && /HC-1/.test(x)));
book['Asset Receiving Form'].push(rRow(new Date(Date.now() + 3000).toISOString(), 'NEWAI', 'HC-1 (typo)', 'JCB'));
book['Asset Receiving Form'].push(rRow(new Date(Date.now() + 4000).toISOString(), 'NEWAI', '— Nothing in transit right now —', ''));
R('runMasterSync()');
t('health check: a form entry with a name the sheet does not know is reported', healthRows().some(x => /not in the sheet/.test(x) && /HC-1 \(typo\)/.test(x)));
t('health check: the "nothing in transit" placeholder is not a problem', !healthRows().some(x => /Nothing in transit/.test(x)));
book['Asset Transfer Form'].push(tRow(new Date(Date.now() - 5 * 86400000).toISOString(), 'NEWAI', 'JCB', 'HC-2', 'TONK'));
R(`processAddNewAsset('BOSS', { name: 'HC-2', cat: 'JCB', loc: 'NEWAI', ownership: 'OWN', files: [] })`);
book['Asset Transfer Form'].push(tRow(new Date(Date.now() - 5 * 86400000).toISOString(), 'NEWAI', 'JCB', 'HC-2', 'TONK'));
R('runMasterSync()');
t('health check: on the way for more than 3 days is reported', healthRows().some(x => /On the way for 5 days/.test(x) && /HC-2/.test(x)));
t('health check: the tab says when it last ran', book['Health Check'][0][0] === 'Last checked' && book['Health Check'][0][1] instanceof Date);

console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
