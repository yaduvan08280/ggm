// Fuel & Car: the Checklist calendar adds the next month by itself (it stopped at 31 Oct 2026,
// the last month built by hand, so every write from 1 Nov had no column).
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };

// the live layout: A blank, B CAR, C Task, D Freq, E next due; row 1 month names, row 2 day numbers;
// SEPTEMBER in F..AJ (1..31), spacer AK, OCTOBER in AL..BP (1..31), task rows from row 3
const grid = [[], []];
const put = (r, c, v) => { while (grid.length < r) grid.push([]); grid[r - 1][c - 1] = v; };
put(2, 2, 'CAR'); put(2, 3, 'Task'); put(2, 4, 'Freq');
put(1, 6, 'SEPTEMBER'); for (let d = 1; d <= 31; d++) put(2, 5 + d, String(d));
put(1, 38, 'OCTOBER');  for (let d = 1; d <= 31; d++) put(2, 37 + d, String(d));
put(3, 2, 'RJ45CX2223'); put(3, 3, 'INTERIOR CLEAN'); put(3, 4, 'D'); put(3, 38, '❌');
let maxCols = 68;
function chain(o) { return new Proxy(o, { get: (x, k) => k in x ? x[k] : () => chain(x) }); }
const sheet = {
  getLastColumn: () => Math.max(...grid.map(r => r.length)), getLastRow: () => grid.length,
  getMaxColumns: () => maxCols, insertColumnsAfter: (a, n) => { maxCols += n; },
  getColumnWidth: () => 30, setColumnWidths() {}, setColumnWidth() {},
  getDataRange: () => sheet.getRange(1, 1, grid.length, sheet.getLastColumn()),
  getRange: (r, c, nr = 1, nc = 1) => chain({
    getDisplayValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const v = (grid[r - 1 + i] || [])[c - 1 + j]; return v == null ? '' : String(v); })),
    setValues: v => { v.forEach((row, i) => row.forEach((x, j) => put(r + i, c + j, x))); return chain({}); },
    setValue: v => { put(r, c, v); return chain({ setHorizontalAlignment: () => chain({}) }); },
    clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (grid[r - 1 + i]) grid[r - 1 + i][c - 1 + j] = ''; },
    copyTo: () => {}, breakApart: () => {}, merge() { return this; },
    getBackground: () => '#fff', getFontColor: () => '#000', getFontWeight: () => 'bold', getFontSize: () => 10, getFontFamily: () => 'Arial'
  })
};
const ctx = vm.createContext({ console, Date, Math, JSON, String, Number, Object, Array, Logger: { log() {} },
  SpreadsheetApp: { flush() {}, CopyPasteType: { PASTE_FORMAT: 'f' } } });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'fuel_and_car_tasks', 'Config.js'), 'utf8'), ctx);
ctx.sheet = sheet;
const R = c => vm.runInContext(c, ctx);

const L0 = R(`checklistLayout_(sheet)`);
t('the live layout is read: September and October blocks, no November', L0.blocks.length === 2 && L0.blocks[1].start === 38 && L0.blocks[1].end === 68 && !R(`checklistColFor_(checklistLayout_(sheet), new Date(2026, 10, 1))`));
t('1 Nov 2026: November is added after a spacer column, days 1..30', R(`ensureChecklistMonth_(sheet, new Date(2026, 10, 1)).join()`) === 'NOVEMBER' &&
  grid[0][69] === 'NOVEMBER' && grid[1][69] === 1 && grid[1][98] === 30 && grid[1][99] === undefined);
t('…and writes for November have a column', R(`checklistColFor_(checklistLayout_(sheet), new Date(2026, 10, 1))`) === 70 && R(`checklistColFor_(checklistLayout_(sheet), new Date(2026, 10, 30))`) === 99);
t('running again adds nothing (no duplicate month)', R(`ensureChecklistMonth_(sheet, new Date(2026, 10, 15)).length`) === 0);
t('3 days before December, December is added', R(`ensureChecklistMonth_(sheet, new Date(2026, 11, 1)).join()`) === 'DECEMBER' && grid[0][100] === 'DECEMBER' && grid[1][130] === 31);
t('an old date never adds a month backwards', R(`ensureChecklistMonth_(sheet, new Date(2026, 6, 1)).length`) === 0);
// next year the same month name appears again: the newest block must win
put(1, 133, 'JANUARY'); for (let d = 1; d <= 31; d++) put(2, 132 + d, String(d));
t('when a month name repeats (next year) the newest block is used', R(`checklistColFor_(checklistLayout_(sheet), new Date(2027, 0, 5))`) === 137);
const tasks = fs.readFileSync(path.join(ROOT, 'fuel_and_car_tasks', 'Tasks.js'), 'utf8');
t('the nightly rollover and every Checklist write add a missing month first', /ensureChecklistMonth_\(cSheet, today\)/.test(tasks) && /if \(!col && ensureChecklistMonth_\(cSheet, dateObj\)/.test(tasks));

console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
