// Attendance (employee_attendance): joined to GGM Portal (v2 login), the speed layer, supervisors
// adding workers, and every page call existing on the server. Runs the real server files on a
// fake spreadsheet; the hub's own code signs the "Portal Users ATTENDANCE" rows.
const vm = require('vm'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..'), APPDIR = path.join(ROOT, 'employee_attendance');
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(String(e.message || e)); } };

/* ---------- Google services, enough for these files ---------- */
const toSigned = buf => Array.from(buf).map(b => b > 127 ? b - 256 : b);
const toBuf = x => Buffer.isBuffer(x) ? x : typeof x === 'string' ? Buffer.from(x, 'utf8') : Buffer.from(x.map(b => b & 255));
const TZ_FMT = (d, f) => {
  const p = {}; new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(d).forEach(x => { p[x.type] = x.value; });
  const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const m = Number(p.month);
  return f.replace(/yyyy|MMMM|MMM|MM|dd|EEE|HH|mm|ss|d/g, k => ({ yyyy: p.year, MMMM: MON[m - 1], MMM: MON[m - 1].slice(0, 3), MM: ('0' + m).slice(-2),
    dd: ('0' + p.day).slice(-2), EEE: p.weekday, HH: p.hour, mm: p.minute, ss: p.second, d: String(Number(p.day)) })[k]);
};
const Utilities = {
  Charset: { UTF_8: 'utf8' }, DigestAlgorithm: { MD5: 'md5', SHA_256: 'sha256' },
  base64EncodeWebSafe: x => toBuf(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
  base64DecodeWebSafe: s => toSigned(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
  computeHmacSha256Signature: (v, k) => toSigned(crypto.createHmac('sha256', toBuf(k)).update(toBuf(v)).digest()),
  computeDigest: (a, v) => toSigned(crypto.createHash(a).update(toBuf(v)).digest()),
  newBlob: x => ({ getDataAsString: () => toBuf(x).toString('utf8'), getBytes: () => toSigned(toBuf(x)) }),
  getUuid: () => crypto.randomUUID(),
  formatDate: (d, tz, f) => TZ_FMT(d, f)
};
const PEPPER = 'pepper-' + crypto.randomBytes(6).toString('hex');
const cacheMap = {};
const CacheService = { getScriptCache: () => ({
  get: k => (k in cacheMap ? cacheMap[k] : null), put: (k, v) => { cacheMap[k] = String(v); }, remove: k => { delete cacheMap[k]; },
  getAll: ks => { const o = {}; ks.forEach(k => { if (k in cacheMap) o[k] = cacheMap[k]; }); return o; },
  putAll: o => Object.assign(cacheMap, o), removeAll: ks => ks.forEach(k => delete cacheMap[k]) }) };
const props = { PORTAL_KEY: PEPPER };
const PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }),
  getDocumentProperties: () => ({ getProperty: k => props['D_' + k] || null, setProperty: (k, v) => { props['D_' + k] = v; }, deleteProperty: k => { delete props['D_' + k]; } }) };

