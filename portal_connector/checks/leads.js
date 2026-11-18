// Leads & Orders (folder leads_orders): deadlines = the FMS formula, step layout read from the
// sheet headings, where each tile sits, and every move (next / follow-up / back / won / lost / new).
const vm = require('vm'), fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', '..', 'leads_orders');
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };

/* ---------------- dates (India time) */
const IST = 19800000;
function D(s) {                       // 'dd/mm/yyyy hh:mm:ss' (India) → Date
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}):(\d{2}))?$/);
  if (!m) return s;
  return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) - IST);
}
function fmt(d, f) {
  const x = new Date(d.getTime() + IST), p = n => String(n).padStart(2, '0');
  return f.replace('yyyy', x.getUTCFullYear()).replace('MM', p(x.getUTCMonth() + 1)).replace('dd', p(x.getUTCDate()))
    .replace('HH', p(x.getUTCHours())).replace('mm', p(x.getUTCMinutes())).replace('ss', p(x.getUTCSeconds()));
}
const disp = v => v instanceof Date ? fmt(v, 'dd/MM/yyyy HH:mm:ss') : v == null ? '' : String(v);

/* ---------------- fake spreadsheets */
function letter(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; }
function makeSheet(name, ss, cols) {
  const sh = { name, v: [], f: [], dv: [], cols: cols || 1, maxRows: 60, id: Math.floor(Math.random() * 1e6) };
  const cell = (r, c) => { sh.v[r] = sh.v[r] || []; sh.f[r] = sh.f[r] || []; sh.dv[r] = sh.dv[r] || []; };
  const rng = (r, c, nr = 1, nc = 1) => {
    const grid = fn => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => fn(r - 1 + i, c - 1 + j)));
    let P; const R = {
      getValues: () => grid((i, j) => (sh.v[i] || [])[j] ?? ''),
      getDisplayValues: () => grid((i, j) => disp((sh.v[i] || [])[j])),
      getDisplayValue: () => disp((sh.v[r - 1] || [])[c - 1]),
      getValue: () => (sh.v[r - 1] || [])[c - 1] ?? '',
      getFormulas: () => grid((i, j) => (sh.f[i] || [])[j] || ''),
      getFormulasR1C1: () => grid((i, j) => (sh.f[i] || [])[j] || ''),
      getDataValidations: () => grid((i, j) => (sh.dv[i] || [])[j] || null),
      setValue: v => { cell(r - 1); sh.v[r - 1][c - 1] = v; (sh.writes = sh.writes || []).push([r, c]); return P; },
      setValues: vals => { vals.forEach((row, i) => row.forEach((v, j) => { cell(r - 1 + i); sh.v[r - 1 + i][c - 1 + j] = v; })); sh.cols = Math.max(sh.cols, c - 1 + nc); return P; },
      setFormulaR1C1: f => { cell(r - 1); sh.f[r - 1][c - 1] = f; return P; },
      setNumberFormat: () => P, setFontWeight: () => P, setBackground: () => P, setFontColor: () => P,
      getA1Notation: () => letter(c - 1) + r + ':' + letter(c - 2 + nc) + (r - 1 + nr), getSheet: () => S,
      setDataValidation: d => { for (let i = 0; i < nr; i++) { cell(r - 1 + i); sh.dv[r - 1 + i][c - 1] = d; } return P; },
      applyRowBanding: () => anyObj(), getCell: (i, j) => rng(r + i - 1, c + j - 1)
    };
    return (P = loose(R));
  };
  const S = {
    getName: () => name, getSheetId: () => sh.id, getParent: () => ss,
    setName: n => { if (ss && ss._tabs && ss._tabs[name] === S2) { delete ss._tabs[name]; ss._tabs[n] = S2; } name = n; return S2; },
    getLastRow: () => { let n = 0; sh.v.forEach((row, i) => { if (row && row.some(x => x !== '' && x != null)) n = i + 1; }); sh.f.forEach((row, i) => { if (row && row.some(Boolean)) n = Math.max(n, i + 1); }); return n; },
    getLastColumn: () => sh.cols, getMaxRows: () => sh.maxRows, insertRowsAfter: (a, n) => { sh.maxRows += n; },
    getRange: (r, c, nr, nc) => rng(r, c, nr, nc), setFrozenRows: () => {},
    getRangeList: a1s => ({ setValue: v => a1s.forEach(a1 => { const m = a1.match(/^([A-Z]+)(\d+)$/); let c = 0; for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64; rng(+m[2], c).setValue(v); }) }),
    appendRow: row => { const n = S.getLastRow() + 1; cell(n - 1); sh.v[n - 1] = row.slice(); sh.cols = Math.max(sh.cols, row.length); },
    getMaxColumns: () => sh.maxCols || 26, insertColumnsAfter: (a, n) => { sh.maxCols = (sh.maxCols || 26) + n; sh.cols = sh.maxCols; },
    deleteColumns: (a, n) => { [sh.v, sh.f, sh.dv].forEach(g => g.forEach(row => { if (row) row.splice(a - 1, n); })); sh.maxCols = (sh.maxCols || 26) - n; sh.cols = Math.max(1, sh.cols - n); },
    deleteRows: (a, n) => { sh.maxRows -= n; },
    deleteRow: r => { [sh.v, sh.f, sh.dv].forEach(g => g.splice(r - 1, 1)); },
    copyTo: ss2 => { const c = makeSheet(name + ' copy', ss2, sh.cols); c._.v = JSON.parse(JSON.stringify(sh.v)); c._.copied = true; let nm = name + ' copy';
      return { setName: n => { nm = n; ss2._tabs[n] = c; return { getName: () => nm }; } }; },
    getBandings: () => [],
    _: sh
  };
  const S2 = loose(S);
  return S2;
}
function anyObj() { const P = new Proxy(function () {}, { get: (o, k) => typeof k === 'symbol' ? undefined : () => P, apply: () => P }); return P; }
function loose(o) { return new Proxy(o, { get: (x, k) => (k in x || typeof k === 'symbol' || k === 'then' || k === 'toJSON') ? x[k] : () => anyObj() }); }
function makeSs(id) {
  const tabs = {};
  const ss = { getId: () => id, getSheetByName: n => tabs[n] || null, _tabs: tabs,
    insertSheet: n => { const sh = makeSheet(n, ss, 26); sh._.maxRows = 1000; return (tabs[n] = sh); },
    getSheets: () => Object.values(tabs), deleteSheet: sh => { delete tabs[sh.getName()]; },
    getSpreadsheetTimeZone: () => 'Asia/Kolkata', getSpreadsheetLocale: () => 'en_GB', setActiveSheet: () => {}, moveActiveSheet: () => {} };
  return ss;
}

/* ---------------- FMS 1: LEADS TO ORDER (real headings, formulas, dropdowns, first rows) */
const L_HEAD = ['Order No', 'Timestamp', 'SOURCE', 'Company Name', 'CONTACT PERSON', 'Contact Details', 'EXP. / DOM', 'COUNTRY / CITY', 'ATT. NAME', 'Product Category', 'PRODUCT NAME', 'MAIL ID', 'QUANTITY',
  'Planned', 'Actual', 'Status', 'Time Delay', 'REMARK', 'Planned', 'Actual', 'Status', 'Time Delay', 'REMARK', 'Planned', 'Actual', 'Sample Req. ? ', 'Time Delay', 'DISPATCH DATE ', 'ETA', 'DELIVERY STATUS', 'Sample Status', 'SAMPLE REMARK',
  'Planned', 'Actual', 'Status', 'Time Delay', 'Remark', 'Planned', 'Actual', 'Status', 'Time Delay', 'REMARK'];
function row(n, pairs) { const r = Array(n).fill(''); Object.keys(pairs).forEach(k => { r[k] = pairs[k]; }); return r; }
const planF = (s, w) => `=IF(OR(ISBLANK(${s}7),ISBLANK(${w}$5)),"",LET(_start,${s}7,_tat,${w}$5/24,_open,Config!$A$1,_close,Config!$A$2))`;
const delayF = p => `=IF(OR(ISBLANK(${p}7),${p}7=""),"","")`;
const fms1 = makeSs('1PzNOLkhslDCgy6v_SZhsKQABG0vy2aFKHuxvPV26Xuw'), L = makeSheet('LEADS TO ORDER FMS', fms1, 42); fms1._tabs['LEADS TO ORDER FMS'] = L;
L._.v[0] = ['', '14/11/2026 16:51:51'];
L._.v[1] = row(42, { 0: 'What', 1: 'ENQUIRY DATA (1)', 13: 'CONTACT TO BUYER (2)', 18: 'GIVE QUOTATION (3)', 23: 'SAMPLING (SEND SAMPLE) (4)', 32: 'ADVANCE PAYMENT (5)', 37: 'FINAL STATUS (6)' });
L._.v[2] = row(42, { 0: 'Who', 1: 'SURAJ & AAYUSHI & RAHUL', 13: 'SALES PERSON', 18: 'SALES  PERSON', 23: 'SALES PERSON', 32: 'SALES PERSON', 37: 'SALES PERSON' });
L._.v[3] = row(42, { 0: 'How', 1: 'PC', 13: 'CALL / WHATS APP', 18: 'CALL WHATS APP', 23: 'call', 32: 'CALL / WHATS APP', 37: 'CALL WHATS APP' });
L._.v[4] = row(42, { 0: 'When', 1: 'Whenever Needed', 13: '8', 18: '8', 23: '8', 32: '3', 37: '8' });
L._.v[5] = L_HEAD;
const Lrows = [
  ['ORD-001', '05/09/2026 10:32:11', 'INDIAMART', '', 'Lokash Saini', '8000883593', 'DOMESTIC', 'Patwaa', 'SURAJ', 'Soapstone Powder', 'Super Powder', '', '3', '07/09/2026 10:32:11', '07/09/2026 12:41:56', 'Done', '2:09:45', 'ask for visit', '08/09/2026 12:41:56', '07/09/2026 03:42:23', 'Done', '', 'Bring sample', '07/09/2026 18:00:00', '09/09/2026 10:44:48', 'Yes', '40:44:48', '07/09/2026', '', 'Delivered', 'Passed', '', '09/09/2026 13:44:48', '10/09/2026 16:02:58', 'Full Advance', '26:18:10', '', '11/09/2026 16:02:58', '10/09/2026 15:05:56', 'SUCCESS'],
  ['ORD-002', '08/09/2026 11:32:11', 'INDIAMART', 'JSY Agro Indusries', 'Rajendra ji', '9345866667', 'DOMESTIC', 'Tamilnadu', 'SURAJ', 'Talc lumps', 'Super Lumps', '', '100', '09/09/2026 11:32:11', '08/09/2026 11:35:07', 'Done', '', 'he want super lumps', '09/09/2026 11:35:07', '08/09/2026 11:36:21', 'Done', '', 'Details send', '09/09/2026 11:36:21', '27/10/2026 10:44:50', 'Yes', '1151:08:29', '07/09/2026', '', 'Delivered', '', '', '27/10/2026 13:44:50', '', '', '435:07:02'],
  ['ORD-003', '08/09/2026 12:56:29', 'INDIAMART', '', 'Rohit Kumawat', '9509760072', 'DOMESTIC', '', 'SURAJ', 'Quartz Lumps', '10mm', '', '35', '09/09/2026 12:56:29', '08/09/2026 13:04:50', 'Done', '', 'conected', '09/09/2026 13:04:50', '26/10/2026 16:41:20', 'Done', '1131:36:30', '', '27/10/2026 16:41:20', '', '', '432:10:31'],
  ['ORD-004', '08/09/2026 13:13:29', 'INDIAMART', 'Harvest Right Global LLC', 'Harvest Right global llc', '09154401234', 'DOMESTIC', 'Visakhapatnam', 'SURAJ', 'Quartz Lumps', 'MICA QUARTZ', 'x@y.com', '', '09/09/2026 13:13:29', '08/09/2026 13:31:41', 'Done', '', 'conected', '09/09/2026 13:31:41', '', '', '1587:20:10'],
  ['ORD-005', '08/09/2026 13:23:29', 'INDIAMART', 'green multan stone industry', 'Ravi', '09414231272', 'DOMESTIC', 'Ramganj Mandi', 'AAYUSHI', 'Decorative boulders', 'Garden Boulder', '', '2', '09/09/2026 13:23:29', '', '', ''],
  ['ORD-006', '08/09/2026 03:20:29', 'INDIAMART', '', 'Pankaj', '', 'EXPORT', 'USA', 'SURAJ', 'Quartz Slab', 'Specta Quartz', '', 'N/A', '08/09/2026 18:00:00', '10/09/2026 15:20:26', 'Close Inquiry', '']
];
Lrows.forEach((r, i) => { L._.v[6 + i] = r.map((v, j) => [1, 13, 14, 18, 19, 23, 24, 27, 32, 33, 37, 38].includes(j) ? D(v) : v); });
const cfgRange = (ss, sheet, a1, vals) => ({ getSheet: () => ({ getName: () => sheet }), getA1Notation: () => a1, getDisplayValues: () => [vals] });
const dvList = vals => ({ getCriteriaType: () => 'VALUE_IN_LIST', getCriteriaValues: () => [vals] });
const dvRange = (a1, vals) => ({ getCriteriaType: () => 'VALUE_IN_RANGE', getCriteriaValues: () => [cfgRange(null, 'Config', a1, vals)] });
const dvDate = { getCriteriaType: () => 'DATE_IS_VALID_DATE', getCriteriaValues: () => [] };
for (let r = 6; r < 30; r++) {
  L._.f[r] = []; L._.dv[r] = [];
  [[13, 'B', 'N'], [18, 'O', 'S'], [23, 'T', 'X'], [32, 'Y', 'AG'], [37, 'AH', 'AL']].forEach(([c, s, w]) => { L._.f[r][c] = planF(s, w); L._.f[r][c + 3] = delayF(w); });
  L._.dv[r][15] = dvRange('F2:Z2', ['Done', 'CNR', 'BUSY/Not Reachable', 'Cut The Call', 'Wrong Number', 'Close Inquiry']);
  L._.dv[r][20] = dvRange('F3:Z3', ['Done', 'Rate Issue', 'Quality Issue', 'Negotiating', 'Order Reject']);
  L._.dv[r][25] = dvRange('F4:Z4', ['Yes', 'No']);
  L._.dv[r][27] = dvDate; L._.dv[r][28] = dvDate;
  L._.dv[r][29] = dvList(['In Transit', 'Delivered', 'Un Delivered', 'Not Required']);
  L._.dv[r][30] = dvList(['Passed', 'Failed', 'Req. Another Sample']);
  L._.dv[r][34] = dvRange('F5:Z5', ['Full Advance', 'Part Payment', 'On Dispatch', 'Credit']);
  L._.dv[r][39] = dvRange('F6:Z6', ['SUCCESS', 'FAILED']);
}
const L_cfg = makeSheet('Config', fms1, 14); fms1._tabs.Config = L_cfg;
L_cfg._.v = [['10:00', 'Opening Time', '', 'Step Key', 'Step Name', 'Option 1'], ['18:00', 'Closing Time', '', 'CONTACT', '2. CONTACT TO BUYER', 'Done', 'CNR', 'BUSY/Not Reachable', 'Cut The Call', 'Wrong Number', 'Close Inquiry'],
  ['0000001', 'Working Days', '', 'QUOTATION', '3. GIVE QUOTATION', 'Done', 'Rate Issue', 'Quality Issue', 'Negotiating', 'Order Reject'], ['', '', '', 'SAMPLING', '4. SAMPLING (SEND SAMPLE)', 'Yes', 'No'],
  ['', '', '', 'ADVANCE', '5. ADVANCE PAYMENT', 'Full Advance', 'Part Payment', 'On Dispatch', 'Credit'], ['', '', '', 'FINAL', '6. FINAL STATUS', 'SUCCESS', 'FAILED']];
