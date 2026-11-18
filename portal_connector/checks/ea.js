// Main Admin "EA" role: sees Delegated Tasks only, adds tasks for an admin (picks Given By,
// never herself), cannot approve / edit / transfer / decide leave, renewals or routine.
const vm = require('vm'), fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', '..', 'main_admin_dashboard');
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };

const rows = [Array(24).fill('h'), ['', 'TK-1', 'JPR - GOURAV', 'x', '', '', '', '', '', 'Review']];
const sheet = {
  appendRow: r => rows.push(r.slice()),
  getLastRow: () => rows.length,
  getRange: (a, c) => ({ setNumberFormat() { return this; }, setValue(v) { rows[a - 1][c - 1] = v; return this; }, getValues: () => rows.slice(1).map(r => [r[1]]) })
};
const props = {}, cache = {};
const sessions = {
  ea: { u: 'PRIYA', n: 'Priya', r: 'EA' },
  boss: { u: 'NAKUL', n: 'Nakul Goyal', r: 'ADMIN' },
  old: { u: 'VIPIN', n: 'Vipin Goyal', r: '' }          // admins with no role yet stay full admins
};
const hubCalls = [];
const ctx = vm.createContext({ console, JSON, String, Number, Math, Object, Array, Date, Error, RegExp,
  SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  Utilities: { formatDate: () => '18/11/2026 11:00:00' },
  PropertiesService: { getScriptProperties: () => ({ getProperties: () => Object.assign({}, props), setProperty: (k, v) => { props[k] = v; } }) },
  CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) } });
['Code.js', 'PortalApp.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx));
vm.runInContext(`
  portalEnabled_ = function () { return true; };
  portalP_ = function (k) { return PropertiesService.getScriptProperties().getProperties()[k] || ''; };
  portalSetP_ = function (k, v) { PropertiesService.getScriptProperties().setProperty(k, v); };
  portalAppId_ = function () { return 'MAIN ADMIN'; };
  portalCheck_ = function (tok) { var s = SESS[tok]; if (!s) throw new Error('SESSION_EXPIRED'); return s; };
  portalCallHub_ = function (op, d) { HUB.push(op + ':' + d.app); return op === 'directory' && d.app === 'MAIN ADMIN'
    ? [{ u: 'NAKUL', n: 'Nakul Goyal' }, { u: 'VIPIN', n: 'Vipin Goyal' }, { u: 'PRIYA', n: 'Priya' }, { u: 'NEHA', n: 'Neha' }]
    : [{ u: 'GOURAV', d: 'JPR - GOURAV' }]; };
  maDoerAllowed_ = function () { return true; };
  maStamp_ = function () {}; _clearCached = function () {};
  getSheetData_ = function () { return { rows: [] }; };
  getLeaveData_ = function () { return { rows: [{ status: 'Pending' }] }; };
  getRenewalData_ = function () { return { rows: [] }; };
  getRoutineJPRData_ = getRoutineNewaiData_ = getRoutineTonkData_ = function () { return { rows: [] }; };
  getScoresData_ = function () { return {}; };`, Object.assign(ctx, { SESS: sessions, HUB: hubCalls }));
const R = s => vm.runInContext(s, ctx);
const J = (fn, ...a) => R(`${fn}(${a.map(x => JSON.stringify(x)).join(',')})`);

t('roles offered to the hub: ADMIN, EA', JSON.stringify(R('portalAdapter_().meta()').roles) === '["ADMIN","EA"]');
t('blank role = ADMIN', R("maRole_('')") === 'ADMIN' && R("maRole_(' ea ')") === 'EA');

const dEA = J('getDashboardData', 'ea'), dBoss = J('getDashboardData', 'boss'), dOld = J('getDashboardData', 'old');
t('EA gets Delegated Tasks only', dEA.me.ea === true && dEA.master && !dEA.leaves && !dEA.renewals && !dEA.routineJPR && !dEA.scores);
t('admin (and blank role) get everything', !dBoss.me.ea && dBoss.leaves && dBoss.scores && !dOld.me.ea && dOld.renewals);

['actionRenewalTask', 'updateLeaveStatus', 'markRoutineDone', 'transferTask', 'editTask', 'updateTaskStatusById', 'rejectTaskByBoss']
  .forEach(fn => t('EA blocked: ' + fn, /EA\) can only add/.test(J(fn, 'ea', 'TK-1', 'x', 'y', 'z').error || '')));

// the EA has been seen → she never shows up as a "Given By" choice
const g = J('getDoerList', 'ea');
t('EA gets doers + Given By choices', g.doers.length === 1 && Array.isArray(g.givers));
t('Given By: other admins, not herself', g.givers.map(x => x.u).join() === 'NAKUL,NEHA,VIPIN');
sessions.neha = { u: 'NEHA', n: 'Neha', r: 'EA' }; J('getDashboardData', 'neha');   // a second EA opens the app
t('another EA is dropped from the choices once seen', J('getDoerList', 'ea').givers.map(x => x.u).indexOf('NEHA') < 0);
t('admins get no Given By list', J('getDoerList', 'boss').givers === undefined);

const n0 = rows.length;
t('EA must pick Given By', /Pick who/.test(J('addNewTask', 'ea', 'JPR - GOURAV', 'do it', '20/11/2026', '', []).error));
t('EA cannot give it as herself', /Pick who/.test(J('addNewTask', 'ea', 'JPR - GOURAV', 'do it', '20/11/2026', 'PRIYA', []).error));
t('EA cannot invent a giver', /cannot give/.test(J('addNewTask', 'ea', 'JPR - GOURAV', 'do it', '20/11/2026', 'RANDOM', []).error) && rows.length === n0);
const ok1 = J('addNewTask', 'ea', 'JPR - GOURAV', 'do it', '20/11/2026', 'NAKUL', []);
t('EA adds a task for Nakul: Given By = NAKUL', ok1.success && rows[rows.length - 1][10] === 'NAKUL' && rows[rows.length - 1][2] === 'JPR - GOURAV');
const ok2 = J('addNewTask', 'boss', 'JPR - GOURAV', 'do it', '20/11/2026', 'SOMEONE', []);
t('admin: Given By is still the signed-in admin', ok2.success && rows[rows.length - 1][10] === 'NAKUL');

const counts = R(`maCounts_([{ u: 'PRIYA', r: 'EA' }, { u: 'NAKUL', r: 'ADMIN' }, { u: 'VIPIN', r: '' }])`);
t('portal badge: 0 for EA, waiting count for admins', counts.PRIYA === 0 && counts.NAKUL === 1 && counts.VIPIN === 1);

const page = fs.readFileSync(path.join(DIR, 'Index.html'), 'utf8');
t('page: EA hides every menu item except Delegated Tasks', /body\.ea-mode \.nav-item-btn:not\(\[data-tab="delegated"\]\)/.test(page) && /body\.ea-mode \.mobile-nav-btn:not\(\[data-tab="delegated"\]\)/.test(page));
t('page: EA cannot switch to another tab', /if \(IS_EA && tabId !== 'delegated'\) tabId = 'delegated';/.test(page));
t('page: EA opens on Delegated Tasks', /if \(IS_EA\) switchTabDelegated\('all'\); else switchTab\('overview'\);/.test(page));
t('page: no action buttons in task detail for EA', /if \(IS_EA\) \{\s*\/\/ EA only views/.test(page));
t('page: Given By picker filled from the server list', /GIVERS = response\.givers; fillGivers\(\);/.test(page));

console.log(ok + ' passed, ' + bad + ' failed');
process.exit(bad ? 1 : 0);
