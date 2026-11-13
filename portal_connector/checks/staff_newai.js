// Staff Dashboard: Newai people see their Newai checklist (from the Newai Master tab, matched by
// the Doer List name on the same mobile) and their Done / notes are saved there by Task ID.
// Before 4 Nov 2026 only peons saw Newai tasks, read from Monthly Master and saved only there
// (that tab is rebuilt from Master every night, so those ticks were lost).
process.env.TZ = 'Asia/Kolkata';
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'Staff_dashboard');
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };

const now = new Date(); const day = n => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
const pad = n => String(n).padStart(2, '0');
const HINDI = 'स्टोर की कम्पलीट सफाई और सामग्री की जाँच करना है, रिपोर्ट भेजें — '.repeat(3);

// ---- Newai sheet -----------------------------------------------------------------
const master = [['Name', 'Email', 'Department', 'Task ID', 'Freq', 'Task', 'Planned', 'Actual', 'Status', 'Email', 'Buddy', 'Remark']];
let id = 5000;
const add = (name, freq, task, d, status = '', actual = '') => { master.push([name, '', 'X', ++id, freq, task, d, actual, status, '', '', '']); return id; };
for (let p = 0; p < 30; p++) for (let k = 0; k < 4; k++) for (let n = -now.getDate() + 1; n < 30; n++) add('WORKER ' + p, 'D', HINDI + k, day(n));
const SUNIL_TODAY = add('SUNIL CHOUDHARY', 'D', 'Kanta reading', day(0));
const SUNIL_W_OVER = add('SUNIL CHOUDHARY', 'W', 'Weigh bridge calibration', day(-3));
const SUNIL_W_NEXT = add('SUNIL CHOUDHARY', 'W', 'Weigh bridge calibration', day(4));
const SUNIL_W_FAR = add('SUNIL CHOUDHARY', 'M', 'Monthly kanta report', day(12));
const SUNIL_OLD_OPEN_W = add('SUNIL CHOUDHARY', 'W', 'Oil the gate', day(-40));
const SUNIL_OLD_DONE = add('SUNIL CHOUDHARY', 'W', 'Old one', day(-70), 'Done', '01/01/2026 10:00:00');
const DEEPAK_TODAY = add('DEEPAK Sharma', 'D', 'Count the store stock', day(0));
const SATYA_TODAY = add('SATYANARAYAN', 'D', 'Office cleaning (Newai)', day(0));
const monthly = master.filter((r, i) => i === 0 || (r[6] instanceof Date && r[6].getMonth() === now.getMonth())).map(r => r.slice());

class Sheet {
  constructor(name, rows) { this.name = name; this.rows = rows; this.fullReads = 0; }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getMaxColumns() { return 30; }
  getRange(r, c, nr = 1, nc = 1) {
    const sh = this;
    if (typeof r === 'string') { const col = r.charCodeAt(0) - 64; r = 1; c = col; nr = sh.rows.length; nc = 1; }
    return {
      getValues() { if (c === 1 && nc === 12 && nr > 100) sh.fullReads++;
        return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const v = (sh.rows[r - 1 + i] || [])[c - 1 + j]; return v === undefined ? '' : v; })); },
      getDisplayValues() { return this.getValues().map(x => x.map(String)); },
      setValues(v) { v.forEach((row, i) => row.forEach((x, j) => { while (sh.rows.length < r + i) sh.rows.push([]); sh.rows[r - 1 + i][c - 1 + j] = x; })); return this; },
      setValue(x) { return this.setValues([[x]]); },
      getValue() { return this.getValues()[0][0]; },
      createTextFinder(q) { return { matchEntireCell() { return this; }, findNext() {
        for (let i = 0; i < nr; i++) { const v = (sh.rows[r - 1 + i] || [])[c - 1]; if (v !== undefined && v !== '' && String(v).toUpperCase() === String(q).toUpperCase()) return { getRow: () => r + i }; }
        return null; } }; }
    };
  }
}
const book = tabs => ({ getSheetByName: n => tabs[n] || null });
const newai = {
  Master: new Sheet('Master', master),
  'Monthly Master': new Sheet('Monthly Master', monthly),
  'Doer List': new Sheet('Doer List', [['Name', 'Dept', 'Email', 'Mobile', 'Pass'],
    ['SUNIL CHOUDHARY', 'Kata boy', '', '7878069717', 'x'], ['DEEPAK Sharma', 'STORE', '', '9799019943', 'x'], ['SATYANARAYAN', 'PEON', '', '9772911733', 'x']])
};
// Jaipur Monthly Master: another SUNIL and a DEEPAK, who must not show up for the Newai people
const jaipur = { 'Monthly Master': new Sheet('Monthly Master', [master[0],
  ['JPR - SUNIL KUMAR', '', '', 'J1', 'D', 'Jaipur office task', day(0), '', '', '', '', '', ''],
  ['DEEPAK KUMAR', '', '', 'J2', 'D', 'Jaipur accounts task', day(0), '', '', '', '', '', ''],
  ['SATYANARAYAN', '', '', 'J3', 'D', 'Jaipur peon task', day(0), '', '', '', '', '', '']]) };