L_cfg._.cols = 14;
fms1._tabs.Holidays = makeSheet('Holidays', fms1, 1);
const LFR = makeSheet('Form responses 1', fms1, 15); fms1._tabs['Form responses 1'] = LFR;
LFR._.v = [L_HEAD.slice(0, 13)].concat(L._.v.slice(6, 12).map(r => r.slice(0, 13)));

/* ---------------- FMS 2: ORDER TO DELIVERY */
const O_HEAD = ['Order no.', 'Timestamp', 'SALES PER.', 'PARTY NAME', 'Mines/Factory', 'Mat. Gr.', 'Material Grade (Newai)', 'Material Grade ( SBSMC TONK MINES  )', 'Material Grade (  BALAJI PIT  )', 'Material Grade ( BSGM /NK MINERALS  )', 'Material Grade ( AMG MINES  )', 'Material Grade ( SAW. MINES  )', 'Material Grade ( KHA. MINES  )', 'QTY.', 'EST. DEL. Dt.', 'REMARK',
  'Planned', 'Actual', 'Status', 'Time Delay', 'EDD', 'Prev. Dt.', 'Remark', 'Planned', 'Actual', 'Status', 'Time Delay', 'Remark', 'Planned', 'Actual', 'Status', 'Time Delay', 'Remark', 'Planned', 'Actual', 'Status', 'Time Delay', 'Payment Term', 'Remark',
  'Planned', 'Actual', 'Status', 'Time Delay', 'Est. Date (one day bef)', 'TPT. NAME', 'VEH.', 'WT.', 'MOB.', 'Balance WT.', 'Planned', 'Actual', 'Status', 'Time Delay', 'Planned', 'Actual', 'Status', 'Time Delay', 'Act. Date', 'Veh. Reached at site',
  'Planned', 'Actual', 'Status', 'Time Delay', 'Remark', 'Planned', 'Actual', 'Status', 'Time Delay', 'Remark', 'Planned', 'Actual', 'Status', 'Time Delay', 'Remark', 'Planned', 'Actual', 'Status', 'Time Delay', 'Remark 1', 'Remark 2', 'Delay Days', 'Remark'];
const fms2 = makeSs('1xe2PTcNPxf3uDFJq2ITlbG96QoLZUCCTG6ZQVhsjgWM'), O = makeSheet('FMS', fms2, 82); fms2._tabs.FMS = O;
O._.v[0] = ['', '14/11/2026 16:52:02'];
const OW = { 0: 'What', 1: 'ORDER DETAILS (1)', 16: 'CONFIRMATION AT STATION (When it will be ready?) (2)', 23: 'CLIENT OK WITH AVAILABLITY (3)', 28: 'Send ESTIMATE/ PI/ TPT. CHARGES (4)', 33: 'ADVANCE PAYMENT (5)', 39: 'ARRANGE TRANSPORTATION (6)', 49: 'Carry forward balance order (6A)', 53: 'DISPATCH (7)', 59: 'PAYMENT CONFIRMATION (8)', 64: 'CHECK & SEND INVOICE (9)', 69: 'CONFIRMATION OF DELIVERY (10)', 74: 'CALL FOR BALANCE PAYMENT (11)' };
O._.v[1] = row(82, OW);
O._.v[2] = row(82, { 0: 'Who', 1: 'SALES PERSON', 16: 'STATION', 23: 'CLIENT / PC/ SALES PERSON', 28: 'SALES PERSON', 33: 'CLIENT / ACCOUNTS', 39: 'HEMANT / BHOPAL / SITE / CLIENT', 49: 'PC (Aayushi)', 53: 'SITE PERSON', 59: 'PC/ACCOUNTS', 64: 'SALES PERSON / SITE PERSON', 69: 'SALES PERSON / DRIVER', 74: 'SALES PERSON' });
O._.v[3] = row(82, { 0: 'How' });
O._.v[4] = row(82, { 0: 'When', 1: 'Whenever Needed', 16: '2', 23: '1', 28: '2', 33: '8', 39: '1', 44: 'Transporter Details', 49: '3', 53: '12', 59: '2', 64: '8', 69: '16', 74: '16' });
O._.v[5] = O_HEAD;
const Orows = [
  row(82, { 0: 'ORD-001', 1: D('21/05/2026 09:40:15'), 2: 'VIPIN GOYAL', 3: 'Indra Enterprises, sachore', 4: 'KHAKHUNDA MINES', 5: 'Super Talc Lumps', 13: 25, 14: D('25/05/2026'),
    16: D('21/05/2026 12:00:00'), 17: D('21/05/2026 09:43:26'), 18: 'Yes', 20: D('17/06/2026'), 21: D('13/06/2026'), 22: 'Done', 23: D('21/05/2026 11:00:00'), 24: D('21/05/2026 12:16:51'), 25: 'Yes',
    28: D('21/05/2026 14:16:51'), 29: D('29/06/2026 12:17:10'), 30: 'Done', 33: D('30/06/2026 12:17:10'), 34: D('30/06/2026 15:15:32'), 35: 'No', 37: 'Done',
    39: D('13/06/2026 11:00:00'), 40: D('29/06/2026 12:17:19'), 41: 'Done', 45: 'RJ07GB5060', 46: 24.34, 47: 9358469511, 49: D('29/06/2026 15:17:19'), 50: D('30/06/2026 17:29:07'), 51: 'Done',
    53: D('30/06/2026 16:17:19'), 54: D('29/06/2026 15:07:16'), 55: 'Yes', 58: 'Yes', 59: D('29/06/2026 17:07:16'), 60: D('14/07/2026 13:11:30'), 61: 'Done', 64: D('15/07/2026 13:11:30'), 65: D('01/07/2026 13:04:32'), 66: 'Done',
    69: D('03/07/2026 13:04:32'), 70: D('01/07/2026 13:04:36'), 71: 'Done', 74: D('03/07/2026 13:04:36'), 75: D('14/07/2026 13:11:36'), 76: 'Done', 80: 37 }),
  row(82, { 0: 'ORD-002', 1: D('21/05/2026 09:42:57'), 2: 'SURAJ KUMAR', 3: 'DISHVAM CORPORATION', 4: 'SHREE BS MINING TONK MINES', 5: 'SODA CHURA BP', 13: 80, 14: D('21/05/2026'), 16: D('21/05/2026 12:00:00') }),
  row(82, { 0: 'ORD-003', 1: D('21/05/2026 10:26:01'), 2: 'SURAJ KUMAR', 3: 'M/s Modern Chemicals', 4: 'BS GRINDING/NK MINERALS', 5: 'Amg White silica DDt', 13: 35, 14: D('28/05/2026'),
    16: D('21/05/2026 12:26:01'), 17: D('21/05/2026 12:17:04'), 18: 'Yes', 20: D('10/06/2026'), 21: D('31/05/2026'), 23: D('21/05/2026 13:17:04'), 24: D('21/05/2026 12:17:09'), 25: 'Yes',
    28: D('21/05/2026 14:17:09'), 29: D('21/05/2026 12:17:17'), 30: 'Done', 33: D('22/05/2026 12:17:17'), 34: D('21/05/2026 15:20:21'), 35: 'Yes', 37: 'Done' })
];
Orows.forEach((r, i) => { O._.v[6 + i] = r; });
const OPL = { 16: ['B', 'Q'], 23: ['R', 'X'], 28: ['Y', 'AC'], 33: ['AD', 'AH'], 39: ['V', 'AN'], 49: ['AO', 'AX'], 53: ['AO', 'BB'], 59: ['BC', 'BH'], 64: ['BI', 'BM'], 69: ['BN', 'BR'], 74: ['BS', 'BW'] };
for (let r = 6; r < 30; r++) {
  O._.f[r] = []; O._.dv[r] = [];
  Object.keys(OPL).forEach(c => { O._.f[r][+c] = planF(OPL[c][0], OPL[c][1]); O._.f[r][+c + 3] = delayF(OPL[c][1]); });
  O._.f[r][43] = '=IF(ISBLANK(V7), , V7 - 1)';
  if (r === 6) O._.f[r][80] = '=ARRAYFORMULA(IF((BS7:BS<>"")*(O7:O<>""), DAYS(BS7:BS, O7:O), ""))';
  [18, 25, 35, 55].forEach(c => { O._.dv[r][c] = dvList(['Yes', 'No']); });
  [30, 41, 51, 61, 66, 71, 76].forEach(c => { O._.dv[r][c] = dvList(['Done']); });
  O._.dv[r][37] = dvList(['Part Payment', 'Credit', 'Done', 'On Dispatch', 'On Delivery']);
  O._.dv[r][58] = dvList(['Yes', 'Cancelled']);
}
O._.f[6][0] = '=ARRAYFORMULA(IF(B7:B<>"", "ORD-" & TEXT(ROW(B7:B)-6, "000"), ""))';
O._.f[6][1] = `=FILTER('Form responses 1'!$A$2:$O, 'Form responses 1'!$A$2:$A <> "")`;
const FR = makeSheet('Form responses 1', fms2, 21); fms2._tabs['Form responses 1'] = FR;
FR._.v = [['Timestamp', 'SALES PERSON', 'Party Name', 'Mines/Factory', 'Product Name / Material Grade', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'Quantity', 'DELIVERY DATE', 'REMARK']]
  .concat(Orows.map(r => r.slice(1, 16)));
/** what the FILTER + ARRAYFORMULA show (the fake has no formula engine) */
function spillO() {
  const rows = FR._.v.slice(1).filter(r => r && r[0] !== '' && r[0] != null);
  for (let i = 0; i < 60; i++) {
    const row = O._.v[6 + i] || (O._.v[6 + i] = Array(82).fill(''));
    const src = rows[i];
    row[0] = src ? 'ORD-' + String(i + 1).padStart(3, '0') : '';
    for (let c = 1; c <= 15; c++) row[c] = src ? (src[c - 1] ?? '') : '';
  }
}
const O_cfg = makeSheet('Config', fms2, 11); fms2._tabs.Config = O_cfg;
O_cfg._.v = [['10:00', 'Opening Time', '', 'Step Key', 'Step Name'], ['18:00', 'Closing Time', '', 'STATION', 'CONFIRMATION AT STATION (When it will be ready?) (2)', 'Yes', 'No'],
  ['0000001', 'Working Days', '', 'CLIENT_OK', 'CLIENT OK WITH AVAILABLITY (3)', 'Yes', 'No'], ['', '', '', 'ESTIMATE', 'Send ESTIMATE/ PI/ TPT. CHARGES (4)', 'Done', 'Rate Issue', 'Quality Issue', 'Negotiating', 'Order Reject'],
  ['', '', '', 'ADVANCE', 'ADVANCE PAYMENT (5)', 'Yes', 'No', 'Full Advance', 'Part Payment', 'On Dispatch'], ['', '', '', 'TRANSPORT', 'ARRANGE TRANSPORTATION (6)', 'Done'], ['', '', '', 'DISPATCH', 'DISPATCH (7)', 'Yes', 'No'],
  ['', '', '', 'PAY_CONFIRM', 'PAYMENT CONFIRMATION (8)', 'Done'], ['', '', '', 'INVOICE', 'CHECK & SEND INVOICE (9)', 'Done'], ['', '', '', 'DELIVERY', 'CONFIRMATION OF DELIVERY (10)', 'Done'], ['', '', '', 'BALANCE_PAY', 'CALL FOR BALANCE PAYMENT (11)', 'Done']];
O_cfg._.cols = 11;
fms2._tabs.Holidays = makeSheet('Holidays', fms2, 1);

const appSs = makeSs('1sQ_3GJ5NuMqqMSKFJrezxFG2cyk35tmLq6_WXzj4FpI');
const hubSs = makeSs('19n2BoxjvBpfqpenxGkWuGleRLmyBYcI7RY0o3fepmCM'), HU = makeSheet('Users', hubSs, 2); hubSs._tabs.Users = HU;
HU._.v = [['Username', 'Name'], ['admin', 'NIKHIL YADAV'], ['NAKUL', 'Nakul Goyal'], ['VIPIN', 'Vipin Goyal'], ['NEERAJ', 'Neeraj Goyal'],
  ['SURAJ', 'SURAJ'], ['AAYUSHI KHANDELWAL', 'AAYUSHI KHANDELWAL'], ['DEEPAK', 'Deepak'], ['DEEPAK KUMAR', 'DEEPAK KUMAR']];
const SPREADS = { [fms1.getId()]: fms1, [fms2.getId()]: fms2, [appSs.getId()]: appSs, [hubSs.getId()]: hubSs };

/* ---------------- fake Telegram */
const TRIG = [];
const TG = { sent: [], updates: [], calls: [], good: '123456789:AAH_fake_token_for_tests_only_xxxxxxxx',
  call(url, o) {
    const m = /bot([^/]+)\/(\w+)$/.exec(url), tok = m && m[1], meth = m && m[2], body = o && o.payload ? JSON.parse(o.payload) : {};
    this.calls.push(meth);
    const ans = j => ({ getContentText: () => JSON.stringify(j), getResponseCode: () => 200 });
    if (tok !== this.good) return ans({ ok: false, description: 'Unauthorized' });
    if (meth === 'getMe') return ans({ ok: true, result: { username: 'ggm_test_bot' } });
    if (meth === 'deleteWebhook') return ans({ ok: true, result: true });
    if (meth === 'getUpdates') { const u = this.updates.filter(x => !body.offset || x.update_id >= body.offset); return ans({ ok: true, result: u }); }
    if (meth === 'sendMessage') { this.sent.push(body); return ans({ ok: true, result: { message_id: this.sent.length } }); }
    return ans({ ok: false, description: 'unknown' });
  } };

