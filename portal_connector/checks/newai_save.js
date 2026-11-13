// Newai Checklist: checklist Done / notes are saved into Master (the "MM" tab they used to go to
// was removed on 31 Oct 2026 and every save since was silently lost), loads come from a per-person
// cache copy, and W/M/Q/Y tasks cannot be ticked too early or out of order.
process.env.TZ = 'Asia/Kolkata';
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'newai_checklist');
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };

// ---- a sheet with no MM tab ------------------------------------------------
const now = new Date(); const day = n => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
const pad = n => String(n).padStart(2, '0');
const dmy = d => pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
const HINDI = 'स्टोर की कम्पलीट सफाई और सामग्री की जाँच करना है, रिपोर्ट भेजें — '.repeat(3);
const master = [['Name', 'Email', 'Department', 'Task ID', 'Freq', 'Task', 'Planned', 'Actual', 'Status', 'Email', 'Buddy', 'Remark']];
let id = 1000;
const add = (name, freq, task, d, status = '', actual = '') => { master.push([name, '', 'STORE', ++id, freq, task, d, actual, status, '', '', '']); return id; };
// 40 people × daily tasks over the month: enough rows (and Hindi text) to need several cache parts
for (let p = 0; p < 40; p++) for (let k = 0; k < 4; k++) for (let n = -now.getDate() + 1; n < 30; n++) add('WORKER ' + p, 'D', HINDI + k, day(n));
const DAILY_TODAY = add('DEEPAK Sharma', 'D', 'Count the store stock', day(0));
for (let n = -now.getDate() + 1; n < 30; n++) if (n) add('DEEPAK Sharma', 'D', 'Count the store stock', day(n));
const W_OVERDUE = add('DEEPAK Sharma', 'W', 'Send repair status to Jaipur', day(-4));
const W_NEXT = add('DEEPAK Sharma', 'W', 'Send repair status to Jaipur', day(3));
const W_FAR = add('DEEPAK Sharma', 'W', 'Clean the godown', day(10));
const W_SOON = add('DEEPAK Sharma', 'W', 'Check fire extinguishers', day(2));
const OLD_DONE = add('DEEPAK Sharma', 'W', 'Old done task', day(-70), 'Done', '01/01/2026 10:00:00');
const SONU_TASK = add('SONU', 'D', 'CDE plant reading', day(0));
const monthly = master.filter((r, i) => i === 0 || (r[6] instanceof Date && r[6].getMonth() === now.getMonth())).map(r => r.slice());

class Sheet {
  constructor(name, rows) { this.name = name; this.rows = rows; this.fullReads = 0; }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getMaxColumns() { return 30; }
  getRange(r, c, nr = 1, nc = 1) {
    if (typeof r === 'string') { r = 1; c = 1; }
    const sh = this;
    return {
      getValues() { if (c === 1 && nc === 12 && nr > 100) sh.fullReads++;
        return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const v = (sh.rows[r - 1 + i] || [])[c - 1 + j]; return v === undefined ? '' : v; })); },
      setValues(v) { v.forEach((row, i) => row.forEach((x, j) => { while (sh.rows.length < r + i) sh.rows.push([]); sh.rows[r - 1 + i][c - 1 + j] = x; })); return this; },
      setValue(x) { return this.setValues([[x]]); },
      getValue() { return this.getValues()[0][0]; },
      clearDataValidations() { return this; }, clearContent() { return this; },
      getRow: () => r, getColumn: () => c,
      createTextFinder(q) { return { matchEntireCell() { return this; }, findNext() {
        for (let i = 0; i < nr; i++) { const v = (sh.rows[r - 1 + i] || [])[c - 1]; if (v !== undefined && v !== '' && String(v) === String(q)) return { getRow: () => r + i }; }
        return null; } }; }
    };
  }
}
const sheets = {
  Master: new Sheet('Master', master),
  'Monthly Master': new Sheet('Monthly Master', monthly),
  'Doer List': new Sheet('Doer List', [['Name', 'Dept', 'Email', 'Mobile', 'Pass'], ['DEEPAK Sharma', 'STORE', 'd@x', '9799019943', 'x'], ['SONU', 'CDE', 's@x', '7976784788', 'x']]),
  SUMMARY: new Sheet('SUMMARY', [['', '', '', 'Daily', 'Nov'], ['', '', '', '', ''], ['', '', 'DEEPAK Sharma', 0.5, 12]])
};

