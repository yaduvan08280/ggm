// Main Admin "Transfer task": an open task moves to someone else (doer on leave);
// finished / in-review tasks do not move; the staff-side transfer request is cleared.
const vm = require('vm'), fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', '..', 'main_admin_dashboard');
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };

// Master: A Created · B ID · C Doer · D Task · E Due · … J Status · … Q History · R transfer request / review date
const row = (id, doer, status, extra) => { const r = Array(24).fill(''); r[1] = id; r[2] = doer; r[3] = 'task ' + id; r[4] = '20/10/2026'; r[9] = status; r[16] = extra || ''; return r; };
const grid = [Array(24).fill('h'),
  row('TK-1', 'JPR - RAJPAL SINGH (DRIVER)', 'Pending'),
  row('TK-2', 'JPR - RAJPAL SINGH (DRIVER)', 'Done'),
  row('TK-3', 'JPR - RAJPAL SINGH (DRIVER)', 'Review'),
  row('TK-4', 'JPR - HARSHIT JAIN', 'Rejected', 'old note')];
grid[1][17] = 'JPR - GOURAV';          // Rajpal had asked (Staff Dashboard) to pass TK-1 to Gourav
const stamps = [];
const sheet = {
  getRange: (a, c) => {
    if (typeof a === 'string') return { createTextFinder: id => ({ matchEntireCell: () => ({ findNext: () => { const i = grid.findIndex(r => r[1] === id); return i < 0 ? null : { getRow: () => i + 1 }; } }) }) };
    return { getDisplayValue: () => String(grid[a - 1][c - 1]), setValue(v) { grid[a - 1][c - 1] = v; return this; }, setNumberFormat() { return this; } };
  }
};
const ctx = vm.createContext({ console, JSON, String, Number, Math, Object, Array, Date, Error, RegExp,
  SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  Utilities: { formatDate: () => '28/10/2026 11:00' },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) } });
const src = fs.readFileSync(path.join(DIR, 'Code.js'), 'utf8');
vm.runInContext(src, ctx);
vm.runInContext(`maSessionOrNull_ = function (t) { return t === 'tok' ? { legacy: false, u: 'nakul', n: 'NAKUL GOYAL' } : null; };
  maDoerAllowed_ = function () { return true; }; maStampAction_ = function (sh, r, a) { STAMPS.push([r, a]); }; _clearCached = function () {};`, Object.assign(ctx, { STAMPS: stamps }));
const T = (...a) => vm.runInContext(`transferTask(${a.map(x => JSON.stringify(x)).join(',')})`, ctx);

t('needs a sign-in', T('bad', 'TK-1', 'JPR - GOURAV', '', 'leave').error === 'SESSION_EXPIRED');
t('reason is required', /Write why/.test(T('tok', 'TK-1', 'JPR - GOURAV', '', '  ').error));
t('a finished task is not moved', /already finished/.test(T('tok', 'TK-2', 'JPR - GOURAV', '', 'leave').error) && grid[2][2].includes('RAJPAL'));
t('a task waiting for review is decided first', /waiting for your review/.test(T('tok', 'TK-3', 'JPR - GOURAV', '', 'leave').error) && grid[3][9] === 'Review');
t('not to the same person', /already with/.test(T('tok', 'TK-1', 'JPR - RAJPAL SINGH (DRIVER)', '', 'leave').error));
const r1 = T('tok', 'TK-1', 'JPR - GOURAV', '', 'on leave till 5 Nov');
t('open task transferred', r1.success && grid[1][2] === 'JPR - GOURAV' && grid[1][9] === 'Pending');
t('due date kept when no new date is given', grid[1][4] === '20/10/2026');
t('history line with names and reason', /Transferred from RAJPAL SINGH to GOURAV on 28\/10\/2026 11:00 \| Reason: on leave till 5 Nov/.test(grid[1][16]));
t('staff-side transfer request cleared', grid[1][17] === '');
t('who did it is stamped', stamps.some(s => s[0] === 2 && /Transferred to GOURAV/.test(s[1])));
const r4 = T('tok', 'TK-4', 'JPR - GOURAV', '02/11/2026', 'Harshit on leave');
t('rejected task can move, new due date set, back to Pending, old notes kept', r4.success && grid[4][4] === '02/11/2026' && grid[4][9] === 'Pending' && /^old note\nTransferred from HARSHIT JAIN to GOURAV/.test(grid[4][16]));
t('unknown task id', /not found/.test(T('tok', 'TK-99', 'JPR - GOURAV', '', 'x').error));

const page = fs.readFileSync(path.join(DIR, 'Index.html'), 'utf8');
t('page: Transfer button on open tasks + form + call', /openTransferModal\('\$\{t\.id\}'\)/.test(page) && /id="transferTaskModal"/.test(page) && /\.transferTask\(adminToken\(\), taskId, doer, dueFmt, reason\)/.test(page));
t('page: review cards show task files and done files', /'Task File ' \+ \(i \+ 1\)/.test(page) && /'Done File ' \+ \(i \+ 1\)/.test(page));
t('page: history shown in task detail', /History \/ Notes/.test(page));

console.log(ok + ' passed, ' + bad + ' failed');
process.exit(bad ? 1 : 0);