/* ---------- a fake spreadsheet: values + backgrounds per cell ---------- */
let READS = 0, dropdown = null;   // dropdown: the last list put on a dropdown
function chain(target) {   // unknown formatting calls just return the range
  return new Proxy(target, { get: (o, k) => k in o ? o[k] : (typeof k === 'string' ? () => chain(o) : undefined) });
}
function Sheet(book, name) {
  const s = { v: [], bg: [], fc: [], maxRows: 1000, maxCols: 26 };
  const at = (g, r, c, dflt) => ((g[r - 1] || [])[c - 1] === undefined ? dflt : g[r - 1][c - 1]);
  const set = (g, r, c, x) => { while (g.length < r) g.push([]); g[r - 1][c - 1] = x; };
  const sh = {
    _s: s, getName: () => name, getParent: () => book, isSheetHidden: () => false, hideSheet() {},
    getLastRow: () => { for (let r = s.v.length; r > 0; r--) if ((s.v[r - 1] || []).some(x => x !== '' && x !== undefined && x !== null)) return r; return 0; },
    getLastColumn: () => Math.max(0, ...s.v.map(r => { for (let c = r.length; c > 0; c--) if (r[c - 1] !== '' && r[c - 1] !== undefined) return c; return 0; })),
    getMaxRows: () => s.maxRows, getMaxColumns: () => s.maxCols,
    insertRowsAfter: (a, n) => { s.maxRows += n; }, insertColumnsAfter: (a, n) => { s.maxCols += n; },
    deleteColumns: (a, n) => { s.maxCols -= n; }, deleteRows: (a, n) => { s.maxRows -= n; },
    deleteRow: r => { s.v.splice(r - 1, 1); s.bg.splice(r - 1, 1); },
    appendRow: row => { const r = sh.getLastRow() + 1; row.forEach((x, j) => set(s.v, r, j + 1, x)); },
    setFrozenRows() {}, setFrozenColumns() {}, setColumnWidth() {}, setColumnWidths() {}, setRowHeight() {}, setConditionalFormatRules() {},
    getRange(r, c, nr, nc) {
      if (typeof r === 'string') return chain({});
      nr = nr || 1; nc = nc || 1;
      const grid = (g, dflt) => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => at(g, r + i, c + j, dflt)));
      const R = {
        getValues: () => { READS++; return grid(s.v, ''); }, getDisplayValues: () => grid(s.v, '').map(row => row.map(String)),
        getBackgrounds: () => { READS++; return grid(s.bg, '#ffffff'); },
        getFontColors: () => grid(s.fc, '#000000'),
        setFontColors: g => { g.forEach((row, i) => row.forEach((x, j) => set(s.fc, r + i, c + j, x))); return chain(R); },
        getValue: () => at(s.v, r, c, ''), getBackground: () => at(s.bg, r, c, '#ffffff'),
        setValues: vals => { vals.forEach((row, i) => row.forEach((x, j) => set(s.v, r + i, c + j, x))); return chain(R); },
        setValue: x => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) set(s.v, r + i, c + j, x); return chain(R); },
        setBackgrounds: g => { g.forEach((row, i) => row.forEach((x, j) => set(s.bg, r + i, c + j, x))); return chain(R); },
        setBackground: x => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) set(s.bg, r + i, c + j, x === null ? '#ffffff' : x); return chain(R); },
        insertCheckboxes: () => chain(R), clearContent: () => { R.setValue(''); return chain(R); }
      };
      return chain(R);
    }
  };
  return sh;
}
const book = { tabs: {}, getSheetByName(n) { return this.tabs[n] || null; }, insertSheet(n) { return (this.tabs[n] = Sheet(this, n)); },
  getSheets() { return Object.values(this.tabs); }, getId: () => 'SHEET1' };
const fill = (name, rows) => { const sh = book.insertSheet(name); rows.forEach((r, i) => r.forEach((x, j) => sh.getRange(i + 1, j + 1).setValue(x))); return sh; };

const SpreadsheetApp = { getActiveSpreadsheet: () => book, openById: () => book, flush() {},
  newDataValidation: () => { const o = chain({ build: () => ({}), requireValueInList: l => { dropdown = l; return o; } }); return o; }, ProtectionType: { SHEET: 'SHEET' } };
const LockService = { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) };
const Session = { getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => 'owner@x' }), getScriptTimeZone: () => 'Asia/Kolkata' };

/* ---------- the hub signs the portal rows ---------- */
const hub = vm.createContext({ Utilities, PropertiesService: { getScriptProperties: () => ({ getProperty: k => ({ PEPPER })[k] || null, getProperties: () => ({ PEPPER }) }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) }, SpreadsheetApp, Session, console, JSON, Math, Date, String, Number, Object, Array });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'main hub app', 'Code.js'), 'utf8'), hub);
const H = c => vm.runInContext(c, hub);
function portalRow(username, name, role, site, pw) {
  const salt = 's' + username;
  const r = [username, name, '98290' + String(Math.abs(username.length * 12345)).padStart(5, '0'), '', role, site, '', H(`hashPassword_(${JSON.stringify(pw)}, ${JSON.stringify(salt)})`), salt, '', ''];
  r[10] = H(`appRowCheck_('ATTENDANCE', ${JSON.stringify(r)})`);
  return r;
}