// ---- Apps Script services ----------------------------------------------------
const store = new Map(); let biggest = 0;
const putOne = (k, v) => { const b = Buffer.byteLength(String(v)); if (b > 100 * 1024) throw new Error('Argument too large: value'); biggest = Math.max(biggest, b); store.set(k, String(v)); };
const cache = { get: k => store.has(k) ? store.get(k) : null, put: putOne, putAll: m => Object.keys(m).forEach(k => putOne(k, m[k])),
  getAll: ks => { const o = {}; ks.forEach(k => { if (store.has(k)) o[k] = store.get(k); }); return o; },
  remove: k => store.delete(k), removeAll: ks => ks.forEach(k => store.delete(k)) };
const fmt = (d, tz, f) => f.replace(/yyyy|MM|dd|HH|hh|mm|ss|a/g, x => ({ yyyy: d.getFullYear(), MM: pad(d.getMonth() + 1), dd: pad(d.getDate()), HH: pad(d.getHours()),
  hh: pad(d.getHours() % 12 || 12), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()), a: d.getHours() < 12 ? 'AM' : 'PM' })[x]);
const ss = { getSheetByName: n => sheets[n] || null, toast() {} };
const ctx = vm.createContext({ console: { log() {}, error() {}, warn() {} }, Date, Math, JSON, String, Number, Object, Array, Set, RegExp, parseInt, isNaN,
  CacheService: { getScriptCache: () => cache },
  LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => ss, getActive: () => ss, flush() {}, openById: () => ({ getSheetByName: () => null }) },
  Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
  Utilities: { formatDate: fmt } });
for (const f of ['Code.js', 'Routine.js', 'PortalApp.js']) vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), ctx, { filename: f });
vm.runInContext(`portalCheck_ = function (tok) { if (tok === 'deepak') return { u: 'DEEPAK', d: 'DEEPAK Sharma', p: '9799019943' };
  if (tok === 'sonu') return { u: 'SONU', d: 'SONU', p: '7976784788' }; throw new Error('bad'); };`, ctx);
const R = c => vm.runInContext(c, ctx);
const call = (fn, ...a) => { ctx.__a = a; return R(fn + '.apply(null, __a)'); };
const row = tid => master.find(r => r[3] === tid);

// ---- loading -------------------------------------------------------------------
t('the sheet has no MM tab (as live)', !sheets.MM);
const before = sheets.Master.fullReads;
let res = call('getAllTasksForUser', 'deepak', '', '', false);
const ids = res.routineTasks.map(x => x.taskId);
t('Deepak gets his tasks from Master', ids.includes(String(DAILY_TODAY)) && ids.includes(String(W_OVERDUE)) && !ids.includes(String(SONU_TASK)));
t('…not old finished ones from earlier months', !ids.includes(String(OLD_DONE)));
t('one read of Master builds everyone\'s copy', sheets.Master.fullReads === before + 1);
t('every cache value stays under 100 KB (Hindi text is 3 bytes a character)', biggest > 0 && biggest <= 100 * 1024);
call('getAllTasksForUser', 'sonu', '', '', true);
call('getAllTasksForUser', 'deepak', '', '', true);
t('later loads (even "refresh") read no Master rows', sheets.Master.fullReads === before + 1);
t('stats still come through (SUMMARY)', res.stats.dailyScore === '50%' && res.stats.routineMonthlyTotal > 20);

// ---- saving ---------------------------------------------------------------------
res = call('batchUpdateTasks', 'deepak', [{ taskId: String(DAILY_TODAY), type: 'routine', taskTitle: 'Count the store stock', taskDueDate: dmy(day(0)) }]);
t('Done is saved into Master (no MM tab needed)', res.success === true && res.count === 1 && row(DAILY_TODAY)[8] === 'Done' && /^\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d$/.test(row(DAILY_TODAY)[7]));
const mmRow = monthly.find(r => r[3] === DAILY_TODAY);
t('…and copied to the same Task ID in Monthly Master', mmRow[8] === 'Done' && mmRow[7] === row(DAILY_TODAY)[7]);
res = call('getAllTasksForUser', 'deepak', '', '', true);
t('the next load shows it done, without reading Master again', res.routineTasks.find(x => x.taskId === String(DAILY_TODAY)).status === 'completed' && sheets.Master.fullReads === before + 1);

res = call('batchUpdateTasks', 'deepak', [{ taskId: String(W_OVERDUE), type: 'routine', isJustNote: true, remarkText: 'waiting for the mechanic' }]);
t('a note only goes to Remark (L), status untouched', res.success && row(W_OVERDUE)[11] === 'waiting for the mechanic' && row(W_OVERDUE)[8] === '');

