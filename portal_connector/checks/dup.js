// No duplicate people in the hub's Users tab: finder, edit guard, ambiguous sign-in refused.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ctx = vm.createContext({ console, JSON, Math, Date, String, Number, Object, Array });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'main hub app', 'Code.js'), 'utf8'), ctx);
const R = c => vm.runInContext(c, ctx);
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(String(e.message || e)); } };

// Users: A username, B name, C phone, … J email (index 9)
const row = (u, n, ph, em) => { const r = new Array(13).fill(''); r[0] = u; r[1] = n; r[2] = ph; r[9] = em; r[3] = true; return r; };
ctx.ROWS = [new Array(13).fill('h'),
  row('ramesh', 'Ramesh', '98290 12345', 'r@ggm.com'),
  row('VIPIN', 'Vipin Goyal', '9000000001', ''),
  row('vipin ', 'JPR - VIPIN', '+91 90000 00001', 'v@ggm.com'),
  row('mohan', 'Mohan', '', 'R@GGM.com')];
R(`values_ = () => ROWS; log_ = () => {};`);

const d = R(`duplicateUsers_(ROWS)`);
t('finds username twice (case and spaces ignored)', d.some(x => x.label === 'Username' && x.value === 'vipin' && x.rows.join() === '3,4'));
t('finds phone twice (formats ignored, last 10 digits)', d.some(x => x.label === 'Phone' && x.rows.join() === '3,4'));
t('finds email twice (case ignored)', d.some(x => x.label === 'Email' && x.rows.join() === '2,5'));
t('blank phone / email are not duplicates', !d.some(x => x.value === ''));

t('sign-in by a shared phone is refused', throws(() => R(`findUser_('9000000001')`), /phone number belongs to more than one person/));
t('sign-in by a shared username is refused', throws(() => R(`findUser_('Vipin')`), /username belongs to more than one person/));
t('sign-in by a shared email is refused', throws(() => R(`findUser_('r@ggm.com')`), /email belongs to more than one person/));
t('a unique username still signs in', R(`findUser_('ramesh').username`) === 'ramesh');
t('session check (username only) still finds the person', R(`findUser_('ramesh', true).username`) === 'ramesh');

// Edit guard: a fake Users sheet
function sheet(rows) {
  const s = { rows, writes: [],
    getDataRange: () => ({ getValues: () => s.rows.map(r => r.slice()) }),
    getRange: (r, c) => ({ setValue: v => { s.writes.push([r, c, v]); s.rows[r - 1][c - 1] = v; } }) };
  return s;
}
const toasts = [];
ctx.SpreadsheetApp = { getActive: () => ({ toast: m => toasts.push(m) }) };
R(`forgetTabs_ = () => {};`);
const ev = (sh, r, c, nr, nc, oldValue) => ({ oldValue, range: { getSheet: () => sh, getRow: () => r, getColumn: () => c, getNumRows: () => nr || 1, getNumColumns: () => nc || 1 } });

// typed duplicate username → goes back to the old value
const s1 = sheet([new Array(13).fill('h'), row('ramesh', 'R', '', ''), row('Ramesh', 'New', '', '')]);
ctx.S = s1; ctx.E = ev(s1, 3, 1, 1, 1, 'newguy');
t('typed duplicate username is put back to its old value', R(`guardUniqueUsers_(E)`) === true && s1.rows[2][0] === 'newguy' && toasts.length === 1);
// pasted block with a duplicate phone → cleared, the other row kept
const s2 = sheet([new Array(13).fill('h'), row('a', 'A', '9829012345', ''), row('b', 'B', '98290-12345', ''), row('c', 'C', '9000000002', '')]);
ctx.E = ev(s2, 3, 1, 2, 13);
t('pasted duplicate phone is cleared, other pasted rows kept', R(`guardUniqueUsers_(E)`) === true && s2.rows[2][2] === '' && s2.rows[3][2] === '9000000002');
// two equal new values in one paste: the first is cleared, the second stays
const s3 = sheet([new Array(13).fill('h'), row('x1', 'X', '', 'same@ggm.com'), row('x2', 'Y', '', 'same@ggm.com')]);
ctx.E = ev(s3, 2, 1, 2, 13);
R(`guardUniqueUsers_(E)`);
t('same email twice in one paste: only one is kept', [s3.rows[1][9], s3.rows[2][9]].filter(Boolean).length === 1);
// an edit that is not a duplicate does nothing
const s4 = sheet([new Array(13).fill('h'), row('a', 'A', '9829012345', ''), row('b', 'B', '9000000003', '')]);
ctx.E = ev(s4, 3, 3, 1, 1, '');
t('unique phone is left alone', R(`guardUniqueUsers_(E)`) === false && s4.writes.length === 0);
// editing other columns (e.g. Name) is not checked
ctx.E = ev(s4, 3, 2, 1, 1, '');
t('editing the Name column is not checked', R(`guardUniqueUsers_(E)`) === false);

console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