/* ---------- the app ---------- */
const app = vm.createContext({ Utilities, CacheService, PropertiesService, SpreadsheetApp, LockService, Session,
  HtmlService: { createHtmlOutput: h => ({ getContent: () => h }) }, ContentService: { createTextOutput: s => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
  ScriptApp: { getProjectTriggers: () => [] }, Logger: { log() {} }, console, JSON, Math, Date, String, Number, Object, Array, Intl });
['Config', 'Code', 'Fast', 'Auth', 'Attendance', 'Adminops', 'Sheetsetup', 'Triggers', 'Migration', 'GgmLogin', 'PortalApp', 'Photos', 'Punch']
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(APPDIR, f + '.js'), 'utf8'), app, { filename: f + '.js' }));
const A = c => vm.runInContext(c, app);
const newRequest = () => A(`MEMO_ = {}; GGM_MEMO_ = {};`);   // each server call starts with empty per-request memory

// sheet contents (there is no Users tab: Portal Users is the only list of people)
fill('Employees', [['Employee ID', 'Name', 'Site', 'Supervisor', 'Designation', 'Active'],
  ['TNK-001', 'Ramesh Kumar', 'Tonk', 'tonk.super', 'Loader', true], ['TNK-002', 'Suresh Meena', 'Tonk', 'tonk.super', '', true],
  ['TNK-003', 'Mohan Lal', 'Tonk', '', '', true], ['TNK-004', 'Old Hand', 'Tonk', 'tonk.super', '', false],
  ['NW-01', 'Kamla Devi', 'Newai', '', '', true], ['NW-02', 'Hari Om', 'Newai', '', '', true]]);
fill('Settings', [['Site', 'Closing', 'Refresh', 'Lock', 'Redo'], ['Tonk', '23:59', 30, false, true], ['Newai', '23:59', 30, false, true]]);
fill('AuditLog', [['Timestamp']]);
fill('Portal Users ATTENDANCE', [['Username', 'Name', 'Phone', 'Email', 'Role', 'Site', 'Doer Name', 'Password Hash', 'Salt', 'Updated', 'Check'],
  portalRow('ramesh.p', 'Ramesh P', 'Supervisor', 'Tonk', 'portal1'),
  portalRow('priya', 'Priya HR', 'HR', '', 'portal2'),
  portalRow('newsup', 'Newai Sup', 'Supervisor', 'Newai', 'portal3'),
  portalRow('tonk.super', 'Tonk Supervisor', 'Supervisor', 'Tonk', 'super123'),
  portalRow('hr1', 'HR One', 'HR', '', 'hr123456'),
  portalRow('admin.a', 'Admin', 'Admin', '', 'admin123')]);

/* ---------- 1. sign-in ---------- */
newRequest();
const sup = A(`loginAndLoad('tonk.super', 'super123')`);
t('supervisor signs in with the portal username; first screen comes with it (one trip)', sup.ok && sup.session.role === 'Supervisor' && sup.first.view === 'mark' && sup.cfg.scope[0] === 'Tonk');
const mk = sup.first.mark;
t('supervisor sees own + unassigned workers, not the switched-off one', mk.employees.map(e => e.id).sort().join() === 'TNK-001,TNK-002,TNK-003' && mk.unassigned === 1);
t('next free Employee ID is suggested', mk.nextId === 'TNK-005');
newRequest();
t('HR signs in the same way', A(`login('hr1', 'hr123456')`).ok);
t('wrong password is refused', A(`login('admin.a', 'nope')`).ok === false);
newRequest();
t('an old shared login (not in Portal Users) is refused', A(`login('Newai01', 'whatever1')`).ok === false);
newRequest();
A(`CacheService.getScriptCache().put(SESSION_CACHE_PREFIX + 'old', JSON.stringify({ username: 'Newai', role: 'Supervisor', site: 'Newai', ts: Date.now() }), 60)`);
t('a session opened with an old login has ended', throws(() => A(`requireSession_('old')`), /SESSION_EXPIRED/));

/* ---------- 2. marking + speed ---------- */
const ST = sup.session.token;
newRequest();
t('mark Full Day', A(`submitAttendance('${ST}', 'TNK-001', 'Full Day')`).ok);
newRequest();
t('second mark is refused', /Already marked/.test(A(`submitAttendance('${ST}', 'TNK-001', 'Half Day')`).error));
newRequest();
t('worker on another list is refused', /another supervisor/.test(A(`submitAttendance('${ST}', 'NW-01', 'Full Day')`).error));
newRequest();
const after = A(`getSupervisorEmployees('${ST}')`);
t('the mark shows at once (cached copy patched, not dropped)', after.employees.filter(e => e.id === 'TNK-001')[0].status === 'Full Day' && after.done === 1);
newRequest(); READS = 0;
A(`getSupervisorEmployees('${ST}')`);
t('a poll reads nothing from the sheet (Employees, Settings, today column all cached)', READS === 0);