const delegated = { Master: new Sheet('Master', [['h']]), 'Doer List': new Sheet('Doer List', [['A', 'B', 'C', 'D']]) };
const IDS = { '1s51ECvMoG-H3wgUsQhGOEmhFjlH_N4ZH4N8-iH1QoJU': newai, '15KTN4Ptp_K1iRPt3fmssGjC39ttKJx-MFMWOj-SjADg': jaipur, '1tEUckPww1GiD-PgP7yxMxt70W1Q-ueoUGXdI8_-Aq8A': delegated };

// ---- Apps Script services ----------------------------------------------------------
const store = new Map(); let biggest = 0;
const putOne = (k, v) => { const b = Buffer.byteLength(String(v)); if (b > 100 * 1024) throw new Error('Argument too large: value'); biggest = Math.max(biggest, b); store.set(k, String(v)); };
const cache = { get: k => store.has(k) ? store.get(k) : null, put: putOne, putAll: m => Object.keys(m).forEach(k => putOne(k, m[k])),
  getAll: ks => { const o = {}; ks.forEach(k => { if (store.has(k)) o[k] = store.get(k); }); return o; },
  remove: k => store.delete(k), removeAll: ks => ks.forEach(k => store.delete(k)) };
const fmt = (d, tz, f) => f.replace(/yyyy|MM|dd|HH|hh|mm|ss|a/g, x => ({ yyyy: d.getFullYear(), MM: pad(d.getMonth() + 1), dd: pad(d.getDate()), HH: pad(d.getHours()),
  hh: pad(d.getHours() % 12 || 12), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()), a: d.getHours() < 12 ? 'AM' : 'PM' })[x]);
const ctx = vm.createContext({ console: { log() {}, error() {}, warn() {} }, Date, Math, JSON, String, Number, Object, Array, Set, Map, RegExp, parseInt, isNaN,
  CacheService: { getScriptCache: () => cache },
  LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
  SpreadsheetApp: { flush() {}, openById: i => book(IDS[i] || {}) },
  Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
  Utilities: { formatDate: fmt, getUuid: () => 'u' } });
for (const f of ['Code.js', 'NewaiRoutine.js', 'PortalApp.js']) vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), ctx, { filename: f });
vm.runInContext(`portalCheck_ = function (tok) {
  if (tok === 'sunil') return { u: 'SUNIL JAT', n: 'SUNIL JAT', d: 'NEWAI - SUNIL JAT (KANTA) - 7878069717', p: '7878069717' };
  if (tok === 'deepak') return { u: 'DEEPAK', n: 'DEEPAK SHARMA', d: 'NEWAI - DEEPAK SHARMA (STORE) - 9799019943', p: '' };
  if (tok === 'satya') return { u: 'SATYANARAYAN', n: 'SATYANARAYAN', d: 'JPR - SATYANARAYAN - 9772911733', p: '9772911733' };
  if (tok === 'jpr') return { u: 'SUNILK', n: 'SUNIL KUMAR', d: 'JPR - SUNIL KUMAR - 9000000000', p: '9000000000' };
  throw new Error('bad'); }; portalAssertEditor_ = function () {};`, ctx);