res = call('batchUpdateTasks', 'deepak', [{ taskId: '99999999', type: 'routine', taskTitle: 'nothing', taskDueDate: dmy(day(0)) }]);
t('a task that cannot be found is reported, not "updated"', res.success === false && res.count === 0 && res.missed.length === 1 && /no longer in the sheet/.test(res.message));
res = call('batchUpdateTasks', 'deepak', [{ taskId: String(SONU_TASK), type: 'routine' }]);
t('someone else\'s Task ID is refused', res.success === false && /someone else/.test(res.message) && row(SONU_TASK)[8] === '');

// ---- W/M/Q/Y: not too early, not out of order --------------------------------------
res = call('batchUpdateTasks', 'deepak', [{ taskId: String(W_FAR), type: 'routine' }]);
t('a weekly task 10 days away cannot be ticked yet', res.success === false && /Too early/.test(res.message) && row(W_FAR)[8] === '');
res = call('batchUpdateTasks', 'deepak', [{ taskId: String(W_NEXT), type: 'routine' }]);
t('next week\'s row cannot be ticked while last week\'s is open', res.success === false && /Finish the one due/.test(res.message) && row(W_NEXT)[8] === '');
res = call('batchUpdateTasks', 'deepak', [{ taskId: String(W_SOON), type: 'routine' }]);
t('a weekly task due in 2 days can be ticked early', res.success === true && row(W_SOON)[8] === 'Done');
res = call('batchUpdateTasks', 'deepak', [{ taskId: String(W_OVERDUE), type: 'routine' }, { taskId: String(W_NEXT), type: 'routine' }]);
t('overdue one first, then next week\'s, in one batch: both saved', res.success === true && res.count === 2 && row(W_OVERDUE)[8] === 'Done' && row(W_NEXT)[8] === 'Done');
t('the note written earlier is kept', row(W_OVERDUE)[11] === 'waiting for the mechanic');

// ---- hand edits in the sheet drop the copy ------------------------------------------
row(SONU_TASK)[8] = 'Done';
call('onEdit', { range: { getSheet: () => sheets.Master, getRow: () => 5, getColumn: () => 9, getValue: () => 'Done' } });
res = call('getAllTasksForUser', 'sonu', '', '', false);
t('an edit in Master is picked up on the next load', res.routineTasks.find(x => x.taskId === String(SONU_TASK)).status === 'completed' && sheets.Master.fullReads === before + 2);

// ---- the page --------------------------------------------------------------------
const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const fnSrc = name => { const i = html.indexOf('function ' + name + '('); let d = 0, j = html.indexOf('{', i); for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && --d === 0) break; } return html.slice(i, j + 1); };
const page = vm.createContext({ Date, Math, String, parseInt, isNaN, localStorage: { getItem: () => 'en' } });
vm.runInContext(['dueDiff', 'dateSorter', 'cleanTaskName', 'routineLock'].map(fnSrc).join('\n') + '\nconst RT_EARLY_DAYS = 6; var rawRoutineTasks = [];', page);
const lockOf = (task, all) => { page.rawRoutineTasks = all; page.__t = task; return vm.runInContext('rawRoutineTasks = this.rawRoutineTasks; routineLock(__t)', page); };
const T = (title, n, freq = 'W', status = 'pending') => ({ title, dueDate: dmy(day(n)), freq, status });
const a = T('Send repair status', -4), b = T('Send repair  status.', 3), c = T('Clean godown', 10), d = T('Count stock', 0, 'D');
t('page: a task 10 days away shows "Can be marked from"', /^Can be marked from \d\d\/\d\d$/.test(lockOf(c, [c])));
t('page: next week\'s row is locked while the overdue one is open', /^Finish the one due/.test(lockOf(b, [a, b])));
t('page: the overdue one itself can be ticked', lockOf(a, [a, b]) === '');
t('page: daily tasks are never locked', lockOf(d, [d]) === '');
t('page: the Done buttons are hidden on a locked card', /\$\{lock \? `<span[^`]*fa-lock/.test(html) && /\$\{lock \? '' : `<button onclick="submitTask\('\$\{jid\}', 'routine', false\)"/.test(html));
t('page: only the tasks that were not saved go back to pending', /res\.missed\.map/.test(html));

const code = fs.readFileSync(path.join(APP, 'Code.js'), 'utf8');
t('nothing reads or writes the MM tab any more', !/getSheetByName\('MM'\)/.test(code.replace(/function syncMMtoMaster[\s\S]*$/, '')));

console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