/* ---------- 3. supervisor adds a worker ---------- */
newRequest();
const add = A(`supervisorAddEmployee('${ST}', 'TNK-005', 'New Guy', 'Helper')`);
t('supervisor adds a worker to their own site and list', add.ok && add.employee.id === 'TNK-005' && add.employee.unassigned === false && add.nextId === 'TNK-006');
const empRow = book.tabs.Employees._s.v.filter(r => r[0] === 'TNK-005')[0];
t('…written to Employees with their site and themselves as supervisor', empRow && empRow[2] === 'Tonk' && empRow[3] === 'tonk.super');
newRequest();
t('…and is on their marking list straight away', A(`getSupervisorEmployees('${ST}')`).employees.some(e => e.id === 'TNK-005'));
newRequest();
t('an ID that exists anywhere is refused', /already exists/.test(A(`supervisorAddEmployee('${ST}', 'nw-01', 'Dup', '')`).error));
newRequest();
const HRT = A(`login('hr1', 'hr123456')`).token;
newRequest();
t('HR cannot use the supervisor add', throws(() => A(`supervisorAddEmployee('${HRT}', 'X-1', 'X', '')`), /Not authorised/));

/* ---------- 4. HR: one call for everything today ---------- */
newRequest();
const td = A(`getTodayRows('${HRT}', 'ALL')`);
t('HR gets every active person in scope in one call', td.rows.length === 6 && td.sites.length === 5 && td.rows.filter(r => r.id === 'TNK-001')[0].st === 'Full Day');
newRequest();
t('HR approves', A(`verifyRecord('${HRT}', 'Tonk', 'TNK-001', 'Approved')`).ok);
newRequest();
t('…and the approval shows at once', A(`getTodayRows('${HRT}', 'Tonk')`).rows.filter(r => r.id === 'TNK-001')[0].ap === 'Approved');
newRequest();
A(`hrSetAttendance('${HRT}', 'Tonk', 'TNK-002', 'Absent')`);
newRequest();
const k = A(`getKpis('${HRT}', 'Tonk')`);
t('KPIs still add up (old screens)', k.totals.filled === 2 && k.totals.absent === 1 && k.totals.verified === 2);
newRequest();
const month = A(`getEmployeeMonth('${HRT}', 'Tonk', 'TNK-001')`);
t("one person's month: today's Full Day, HR-approved", month.ok && month.counts.full === 1 && month.counts.approved === 1);
newRequest();
t('a supervisor cannot read another site', throws(() => A(`getEmployeeMonth('${ST}', 'Newai', 'NW-01')`), /do not have access/));

/* ---------- 5. GGM Portal sign-in ---------- */
newRequest();
const rp = A(`login('ramesh.p', 'portal1')`);
t('a portal Supervisor works under their own username, at the site from the hub', rp.ok && rp.username === 'ramesh.p' && rp.role === 'Supervisor' && rp.scope.join() === 'Tonk');
newRequest();
const pr = A(`login('priya', 'portal2')`);
t('role + site come from the hub (HR, blank site = all sites)', pr.ok && pr.role === 'HR' && pr.scope.length === 5 && pr.username === 'priya');
newRequest();
t('portal phone number works as the username too', A(`login('${portalRow('priya', '', '', '', 'x')[2]}', 'portal2')`).ok);
newRequest();
const ns = A(`login('newsup', 'portal3')`);
newRequest();
t('a portal Supervisor counts as a supervisor (HR can assign workers to them)', A(`listSupervisors_(ss_(), false)`).some(s => s.username === 'newsup' && s.site === 'Newai' && s.portal) &&
  A(`getSupervisorEmployees('${ns.token}')`).employees.length === 2);
