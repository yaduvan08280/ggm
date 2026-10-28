// Fuel & Car: the driver log book is read back from the Checklist calendar
// (who marked which task done, for which car, on which date), and the dashboard
// data carries it plus the sign-in names. Completions drop the cached copy.
const vm = require('vm'), fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', '..', 'fuel_and_car_tasks');
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };

/* ---------- a Checklist calendar: SEPTEMBER 1..30, OCTOBER 1..31 ---------- */
const head1 = ['', '', ''], head2 = ['S.NO', 'CAR', 'TASK'];
for (let d = 1; d <= 30; d++) { head1.push(d === 1 ? 'SEPTEMBER' : ''); head2.push(String(d)); }
for (let d = 1; d <= 31; d++) { head1.push(d === 1 ? 'OCTOBER' : ''); head2.push(String(d)); }
const W = head1.length;
const row = (n, car, task) => { const r = Array(W).fill(''); r[0] = n; r[1] = car; r[2] = task; return r; };
const col = (month, day) => 3 + (month === 9 ? day : 30 + day) - 1;   // 0-based
const chk = [head1, head2, row(1, 'KIA', 'INTERIOR CLEANING'), row(2, 'CRETA', 'FUEL CHECKING'), row(3, 'FORTUNER', 'BATTERY HEALTH')];
chk[2][col(10, 20)] = 'Gajendra Meena\n(09:12 AM)';
chk[2][col(10, 21)] = '⚠ Gajendra Meena\n(06:40 PM)\nwas raining';
chk[2][col(10, 19)] = '❌';
chk[2][col(10, 18)] = '⏭ +2d (Harshit Jain)';
chk[3][col(10, 21)] = 'Harshit Jain\n(10:05 AM)';
chk[3][col(9, 30)] = 'Harshit Jain (08:00 AM)';           // one-line style
chk[4][col(10, 25)] = 'Gajendra Meena\n(10:00 AM)';         // after "today" -> last year's 25 Oct
const users = [['DRIVER', 'VEHICLE', 'EMAIL', 'NAME', 'PASSWORD', 'ROLE', 'STATUS', 'OTP', 'OTP_EXPIRY', 'LAST_LOGIN', 'USERNAME'],
  ['GAJENDRA', 'RJ45CN9562 KIA', 'g@x.com', 'Gajendra Meena', 'h', 'USER', 'ACTIVE', '', '', '', 'gajendra'],
  ['HARSHIT', 'RJ14 CRETA', 'h@x.com', 'Harshit Jain', 'h', 'USER', 'ACTIVE', '', '', '', 'harshit'],
  ['', '', 'old@x.com', 'Old Driver', 'h', 'USER', 'DISABLED', '', '', '', 'old']];
const book = { Checklist: chk, Users: users };

function sheet(name) {
  const g = () => book[name];
  const range = (r, c, nr, nc) => ({
    getValues: () => g().slice(r - 1, r - 1 + nr).map(x => { const y = x.slice(c - 1, c - 1 + nc); while (y.length < nc) y.push(''); return y; }),
    getDisplayValues() { return this.getValues().map(x => x.map(v => String(v))); },
    getFormulas() { return this.getValues().map(x => x.map(() => '')); },
    getFontColors() { return this.getValues().map(x => x.map(() => '#000')); },
    getHorizontalAlignments() { return this.getValues().map(x => x.map(() => 'left')); },
    setValues: v => v.forEach((x, i) => x.forEach((y, j) => { g()[r - 1 + i][c - 1 + j] = y; })),
    setFontColors: () => {}, setHorizontalAlignments: () => {},
    setValue: v => { g()[r - 1][c - 1] = v; return { setFontWeight: () => {} }; }, setFontWeight: () => {}
  });
  return {
    getRange: (r, c, nr, nc) => {
      if (typeof r === 'string') { const m = r.match(/^([A-Z])2:/); const cc = m[1].charCodeAt(0) - 64; return range(2, cc, g().length - 1, 1); }
      return range(r, c, nr || 1, nc || 1);
    },
    getDataRange: () => range(1, 1, g().length, Math.max(...g().map(x => x.length))),
    getLastRow: () => g().length, getLastColumn: () => Math.max(...g().map(x => x.length))
  };
}
const cacheBox = {}; let checklistReads = 0;
const ss = { getSheetByName: n => { if (n === 'Checklist') checklistReads++; return book[n] ? sheet(n) : null; } };
const pad = n => String(n).padStart(2, '0');
const ctx = vm.createContext({ console, JSON, Math, Date, String, Number, Object, Array, isNaN, parseInt, parseFloat, Set,
  Logger: { log: () => {} },
  SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush: () => {} },
  Utilities: { formatDate: (d, tz, f) => f === 'yyyy-MM-dd' ? '2026-10-21' : f === 'dd/MM/yyyy' ? pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() : String(d) },
  CacheService: { getScriptCache: () => ({
    get: k => (k in cacheBox ? cacheBox[k] : null),
    getAll: ks => { const o = {}; ks.forEach(k => { if (k in cacheBox) o[k] = cacheBox[k]; }); return o; },
    putAll: o => Object.assign(cacheBox, o), remove: k => { delete cacheBox[k]; } }) } });
