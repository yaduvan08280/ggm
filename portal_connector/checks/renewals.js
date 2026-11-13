// Renewal Record sheet: typed renewal details stay with their Doc ID (Feed Inputs), a renewal is
// only "done" when the new expiry is really on the entry tab, and bad dates are refused.
const vm = require('vm'), fs = require('fs'), path = require('path');
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const root = path.join(__dirname, '..', '..');
const core = fs.readFileSync(path.join(root, 'renewal_system', 'RenewalCore.js'), 'utf8');
for (const app of ['Staff_dashboard', 'main_admin_dashboard'])
  t('RenewalCore.js in ' + app + ' is the same file', fs.readFileSync(path.join(root, app, 'RenewalCore.js'), 'utf8') === core);

// ---- a tiny spreadsheet: values (and R1C1 formulas) per cell ---------------------------------
function Sheet(name, rows) {
  const s = { name, cells: rows.map(r => r.slice()), f: [], hidden: false, revert: null };
  const cell = (r, c) => ((s.cells[r - 1] || [])[c - 1]);
  const put = (r, c, v) => { while (s.cells.length < r) s.cells.push([]); s.cells[r - 1][c - 1] = v; };
  const api = {
    _s: s, getName: () => name, hideSheet: () => { s.hidden = true; },
    getParent: () => ss,
    getLastRow: () => { for (let r = s.cells.length; r > 0; r--) if ((s.cells[r - 1] || []).some(v => v !== '' && v !== undefined && v !== null)) return r; return 0; },
    deleteRow: r => { s.cells.splice(r - 1, 1); s.f.splice(r - 1, 1); },
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const v = cell(r + i, c + j); return v === undefined ? '' : v; })),
      setValues: vals => vals.forEach((row, i) => row.forEach((v, j) => { put(r + i, c + j, v); (s.f[r + i - 1] = s.f[r + i - 1] || [])[c + j - 1] = ''; })),
      getValue: () => { const v = cell(r, c); return v === undefined ? '' : v; },
      setValue: v => { put(r, c, (s.revert && s.revert(r, c)) ? cell(r, c) : v); },
      getFormulasR1C1: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ((s.f[r + i - 1] || [])[c + j - 1]) || '')),
      setFormulaR1C1: fx => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) (s.f[r + i - 1] = s.f[r + i - 1] || [])[c + j - 1] = fx; }
    })
  };
  return api;
}
const D = (y, m, d) => new Date(y, m - 1, d);
const blank = n => Array.from({ length: n }, () => []);
let ss;
function book() {
  const entry = (pfx, docs) => Sheet(pfx, blank(4).concat(docs.map(([id, valid]) => [id, '', 'Insurance', '', '', '', valid].concat(Array(13).fill('')))));
  const sheets = {
    'Vehicle Documents': entry('Vehicle Documents', [['VEH-001', D(2026, 10, 4)], ['VEH-002', D(2026, 10, 13)]]),
    'Personal Policies': entry('Personal Policies', [['POL-001', D(2026, 10, 10)]]),
    'Mining Documents': entry('Mining Documents', []),
    'Renewal Log': Sheet('Renewal Log', blank(4)),
    'Engine': Sheet('Engine', [['Doc ID'], ['VEH-001', 'Vehicle Documents', 'Vehicle', 'Insurance', 'RJ1', 'Renew: Insurance - RJ1'], ['VEH-002', 'Vehicle Documents', 'Vehicle', 'Insurance', 'RJ2', 'Renew: Insurance - RJ2']]),
    'Task Feed': Sheet('Task Feed', blank(4).concat([['1', 'VEH-002'], ['2', 'VEH-001'], ['3', '']]))
  };
  ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = Sheet(n, [])), _sheets: sheets };
  return ss;
}
const ctx = vm.createContext({ console, Date, Math, JSON, String, Number, Object, Array, isNaN,
  SpreadsheetApp: { flush: () => {}, getActive: () => ss, getUi: () => ({ alert: m => { ctx.lastAlert = m; } }) },
  Session: { getScriptTimeZone: () => 'Asia/Kolkata', getActiveUser: () => ({ getEmail: () => 'it@x.com' }) },
  Utilities: { formatDate: (d, tz, f) => f === 'yyyy-MM-dd' ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') : d.toDateString() },
  Logger: { log: () => {} } });
vm.runInContext(core, ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'renewal_system', 'Code.js'), 'utf8'), ctx);
const R = c => vm.runInContext(c, ctx);
const day = d => d instanceof Date ? d.toISOString().slice(0, 10) : String(d);
const G = (tab, row) => ss._sheets[tab].getRange(row, 7).getValue();

// ---- Feed Inputs -------------------------------------------------------------------------------
book(); ctx.ss = ss;
R(`rcSetInputs_(ss, 'VEH-001', { renewedOn: new Date(2026, 9, 30), newValid: new Date(2027, 9, 3), cost: 500, status: 'Review' })`);
R(`rcSetInputs_(ss, 'VEH-001', { remark: 'paid' })`);
const inp = R(`rcReadInputs_(ss)['VEH-001']`);
t('Feed Inputs: one row per document; later fields add to it', inp.row === 2 && inp.cost === 500 && inp.remark === 'paid' && inp.status === 'Review' && inp.done === false && ss._sheets['Feed Inputs']._s.hidden);