const call = (fn, ...a) => { ctx.__a = a; return vm.runInContext(fn + '.apply(null, __a)', ctx); };
const row = tid => master.find(r => r[3] === tid);
const has = (res, tid) => res.routineTasks.some(x => x.taskId === 'NEWAI_' + tid);

// ---- loading ----------------------------------------------------------------------------
const before = newai.Master.fullReads;
let res = call('getAllTasksForUser', 'sunil', '', false);
t('SUNIL JAT (doer name) gets the Newai rows of SUNIL CHOUDHARY (same mobile)', has(res, SUNIL_TODAY) && has(res, SUNIL_W_OVER) && has(res, SUNIL_W_NEXT));
t('…an open weekly task from an earlier month is still listed', has(res, SUNIL_OLD_OPEN_W));
t('…but not old finished ones, nor other people\'s', !has(res, SUNIL_OLD_DONE) && !has(res, DEEPAK_TODAY));
t('…and none of the Jaipur rows that only share a first name', !res.routineTasks.some(x => x.location === 'jaipur'));
t('Newai tasks are labelled location "newai", Task ID "NEWAI_<id>"', res.routineTasks.every(x => x.location === 'newai' && /^NEWAI_\d+$/.test(x.taskId)));
t('one read of the Newai Master builds everyone\'s copy', newai.Master.fullReads === before + 1);
t('every cache value stays under 100 KB (Hindi text)', biggest > 0 && biggest <= 100 * 1024);
res = call('getAllTasksForUser', 'deepak', '', true);
t('DEEPAK (no phone in the session) is found by the mobile in his doer name', has(res, DEEPAK_TODAY) && !has(res, SUNIL_TODAY));
t('"refresh" does not read the Newai Master again', newai.Master.fullReads === before + 1);
res = call('getAllTasksForUser', 'satya', '', false);
t('the peon still gets both: Jaipur and Newai', has(res, SATYA_TODAY) && res.routineTasks.some(x => x.taskId === 'JPR_J3'));
res = call('getAllTasksForUser', 'jpr', '', false);
t('a Jaipur person gets Jaipur tasks only (Newai sheet not opened for them)', res.routineTasks.some(x => x.taskId === 'JPR_J1') && !res.routineTasks.some(x => x.location === 'newai'));

// ---- saving ----------------------------------------------------------------------------------
res = call('markRoutineTaskDoneBatch', 'sunil', ['NEWAI_' + SUNIL_TODAY]);
t('Done is saved into the Newai Master row with that Task ID', res.success === true && res.updated === 1 && row(SUNIL_TODAY)[8] === 'Done' && /^\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d$/.test(row(SUNIL_TODAY)[7]));
const mmRow = monthly.find(r => r[3] === SUNIL_TODAY);
t('…and copied to the same Task ID in Monthly Master', mmRow[8] === 'Done' && mmRow[7] === row(SUNIL_TODAY)[7]);
res = call('getAllTasksForUser', 'sunil', '', false);
t('the next load shows it done, without reading the Newai Master again', res.routineTasks.find(x => x.taskId === 'NEWAI_' + SUNIL_TODAY).status === 'completed' && newai.Master.fullReads === before + 1);

res = call('addRemarkToTask', 'sunil', 'NEWAI_' + SUNIL_W_OVER, 'waiting for the engineer', 'routine', [], true);
t('a note only goes to Remark (L), status untouched', res.success && row(SUNIL_W_OVER)[11] === 'waiting for the engineer' && row(SUNIL_W_OVER)[8] === '');