newRequest();
const gl = A(`ggmLogin('priya', 'portal2')`);
newRequest();
t('a portal tile pass signs in without a password', A(`portalSignIn('${gl.token}')`).ok);
// unticked in the hub → the row disappears → signed out within the recheck
const tab = book.tabs['Portal Users ATTENDANCE']._s.v;
const priyaIdx = tab.findIndex(r => r[0] === 'priya');
const priyaRow = tab.splice(priyaIdx, 1)[0];
Object.keys(cacheMap).filter(x => /^ggm_tab_|^ATT_PCHK_/.test(x)).forEach(x => delete cacheMap[x]);
newRequest();
t('unticked in GGM Portal → their Attendance session ends', throws(() => A(`requireSession_('${pr.token}')`), /SESSION_EXPIRED/));
tab.splice(priyaIdx, 0, priyaRow);
// a row edited by hand is ignored
tab[1][4] = 'Admin';
Object.keys(cacheMap).filter(x => /^ggm_tab_/.test(x)).forEach(x => delete cacheMap[x]);
newRequest();
t('a hand-edited portal row does not let anyone in', A(`login('ramesh.p', 'portal1')`).ok === false);

/* ---------- 5b. opened from a GGM Portal tile ---------- */
newRequest();
const pass = A(`ggmSign_({ t: 'l', a: 'ATTENDANCE', u: 'priya', j: 'j1', exp: ggmNow_() + 300 })`);
newRequest();
const boot = A(`attPortalBoot_({ parameter: { pt: '${pass}' } })`);
t('a tile opens signed in, with the first screen inside the page (no extra trips)', boot && boot.session && boot.session.ok && boot.session.role === 'HR' && boot.first.view === 'today' && boot.first.today.rows.length > 0);
newRequest();
t('a pass for another app is ignored (normal sign-in screen)', A(`attPortalBoot_({ parameter: { pt: '${A(`ggmSign_({ t: 'l', a: 'STAFF', u: 'priya', j: 'j2', exp: ggmNow_() + 300 })`)}' } })`) === null);
const json = A(`safeJson_({ x: '</script><b>' + String.fromCharCode(8232) })`);
t('data put in the page cannot close its script tag', json.indexOf('<') === -1 && json.indexOf(String.fromCharCode(8232)) === -1);

/* ---------- 6. hub requests ---------- */
newRequest();
const meta = A(`GGM_APP.meta()`);
t('hub dropdowns: roles, sites, Supervisor needs a site', meta.roles.join() === 'Supervisor,HR,Admin' && meta.sites.length === 5 && meta.siteRoles.join() === 'Supervisor');
newRequest();
const badges = A(`GGM_APP.counts([{ u: 'tonk.super', r: 'Supervisor', s: 'Tonk' }, { u: 'priya', r: 'HR', s: '' }, { u: 'nobody', r: '', s: '' }])`);
t('badges: supervisor = own workers still to mark; HR = records waiting for a check', badges['tonk.super'] === 2 && badges.priya === 0 && badges.nobody === 0);
t('hub Apps row for ATTENDANCE (v2: Sheet ID, fields role,site) matches the app id',
  H(`DEFAULT_APPS.some(r => r[0] === 'ATTENDANCE' && r[A.SHEET] === '1Msf0vgketMqVUvd_f_CXOI_YejatEro8iM9BrhGtJVs' && r[A.FIELDS] === 'role,site')`) && A(`GGM_APP.id`) === 'ATTENDANCE' && A(`GGM_APP.sheetId`) === '1Msf0vgketMqVUvd_f_CXOI_YejatEro8iM9BrhGtJVs');
t('GgmLogin.js copy in employee_attendance = master', fs.readFileSync(path.join(APPDIR, 'GgmLogin.js'), 'utf8') === fs.readFileSync(path.join(ROOT, 'portal_connector', 'GgmLogin.js'), 'utf8'));

/* ---------- 6b. the 5-minute warm-up ---------- */
newRequest();
const AT = A(`login('admin.a', 'admin123')`).token;
newRequest();
A(`warmCaches()`);
newRequest(); READS = 0;
const ov = A(`getAdminOverview('${AT}')`);
const td2 = A(`getTodayRows('${AT}', 'ALL')`);
t('after the warm-up the Admin overview + today load without reading the sheet', READS === 0 && ov.headcount === 6 && td2.rows.length === 6);
t('overview month numbers are per person (for the "man-days lost" list)', ov.people.some(p => p.id === 'TNK-001' && p.f === 1));