// ---- checks before a renewal -------------------------------------------------------------------
const chk = (id, ren, nv) => R(`rcCheckRenewal_(ss, '${id}', { renewedOn: ${ren}, newValid: ${nv} })`);
t('refused: new expiry not later than the current one', /must be later/.test(chk('VEH-002', 'new Date(2026,9,9)', 'new Date(2026,9,13)')));
t('refused: renewed in the future', /in the future/.test(chk('VEH-001', 'new Date(2099,0,1)', 'new Date(2099,5,1)')));
t('refused: unknown document / missing date', /not found/.test(chk('VEH-999', 'new Date()', 'new Date(2030,0,1)')) && /NEW VALID UNTIL/.test(chk('VEH-001', 'new Date()', 'null')));
t('accepted: a real renewal', chk('VEH-001', 'new Date(2026,9,30)', 'new Date(2027,9,3)') === '');

// ---- applying ----------------------------------------------------------------------------------
const res = R(`rcApplyRenewal_(ss, 'VEH-001', { renewedOn: new Date(2026,9,30), newValid: new Date(2027,9,3), cost: 500, link: 'L' }, 'it@x.com')`);
const logRow = ss._sheets['Renewal Log'].getRange(5, 1, 1, 12).getValues()[0];
t('applied: expiry + link on the entry tab', day(G('Vehicle Documents', 5)) === day(D(2027, 10, 3)) && ss._sheets['Vehicle Documents'].getRange(5, 20).getValue() === 'L');
t('applied: one Renewal Log line (prev, new, renewed, cost, who, title)', res.logRow === 5 && logRow[2] === 'VEH-001' && day(logRow[6]) === day(D(2026, 10, 4)) && day(logRow[7]) === day(D(2027, 10, 3)) && logRow[9] === 500 && logRow[10] === 'it@x.com' && logRow[11] === 'Renew: Insurance - RJ1');
// the 31 Oct 2026 failure: the log line was written but the expiry did not stay. Now that is an error.
ss._sheets['Personal Policies']._s.revert = (r, c) => c === 7;
let err = '';
try { R(`rcApplyRenewal_(ss, 'POL-001', { renewedOn: new Date(2026,9,10), newValid: new Date(2027,9,10), cost: 0 }, 'x')`); } catch (e) { err = e.message; }
t('an expiry that does not stay saved is reported, not called done', /did not stay saved/.test(err));

// ---- Task Feed: typed cells move to Feed Inputs under the row's Doc ID ------------------------
book(); ctx.ss = ss;
const feed = ss._sheets['Task Feed'];
feed.getRange(5, 15).setValue(D(2027, 10, 12));   // row 5 = VEH-002: NEW VALID UNTIL typed
feed.getRange(5, 17).setValue(true);              // DONE ticked
feed.getRange(6, 22).setValue('call agent');      // row 6 = VEH-001: remark typed
ctx.feed = feed;
R(`captureFeedEdits_(feed, 5, 3, 14, 11)`);
const all = R(`rcReadInputs_(ss)`);
t('typed values saved under the document of that row', day(all['VEH-002'].newValid) === day(D(2027, 10, 12)) && all['VEH-002'].done === true && all['VEH-001'].remark === 'call agent');
t('ticking DONE fills RENEWED ON with today', all['VEH-002'].renewedOn instanceof Date && day(all['VEH-002'].renewedOn) === day(new Date(new Date().setHours(0, 0, 0, 0))));
t('the cells get their formulas back (they follow the document, not the row)', /Feed Inputs'!C3/.test(feed._s.f[4][14]) && /=TRUE,FALSE/.test(feed._s.f[4][16]) && /Feed Inputs'!C8/.test(feed._s.f[5][21]));
feed.getRange(7, 17).setValue(false);             // an unticked box typed over on a row with no saved inputs
ss._sheets['Task Feed']._s.cells[6][1] = 'VEH-009';
R(`captureFeedEdits_(feed, 7, 1, 17, 1)`);
t('an unticked box on a document with nothing saved creates no Feed Inputs row', !R(`rcReadInputs_(ss)['VEH-009']`));
// the feed order changes: VEH-001 is now first. The remark still belongs to VEH-001 (no row data to slide).
feed._s.cells[4][1] = 'VEH-001'; feed._s.cells[5][1] = 'VEH-002';
t('after the order changes nothing typed is left on a row', R(`captureFeedEdits_(feed, 5, 150, 14, 11)`) === 0);

// ---- the menu: ticked rows complete, bad ones block everything ---------------------------------
R(`rcSetInputs_(ss, 'VEH-002', { renewedOn: new Date(2026,9,20), newValid: new Date(2027,9,12), done: true })`);
R(`completeTickedRenewals()`);
t('menu: renewal applied, its inputs removed', day(G('Vehicle Documents', 6)) === day(D(2027, 10, 12)) && !R(`rcReadInputs_(ss)['VEH-002']`) && /1 renewal completed/.test(ctx.lastAlert));
R(`rcSetInputs_(ss, 'VEH-001', { renewedOn: new Date(2026,9,20), newValid: new Date(2026,9,1), done: true })`);
R(`completeTickedRenewals()`);
t('menu: a bad date is refused and nothing changes', /Nothing was changed/.test(ctx.lastAlert) && day(G('Vehicle Documents', 5)) === day(D(2026, 10, 4)) && R(`rcReadInputs_(ss)['VEH-001'].done`) === true);

console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