/* ---------------- Apps Script stubs */
const cacheStore = {}, props = {};
const ctx = vm.createContext({
  console, JSON, Math, Date, String, Number, Object, Array, RegExp, Error, isNaN, parseFloat, parseInt,
  SpreadsheetApp: { openById: id => SPREADS[id], getActiveSpreadsheet: () => appSs, getUi: () => { throw new Error('no ui'); }, flush: () => spillO(),
    newDataValidation: () => { const b = { requireValueInList: l => { b.l = l; return b; }, requireDate: () => { b.d = 1; return b; }, setAllowInvalid: () => b, build: () => b.d ? dvDate : dvList(b.l) }; return b; },
    newConditionalFormatRule: () => anyObj(), BandingTheme: { LIGHT_GREY: 1 }, BorderStyle: { SOLID_MEDIUM: 1 } },
  CacheService: { getScriptCache: () => ({ get: k => cacheStore[k] ?? null, put: (k, v) => { cacheStore[k] = v; }, putAll: m => Object.assign(cacheStore, m),
    getAll: ks => ks.reduce((o, k) => { if (k in cacheStore) o[k] = cacheStore[k]; return o; }, {}), remove: k => { delete cacheStore[k]; } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, getKeys: () => Object.keys(props), deleteProperty: k => { delete props[k]; } }) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, tryLock: () => true, releaseLock: () => {} }) },
  Utilities: { formatDate: (d, tz, f) => fmt(d, f), base64Decode: s => Buffer.from(s, 'base64'), base64Encode: b => Buffer.from(b).toString('base64'),
    newBlob: (b, ty, n) => ({ b, ty, n }), getUuid: () => 'u' + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2) },
  UrlFetchApp: { fetch: (url, o) => TG.call(url, o), fetchAll: list => list.map(o => TG.call(o.url, o)) },
  DriveApp: { getFolderById: () => ({ createFile: b => ({ getId: () => 'FILE' + Math.random().toString(36).slice(2, 8) }) }),
    createFolder: () => ({ getId: () => 'FOLDER', createFile: b => ({ getId: () => 'FILE' + Math.random().toString(36).slice(2, 8) }) }) },
  HtmlService: {}, Logger: { log: () => {} },
  ContentService: { createTextOutput: s => ({ setMimeType: () => ({ text: s }) }), MimeType: { JSON: 'json' } },
  ScriptApp: { getProjectTriggers: () => TRIG.slice(), deleteTrigger: t => { TRIG.splice(TRIG.indexOf(t), 1); },
    newTrigger: fn => { const b = { timeBased: () => b, everyMinutes: () => b, atHour: () => b, everyDays: () => b, inTimezone: () => b, forSpreadsheet: () => b, onChange: () => b,
      create: () => { TRIG.push({ getHandlerFunction: () => fn, getTriggerSourceId: () => '' }); } }; return b; } }
});
['Config.js', 'Work.js', 'Store.js', 'Fms.js', 'Api.js', 'Perf.js', 'PortalApp.js', 'Setup.js', 'Migrate.js', 'Notify.js', 'Cycles.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx, { filename: f }));
const USERS = {
  // no doer names: people are matched to the sheets by their portal name / username
  suraj: { username: 'SURAJ', name: 'SURAJ', role: 'Executive', hash: 'h', salt: 's' },
  aayushi: { username: 'AAYUSHI KHANDELWAL', name: 'AAYUSHI KHANDELWAL', role: 'Executive', hash: 'h', salt: 's' },
  vipin: { username: 'VIPIN', name: 'Vipin Goyal', role: 'Executive', hash: 'h', salt: 's' },
  neeraj: { username: 'NEERAJ', name: 'Neeraj Goyal', role: 'Manager', hash: 'h', salt: 's' },
  boss: { username: 'admin', name: 'NIKHIL YADAV', role: 'Admin', hash: 'h', salt: 's' }
};
ctx.USERS = USERS;
vm.runInContext(`var ROWS_ = {}; Object.keys(USERS).forEach(function (k) { ROWS_[USERS[k].username.toLowerCase()] = USERS[k]; });
  ggmRows_ = function () { return ROWS_; }; ggmUser_ = function (t) { var u = USERS[t]; if (!u) throw new Error('SESSION_EXPIRED'); return u; };`, ctx);
const R = c => vm.runInContext(c, ctx);
const NOW0 = Date.now;
R(`FLOW_IDS.forEach(function (f) { FLOWS[f].ssId = FLOWS[f].legacy.ssId; FLOWS[f].tab = FLOWS[f].legacy.tab; })`);

/* ---------------- 1. deadlines = the sheets' Planned formula */
const cal = { open: 10, close: 18, mask: '0000001', hol: [] };
ctx.CAL = cal;
const wa = (s, h) => fmt(new Date(R(`workAdd(${D(s).getTime()}, ${h}, CAL)`)), 'dd/MM/yyyy HH:mm:ss');
t('deadline: Sat 10:32 + 8 h → Mon 10:32 (Sunday off, 10–18)', wa('05/09/2026 10:32:11', 8) === '07/09/2026 10:32:11');
t('deadline: Mon 12:41 + 8 h → Tue 12:41', wa('07/09/2026 12:41:56', 8) === '08/09/2026 12:41:56');
t('deadline: 03:42 before opening + 8 h → 18:00 the same day', wa('07/09/2026 03:42:23', 8) === '07/09/2026 18:00:00');
t('deadline: 16:02 + 8 h → next day 16:02', wa('10/09/2026 16:02:58', 8) === '11/09/2026 16:02:58');
t('deadline: Wed 13:04 + 16 h → Fri 13:04', wa('01/07/2026 13:04:36', 16) === '03/07/2026 13:04:36');
t('deadline: a date with no time (Prev. Dt.) + 1 h → 11:00', wa('13/06/2026', 1) === '13/06/2026 11:00:00');
t('deadline: 12 h from Mon 12:17 → Tue 16:17', wa('29/06/2026 12:17:19', 12) === '30/06/2026 16:17:19');
t('working hours between 17:00 and next day 11:00 = 2', R(`workHours(${D('07/09/2026 17:00:00').getTime()}, ${D('08/09/2026 11:00:00').getTime()}, CAL)`) === 2);
t('names typed by hand match: SURAJ = Suraj Kumar = suraj ji; not SURAJIT', R(`namesMatch('SURAJ','Suraj Kumar') && namesMatch('suraj ji','SURAJ') && !namesMatch('SURAJIT','SURAJ')`));

/* ---------------- 2. layout read from the sheet headings */
const lay1 = R(`layout_('L2O')`), lay2 = R(`layout_('O2D')`);
t('Leads → Order: 5 steps with the Config keys', lay1.steps.map(s => s.key).join() === 'CONTACT,QUOTATION,SAMPLING,ADVANCE,FINAL');
const smp = lay1.steps[2];
t('Sampling: answer column is "Sample Req. ?", dates and dropdowns are typed', smp.statusHead === 'Sample Req. ?' && smp.fields.map(f => f.k + ':' + f.t).join() === 'DISPATCH DATE:date,ETA:date,DELIVERY STATUS:select,Sample Status:select,SAMPLE REMARK:textarea');
t('answers come from the Config tab', lay1.steps[0].opts.join() === 'Done,CNR,BUSY/Not Reachable,Cut The Call,Wrong Number,Close Inquiry');
t('clock: contact starts at the Timestamp, quotation at contact\'s Actual', JSON.stringify(lay1.steps[0].from) === '{"base":1}' && lay1.steps[1].from.step === 'CONTACT' && lay1.steps[1].from.actual);
t('Order → Delivery: 11 steps incl. 6A', lay2.steps.map(s => s.key).join() === 'STATION,CLIENT_OK,ESTIMATE,ADVANCE,TRANSPORT,S6A,DISPATCH,PAY_CONFIRM,INVOICE,DELIVERY,BALANCE_PAY');
t('transport clock starts at "Prev. Dt." (the ready date), 6A and dispatch at transport\'s Actual', lay2.steps[4].from.field === 'Prev. Dt.' && lay2.steps[5].from.step === 'TRANSPORT' && lay2.steps[6].from.step === 'TRANSPORT');
t('formula columns are read-only (Est. Date, Delay Days ARRAYFORMULA)', lay2.steps[4].fields.find(f => f.k === 'Est. Date (one day bef)').ro && lay2.steps[10].fields.find(f => f.k === 'Delay Days').ro);
const ob = lay2.base;
t('order details filled by B7 =FILTER(Form responses 1) are never written in the order sheet (they are read-only there, edited in the source)',
  lay2.source && lay2.source.tab === 'Form responses 1' && ob.filter(b => b.c >= 1 && b.c <= 15).every(b => b.ro && b.sp) &&
  ob.find(b => b.k === 'SALES PER.').src === 1 && ob.find(b => b.k === 'QTY.').src === 12 && ob.find(b => b.k === 'Order no.').ro);
t('…the leads sheet has typed values, nothing is formula-filled there', !lay1.source && lay1.base.filter(b => b.sp).length === 0);
t('Planned / Actual / Time Delay are not fields', !lay2.steps.some(s => s.fields.some(f => /planned|actual|time delay/i.test(f.k))));

/* ---------------- 3. where each tile sits */
const board1 = R(`boardData_('L2O')`), by1 = id => board1.leads.find(l => l.id === id);
t('ORD-001 (FINAL = SUCCESS) is won', by1('ORD-001').closed && by1('ORD-001').closed.o === 'won' && !by1('ORD-001').cur);
t('ORD-002 waits at Advance payment with the sheet\'s deadline', by1('ORD-002').cur === 'ADVANCE' && fmt(new Date(by1('ORD-002').s.ADVANCE.p), 'dd/MM/yyyy HH:mm:ss') === '27/10/2026 13:44:50');
t('ORD-003 at Sampling, ORD-004 at Quotation, ORD-005 at Contact', by1('ORD-003').cur === 'SAMPLING' && by1('ORD-004').cur === 'QUOTATION' && by1('ORD-005').cur === 'CONTACT');
t('ORD-006 ("Close Inquiry" with an Actual) is lost', by1('ORD-006').closed && by1('ORD-006').closed.o === 'lost' && by1('ORD-006').closed.why === 'Close Inquiry');
t('owner comes from ATT. NAME', by1('ORD-005').owner === 'AAYUSHI');
const board2 = R(`boardData_('O2D')`), by2 = id => board2.leads.find(l => l.id === id);
t('O2D ORD-001 (every step done) is completed', by2('ORD-001').closed && by2('ORD-001').closed.o === 'won');
t('O2D ORD-002 is at Station; ORD-003 at Transport with deadline from Prev. Dt. (31 May, a Sunday → Mon 11:00)',
  by2('ORD-002').cur === 'STATION' && by2('ORD-003').cur === 'TRANSPORT' && fmt(new Date(by2('ORD-003').s.TRANSPORT.p), 'dd/MM/yyyy HH:mm:ss') === '01/06/2026 11:00:00');
t('6A (carry forward) is not shown without a Balance WT.', by2('ORD-003').side.length === 0);
t('deadline colours: past = over, close = warn, far = ok, none',
  R(`dueState(Date.now() - 1000, 8, Date.now(), CAL, 30)`) === 'over' && R(`dueState(workAdd(Date.now(), 1, CAL), 8, Date.now(), CAL, 30)`) === 'warn' &&
  R(`dueState(workAdd(Date.now(), 40, CAL), 8, Date.now(), CAL, 30)`) === 'ok' && R(`dueState(null, 8, 1, CAL, 30)`) === 'none');

/* ---------------- 4. permissions */
t('Suraj may answer his own lead; Aayushi may not; the Admin may', R(`canAct_(USERS.suraj, 'L2O', boardData_('L2O').leads[3], 'QUOTATION')`) &&
  !R(`canAct_(USERS.aayushi, 'L2O', boardData_('L2O').leads[3], 'QUOTATION')`) && R(`canAct_(USERS.boss, 'L2O', boardData_('L2O').leads[3], 'QUOTATION')`));
t('Station (Who = STATION) is not the owner\'s by default; ticked doers can', !R(`canAct_(USERS.suraj, 'O2D', boardData_('O2D').leads[1], 'STATION')`));

/* ---------------- 5. answering steps */
const cellL = (id, c) => L._.v[Lrows.findIndex(r => r[0] === id) + 6][c];
let r1 = R(`submitStep('suraj', 'L2O', 'ORD-004', 'QUOTATION', { status: 'Negotiating', note: 'asked for a better rate' })`);
t('"Negotiating" keeps the tile at Quotation, writes the answer, no Actual, logs a follow-up',
  r1.rule === 'stay' && cellL('ORD-004', 20) === 'Negotiating' && !cellL('ORD-004', 19) && r1.detail.lead.cur === 'QUOTATION' && r1.detail.lead.att.QUOTATION === 1 && r1.detail.notes.length === 1);
r1 = R(`submitStep('suraj', 'L2O', 'ORD-004', 'QUOTATION', { status: 'Done', fields: { REMARK: 'rate sent' } })`);
t('"Done" moves it to Send sample: Actual + answer + remark written', r1.rule === 'next' && cellL('ORD-004', 19) instanceof Date && cellL('ORD-004', 20) === 'Done' && cellL('ORD-004', 22) === 'rate sent' && r1.detail.lead.cur === 'SAMPLING');
t('the next deadline is worked out from the new Actual (sheet formula not recalculated here)', r1.detail.lead.s.SAMPLING.p === R(`workAdd(${cellL('ORD-004', 19).getTime()}, 8, CAL)`));
let threw = '';
try { R(`submitStep('aayushi', 'L2O', 'ORD-004', 'SAMPLING', { status: 'Yes' })`); } catch (e) { threw = e.message; }
t('someone else\'s lead: refused', /not assigned to you/.test(threw));
try { R(`submitStep('suraj', 'L2O', 'ORD-004', 'QUOTATION', { status: 'Done' })`); threw = ''; } catch (e) { threw = e.message; }
t('answering a step the tile has already left: refused with where it is now', /no longer at "Give quotation".*Send sample/.test(threw));
r1 = R(`submitStep('suraj', 'L2O', 'ORD-004', 'SAMPLING', { status: 'Yes', fields: { 'Sample Status': 'Failed', 'DISPATCH DATE': '2026-11-10' } })`);
t('sample "Failed" sends it back to Send sample: clock restarts, Actual stays empty, fields kept',
  r1.rule === 'back:SAMPLING' && r1.detail.lead.cur === 'SAMPLING' && !cellL('ORD-004', 24) && cellL('ORD-004', 30) === 'Failed' && cellL('ORD-004', 27) instanceof Date && r1.detail.lead.rs.SAMPLING > 0);
r1 = R(`submitStep('suraj', 'L2O', 'ORD-004', 'SAMPLING', { status: 'Yes', fields: { 'Sample Status': 'Passed' } })`);
t('second sample passes → Advance payment', r1.detail.lead.cur === 'ADVANCE');
r1 = R(`sendBack('suraj', 'L2O', 'ORD-004', 'QUOTATION', 'wrong rate quoted')`);
t('send back by hand: Quotation and Sampling are cleared in the sheet, history keeps the old values',
  r1.detail.lead.cur === 'QUOTATION' && !cellL('ORD-004', 19) && !cellL('ORD-004', 24) && !cellL('ORD-004', 20) &&
  r1.detail.events.some(e => e.a === 'BACK' && e.to === 'QUOTATION' && e.d.cleared.QUOTATION && e.d.blame === 'SURAJ'));
t('…and the tile counts both send-backs (failed sample + by hand)', r1.detail.lead.bk === 2);
r1 = R(`submitStep('aayushi', 'L2O', 'ORD-005', 'CONTACT', { status: 'Close Inquiry' })`);
t('"Close Inquiry" closes it as lost (Actual written)', r1.rule === 'lost' && r1.detail.lead.closed.o === 'lost' && cellL('ORD-005', 14) instanceof Date);
r1 = R(`closeLead('boss', 'L2O', 'ORD-005', 'open', '')`);
t('reopen clears that answer and the lead is back at Contact', !r1.detail.lead.closed && r1.detail.lead.cur === 'CONTACT' && !cellL('ORD-005', 14));
r1 = R(`closeLead('boss', 'L2O', 'ORD-005', 'lost', 'duplicate enquiry')`);
t('closing by hand uses the step\'s own closing answer ("Close Inquiry")', cellL('ORD-005', 15) === 'Close Inquiry' && r1.detail.lead.closed.o === 'lost');

const cellO = (id, c) => O._.v[Orows.findIndex(r => r[0] === id) + 6][c];
R(`stepCfg_('O2D'); MEMO_['scfg_O2D'].STATION.doers = ['VIPIN'];`);
let r2 = R(`submitStep('vipin', 'O2D', 'ORD-002', 'STATION', { status: 'Yes', fields: { 'EDD': '2026-11-20', 'Prev. Dt.': '2026-11-18' } })`);
t('Station answered by a ticked doer → Client OK', r2.detail.lead.cur === 'CLIENT_OK' && cellO('ORD-002', 21) instanceof Date);
R(`stepCfg_('O2D'); MEMO_['scfg_O2D'].STATION.doers = ['VIPIN'];`);
try { R(`submitStep('vipin', 'O2D', 'ORD-002', 'CLIENT_OK', { status: 'No' })`); threw = ''; } catch (e) { threw = e.message; }
t('Client OK is the sales person\'s step (Vipin is not ORD-002\'s owner): refused', /not assigned/.test(threw));
r2 = R(`submitStep('suraj', 'O2D', 'ORD-002', 'CLIENT_OK', { status: 'No' })`);
t('client says "No" → back to Station; Station\'s Actual cleared; the "No" is not left in the sheet',
  r2.rule === 'back:STATION' && r2.detail.lead.cur === 'STATION' && !cellO('ORD-002', 17) && !cellO('ORD-002', 25));
try { R(`submitStep('boss', 'O2D', 'ORD-003', 'TRANSPORT', { status: 'Done' })`); threw = ''; } catch (e) { threw = e.message; }
t('Transport needs transporter + vehicle', /Fill in: TPT\. NAME, VEH\./.test(threw));
r2 = R(`submitStep('boss', 'O2D', 'ORD-003', 'TRANSPORT', { status: 'Done', fields: { 'TPT. NAME': 'SHREE OM ROAD LINES', 'VEH.': 'RJ08GA8920', 'Balance WT.': '5' } })`);
t('Transport done with a balance → Dispatch, and 6A (carry forward) shows beside it', r2.detail.lead.cur === 'DISPATCH' && r2.detail.lead.side.join() === 'S6A' && cellO('ORD-003', 44) === 'SHREE OM ROAD LINES');
t('read-only formula column is never written (Est. Date)', cellO('ORD-003', 43) === undefined || cellO('ORD-003', 43) === '');

/* ---------------- 6. new lead, lead → order */
let r3 = R(`createEntry('aayushi', 'L2O', { 'CONTACT PERSON': 'Test Buyer', 'Contact Details': '9999999999', 'PRODUCT NAME': 'Talc', __industry: 'Paints & coatings' }, null)`);
t('new lead by an Executive: next number, first empty row, written under her Master App username', r3.id === 'ORD-007' && L._.v[12][0] === 'ORD-007' && L._.v[12][8] === 'AAYUSHI KHANDELWAL');
t('…its formulas are already in that row', !!L._.f[12][13]);
const newLead = R(`MEMO_ = {ss: MEMO_.ss}; boardData_('L2O').leads.find(function (l) { return l.id === 'ORD-007'; })`);
t('…it starts at Contact with an 8-hour deadline from now, industry saved', newLead.cur === 'CONTACT' && newLead.s.CONTACT.p > Date.now() && newLead.ind === 'Paints & coatings');
try { R(`createEntry('suraj', 'L2O', { 'PRODUCT NAME': 'x' }, null)`); threw = ''; } catch (e) { threw = e.message; }
t('a lead needs a company or contact name', /Enter Company Name or CONTACT PERSON/.test(threw));
r3 = R(`createEntry('suraj', 'O2D', { 'PARTY NAME': 'Lokash Saini', 'QTY.': '3', 'Mines/Factory': 'KHAKHUNDA MINES', 'Mat. Gr.': 'Super Powder' }, 'ORD-001')`);
t('…an order made from a lead is written under the lead owner\'s username (SURAJ)', O._.v[9][2] === 'SURAJ');
t('won lead → order ORD-004 in Order → Delivery, both linked', r3.id === 'ORD-004' && R(`MEMO_ = {ss: MEMO_.ss}; leadState_('L2O')['ORD-001'].link`) === 'ORD-004' && R(`leadState_('O2D')['ORD-004'].link`) === 'ORD-001');
try { R(`createEntry('suraj', 'O2D', { 'PARTY NAME': 'x', 'QTY.': '1' }, 'ORD-001')`); threw = ''; } catch (e) { threw = e.message; }
t('…and only once', /already has order ORD-004/.test(threw));

/* ---------------- 7. scores, badges, hub dropdowns */
const perf = R(`perfData('suraj', { from: '2026-09-01', to: '${fmt(new Date(), 'yyyy-MM-dd')}' })`);
t('Suraj\'s dashboard: steps done incl. ones entered in the sheet, follow-up, send-back penalty', perf.kpi.done > 5 && perf.kpi.fromSheet > 0 && perf.kpi.follow === 1 && perf.kpi.rework === 2 &&
  perf.breakdown.some(b => b.k === 'rework' && b.count === 2 && b.pts === -16) && perf.breakdown.some(b => b.k === 'step_on_time'));
t('score = plus + minus, days listed for the trend chart', perf.kpi.score === perf.kpi.pos + perf.kpi.neg && perf.days.length > 60);
const team = R(`perfData('boss', { from: '2026-09-01', to: '${fmt(new Date(), 'yyyy-MM-dd')}', user: '*' })`);
t('Admin sees the whole team ranked by score', team.team.length === 5 && team.team[0].score >= team.team[1].score);
const exPerf = R(`perfData('aayushi', { user: 'SURAJ' })`);
t('an Executive only ever gets their own numbers', exPerf.person && exPerf.person.u === 'AAYUSHI KHANDELWAL');
const badges = R(`GGM_APP.counts([{ u: 'SURAJ', r: 'Executive' }, { u: 'admin', r: 'Admin' }])`);
t('hub badge: Suraj = his overdue / due-soon tiles; Admin = all overdue tiles', badges.SURAJ >= 2 && badges.admin >= badges.SURAJ);
const meta = R(`GGM_APP.meta()`);
t('hub asks only for a role (no doer names)', meta.roles.join() === 'Admin,Manager,Executive,Lead Generator,Order Generator' && !meta.doers);

/* ---------------- 7b. no doer names: matching and assigning */
t('the name written for a person is always their Master App username', R(`sheetName_(USERS.suraj, 'O2D')`) === 'SURAJ' && R(`sheetName_(USERS.vipin, 'O2D')`) === 'VIPIN' && R(`sheetName_(USERS.boss, 'L2O')`) === 'admin');
const users = R(`hubUsers_()`), on = n => R(`ownerUsername_(${JSON.stringify(n)}, hubUsers_(), {})`);
t('Master App users are read from its Users tab', users.length === 8 && users[0].u === 'admin');
t('old sheet names → usernames: SURAJ KUMAR→SURAJ, Suraj→SURAJ, AAYUSHI→AAYUSHI KHANDELWAL, VIPIN GOYAL→VIPIN, NEERAJ KUMAR GOYAL→NEERAJ',
  on('SURAJ KUMAR') === 'SURAJ' && on('Suraj') === 'SURAJ' && on('AAYUSHI') === 'AAYUSHI KHANDELWAL' && on('VIPIN GOYAL') === 'VIPIN' && on('NEERAJ KUMAR GOYAL') === 'NEERAJ');
t('…an exact username always wins (DEEPAK stays DEEPAK), nobody / two people → left alone (MAAHI)', on('DEEPAK') === 'DEEPAK' && on('MAAHI') === null && on('deepak kumar') === 'DEEPAK KUMAR');
t('…an admin spelling (Settings → People) maps a name nobody matches', R(`ownerUsername_('MAAHI', hubUsers_(), { 'neeraj': 'MAAHI' })`) === 'NEERAJ');
R(`MEMO_ = { ss: MEMO_.ss }`);
const nr = R(`normalizeOwners_()`);
t('rename run: both sheets rewritten in place, unknown names reported, a RENAME line in Events',
  nr.changed > 0 && O._.v[6][2] === 'VIPIN' && O._.v[7][2] === 'SURAJ' && cellL('ORD-005', 8) === 'AAYUSHI KHANDELWAL' && cellL('ORD-001', 8) === 'SURAJ' &&
  nr.report['SURAJ KUMAR → SURAJ'] >= 1 && R(`rows_(TABS.EVENTS).some(function (r) { return r[6] === 'RENAME'; })`));
t('…in the order sheet the names were renamed in Form responses 1, never typed into the sheet itself (that would break the FILTER)',
  FR._.v[1][1] === 'VIPIN' && FR._.v[2][1] === 'SURAJ' && !(O.__ = O._.writes || []).some(w => w[1] >= 2 && w[1] <= 16));
t('…a second run changes nothing (names stay the same from now on)', R(`MEMO_ = { ss: MEMO_.ss }; normalizeOwners_().changed`) === 0);
try { R(`assignOwner('vipin', 'L2O', 'ORD-003', 'AAYUSHI KHANDELWAL')`); threw = ''; } catch (e) { threw = e.message; }
t('an Executive cannot reassign', /Only an Admin or a Manager/.test(threw));
let r4 = R(`assignOwner('boss', 'L2O', 'ORD-003', 'AAYUSHI KHANDELWAL')`);
t('Admin assigns ORD-003 to Aayushi: ATT. NAME = her username, logged, and now she may answer it (Suraj no longer)',
  cellL('ORD-003', 8) === 'AAYUSHI KHANDELWAL' && r4.detail.lead.owner === 'AAYUSHI KHANDELWAL' && r4.detail.events.some(e => e.a === 'ASSIGN') &&
  R(`canAct_(USERS.aayushi, 'L2O', freshLead_('L2O', 'ORD-003'), 'SAMPLING')`) && !R(`canAct_(USERS.suraj, 'L2O', freshLead_('L2O', 'ORD-003'), 'SAMPLING')`));
r4 = R(`createEntry('boss', 'L2O', { 'CONTACT PERSON': 'Walk-in', 'Contact Details': '9000000000', __owner: 'NEERAJ' }, null)`);
t('Admin creates a lead for someone else → their username', L._.v[13][8] === 'NEERAJ');
r4 = R(`createEntry('suraj', 'L2O', { 'CONTACT PERSON': 'Someone', 'Contact Details': '9000000001', __owner: 'AAYUSHI KHANDELWAL', 'ATT. NAME': 'XYZ' }, null)`);
t('an Executive new lead is always their own (cannot pick someone else or type a name)', L._.v[14][8] === 'SURAJ');

let threwW = '';
try { R(`writeCells_('O2D', 8, { 2: 'X' })`); } catch (e) { threwW = e.message; }
t('safety net: a direct write into a formula-filled column is refused', /filled by a formula/.test(threwW));
R(`MEMO_ = { ss: MEMO_.ss }`);
let r5 = R(`assignOwner('boss', 'O2D', 'ORD-003', 'VIPIN')`);
t('assigning an order writes the source row (Form responses 1), the sheet shows it through the FILTER', FR._.v[3][1] === 'VIPIN' && O._.v[8][2] === 'VIPIN' && r5.detail.lead.owner === 'VIPIN');
R(`MEMO_ = { ss: MEMO_.ss }`);
r5 = R(`editFields('boss', 'O2D', 'ORD-003', 'base', { 'QTY.': '36', 'REMARK': 'urgent' })`);
t('editing order details goes to the source row too', FR._.v[3][12] === '36' && FR._.v[3][14] === 'urgent' && O._.v[8][13] === '36');
t('…nothing was ever typed into the order sheet columns B:P', !(O._.writes || []).some(w => w[1] >= 2 && w[1] <= 16));

/* ---------------- 7c. speed */
R(`MEMO_ = { ss: MEMO_.ss }; boardData_('L2O'); boardData_('O2D');`);
const v0 = R(`boardVer_()`);
R(`submitStep('suraj', 'L2O', 'ORD-004', 'QUOTATION', { status: 'Rate Issue' })`);
const v1 = R(`boardVer_()`), carried = R(`cacheGet_('bd2_L2O_' + boardVer_())`);
t('after a save the board for the new version is already in the cache, with that lead updated (no full re-read)',
  v1 !== v0 && carried && carried.leads.find(l => l.id === 'ORD-004').att.QUOTATION >= 1 && !!R(`cacheGet_('bd2_O2D_' + boardVer_())`));
t('opening from the portal puts the first screen inside the page (no extra round trip)', /t\.bootJson = jsonTag_\(bootFor_\(u\)\)/.test(fs.readFileSync(path.join(DIR, 'Api.js'), 'utf8')));

t('a visitor never waits for a full sheet read: with no board for this version, the last one built is served',
  R(`PropertiesService.getScriptProperties().setProperty('BOARD_VER', 'x-new'); !!boardData_('L2O').leads.length && !cacheGet_('bd2_L2O_x-new')`));
R(`submitStep('suraj', 'L2O', 'ORD-004', 'QUOTATION', { status: 'Quality Issue' })`);
const before = R(`boardVer_()`);
t('background rebuild publishes a new version and keeps a save made during the read', R(`rebuildBoards_()`) === true && R(`boardVer_()`) !== before &&
  R(`cacheGet_('bd2_L2O_' + boardVer_()).leads.filter(function (l) { return l.id === 'ORD-004'; })[0].att.QUOTATION`) >= 2);
t('…and only one rebuild runs at a time (a second one is queued)', R(`PropertiesService.getScriptProperties().setProperty('REBUILDING', String(Date.now())); var r = rebuildBoards_(); PropertiesService.getScriptProperties().deleteProperty('REBUILDING'); r`) === false &&
  R(`PropertiesService.getScriptProperties().getProperty('REBUILD_AGAIN')`) === '1');

/* ---------------- 7d. the app's own backend: LEADS + ORDERS tabs in the app sheet */
R(`MEMO_ = {}; PropertiesService.getScriptProperties().deleteProperty('REBUILDING')`);
const sumLay = () => R(`JSON.stringify(FLOW_IDS.map(function (f) { return layout_(f).steps.map(function (s) { return [s.key, s.opts, s.tat, s.from, s.fields.length]; }); }))`);
const curOf = () => R(`JSON.stringify(FLOW_IDS.map(function (f) { return buildBoard_(f).leads.map(function (l) { return [l.id, l.cur, l.owner, !!l.closed, l.s[l.cur || 'x'] ? l.s[l.cur].p : 0]; }); }))`);
const oldLay = JSON.parse(sumLay()), oldCur = curOf(), oldN = JSON.parse(oldCur).map(a => a.length);
const oldGrid = JSON.stringify([L._.v, O._.v]);
R(`FLOWS.L2O.tab = 'LEADS'; FLOWS.O2D.tab = 'ORDERS';`);
const mig = R(`migrateToAppSheet_()`);
R(`FLOW_IDS.forEach(function (f) { FLOWS[f].ssId = ''; FLOWS[f].tab = f === 'L2O' ? 'LEADS' : 'ORDERS'; cache_().remove('lay_' + f + LAY_V); }); MEMO_ = {};`);
const NL = appSs._tabs.LEADS, NO = appSs._tabs.ORDERS
t('move: LEADS and ORDERS tabs made in the app sheet with every lead and order', !!NL && !!NO && mig.L2O.rows === oldN[0] && mig.O2D.rows === oldN[1]);
t('…plain values only: no formula anywhere in LEADS / ORDERS', [NL, NO].every(sh => !sh._.f.some(r => r && r.some(Boolean))));
t('…ORDERS drops the 7 per-mine grade columns, Delay Days and Est. Date (one day bef); LEADS keeps all 42',
  !NO._.v[5].some(h => /^Material Grade \(|^Delay Days$|^Est\. Date/.test(h)) && NO._.v[5].length === 82 - 9 && NL._.v[5].length === 42);
const newLay = JSON.parse(sumLay());
t('…same steps, keys, answers, hours and clock starts as the old sheets (Steps tab)',
  JSON.stringify(newLay.map(f => f.map(s => s.slice(0, 4)))) === JSON.stringify(oldLay.map(f => f.map(s => s.slice(0, 4)))));
t('…every lead / order sits at the same step with the same owner and deadline', curOf() === oldCur);
t('…office hours and weekly off in the Holidays tab', appSs._tabs.Holidays._.v[2][1] === '0000001' && appSs._tabs.Holidays._.v[0][1] === '10:00' && R(`layout_('L2O').cal.close`) === 18);
t('…dropdowns kept (status answers + field lists)', R(`layout_('L2O').steps[0].opts.join()`) === 'Done,CNR,BUSY/Not Reachable,Cut The Call,Wrong Number,Close Inquiry' && /Delivered/.test(R(`JSON.stringify(layout_('L2O').steps[2].fields)`)));
R(`MEMO_ = { ss: MEMO_.ss }`);
const openId = R(`buildBoard_('L2O').leads.filter(function (l) { return l.cur === 'CONTACT'; })[0].id`);
const a5 = R(`submitStep('boss', 'L2O', '${openId}', 'CONTACT', { status: 'Done', fields: { REMARK: 'called' } })`);
const rw5 = NL._.v.findIndex(r => r && r[0] === openId);
t('a step answer is written in LEADS: Actual, Status, Planned, remark', a5.ok && NL._.v[rw5][14] instanceof Date && NL._.v[rw5][15] === 'Done' && NL._.v[rw5][13] instanceof Date && NL._.v[rw5][17] === 'called');
t('…Time Delay written when done after Planned (as the sheet formula did), empty when on time', (() => { const pl = NL._.v[rw5][13].getTime(), ac = NL._.v[rw5][14].getTime(), d = NL._.v[rw5][16];
  return ac > pl ? Math.abs(d - (ac - pl) / 864e5) < 1e-6 : d === ''; })());
t('…the old FMS sheets were never written', JSON.stringify([L._.v, O._.v]) === oldGrid);
R(`MEMO_ = { ss: MEMO_.ss }`);
R(`sendBack('boss', 'L2O', '${openId}', 'CONTACT', 'wrong number typed')`);
t('send back clears Actual, Status, Planned and Time Delay of the step (the clock restarts)', NL._.v[rw5][14] === '' && NL._.v[rw5][15] === '' && NL._.v[rw5][13] === '' && NL._.v[rw5][16] === '');
const ids = sh => sh._.v.filter(r => r && /^ORD-/.test(r[0])).map(r => r[0]);
const nOrd = ids(NO).length, oh = NO._.v[5];
t('no Google Form import any more: the app is the only way in', R(`typeof importForms`) === 'undefined' && !/importForms\(\)/.test(fs.readFileSync(path.join(DIR, 'Setup.js'), 'utf8')));
const cn = R(`MEMO_ = { ss: MEMO_.ss }; createEntry('boss', 'O2D', { 'PARTY NAME': 'Typed In App', 'SALES PER.': 'NAKUL', 'QTY.': '5' })`);
t('a new order typed in the app goes into ORDERS (next number), not the old form tab', cn.ok !== false && ids(NO).length === nOrd + 1 && NO._.v.some(r => r && r[oh.indexOf('PARTY NAME')] === 'Typed In App') && !FR._.v.some(r => r && r[2] === 'Typed In App'));

/* ---------------- 7e. form-only roles: Lead Generator / Order Generator */
USERS.lg = { username: 'LG1', name: 'Lead Gen One', role: 'Lead Generator', hash: 'h', salt: 's' };
USERS.og = { username: 'OG1', name: 'Order Gen One', role: 'Order Generator', hash: 'h', salt: 's' };
R(`ROWS_['lg1'] = USERS.lg; ROWS_['og1'] = USERS.og; MEMO_ = { ss: MEMO_.ss }`);
t('roles: Lead Generator / Order Generator offered to the hub and recognised', R(`ROLES.indexOf('Lead Generator') > -1 && ROLES.indexOf('Order Generator') > -1 && roleOf_(USERS.lg) === 'leadgen' && roleOf_(USERS.og) === 'ordergen'`));
const gb = R(`bootstrap('lg')`);
t('…a Lead Generator gets only the leads form: no board data, one flow, people to give it to (not other generators)',
  gb.boards.length === 0 && gb.flows.length === 1 && gb.flows[0].fid === 'L2O' && gb.users.length > 0 && !gb.users.some(u => u.r === 'leadgen' || u.r === 'ordergen'));
const refused = fn => { try { R(fn); return false; } catch (e) { return /only adds new/.test(e.message); } };
t('…and everything else is refused (lead detail, answering, performance, settings)',
  refused(`leadDetail('lg', 'L2O', 'ORD-001')`) && refused(`submitStep('og', 'O2D', 'ORD-001', 'STATION', { status: 'Yes' })`) && refused(`perfData('lg', {})`) && refused(`settingsData('og')`));
t('…ping never sends the board', R(`ping('lg', 30, '', 0).boards`) === undefined);
let ge = '';
try { R(`createEntry('lg', 'O2D', { 'PARTY NAME': 'X', 'QTY.': '1', __owner: 'NAKUL' })`); } catch (e) { ge = e.message; }
t('…a Lead Generator cannot add orders', /only add leads/.test(ge));
ge = ''; try { R(`createEntry('lg', 'L2O', { 'Company Name': 'Gen Co', 'Contact Details': '9000000000' })`); } catch (e) { ge = e.message; }
t('…must pick who works the lead', /Pick who/.test(ge));
ge = ''; try { R(`createEntry('lg', 'L2O', { 'Company Name': 'Gen Co', 'Contact Details': '9000000000', __owner: 'OG1' })`); } catch (e) { ge = e.message; }
t('…cannot give it to another generator', /cannot work them/.test(ge));
const gn = R(`MEMO_ = { ss: MEMO_.ss }; createEntry('lg', 'L2O', { 'Company Name': 'Gen Co', 'Contact Details': '9000000000', __owner: 'SURAJ' })`);
t('…saves the lead with the chosen owner and gets back only the number (no data)', gn.ok && /^ORD-/.test(gn.id) && !gn.lead && NL._.v.some(r => r && r[0] === gn.id && r[8] === 'SURAJ' && r[3] === 'Gen Co'));
ge = ''; try { R(`assignOwner('boss', 'L2O', '${gn.id}', 'LG1')`); } catch (e) { ge = e.message; }
t('…and nobody can assign a lead to a generator', /cannot work them/.test(ge));
t('…badge in the hub is 0 for generators', R(`GGM_APP.counts([{ u: 'LG1', r: 'Lead Generator' }]).LG1`) === 0);
const gob = R(`bootstrap('og')`), glb = R(`bootstrap('lg')`);
const allParties = [...new Set(NO._.v.slice(6).filter(r => r && /^ORD-/.test(r[0])).map(r => String(r[NO._.v[5].indexOf('PARTY NAME')]).trim().toUpperCase()).filter(String))];
t('…an Order Generator gets the party names already used (every one, no limit), so the Party box suggests them',
  gob.lists && gob.lists.O2D && Array.isArray(gob.lists.O2D['PARTY NAME']) && gob.lists.O2D['PARTY NAME'].length === allParties.length && gob.boards.length === 0);
t('…names only: no phone numbers, mails or remarks in the generator lists',
  !!glb.lists.L2O['Company Name'] && !glb.lists.L2O['Contact Details'] && !glb.lists.L2O['MAIL ID'] && !Object.keys(glb.lists.L2O).some(k => /remark|note|mail|phone/i.test(k)));
t('…people who work leads get no extra lists (they have the board)', R(`bootstrap('boss').lists`) === undefined);

/* ---------------- 7f. Settings → People → Board: which Executives see only their own steps */
R(`MEMO_ = { ss: MEMO_.ss }`);
const fullS = R(`bootstrap('suraj')`);
t('Executives see the whole board by default (scope "all")', fullS.me.scope === 'all' && fullS.boards[0].leads.length === R(`boardData_('L2O').leads.length`));
R(`saveSettings('boss', { scope: { suraj: 'mine', admin: 'mine', neeraj: 'junk' } })`);
R(`MEMO_ = { ss: MEMO_.ss }`);
t('…the Admin saves "Only their steps" per person (lower-case usernames, only "mine" kept)', JSON.stringify(R(`settingsData('boss').scope`)) === JSON.stringify({ suraj: 'mine', admin: 'mine' }));
const mineS = R(`bootstrap('suraj')`);
t('…such an Executive gets only the open tiles they can answer; nothing else is sent',
  mineS.me.scope === 'mine' && mineS.boards[0].leads.length > 0 && mineS.boards[0].leads.length < R(`boardData_('L2O').leads.length`) &&
  R(`boardsFor_(USERS.suraj).every(function (b) { return b.leads.every(function (l) { return !l.closed && canSee_(USERS.suraj, b.fid, l); }); })`));
t('…the minute ping sends the same cut-down board', R(`ping('suraj', 0, '', 0).boards[0].leads.length`) === mineS.boards[0].leads.length);
const hidden = R(`(function () { var b = boardData_('L2O').leads; for (var i = 0; i < b.length; i++) if (!b[i].closed && !canSee_(USERS.suraj, 'L2O', b[i])) return b[i].id; return ''; })()`);
let hd = ''; try { R(`leadDetail('suraj', 'L2O', '${hidden}')`); } catch (e) { hd = e.message; }
t('…and opening a lead that is not theirs is refused', !!hidden && /not at a step you work/.test(hd));
const sideErr = ['addNote(\'suraj\', \'L2O\', \'' + hidden + '\', \'\', \'hi\')', 'addPhotos(\'suraj\', \'L2O\', \'' + hidden + '\', \'\', [])', 'setIndustry(\'suraj\', \'L2O\', \'' + hidden + '\', \'X\')']
  .map(c => { try { R(c); return ''; } catch (e) { return e.message; } });
t('…nor can they add a note / photos / industry to it (that would send its details back)', sideErr.every(m => /not at a step you work/.test(m)));
t('…Admins / Managers / other Executives keep the whole board (the setting only applies to Executives)',
  R(`bootstrap('boss').me.scope`) === 'all' && R(`bootstrap('boss').boards[0].leads.length`) === R(`boardData_('L2O').leads.length`) && R(`bootstrap('vipin').me.scope`) === 'all');
R(`saveSettings('boss', { scope: {} }); MEMO_ = { ss: MEMO_.ss }`);
t('…back to "All steps": the whole board again', R(`bootstrap('suraj').me.scope`) === 'all');

/* ---------------- 7g. glitch fixes (15 Nov 2026) */
const sideWith = v => R(`(function () { var l = freshLead_('O2D', 'ORD-003'); l.s.TRANSPORT.a = l.s.TRANSPORT.a || Date.now() - 3600000; l.s.S6A.a = null; delete l.s.S6A.s;
  l.s.TRANSPORT.f['Balance WT.'] = ${JSON.stringify(v)}; decorate_('O2D', l, layout_('O2D'), stepCfg_('O2D'), {}, Date.now()); return l.side.join(); })()`);
t('carry forward (6A) opens for a real balance, not for 0 / negative / 0.00 (ORD-120 had -0.14)',
  sideWith('5') === 'S6A' && sideWith('0.5') === 'S6A' && sideWith('-0.14') === '' && sideWith('0') === '' && sideWith('0.00') === '' && sideWith(-2) === '' && sideWith('') === '');
const noReady = R(`(function () { var l = freshLead_('O2D', 'ORD-003'), adv = Date.now() - 5 * 864e5;
  ['TRANSPORT', 'S6A', 'DISPATCH', 'PAY_CONFIRM', 'INVOICE', 'DELIVERY', 'BALANCE_PAY'].forEach(function (k) { l.s[k] = { f: {} }; });
  l.s.ADVANCE.a = adv; delete l.s.STATION.f['Prev. Dt.'];
  decorate_('O2D', l, layout_('O2D'), stepCfg_('O2D'), {}, Date.now());
  return { cur: l.cur, p: l.s.TRANSPORT.p, want: workAdd(adv, stepByKey_(layout_('O2D'), 'TRANSPORT').tat, layout_('O2D').cal) }; })()`);
t('an old order without "Ready by" still gets a transport deadline (counted from the step before), not "No deadline"', noReady.cur === 'TRANSPORT' && noReady.p > 0 && noReady.p === noReady.want);
{
  const htmlNow = fs.readFileSync(path.join(DIR, 'App.html'), 'utf8'), cssNow = fs.readFileSync(path.join(DIR, 'Styles.html'), 'utf8');
  t('page: Team "Open now" counts each tile on the boards once (not the sum of people)', /T\.open = 0; T\.over = 0;/.test(htmlNow) && /tileKeys\(l\)\.forEach\(function \(k\) \{ T\.open\+\+;/.test(htmlNow));
  t('page: search suggestions are wide enough, two lines, no sideways scroll', /\.sg \.b\{min-width:0;flex:1;display:flex;flex-direction:column/.test(cssNow) && /\.sugg\{right:auto;width:max\(100%,460px\)\}/.test(cssNow) && /overflow-x:hidden;padding:5px\}/.test(cssNow));
  t('page: popups never scroll sideways (date boxes in More fit)', /\.pop \.inp\{padding:8px 10px;min-width:0;width:100%\}/.test(cssNow) && /grid-template-columns:1fr 1fr;gap:6px">\<input type="date"/.test(htmlNow));
  t('page: chart end date is not drawn on top of the previous one', /\(i - lastTick\) \* bw >= 44/.test(htmlNow));
  t('page: no "FMS sheet / form" wording left on screen', !/Entered in the sheet \/ form|in the FMS sheet<|Config tab\)/.test(htmlNow));
}

/* ---------------- 7h. Telegram: bot, linking, reminders, date / late alerts, digest */
{
  R(`MEMO_ = { ss: MEMO_.ss }`);
  const err = fn => { try { R(fn); return ''; } catch (e) { return e.message; } };
  t('Telegram: only the Admin sets the bot; a wrong token is refused and not kept',
    /Only an Admin/.test(err(`tgSetToken('suraj', '${TG.good}')`)) && /look like a bot token/.test(err(`tgSetToken('boss', 'hello')`)) &&
    /Unauthorized/.test(err(`tgSetToken('boss', '123456789:AAH_wrong_token_xxxxxxxxxxxxxxxxxxxxxx')`)) && !props.TG_TOKEN);
  const ad = R(`tgSetToken('boss', '${TG.good}')`);
  t('…the right token connects the bot (@name shown), the 5-minute job is installed',
    ad.ready && ad.bot === 'ggm_test_bot' && TRIG.some(x => x.getHandlerFunction() === 'notifyTick'));
  t('…the token is kept only in Script Properties: never in a sheet, never sent to a page',
    props.TG_TOKEN === TG.good && !JSON.stringify(appSs._tabs.Settings ? appSs._tabs.Settings._.v : []).includes(TG.good) &&
    !JSON.stringify(R(`tgAdminData('boss')`)).includes(TG.good) && !JSON.stringify(R(`myReminders('suraj')`)).includes(TG.good));
  const link = R(`tgLinkStart('suraj')`), code = link.url.split('start=')[1];
  t('linking: a one-time t.me link to the bot', /^https:\/\/t\.me\/ggm_test_bot\?start=\w{10,}$/.test(link.url));
  t('…a generator role cannot use reminders', /only adds new/.test(err(`myReminders('og')`)));
  TG.updates.push({ update_id: 101, message: { chat: { id: 555, type: 'private' }, from: { first_name: 'Suraj', username: 'suraj_tg' }, text: '/start ' + code } });
  const mr = R(`myReminders('suraj', true)`);
  t('…"Start" in the bot links the person (read straight away when the page checks)', mr.tg.linked && /suraj_tg/.test(mr.tg.tg) && TG.sent.some(m => String(m.chat_id) === '555' && /Connected/.test(m.text)));
  TG.updates.push({ update_id: 102, message: { chat: { id: 777, type: 'private' }, from: { first_name: 'X' }, text: '/start ' + code } });
  R(`tgPoll_()`);
  t('…the link works once (a second use is refused, nobody else gets linked)', TG.sent.some(m => String(m.chat_id) === '777' && /expired/.test(m.text)) && !R(`userByChat_(777)`));
  t('…the poll moves on (old messages are not read again)', props.TG_OFFSET === '103');

  const iso = ms => { const d = new Date(ms + 19800000); return d.toISOString().slice(0, 16); };
  t('reminders: a time in the past is refused, text is required',
    /already passed/.test(err(`saveReminder('suraj', { text: 'x call', when: '${iso(Date.now() - 3 * 3600000)}' })`)) && /Write what/.test(err(`saveReminder('suraj', { text: '', when: '${iso(Date.now() + 3600000)}' })`)));
  const lead0 = R(`boardData_('L2O').leads.filter(function (l) { return !l.closed && l.owner === 'SURAJ'; })[0].id`);
  const sr = R(`saveReminder('suraj', { text: 'Call about the sample', when: '${iso(Date.now() + 3600000)}', fid: 'L2O', lead: '${lead0}' })`);
  R(`saveReminder('suraj', { text: 'Daily follow-ups', when: '${iso(Date.now() + 7200000)}', repeat: 'daily' })`);
  t('…saved, about a lead, listed for its owner only', sr.ok && R(`myReminders('suraj').list.length`) === 2 && sr.list[0].lead === lead0 && sr.list[0].title && R(`myReminders('aayushi').list.length`) === 0);
  const RM = appSs._tabs.Reminders;
  t('…nobody else can edit or delete it', /not your reminder/.test(err(`deleteReminder('aayushi', '${sr.list[0].id}')`)));
  // make both due
  RM._.v.slice(1).forEach(r => { r[4] = new Date(Date.now() - 60000); });
  const before = TG.sent.length;
  R(`MEMO_ = { ss: MEMO_.ss }; notifyTick()`);
  const got = TG.sent.slice(before).filter(m => String(m.chat_id) === '555');
  t('notifyTick sends due reminders to Telegram (with the lead)', got.some(m => /Call about the sample/.test(m.text) && m.text.includes(lead0)) && got.some(m => /Daily follow-ups/.test(m.text)));
  const rows = RM._.v.slice(1);
  t('…a one-time reminder is marked sent; a daily one moves to tomorrow and stays open',
    rows.find(r => r[3] === 'Call about the sample')[8] === 'sent' && rows.find(r => r[3] === 'Daily follow-ups')[8] === 'open' && rows.find(r => r[3] === 'Daily follow-ups')[4].getTime() > Date.now());
  const b2 = TG.sent.length;
  R(`MEMO_ = { ss: MEMO_.ss }; notifyTick()`);
  t('…the next run sends nothing twice', TG.sent.length === b2);

  // date alert: SAMPLING › ETA today → the owner, with details
  const lay = R(`layout_('L2O')`), etaCol = lay.steps.find(s => s.key === 'SAMPLING').fields.find(f => f.k === 'ETA').c;
  const NLr = NL._.v.findIndex(r => r && r[0] === lead0);
  const todayMid = new Date(Math.floor((Date.now() + 19800000) / 864e5) * 864e5 - 19800000);
  NL._.v[NLr][etaCol] = todayMid;
  R(`MEMO_ = { ss: MEMO_.ss }; PropertiesService.getScriptProperties().deleteProperty('REBUILDING'); rebuildBoards_()`);
  t('date alerts: Admin rule saved (field must be a real date field, someone must get it)',
    /pick the date field/.test(err(`tgSaveRules('boss', { dateAlerts: [{ fid: 'L2O', ref: 'SAMPLING:Nope', to: ['owner'] }] })`)) &&
    /pick who/.test(err(`tgSaveRules('boss', { dateAlerts: [{ fid: 'L2O', ref: 'SAMPLING:ETA', to: [] }] })`)));
  R(`tgSaveRules('boss', { dateAlerts: [{ fid: 'L2O', ref: 'SAMPLING:ETA', to: ['owner', 'u:admin'], at: '00:00', before: 0, show: ['base:PRODUCT NAME', 'base:Contact Details'], note: 'Confirm the sample reached' }] })`);
  const b3 = TG.sent.length;
  R(`MEMO_ = { ss: MEMO_.ss }; notifyTick()`);
  const dm = TG.sent.slice(b3).filter(m => /ETA/.test(m.text));
  t('…on the date: the owner gets "ETA is today" with the lead, the chosen details and the note', dm.length === 1 && String(dm[0].chat_id) === '555' && dm[0].text.includes(lead0) && /is today/.test(dm[0].text) && /Confirm the sample reached/.test(dm[0].text) && /Product:/.test(dm[0].text));
  const LG = appSs._tabs['Notify Log'];
  t('…people not connected to Telegram are logged as "not connected" (nothing sent to them)', LG._.v.some(r => r && r[1] === 'admin' && r[2] === 'date' && r[5] === 'not connected'));
  const b4 = TG.sent.length; R(`MEMO_ = { ss: MEMO_.ss }; notifyTick()`);
  t('…and it is sent once only', TG.sent.length === b4);

  // late alert at CONTACT: a tile that turned late after the alert was switched on
  R(`tgSaveRules('boss', { lateAlerts: { L2O: { CONTACT: { on: true, extra: [] } } }, digest: { on: true, at: '00:00' } })`);
  const la = R(`lateAlerts_()`);
  t('late alerts: switched on per step (remembers since when)', la.L2O.CONTACT.on && la.L2O.CONTACT.since > Date.now() - 60000);
  const pCol = lay.steps.find(s => s.key === 'CONTACT').p, aCol = lay.steps.find(s => s.key === 'CONTACT').a;
  const cont = R(`boardData_('L2O').leads.filter(function (l) { return l.cur === 'CONTACT' && l.owner === 'SURAJ'; }).map(function (l) { return l.id; })`);
  const lateId = cont[0], LR = NL._.v.findIndex(r => r && r[0] === lateId);
  R(`var s = settings_().lateAlerts; s.L2O.CONTACT.since = Date.now() - 2 * 3600000; setSetting_('lateAlerts', s, 'test')`);
  NL._.v[LR][pCol] = new Date(Date.now() - 3600000);
  R(`MEMO_ = { ss: MEMO_.ss }; PropertiesService.getScriptProperties().deleteProperty('REBUILDING'); rebuildBoards_()`);
  const b5 = TG.sent.length;
  R(`MEMO_ = { ss: MEMO_.ss }; notifyTick()`);
  const lm = TG.sent.slice(b5);
  t('…the responsible person gets "Late: Contact buyer" for the tile that just turned late (old late tiles are not blasted)',
    lm.filter(m => /Late:/.test(m.text)).length === 1 && lm.some(m => /Late:/.test(m.text) && m.text.includes(lateId) && String(m.chat_id) === '555'));
  const today0 = Math.floor((Date.now() + 19800000) / 864e5), dow = (today0 + 4) % 7, monNoon = (today0 + ((8 - dow) % 7 || 7)) * 864e5 - 19800000 + 3600000;
  const dg = R(`digestDue_(${monNoon}, {})`), dgS = R(`digestDue_(${(today0 + ((7 - dow) % 7 || 7)) * 864e5 - 19800000 + 3600000}, {})`);
  t('…the daily summary: one message per person listing all their late tiles, on working days only (not Sunday)',
    dg.length > 0 && dg.every(x => /Late today: \d+ tile/.test(x.text)) && new Set(dg.map(x => x.u)).size === dg.length && dg.some(x => x.u === 'suraj') && dgS.length === 0);
  const b6 = TG.sent.length; R(`MEMO_ = { ss: MEMO_.ss }; notifyTick()`);
  t('…neither is sent again on the next run', TG.sent.length === b6);
  TG.updates.push({ update_id: 103, message: { chat: { id: 555, type: 'private' }, text: '/list' } });
  R(`tgPoll_()`);
  t('bot commands: /list shows the next reminders', /Daily follow-ups/.test(TG.sent[TG.sent.length - 1].text));
  TG.updates.push({ update_id: 104, message: { chat: { id: 555, type: 'private' }, text: '/stop' } });
  R(`tgPoll_()`);
  t('…/stop does NOT switch messages off (nobody can stop them)', R(`myReminders('suraj').tg.linked`) && /cannot be switched off/.test(TG.sent[TG.sent.length - 1].text));
  t('…no Disconnect button, no tgUnlink, the bot never offers /stop',
    !/tgUnlink/.test(fs.readFileSync(path.join(DIR, 'App.html'), 'utf8')) && !/function tgUnlink|stop all messages/.test(fs.readFileSync(path.join(DIR, 'Notify.js'), 'utf8')));
  const html2 = fs.readFileSync(path.join(DIR, 'App.html'), 'utf8');
  t('page: Reminders in the menu for everyone, "Remind me" on a lead, Settings → Telegram for the Admin',
    /\{ k: 'rem', t: 'Reminders', i: 'bell' \}/.test(html2) && /data-act="remLead"/.test(html2) && /\['tg', 'Telegram'\]/.test(html2) && /function tgSettingsHtml/.test(html2));
  t('manifest: the app may call Telegram (external requests)', /script\.external_request/.test(fs.readFileSync(path.join(DIR, 'appsscript.json'), 'utf8')));
}

/* ---------------- 7i. tile details per step (Settings → Steps & people → Shown on the tile) */
{
  R(`MEMO_ = { ss: MEMO_.ss }`);
  const cur = R(`JSON.parse(JSON.stringify(stepCfg_('L2O')))`), steps = {};
  Object.keys(cur).forEach(k => { steps[k] = { label: cur[k].label, ownerActs: cur[k].ownerActs, doers: cur[k].doers, required: cur[k].required, card: cur[k].card, side: cur[k].side, photo: cur[k].photo }; });
  steps.CONTACT.card = ['base:COUNTRY / CITY', 'base:CONTACT PERSON', 'base:Contact Details', 'base:PRODUCT NAME', 'base:QUANTITY', 'base:SOURCE'];
  steps.FINAL.card = [];
  const sv = R(`saveSettings('boss', ${JSON.stringify({ steps: { L2O: steps } })})`);
  const lay = sv.flows.find(f => f.fid === 'L2O');
  t('tile details: saved in the order the Admin arranged them (Place first, then 5 more)', lay.steps.find(s => s.key === 'CONTACT').cfg.card.join('|') === steps.CONTACT.card.join('|'));
  t('…a step saved with no details stays empty (no silent fall back to the defaults)', lay.steps.find(s => s.key === 'FINAL').cfg.card.length === 0);
  const pg = R(`ping('suraj', 0, 'old-version', 0)`);
  t('…open screens get the new settings with the next minute ping (no reload needed)', Array.isArray(pg.flows) && pg.flows.find(f => f.fid === 'L2O').steps.find(s => s.key === 'CONTACT').cfg.card[0] === 'base:COUNTRY / CITY');
  const h = fs.readFileSync(path.join(DIR, 'App.html'), 'utf8');
  t('page: every chosen detail shows on the tile, also in Compact (it used to cut at 3)', /var card = st \? st\.cfg\.card\.slice\(0, 12\) : \[\]/.test(h) && !/S\.dense \? 3 : 8/.test(h));
  t('page: Settings shows the chosen details numbered, with ‹ › to move and × to remove', /function cardPickHtml/.test(h) && /data-cmove="-1"/.test(h) && /data-cmove="1"/.test(h) && /if \(\(el = t\.closest\('\[data-cmove\]'\)\)\)/.test(h));
  t('page: the ping applies new step settings', /\(r\.flows \|\| \[\]\)\.forEach\(function \(f\) \{ wCal\(f\.cal\); S\.flows\[f\.fid\] = f; \}\); setBoards\(r\.boards\)/.test(h));
  R(`setSetting_('steps', {}, 'test'); MEMO_ = { ss: MEMO_.ss }`);
}

/* ---------------- 7j. "Only save" vs "Move to next step" */
{
  R(`MEMO_ = { ss: MEMO_.ss }`);
  const lay = R(`layout_('L2O')`), ct = lay.steps.find(s => s.key === 'CONTACT');
  const id = R(`boardData_('L2O').leads.filter(function (l) { return l.cur === 'CONTACT' && l.owner === 'SURAJ'; })[1].id`);
  const row = NL._.v.findIndex(r => r && r[0] === id), remC = ct.fields.find(f => /remark/i.test(f.k)).c;
  const sd = R(`saveStepDraft('suraj', 'L2O', '${id}', 'CONTACT', { fields: { REMARK: 'called once, will call back' }, note: 'half done' })`);
  t('Only save: the filled details are written, the tile stays at its step (no answer, no Actual)',
    sd.ok && sd.detail.lead.cur === 'CONTACT' && NL._.v[row][remC] === 'called once, will call back' && !NL._.v[row][ct.a] && !NL._.v[row][ct.s] && /stays at/.test(sd.msg));
  t('…the board has the saved detail straight away', R(`findBoardLead_('L2O', '${id}').s.CONTACT.f.REMARK`) === 'called once, will call back');
  t('…and the history says "saved (not moved on)"', R(`rows_(TABS.EVENTS).some(function (r) { return r[4] === '${id}' && r[6] === 'SAVE'; })`));
  t('…nothing new = nothing written', /Nothing new/.test(R(`saveStepDraft('suraj', 'L2O', '${id}', 'CONTACT', { fields: { REMARK: 'called once, will call back' } })`).msg));
  const err = fn => { try { R(fn); return ''; } catch (e) { return e.message; } };
  t('…only for whoever may work that step, and only at the step the tile is at',
    /not assigned to you/.test(err(`saveStepDraft('aayushi', 'L2O', '${id}', 'CONTACT', { fields: { REMARK: 'x' } })`)) &&
    /no longer at/.test(err(`saveStepDraft('suraj', 'L2O', '${id}', 'QUOTATION', { fields: { REMARK: 'x' } })`)) &&
    /only adds new/.test(err(`saveStepDraft('lg', 'L2O', '${id}', 'CONTACT', { fields: { REMARK: 'x' } })`)));
  t('Move to next step still needs an answer', /Pick an answer/.test(err(`submitStep('suraj', 'L2O', '${id}', 'CONTACT', { fields: {} })`)));
  const h = fs.readFileSync(path.join(DIR, 'App.html'), 'utf8');
  t('page: every step has "Only save" and a main button named after the answer (Move to next step / Save follow-up / Close as lost…)',
    /data-act="saveOnly"/.test(h) && /case 'saveOnly': saveOnly\(el\.dataset\.k\)/.test(h) && /return isLastMain\(fid, k\) \? 'Finish' : \(stepOf\(fid, k\)\.cfg\.side \? 'Mark done' : 'Move to next step'\)/.test(h));
  t('page: details saved at the current step always show on its tile', /details already saved at this step always show/.test(h));
  t('page: Settings keeps its scroll position when a chip is clicked', /var old = document\.querySelector\('#view \.page'\), y = old \? old\.scrollTop : 0;/.test(h));
}

/* ---------------- 7k. Log call */
{
  R(`MEMO_ = { ss: MEMO_.ss }`);
  const err = fn => { try { R(fn); return ''; } catch (e) { return e.message; } };
  const id = R(`boardData_('L2O').leads.filter(function (l) { return l.cur === 'CONTACT' && l.owner === 'SURAJ'; })[0].id`);
  const att0 = R(`(findBoardLead_('L2O', '${id}').att || {}).CONTACT || 0`);
  const r1 = R(`logCall('suraj', 'L2O', '${id}', { outcome: 'Call not received' })`);
  t('Log call: the call is logged as a follow-up (count on the tile goes up)', r1.ok && /Call logged/.test(r1.msg) && (r1.detail.lead.att || {}).CONTACT === att0 + 1);
  t('…an outcome must be picked; "Asked to call later" needs a date and time in the future',
    /Pick what happened/.test(err(`logCall('suraj', 'L2O', '${id}', {})`)) && /Pick when/.test(err(`logCall('suraj', 'L2O', '${id}', { outcome: 'Asked to call later' })`)) &&
    /already passed/.test(err(`logCall('suraj', 'L2O', '${id}', { outcome: 'Asked to call later', next: '2020-01-01T10:00' })`)));
  const nx = new Date(Date.now() + 2 * 864e5 + 19800000).toISOString().slice(0, 10) + 'T11:30';
  const nRem = R(`rows_(TABS.REMINDERS).length`);
  const r2 = R(`logCall('suraj', 'L2O', '${id}', { outcome: 'Asked to call later', note: 'wants rates for 20 MT', next: '${nx}' })`);
  const rem = R(`rows_(TABS.REMINDERS)`).slice(nRem);
  t('…"Asked to call later" sets a Telegram reminder for that time, about this lead', r2.ok && /reminder/.test(r2.msg) && rem.length === 1 && rem[0][1] === 'SURAJ' && rem[0][7] === id && /Call back/.test(rem[0][3]) && /20 MT/.test(rem[0][3]));
  t('…the text goes into Notes too', R(`rows_(TABS.NOTES).some(function (r) { return r[4] === '${id}' && /wants rates for 20 MT/.test(r[6]); })`));
  t('…someone the lead is not with cannot log it', /not with you/.test(err(`logCall('aayushi', 'L2O', '${id}', { outcome: 'Call not received' })`)));
  const h = fs.readFileSync(path.join(DIR, 'App.html'), 'utf8');
  t('page: a "Log call" button on every open tile (and in the lead panel) with the 4 choices; it does not open the tile',
    /data-logcall="' \+ esc\(l\.id\)/.test(h) && /var CALLS = \['Call not received', 'Talked – interested', 'Talked – not interested', 'Asked to call later'\]/.test(h) &&
    h.indexOf("t.closest('[data-logcall]')") > -1 && h.indexOf("t.closest('[data-logcall]')") < h.indexOf("t.closest('[data-open]')"));
}

/* ---------------- 7l. Contact buyer + Give quotation → "Contact & quote" */
{
  R(`MEMO_ = { ss: MEMO_.ss }; PropertiesService.getScriptProperties().deleteProperty('REBUILDING'); rebuildBoards_()`);
  const before = R(`boardData_('L2O').leads.map(function (l) { return { id: l.id, cur: l.cur, closed: l.closed ? l.closed.o : '', cs: (l.s.CONTACT || {}).s || '', qrem: ((l.s.QUOTATION || {}).f || {}).REMARK || '' }; })`);
  const atQ = before.filter(b => b.cur === 'QUOTATION'), past = before.filter(b => b.cur && b.cur !== 'QUOTATION' && b.cur !== 'CONTACT'), closed = before.filter(b => b.closed);
  const withQrem = before.filter(b => b.qrem);
  R(`setSetting_('steps', { L2O: { CONTACT: { label: 'Contact buyer', card: ['base:CONTACT PERSON'], required: [] }, QUOTATION: { label: 'Give quotation', card: ['base:PRODUCT NAME'] },
      SAMPLING: { card: ['base:PRODUCT NAME', 'QUOTATION:@status', 'QUOTATION:REMARK', 'base:QUANTITY'] } } }, 'test'); MEMO_ = { ss: MEMO_.ss }`);
  const res = JSON.parse(R(`mergeCqOut_()`).text);
  t('merge: runs once, makes a backup of LEADS first', !res.error && /^LEADS before merge/.test(res.backup) && !!appSs._tabs[res.backup] && JSON.parse(R(`mergeCqOut_()`).text).already);
  const lay = R(`MEMO_ = { ss: MEMO_.ss }; layout_('L2O')`), C = lay.steps.find(s => s.key === 'CONTACT');
  t('…LEADS has 4 steps: Contact & quote (with Raw Rates/Prices), Send sample, Advance, Final', lay.steps.map(s => s.key).join() === 'CONTACT,SAMPLING,ADVANCE,FINAL' &&
    C.fields.map(f => f.k).join('|') === 'REMARK|Raw Rates/Prices' && C.opts.length === 10 && C.opts.indexOf('Order Reject') > -1);
  t('…Send sample\'s clock now starts when Contact & quote is done', lay.steps.find(s => s.key === 'SAMPLING').from.step === 'CONTACT');
  const after = {}; R(`boardData_('L2O').leads`).forEach(l => { after[l.id] = l; });
  t('…the ' + atQ.length + ' leads waiting for a quotation are open at Contact & quote again', atQ.length > 0 && atQ.every(b => after[b.id].cur === 'CONTACT' && !after[b.id].closed));
  t('…leads past the quotation stay where they were; closed leads stay closed the same way', past.length > 0 && past.every(b => after[b.id].cur === b.cur) && closed.every(b => after[b.id].closed && after[b.id].closed.o === b.closed));
  t('…no row lost', Object.keys(after).length === before.length);
  t('…quotation remarks are kept in REMARK ("Quotation: …")', withQrem.length > 0 && withQrem.every(b => String(after[b.id].s.CONTACT.f.REMARK || '').includes('Quotation: ' + b.qrem)));
  t('…every changed lead has a MERGE line in its history', R(`rows_(TABS.EVENTS).filter(function (r) { return r[6] === 'MERGE'; }).length`) >= atQ.length);
  const st = R(`settings_().steps.L2O`);
  t('…saved settings follow: no Give quotation; Contact & quote needs Raw Rates/Prices to move on; Send sample tiles show rates + remark instead',
    !st.QUOTATION && st.CONTACT.label === 'Contact & quote' && st.CONTACT.required.indexOf('CONTACT:Raw Rates/Prices') > -1 &&
    st.SAMPLING.card.join('|') === 'base:PRODUCT NAME|CONTACT:Raw Rates/Prices|CONTACT:REMARK|base:QUANTITY');
  const steps = appSs._tabs.Steps._.v.filter(r => r && r[0] === 'LEADS');
  t('…Steps tab: one row "CONTACT & QUOTATION" with all 10 answers', steps.length === 4 && steps[0][3] === 'CONTACT & QUOTATION' && steps[0].slice(5, 15).join('|') === R(`MERGED_ANSWERS`).join('|'));
  const id = atQ[0].id;
  const err = fn => { try { R(fn); return ''; } catch (e) { return e.message; } };
  t('…moving on needs Raw Rates/Prices; with it, the lead goes straight to Send sample',
    /Raw Rates\/Prices/.test(err(`submitStep('suraj', 'L2O', '${id}', 'CONTACT', { status: 'Done' })`)) &&
    R(`MEMO_ = { ss: MEMO_.ss }; submitStep('suraj', 'L2O', '${id}', 'CONTACT', { status: 'Done', fields: { 'Raw Rates/Prices': '₹ 4,200 / MT ex-mine' } })`).detail.lead.cur === 'SAMPLING');
  const others = Object.keys(after).filter(x => x !== id && after[x].cur === 'CONTACT' && after[x].owner === 'SURAJ');
  atQ[1] = { id: others[0] }; atQ[2] = { id: others[1] };
  t('…"Negotiating" keeps it at Contact & quote (follow-up); "Order Reject" closes it as lost',
    R(`MEMO_ = { ss: MEMO_.ss }; submitStep('suraj', 'L2O', '${atQ[1].id}', 'CONTACT', { status: 'Negotiating' })`).detail.lead.cur === 'CONTACT' &&
    R(`MEMO_ = { ss: MEMO_.ss }; submitStep('suraj', 'L2O', '${atQ[2].id}', 'CONTACT', { status: 'Order Reject' })`).detail.lead.closed.o === 'lost');
}

/* ---------------- 7m. sample step: ETD + courier fields */
t('field types: ETD is a date; Courier Charges a number; Tracking No. / Courier Name text; Raw Rates/Prices stays text',
  R(`fieldType_('ETD', null)`) === 'date' && R(`fieldType_('ETA', null)`) === 'date' && R(`fieldType_('Courier Charges', null)`) === 'number' &&
  R(`fieldType_('Tracking No.', null)`) === 'text' && R(`fieldType_('Courier Name', null)`) === 'text' && R(`fieldType_('Raw Rates/Prices', null)`) === 'text');

/* ---------------- 7n. Order → Delivery in cycles (payment-gated cycles with trucks) */
{
  const err = fn => { try { R(fn); return ''; } catch (e) { return e.message; } };
  R(`MEMO_ = { ss: MEMO_.ss }; PropertiesService.getScriptProperties().deleteProperty('REBUILDING'); rebuildBoards_()`);
  t('cycles: off until the move (two boards)', R(`FLOW_IDS.join()`) === 'L2O,O2D' && R(`cyclesOn_()`) === false);
  const before = R(`boardData_('O2D').leads.map(function (l) { return { id: l.id, cur: l.cur || '', side: (l.side || []).join(), closed: l.closed ? l.closed.o : '', qty: pick_(l.b, 'QTY.'), party: pick_(l.b, 'PARTY NAME'),
      st: JSON.stringify([(l.s.STATION || {}).a || '', (l.s.STATION || {}).s || '', (l.s.ESTIMATE || {}).a || '', (l.s.ESTIMATE || {}).s || '']),
      tr: !!(l.s.TRANSPORT || {}).a, wt: ((l.s.TRANSPORT || {}).f || {})['WT.'] || '' }; })`);
  const early = before.filter(b => ['STATION', 'CLIENT_OK', 'ESTIMATE'].includes(b.cur) && !b.closed);
  const later = before.filter(b => !b.closed && !['STATION', 'CLIENT_OK', 'ESTIMATE'].includes(b.cur));
  const res = JSON.parse(R(`cyclesOut_()`).text);
  t('move: runs once, backs up ORDERS first, switches cycles on', !res.error && /^ORDERS before cycles/.test(res.backup) && !!appSs._tabs[res.backup] && JSON.parse(R(`cyclesOut_()`).text).already && R(`cyclesOn_()`) === true);
  if (res.error) console.log('cycles move error:', res.error, res.stack);
  R(`MEMO_ = { ss: MEMO_.ss }`);
  const lo = R(`layout_('O2D')`), lc = R(`layout_('CYC')`);
  t('…ORDERS: Confirm at station, Client OK, Estimate, then "In cycles" (no deadline; Loaded / Balance / Cycles filled by the app)',
    lo.steps.map(s => s.key).join() === 'STATION,CLIENT_OK,ESTIMATE,CYCLES' && lo.steps[3].fields.filter(f => f.ro).map(f => f.k).join('|') === 'Loaded (t)|Balance (t)|Cycles');
  t('…CYCLES tab: payment, trucks, dispatch, payment confirmation, invoice, delivery, balance payment (6–12)',
    lc.steps.map(s => s.key + s.num).join() === 'ADVANCE6,TRANSPORT7,DISPATCH8,PAY_CONFIRM9,INVOICE10,DELIVERY11,BALANCE_PAY12' &&
    lc.steps[0].opts.join() === 'Advance received,Credit,On Dispatch,On Delivery' && lc.steps[0].fields.map(f => f.k + ':' + f.t).join() === 'Amount:number,Tons covered:number,Remark:textarea' &&
    lc.base.every(b => b.ro) && lc.steps[1].fields.filter(f => f.ro).length === 2);
  const after = {}; R(`boardData_('O2D').leads`).forEach(l => { after[l.id] = l; });
  const cyc = R(`boardData_('CYC').leads`), cycOf = id => cyc.filter(c => c.b['Order No'] === id);
  t('…no order lost; details and steps 2–4 copied exactly', before.every(b => after[b.id] && JSON.stringify([(after[b.id].s.STATION || {}).a || '', (after[b.id].s.STATION || {}).s || '', (after[b.id].s.ESTIMATE || {}).a || '', (after[b.id].s.ESTIMATE || {}).s || '']) === b.st && after[b.id].b['PARTY NAME'] === b.party));
  t('…orders before the payment step stay where they were (no cycle yet)', early.length > 0 && early.every(b => after[b.id].cur === b.cur && !cycOf(b.id).length));
  t('…every open order past the estimate is now "In cycles" with at least one open cycle', later.length > 0 && later.every(b => after[b.id].cur === 'CYCLES' && cycOf(b.id).some(c => !c.closed)));
  t('…closed orders stay closed the same way', before.filter(b => b.closed && !b.side).every(b => after[b.id].closed && after[b.id].closed.o === b.closed));
  const carried = later.filter(b => b.tr);
  t('…a truck already loaded continues as C1 at its step (its truck in the Trucks tab); the rest of the order gets a fresh cycle at the payment',
    carried.every(b => { const cs = cycOf(b.id); return cs.length >= 1 && cs[0].id === b.id + '-C1' && cs[0].cur !== 'ADVANCE'; }) &&
    appSs._tabs.Trucks._.v.slice(1).filter(r => r && r[0]).length >= carried.length);
  t('…orders not yet loaded start fresh: C1 at "Cycle payment"', later.filter(b => !b.tr).every(b => { const cs = cycOf(b.id); return cs.length === 1 && cs[0].cur === 'ADVANCE'; }));

  // an order reaching the end of the estimate starts its first cycle by itself — and is used for the walk-through below
  const atEst = early[0].id;
  if (R(`findBoardLead_('O2D', '${atEst}').cur`) === 'STATION') R(`MEMO_ = { ss: MEMO_.ss }; submitStep('boss', 'O2D', '${atEst}', 'STATION', { status: 'Yes', fields: { 'Prev. Dt.': '2026-11-17', 'EDD': '2026-11-18' } })`);
  if (R(`MEMO_ = { ss: MEMO_.ss }; findBoardLead_('O2D', '${atEst}').cur`) === 'CLIENT_OK') R(`MEMO_ = { ss: MEMO_.ss }; submitStep('boss', 'O2D', '${atEst}', 'CLIENT_OK', { status: 'Yes' })`);
  t('…an order not yet at the payment step simply moves through steps 2–4 as before', R(`MEMO_ = { ss: MEMO_.ss }; findBoardLead_('O2D', '${atEst}').cur`) === 'ESTIMATE');
  const e = R(`MEMO_ = { ss: MEMO_.ss }; submitStep('boss', 'O2D', '${atEst}', 'ESTIMATE', { status: 'Done' })`);
  t('estimate done → the order goes "In cycles" and C1 starts at its payment', e.detail.lead.cur === 'CYCLES' && e.extra.CYC && e.extra.CYC[0].id === atEst + '-C1' && e.extra.CYC[0].cur === 'ADVANCE' && /C1 started/.test(e.msg));
  // the payment gate, customer terms and tons
  const ord = atEst, c1 = ord + '-C1', qty = R(`orderSummary_('${ord}').qty`);
  t('gate: no truck before the cycle\'s payment', /Record the payment of .* first/.test(err(`addTruck('boss', '${c1}', { truck: 'RJ14GA1234', wt: 5 })`)));
  t('…Credit is refused until the Admin allows it for the customer', /not allowed for/.test(err(`submitStep('boss', 'CYC', '${c1}', 'ADVANCE', { status: 'Credit', fields: { 'Tons covered': '5' } })`)));
  const party = R(`pick_(findBoardLead_('CYC', '${c1}').b, 'PARTY NAME')`);
  R(`saveSettings('boss', { custTerms: { ${JSON.stringify(party)}: ['Credit', 'Bogus'] } }); MEMO_ = { ss: MEMO_.ss }`);
  t('…Settings → Customers saves the allowed terms (only real ones)', JSON.stringify(R(`settingsData('boss').custTerms`)) === JSON.stringify({ [R(`partyKey_(${JSON.stringify(party)})`)]: ['Credit'] }) &&
    R(`leadDetail('boss', 'CYC', '${c1}').terms`).join() === 'Advance received,Credit');
  t('…advance needs the amount; tons covered are required and cannot exceed the order',
    /advance amount/.test(err(`submitStep('boss', 'CYC', '${c1}', 'ADVANCE', { status: 'Advance received', fields: { 'Tons covered': '1' } })`)) &&
    /Tons covered|tons this payment/.test(err(`submitStep('boss', 'CYC', '${c1}', 'ADVANCE', { status: 'Advance received', fields: { Amount: '50000' } })`)) &&
    (!qty || /is not covered by other cycles/.test(err(`submitStep('boss', 'CYC', '${c1}', 'ADVANCE', { status: 'Advance received', fields: { Amount: '50000', 'Tons covered': '${qty * 3}' } })`))));
  const half = qty ? Math.max(1, Math.floor(qty / 2)) : 10;
  const pay = R(`MEMO_ = { ss: MEMO_.ss }; submitStep('boss', 'CYC', '${c1}', 'ADVANCE', { status: 'Advance received', fields: { Amount: '50000', 'Tons covered': '${half}' } })`);
  t('…a valid payment opens "Trucks"', pay.ok && pay.detail.lead.cur === 'TRANSPORT');
  t('trucks: more than the payment covers is refused', /more than this cycle's payment covers/.test(err(`addTruck('boss', '${c1}', { truck: 'RJ14GA1234', wt: ${half * 2} })`)));
  t('…"Done" is refused while there is no truck', /Add the trucks/.test(err(`submitStep('boss', 'CYC', '${c1}', 'TRANSPORT', { status: 'Done' })`)));
  const tr1 = R(`MEMO_ = { ss: MEMO_.ss }; addTruck('boss', '${c1}', { truck: 'rj14 ga 1234', wt: ${half}, tpt: 'Shree Om', mob: '9999999999' })`);
  t('…a truck is added (number tidied), the cycle shows it, the order\'s Loaded / Balance follow', tr1.ok && tr1.detail.trucks.length === 1 && tr1.detail.trucks[0].truck === 'RJ14 GA 1234' &&
    tr1.detail.lead.s.TRANSPORT.f['Weight loaded (t)'] === half && (!qty || tr1.order.s.CYCLES.f['Balance (t)'] === Math.round((qty - half) * 100) / 100));
  const tr2 = R(`MEMO_ = { ss: MEMO_.ss }; addTruck('boss', '${c1}', { truck: 'RJ01AB9999', wt: 0.5 })`);
  const rm = R(`MEMO_ = { ss: MEMO_.ss }; removeTruck('boss', '${c1}', ${tr2.detail.trucks[1].row})`);
  t('…and removed again (kept in the Trucks tab as removed)', rm.ok && rm.detail.trucks.length === 1 && appSs._tabs.Trucks._.v.some(r => r && r[2] === 'RJ01AB9999' && /^Removed/.test(r[8])));
  const go = (k, data) => R(`MEMO_ = { ss: MEMO_.ss }; submitStep('boss', 'CYC', '${c1}', '${k}', ${JSON.stringify(data)})`);
  go('TRANSPORT', { status: 'Done' });
  t('…after "Done" the trucks are fixed', /can no longer change/.test(err(`addTruck('boss', '${c1}', { truck: 'RJ14GA0001', wt: 1 })`)));
  t('dispatch needs its date (per cycle)', /Dispatch Date/.test(err(`submitStep('boss', 'CYC', '${c1}', 'DISPATCH', { status: 'Yes' })`)));
  go('DISPATCH', { status: 'Yes', fields: { 'Dispatch Date': '2026-11-17' } });
  ['PAY_CONFIRM', 'INVOICE', 'DELIVERY'].forEach(k => go(k, { status: R(`layout_('CYC').steps.filter(function (s) { return s.key === '${k}'; })[0].opts[0]`), fields: k === 'INVOICE' ? { 'Invoice No.': 'GGM/2026/101' } : {} }));
  const wonBefore = R(`rows_(TABS.EVENTS).filter(function (r) { return r[6] === 'WON'; }).length`);
  const last = go('BALANCE_PAY', { status: 'Done' });
  t('…every step per cycle; after the balance payment call the cycle is complete (not counted as a won order)',
    last.detail.lead.closed && last.detail.lead.closed.o === 'won' && R(`rows_(TABS.EVENTS).filter(function (r) { return r[6] === 'WON'; }).length`) === wonBefore);
  let od = R(`MEMO_ = { ss: MEMO_.ss }; leadDetail('boss', 'O2D', '${ord}')`);
  if (qty) {
    t('order: still "In cycles" while tons are left; it lists its cycles', od.lead.cur === 'CYCLES' && od.cycles.length === 1 && od.cycles[0].closed === 'won' && od.sum.balance === qty - half && od.cycles[0].invoice === 'GGM/2026/101');
    t('…"Completed" by hand is refused while tons are left', /still to be sent/.test(err(`submitStep('boss', 'O2D', '${ord}', 'CYCLES', { status: 'Completed' })`)));
    const nx = R(`MEMO_ = { ss: MEMO_.ss }; createCycle('boss', '${ord}')`);
    t('…"Start next cycle" makes C2 at its payment', nx.ok && nx.id === ord + '-C2' && nx.cycle.cur === 'ADVANCE');
    t('…closing the order by hand is refused while a cycle is open', /open cycles/.test(err(`closeLead('boss', 'O2D', '${ord}', 'won', 'done here')`)));
    const c2 = nx.id, rest = qty - half;
    R(`MEMO_ = { ss: MEMO_.ss }; submitStep('boss', 'CYC', '${c2}', 'ADVANCE', { status: 'Credit', fields: { 'Tons covered': '${rest}' } })`);
    R(`MEMO_ = { ss: MEMO_.ss }; addTruck('boss', '${c2}', { truck: 'RJ14GB2222', wt: ${rest} })`);
    const g2 = (k, data) => R(`MEMO_ = { ss: MEMO_.ss }; submitStep('boss', 'CYC', '${c2}', '${k}', ${JSON.stringify(data)})`);
    g2('TRANSPORT', { status: 'Done' }); g2('DISPATCH', { status: 'Yes', fields: { 'Dispatch Date': '2026-11-18' } });
    ['PAY_CONFIRM', 'INVOICE', 'DELIVERY', 'BALANCE_PAY'].forEach(k => g2(k, { status: R(`layout_('CYC').steps.filter(function (s) { return s.key === '${k}'; })[0].opts[0]`) }));
    od = R(`MEMO_ = { ss: MEMO_.ss }; leadDetail('boss', 'O2D', '${ord}')`);
    t('…when everything is loaded and every cycle is done, the order completes by itself (won once)', od.lead.closed && od.lead.closed.o === 'won' && od.lead.s.CYCLES.s === 'Completed' &&
      R(`rows_(TABS.EVENTS).filter(function (r) { return r[4] === '${ord}' && r[6] === 'WON'; }).length`) === 1);
    t('…"+ Next cycle" is refused when nothing is left', /closed|Nothing left/.test(err(`createCycle('boss', '${ord}')`)));
  }
  t('fully sent: less than one truck (30 t) left and something loaded (975 of 1000 t yes, 960 no, 0 of 25 t no)',
    R(`fullySent_({ qty: 1000, loaded: 975, balance: 25 })`) === true && R(`fullySent_({ qty: 1000, loaded: 970, balance: 30 })`) === false &&
    R(`fullySent_({ qty: 40, loaded: 39.33, balance: 0.67 })`) === true && R(`fullySent_({ qty: 25, loaded: 0, balance: 25 })`) === false && R(`fullySent_({ qty: 0, loaded: 0, balance: 0 })`) === false);
  const openBefore = R(`boardData_('O2D').leads.filter(function (l) { return l.cur === 'CYCLES'; }).map(function (l) { return l.id; })`);
  const fx = JSON.parse(R(`cyclesFixOut_()`).text);
  t('repair: runs once and never touches an order whose cycles are open or worked on', !fx.error && JSON.parse(R(`cyclesFixOut_()`).text).already &&
    R(`MEMO_ = { ss: MEMO_.ss }; boardData_('O2D').leads.filter(function (l) { return l.cur === 'CYCLES'; }).length`) === openBefore.length - fx.restored.length);
  const s = R(`settings_().steps`);
  t('settings: the old order steps\' people and tile details moved to the cycle steps; ORDERS keeps "In cycles"',
    !!s.O2D.CYCLES && !s.O2D.TRANSPORT && (!s.CYC || Object.keys(s.CYC).every(k => !s.CYC[k].card.some(r => /QUOTATION|Balance WT|STATION:/.test(r)))));
  const h = fs.readFileSync(path.join(DIR, 'App.html'), 'utf8');
  t('page: Settings loads the step settings of every board incl. Order cycles (the "Order cycles" button used to fail)',
    /flowList\(\)\.forEach\(function \(fid\) \{\s*S\.set\.steps\[fid\] = \{\};/.test(h) && !/\['L2O', 'O2D'\]\.forEach\(function \(fid\) \{\s*S\.set\.steps/.test(h));
  t('page: Order → Delivery board shows the cycle steps after the order steps; order tiles show loaded / left and each cycle; + Next cycle',
    /function boardFlows\(fid\) \{ return fid === 'O2D' && S\.flows\.CYC \? \['O2D', 'CYC'\] : \[fid\]; \}/.test(h) && /function cycleBar\(l\)/.test(h) && /data-newcycle=/.test(h));
  t('page: a cycle shows payment, tons and trucks (add / remove only at Trucks), locked before the payment; terms not allowed are greyed out',
    /data-act="addTruck"/.test(h) && /data-rmtruck=/.test(h) && /Trucks can be added after this cycle’s payment/.test(h) && /class="ans off" disabled/.test(h));
  t('page: Settings → Customers with Credit / On Dispatch / On Delivery per customer', /\['cust', 'Customers'\]/.test(h) && /data-cterm=/.test(h) && /saveSet\(\{ custTerms: S\.set\.cust \|\| \{\} \}\)/.test(h));
}

/* ---------------- 8. page */
const html = fs.readFileSync(path.join(DIR, 'App.html'), 'utf8'), idx = fs.readFileSync(path.join(DIR, 'Index.html'), 'utf8'), css = fs.readFileSync(path.join(DIR, 'Styles.html'), 'utf8');
t('page: red tiles always on top of a column', /var ra = dueOf\(fid, a, k\) === 'over' \? 0 : 1, rb = dueOf\(fid, b, k\) === 'over' \? 0 : 1;   \/\/ red always on top/.test(html));
t('page: search pins the tile on top of its column and clears filters that hide it', /S\.pin = \{ fid: fid, id: id \}/.test(html) && /if \(!passTop\(fid, l, k\)\) \{ S\.f\[bf\] = \{\}/.test(html));
t('page: switcher for both flows next to the search bar', /id="flowSeg"/.test(idx) && idx.indexOf('id="flowSeg"') < idx.indexOf('id="searchBox"'));
t('page: tiles green / yellow / red', /\.tile\.ok\{border-left-color:var\(--ok\)/.test(css) && /\.tile\.warn\{border-left-color:var\(--warn\)/.test(css) && /\.tile\.over\{border-left-color:var\(--bad\)/.test(css));
t('page: Work tab, Lifecycle, Details, Notes & photos in the right drawer', /\['work', 'Work'\], \['life', 'Lifecycle'\], \['details', 'Details'\], \['notes', 'Notes & photos'/.test(html));
t('page: one icon on top of the rail (no duplicate of the Pipeline button)', !/<aside class="rail">\s*<div class="brand-mark"/.test(idx));
t('page: picking "Custom range…" opens the box and the same click does not close it', /!t\.closest\('\[data-f="late"\]'\)\) closePop\(\)/.test(html));
t('page: form-only roles see just the form (rail, top bar, bottom bar hidden)', /if \(GEN\[S\.me\.role\]\) \{ renderGen\(\); return; \}/.test(html) && /body\.gen \.rail,body\.gen \.top,body\.gen \.bnav\{display:none!important\}/.test(css));
t('page: suggestion lists have no size limit (they used to vanish past 150 names)', !/vals\.length > 150/.test(html) && /function suggestVals\(fid, k\)/.test(html));
{
  const grab = n => { const i = html.indexOf('function ' + n + '('); let d = 0, j = html.indexOf('{', i); for (; ; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && !--d) break; } return html.slice(i, j + 1); };
  const nm = vm.runInNewContext(['normName', 'editDist', 'nearNames'].map(grab).join('\n') + ';nearNames', {});
  const L = ['Prakash Traders', 'Krishna Udhyog, Jaipur', 'Dev shree mineral', 'SS Enterprises', 'CM enterprises', 'Shiva chemical, mujhfnager'];
  t('page: "Did you mean" catches typos and variants of an existing party',
    nm('prakash trader', L)[0] === 'Prakash Traders' && nm('Krishna Udyog', L)[0] === 'Krishna Udhyog, Jaipur' && nm('Devshree Minerals', L)[0] === 'Dev shree mineral' &&
    nm('Shiva Chemicals', L)[0] === 'Shiva chemical, mujhfnager' && nm('SS Enterprise', L)[0] === 'SS Enterprises');
  t('…but not for a name typed exactly as it is in the list, or a really new one (SS ≠ CM Enterprises)',
    nm('ss enterprises', L).length === 0 && nm('Brand New Party', L).length === 0 && nm('SS Enterprise', L).indexOf('CM enterprises') < 0);
  t('page: the check runs before saving and "No, it is a new party" saves as typed', /if \(near\.length\) \{ showNear\(fid, tk, tv, near\); break; \}/.test(html) && /cb\.dataset\.sure = el\.dataset\.v; act\('createEntry', cb\)/.test(html));
}
t('page: "Only their steps" shows just their step columns, no Closed column; Board picker in Settings → People', /if \(mineOnly && !myStep\(st\)\) return;/.test(html) && /if \(!mineOnly\) cols \+= closedCol\(fid\)/.test(html) && /data-scope="/.test(html) && /saveSet\(\{ aliases: al, scope: scp \}\)/.test(html));
t('page: screen time only counts when the page is visible and used in the last 3 minutes', /document\.visibilityState === 'visible' && Date\.now\(\) - ACT\.last < 180000/.test(html));

console.log(ok + ' passed, ' + bad + ' failed');
process.exit(bad ? 1 : 0);