/* ---------- 6b2. the Supervisor dropdown follows Portal Users ---------- */
const forgetTab = () => Object.keys(cacheMap).filter(x => /^ggm_tab_|^SUPERVISORS/.test(x)).forEach(x => delete cacheMap[x]);
delete props.ATT_SUP_LIST; forgetTab(); dropdown = null;
newRequest();
A(`warmCaches()`);
t('Employees dropdown = the Supervisor rows of Portal Users (no HR, no Admin)', dropdown && dropdown.includes('tonk.super') && dropdown.includes('newsup') && !dropdown.includes('hr1') && !dropdown.includes('admin.a'));
dropdown = null;
newRequest();
A(`warmCaches()`);
t('nothing changed: the dropdown is left alone', dropdown === null);
const ptab = book.tabs['Portal Users ATTENDANCE']._s.v;
ptab.push(portalRow('jagdish', 'JAGDISH', 'Supervisor', 'Newai', 'portal4'));
forgetTab();
newRequest();
A(`warmCaches()`);
t('a new portal supervisor reaches the dropdown at the next 5-minute run', dropdown && dropdown.includes('jagdish'));
ptab.pop(); forgetTab();
newRequest();
A(`warmCaches()`);
t('…and leaves it when unticked in the portal', dropdown && !dropdown.includes('jagdish'));
newRequest();
const ud = A(`getUsersData('${HRT}')`);
t('App users lists the Portal Users people', ud.portal.some(p => p.username === 'newsup' && p.role === 'Supervisor') && ud.users === undefined);
newRequest();
t('a name that is not a portal supervisor counts as unassigned, so nobody disappears', (() => {
  const row = book.tabs.Employees._s.v.find(r => r[0] === 'NW-01'), old = row[3];
  row[3] = 'Newai01'; Object.keys(cacheMap).filter(x => /EMP/.test(x)).forEach(x => delete cacheMap[x]);
  A(`MEMO_ = {}`);
  const m = A(`employeesForSupervisor_(ss_(), 'Newai', 'newsup')`);
  row[3] = old; Object.keys(cacheMap).filter(x => /EMP/.test(x)).forEach(x => delete cacheMap[x]);
  return m['NW-01'] === 'unassigned';
})());
const appCode = fs.readdirSync(APPDIR).filter(f => /\.(js|html)$/.test(f)).map(f => fs.readFileSync(path.join(APPDIR, f), 'utf8')).join('\n');
t('nothing reads or builds the old Users tab', !/SHEET_USERS|getSheetByName\('Users'\)|insertSheet\('Users'\)/.test(appCode) && !book.tabs.Users);
t('the page has no app passwords or account forms left', !/changeMyPassword|addUser|updateUser|removeUser|resetUserPassword|openPassword/.test(appCode));