for (const f of ['Config.js', 'History.js']) vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx);
const R = c => vm.runInContext(c, ctx);

/* 1. reading the calendar */
const log = R('taskHistory_()');
const str = JSON.stringify(log);
t('5 completions found (missed and postponed cells are not completions)', log.length === 5);
t('newest first: 21 Oct entries lead', log[0][0] === '21/10/2026' && log[1][0] === '21/10/2026');
t('on-time entry: date, time, car, task, doer', str.includes('["20/10/2026","09:12 AM","KIA","INTERIOR CLEANING","Gajendra Meena",0]'));
t('late entry flagged, remark line dropped from the name', str.includes('["21/10/2026","06:40 PM","KIA","INTERIOR CLEANING","Gajendra Meena",1]'));
t('one-line "NAME (time)" style understood', str.includes('["30/09/2026","08:00 AM","CRETA","FUEL CHECKING","Harshit Jain",0]'));
t('a column later than today belongs to last year', str.includes('"25/10/2025"'));
t('no entry from the missed / postponed cells', !str.includes('19/10/2026') && !str.includes('18/10/2026'));

/* 2. cache: second read does not touch the sheet; a Checklist write drops it */
const before = checklistReads;
R('taskHistory_()');
t('second read comes from the cache', checklistReads === before);
R(`flushChecklistWrites_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Checklist'), [{ row: 4, col: ${col(10, 21) + 1}, text: 'Harshit Jain\\n(11:00 AM)' }])`);
const log2 = R('taskHistory_()');
t('after a completion the history is read again and shows it', checklistReads > before && JSON.stringify(log2).includes('["21/10/2026","11:00 AM","CRETA","FUEL CHECKING","Harshit Jain",0]'));

/* 3. a big history still caches (split over several keys) */
for (let r = 0; r < 120; r++) { const x = row(10 + r, 'CAR' + r, 'TASK NUMBER ' + r); for (let d = 1; d <= 30; d++) x[col(9, d)] = 'Driver Name ' + (r % 7) + '\n(09:00 AM)'; chk.push(x); }
R('forgetTaskHistory_()');
const big = R('taskHistory_()');
const n = +cacheBox['task_hist_v1_n'];
const b2 = checklistReads; const again = R('taskHistory_()');
t('3,600+ completions cached in ' + n + ' parts and read back whole', n > 1 && checklistReads === b2 && again.length === big.length && big.length > 3600);

/* 4. people for name matching */
const people = R(`fleetPeople_(SpreadsheetApp.getActiveSpreadsheet())`);
t('sign-in people listed with name + username', people.length === 3 && people[0].name === 'Gajendra Meena' && people[0].username === 'gajendra');
t('disabled account marked inactive', people[2].active === false && people[0].active === true);
t('no emails or passwords sent to the page', !JSON.stringify(people).includes('@') && !JSON.stringify(people).includes('"h"'));

/* 5. what the page receives */
R(`requireSession_ = function (tok) { if (tok !== 'good') throw new Error('SESSION_EXPIRED'); return { name: 'x' }; }`);
const month = R('monthHistory_()');
t('refresh payload: this month only', month.length > 0 && month.every(r => r[0].slice(3) === '10/2026'));
const full = JSON.parse(R(`apiTaskHistory('good')`));
t('full history on request, all months', full.success && full.log.length === big.length && full.log.some(r => r[0].slice(3) === '09/2026'));
t('full history refused without a sign-in', JSON.parse(R(`apiTaskHistory('bad')`)).expired === true);

console.log(ok + ' passed, ' + bad + ' failed');
process.exit(bad ? 1 : 0);