res = call('markRoutineTaskDoneBatch', 'sunil', ['NEWAI_99999999']);
t('a task that cannot be found is reported, not "marked done"', res.success === false && res.missed.length === 1 && res.missed[0].taskId === 'NEWAI_99999999' && /no longer in the sheet/.test(res.message));
res = call('markRoutineTaskDoneBatch', 'sunil', ['NEWAI_' + DEEPAK_TODAY]);
t('someone else\'s Task ID is refused', res.success === false && /someone else/.test(res.message) && row(DEEPAK_TODAY)[8] === '');
res = call('markRoutineTaskDoneBatch', 'sunil', ['NEWAI_' + SUNIL_W_FAR]);
t('a monthly task 12 days away cannot be ticked yet', res.success === false && /Too early/.test(res.message) && row(SUNIL_W_FAR)[8] === '');
res = call('markRoutineTaskDoneBatch', 'sunil', ['NEWAI_' + SUNIL_W_NEXT]);
t('next week\'s row cannot be ticked while last week\'s is open', res.success === false && /Finish the one due/.test(res.message) && row(SUNIL_W_NEXT)[8] === '');
res = call('markRoutineTaskDoneBatch', 'sunil', ['NEWAI_' + SUNIL_W_OVER, 'NEWAI_' + SUNIL_W_NEXT]);
t('overdue one first, then next week\'s, in one batch: both saved', res.success === true && res.updated === 2 && row(SUNIL_W_OVER)[8] === 'Done' && row(SUNIL_W_NEXT)[8] === 'Done');
t('the note written earlier is kept', row(SUNIL_W_OVER)[11] === 'waiting for the engineer');
res = call('markRoutineTaskDoneBatch', 'sunil', ['NEWAI_' + SUNIL_OLD_OPEN_W, 'NEWAI_99999998']);
t('a mixed batch saves the good one and names only the missing one', res.success === false && res.updated === 1 && res.missed.length === 1 && row(SUNIL_OLD_OPEN_W)[8] === 'Done');
res = call('markRoutineTaskDoneBatch', 'jpr', ['JPR_NOPE']);
t('a missing Jaipur task is reported too (it used to say "done")', res.success === false && res.missed[0].taskId === 'JPR_NOPE');
res = call('markRoutineTaskDone', 'deepak', 'NEWAI_' + DEEPAK_TODAY, []);
t('Done with a file (single save) also goes to the Newai Master', res.success === true && row(DEEPAK_TODAY)[8] === 'Done');
res = call('markRoutineTaskDone', 'nobody', 'NEWAI_' + DEEPAK_TODAY, []);
t('no sign-in: refused', res.success === false && res.expired === true);

// ---- the page ------------------------------------------------------------------------------------
const html = fs.readFileSync(path.join(APP, 'Index.html'), 'utf8');
const fnSrc = name => { const i = html.indexOf('function ' + name + '('); let d = 0, j = html.indexOf('{', i); for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && --d === 0) break; } return html.slice(i, j + 1); };
const page = vm.createContext({ Date, Math, String, parseInt, isNaN });
vm.runInContext(['midnight', 'dueDiff', 'dateSorter', 'cleanTaskName', 'routineLock'].map(fnSrc).join('\n') + '\nconst NW_EARLY_DAYS = 6; var rawRoutineTasks = [];', page);
const dmy = d => pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
const lockOf = (task, all) => { page.__all = all; page.__t = task; return vm.runInContext('rawRoutineTasks = __all; routineLock(__t)', page); };
const T = (title, n, freq = 'W', loc = 'newai') => ({ title, dueDate: dmy(day(n)), freq, status: 'pending', location: loc });
const a = T('Weigh bridge calibration', -3), b = T('Weigh bridge  calibration.', 4), c = T('Monthly report', 12, 'M'), d = T('Kanta reading', 0, 'D'), j = T('Jaipur thing', 12, 'M', 'jaipur');
t('page: a Newai task 12 days away shows "Can be marked from"', /^Can be marked from \d\d\/\d\d$/.test(lockOf(c, [c])));
t('page: next week\'s row is locked while the overdue one is open', /^Finish the one due/.test(lockOf(b, [a, b])));
t('page: the overdue one itself can be ticked; daily never locked', lockOf(a, [a, b]) === '' && lockOf(d, [d]) === '');
t('page: Jaipur tasks keep working as before (never locked)', lockOf(j, [j]) === '');
t('page: a locked card shows the lock instead of Done / Mark Done with Note', /\$\{lock \? `<span[^`]*fa-lock/.test(html) && /\$\{lock \? '' : `<button onclick="haptic\(\); submitNote\('\$\{jid\}', 'routine', false\)"/.test(html));
t('page: a refused save puts the task back (pending removed) and shows the reason', /function undoPending\(taskIds, msg\)[\s\S]*?delete pendingActions/.test(html) && /undoPending\(res && res\.missed \? res\.missed\.map\(m => m\.taskId\) : batchToProcess, res && res\.message\)/.test(html));

console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