/* ---------- 6c. the Record tab ---------- */
newRequest();
const rec = A(`getMonthRecord('${HRT}', 'Tonk')`);
const r1 = rec.rows.filter(r => r.id === 'TNK-001')[0], r2 = rec.rows.filter(r => r.id === 'TNK-002')[0];
t('Record: one row per person with the month totals (present / half / absent / not marked)', rec.ok && r1.f === 1 && r1.a === 0 && r2.a === 1 && r1.u === rec.daysCounted - 1);
t('Record: switched-off people are flagged, never counted as "not marked"', rec.rows.filter(r => r.id === 'TNK-004')[0].off === true && rec.rows.filter(r => r.id === 'TNK-004')[0].u === 0);
newRequest();
t('Record: All sites for HR covers every site', A(`getMonthRecord('${HRT}', 'ALL')`).rows.length === 7);
newRequest();
t('Record: a supervisor cannot open it', throws(() => A(`getMonthRecord('${ST}', 'Tonk')`), /Not authorised/));
newRequest();
const nx = new Date(); nx.setMonth(nx.getMonth() + 2);
t('Record: a month that has not started is refused', A(`getMonthRecord('${HRT}', 'Tonk', ${nx.getFullYear()}, ${nx.getMonth() + 1})`).ok === false);
const navSrc = fs.readFileSync(path.join(APPDIR, 'Scripts.html'), 'utf8');
t('Record tab is in the HR and Admin menus, with a Print list (PDF) button', /HR: \[[^\]]*id: 'record'/.test(navSrc) && /Admin: \[[^\]]*id: 'record'/.test(navSrc) &&
  /id="recPrint"/.test(fs.readFileSync(path.join(APPDIR, 'Index.html'), 'utf8')) && /doc\.save\(/.test(navSrc));

/* ---------- 6d. Record follows a change made today ---------- */
newRequest();
A(`getMonthRecord('${HRT}', 'Tonk')`);                     // cached copy exists
newRequest();
A(`hrSetAttendance('${HRT}', 'Tonk', 'TNK-003', 'Half Day')`);
newRequest(); READS = 0;
const rec2 = A(`getMonthRecord('${HRT}', 'Tonk')`).rows.filter(r => r.id === 'TNK-003')[0];
t('Record shows a status set today at once (cached month patched, not re-read)', rec2.h === 1 && READS === 0);
newRequest();
A(`hrSetAttendance('${HRT}', 'Tonk', 'TNK-003', 'Absent')`);
newRequest();
const rec3 = A(`getMonthRecord('${HRT}', 'Tonk')`).rows.filter(r => r.id === 'TNK-003')[0];
t('…and a change of mind moves the day (half → absent), not adds one', rec3.h === 0 && rec3.a === 1);

/* ---------- 6e. employee photos ---------- */
const JPG = 'data:image/jpeg;base64,' + Buffer.from('fakejpeg').toString('base64');
newRequest();
t('supervisor adds a photo for a worker at their site', A(`setEmployeePhoto('${ST}', 'Tonk', 'TNK-002', '${JPG}', '${JPG}')`).ok);
newRequest();
t('…not for a worker at another site', throws(() => A(`setEmployeePhoto('${ST}', 'Newai', 'NW-01', '${JPG}', '${JPG}')`), /do not have access/));
newRequest();
t('…and only a real picture is stored', A(`setEmployeePhoto('${HRT}', 'Newai', 'NW-01', 'javascript:alert(1)', '${JPG}')`).ok === false);
newRequest();
t('a picture too big for a sheet cell is refused', A(`setEmployeePhoto('${HRT}', 'Newai', 'NW-01', '${JPG}', 'data:image/jpeg;base64,' + 'A'.repeat(49000))`).ok === false);
newRequest();
const idx = A(`getPhotoIndex('${HRT}')`), thumbs = A(`getPhotoThumbs('${HRT}', ['TNK-002', 'TNK-001'])`);
t('photo index lists who has one; thumbs come only for those asked', idx['TNK-002'] > 0 && !idx['TNK-001'] && thumbs['TNK-002'] === JPG && !thumbs['TNK-001']);
newRequest();
t('the sharp photo comes back on tap', A(`getEmployeePhoto('${ST}', 'TNK-002')`) === JPG);
newRequest();
A(`setEmployeePhoto('${HRT}', 'Tonk', 'TNK-002', '${JPG}', '${JPG}')`);
t('changing a photo replaces it (one row per person)', book.tabs['Employee Photos']._s.v.filter(r => r[0] === 'TNK-002').length === 1);

/* ---------- 6g. punch report: marks that do not fit the punches turn red ---------- */
{
  const yr = new Date().getFullYear(), d0 = new Date();
  const iso = dt => dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  const today = iso(d0), tomorrow = iso(new Date(d0.getTime() + 864e5));
  // today on the Tonk tab: TNK-001 Full Day (HR), TNK-002 cleared, TNK-003 Absent, TNK-005 not marked
  newRequest(); A(`hrSetAttendance('${HRT}', 'Tonk', 'TNK-002', 'Half Day')`);
  const payload = { file: 'daily_punch_report.xlsx', dates: [today, tomorrow], rows: [
    { id: 'TNK-001', d: ['540,1100,2', '540,1100,2'] },   // 9:00 → 18:20 = 9h20: Full day fits
    { id: 'TNK-002', d: ['540,1100,2', ''] },             // marked Half day but 9h20 → red
    { id: 'TNK-003', d: ['', ''] },                       // marked Absent, no punch: fits
    { id: 'TNK-005', d: ['600,900,2', ''] },              // punched, not marked: counted, untouched
    { id: '99999', d: ['540,1100,2', ''] }                // not on the attendance
  ] };
  newRequest();
  const pr = A(`uploadPunchReport('${HRT}', ${JSON.stringify(payload)})`);
  const tab = book.tabs['Tonk_' + yr]._s, col = A(`dayCol_(${yr}, ${d0.getMonth() + 1}, ${d0.getDate()})`);
  const rowOf = id => tab.v.findIndex(r => r[0] === id);
  const font = id => (tab.fc[rowOf(id)] || [])[col - 1] || '#000000';
  t('punch check: the mark that does not fit turns red, the ones that fit stay black', pr.ok && font('TNK-002') === '#ff0000' && font('TNK-001') === '#000000' && font('TNK-003') === '#000000');
  t('…counts: checked, different, punched-but-not-marked, not on attendance; tomorrow is never touched',
    pr.compared === 3 && pr.different === 1 && pr.notMarked === 1 && pr.notOnAttendance === 1 && pr.list[0].id === 'TNK-002' && /9h20/.test(pr.list[0].punch));
  newRequest(); A(`hrSetAttendance('${HRT}', 'Tonk', 'TNK-002', 'Full Day')`);
  newRequest(); A(`uploadPunchReport('${HRT}', ${JSON.stringify(payload)})`);
  t('…uploading again after a correction turns it back to black', font('TNK-002') === '#000000');
  const exp = (p, fd, hd) => A(`punchExpect_('${p}', { fdHours: ${fd}, hdHours: ${hd} }).fit.join('|')`);
  t('rules: no punch = Absent, one punch = present, ≥7h Full, ≥4h Half, less = Half or Absent',
    exp('', 7, 4) === 'Absent' && exp('540,540,1', 7, 4) === 'Full Day|Half Day' && exp('540,960,2', 7, 4) === 'Full Day' &&
    exp('540,840,2', 7, 4) === 'Half Day' && exp('540,700,2', 7, 4) === 'Half Day|Absent');
  newRequest();
  t('a supervisor cannot upload the punch report', throws(() => A(`uploadPunchReport('${ST}', ${JSON.stringify(payload)})`), /Not authorised/));
}

/* ---------- 6f. next year keeps this year's row order ---------- */
const tonk = book.tabs['Tonk_' + new Date().getFullYear()]._s;
// hand-arranged: TNK-005 first, a blank separator row with a label, then the rest reversed
const dataRows = tonk.v.slice(2).filter(r => r[0]);
const order = ['TNK-005', '', 'TNK-003', 'TNK-002', 'TNK-001', 'TNK-004'];
tonk.v = tonk.v.slice(0, 2).concat(order.map(id => id ? dataRows.filter(r => r[0] === id)[0] : ['', 'Drivers']));
newRequest();
const next = A(`buildYearSheet_(ss_(), 'Tonk', ${new Date().getFullYear() + 1})`);
const got = next._s.v.slice(2).map(r => r[0] || '(' + r[1] + ')');
t('a new year tab keeps last year\'s hand-made order, separator rows included', got.join() === 'TNK-005,(Drivers),TNK-003,TNK-002,TNK-001,TNK-004');

/* ---------- 7. the page ---------- */
const page = fs.readFileSync(path.join(APPDIR, 'Scripts.html'), 'utf8').replace(/^\s*<script>|<\/script>\s*$/g, '');
let syntaxOk = true;
try { new vm.Script(page); } catch (e) { syntaxOk = false; console.log(e.message); }
t('page script parses', syntaxOk);
const calls = [...new Set([...page.matchAll(/call\('([A-Za-z0-9_]+)'/g), ...page.matchAll(/fetchStore\('[a-z]+', '([A-Za-z0-9_]+)'/g)].map(m => m[1]))];
const missing = calls.filter(f => A(`typeof ${f}`) !== 'function' || /_$/.test(f));
t('every server function the page calls exists (' + calls.length + ')', !missing.length);
if (missing.length) console.log('missing: ' + missing.join(', '));
const index = fs.readFileSync(path.join(APPDIR, 'Index.html'), 'utf8');
t('page carries the portal boot data and no blocking chart script', /window\.ATT_BOOT=<\?!= boot \?>/.test(index) && /<\?!= portalTags \?>/.test(index) && !/chart\.umd/.test(index));
t('ink & honey: the hub colours', /--amber:#F2C14E/.test(fs.readFileSync(path.join(APPDIR, 'Styles.html'), 'utf8')) && /Inter/.test(index));
const hasSearch = ['v_mark', 'v_today', 'v_verify', 'v_record', 'v_staff', 'v_overview', 'v_trends', 'v_more', 'v_users'].every(id => {
  const sec = index.split('id="' + id + '"')[1].split('</section>')[0];
  return /searchbar|data-search=/.test(sec);
});
t('every tab has a search bar', hasSearch);

console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
