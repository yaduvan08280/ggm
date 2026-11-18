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
const PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; },
    getProperties: () => Object.assign({}, props) }),
  getDocumentProperties: () => ({ getProperty: k => props['D_' + k] || null, setProperty: (k, v) => { props['D_' + k] = v; }, deleteProperty: k => { delete props['D_' + k]; } }) };

/* ---------- a fake spreadsheet: values + backgrounds per cell ---------- */
let READS = 0, dropdown = null;   // dropdown: the last list put on a dropdown
function chain(target) {   // unknown formatting calls just return the range
  return new Proxy(target, { get: (o, k) => k in o ? o[k] : (typeof k === 'string' ? () => chain(o) : undefined) });
}
function Sheet(book, name) {
  const s = { v: [], bg: [], fc: [], nt: [], maxRows: 1000, maxCols: 26 };
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
        getNotes: () => grid(s.nt, ''), getNote: () => at(s.nt, r, c, ''),
        setNotes: g => { g.forEach((row, i) => row.forEach((x, j) => set(s.nt, r + i, c + j, x))); return chain(R); },
        setNote: x => { set(s.nt, r, c, x); return chain(R); },
        insertCheckboxes: () => chain(R), clearContent: () => { R.setValue(''); return chain(R); }
      };
      return chain(R);
    }
  };
  return sh;
}
const book = { tabs: {}, getSheetByName(n) { return this.tabs[n] || null; }, insertSheet(n) { return (this.tabs[n] = chain(Sheet(this, n))); },
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
  ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ forSpreadsheet: () => ({ onChange: () => ({ create() {} }) }) }) }, Logger: { log() {} }, console, JSON, Math, Date, String, Number, Object, Array, Intl });
['Config', 'Code', 'Fast', 'Auth', 'Attendance', 'Adminops', 'Sheetsetup', 'Triggers', 'Migration', 'GgmLogin', 'PortalApp', 'Photos', 'Punch', 'Salary']
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
t('"Marked by me": the person this supervisor marked is flagged, the others are not', after.employees.find(e => e.id === 'TNK-001').byMe === true && after.employees.filter(e => e.byMe).length === 1);
Object.keys(props).filter(k => /^ATT_BY_/.test(k)).forEach(k => delete props[k]);
newRequest();
t('…if that list is lost it is rebuilt from today\'s AuditLog', A(`getSupervisorEmployees('${ST}')`).employees.find(e => e.id === 'TNK-001').byMe === true);
newRequest();
t('…another supervisor at the site does not see them as theirs', A(`markedByMe_('someone.else')`)['TNK-001'] === undefined);

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
t('hub dropdowns: roles, sites, Supervisor needs a site', meta.roles.join() === 'Supervisor,HR,Accounts,Admin' && meta.sites.length === 5 && meta.siteRoles.join() === 'Supervisor');
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
props[A(`"ATT_BACKFILL2_" + BACKFILL_FROM`)] = "done";   // the one-off fill has its own test (6e3)
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

/* ---------- 6b3. a second site: its supervisors can mark the person too ---------- */
const dropEmp = () => Object.keys(cacheMap).filter(x => /^ATT_EMP|^ATT_DAY_|^SUPERVISORS/.test(x)).forEach(x => delete cacheMap[x]);
newRequest();
t('second site must differ from the main site', /different from the main site/.test(A(`addEmployee('${HRT}', 'TNK-050', 'Visiting Vijay', 'Tonk', '', '', 'Tonk')`).error));
newRequest();
t('a made-up second site is refused', /Pick a second site/.test(A(`addEmployee('${HRT}', 'TNK-050', 'Visiting Vijay', 'Tonk', '', '', 'Mars')`).error));
newRequest();
const addV = A(`addEmployee('${HRT}', 'TNK-050', 'Visiting Vijay', 'Tonk', '', 'Driver', 'Newai')`);
const empTab = book.tabs.Employees._s.v;
t('HR adds a Tonk worker with Newai as second site (Employees column G)', addV.ok && empTab.some(r => r[0] === 'TNK-050' && r[2] === 'Tonk' && r[6] === 'Newai'));
dropEmp(); newRequest();
const nsList = A(`getSupervisorEmployees('${ns.token}')`).employees;
const vis = nsList.find(e => e.id === 'TNK-050');
t('the Newai supervisor sees the visitor, marked as staying from Tonk', vis && vis.home === 'Tonk' && !vis.status && nsList.filter(e => !e.home).length === 2);
newRequest();
t('the Tonk supervisor still has them too (no supervisor = every Tonk supervisor)', A(`getSupervisorEmployees('${ST}')`).employees.some(e => e.id === 'TNK-050' && e.unassigned && !e.home));
newRequest();
const badgeN = A(`GGM_APP.counts([{ u: 'newsup', r: 'Supervisor', s: 'Newai' }])`).newsup;
t('the Newai supervisor\'s badge counts the visitor', badgeN === 3);
newRequest();
t('the Newai supervisor marks them', A(`submitAttendance('${ns.token}', 'TNK-050', 'Half Day')`).ok);
const tq = A(`todayParts_()`), dcol = A(`dayCol_(${tq.year}, ${tq.month}, ${tq.day})`);
const cellOf = (site, id) => { const tb = book.tabs[site + '_' + tq.year]._s.v; const r = tb.find(x => x[0] === id); return r ? r[dcol - 1] : undefined; };
t('…the mark is saved once, on the main site\'s (Tonk) sheet', cellOf('Tonk', 'TNK-050') === 'HD' && cellOf('Newai', 'TNK-050') === undefined);
newRequest();
const tonkView = A(`getSupervisorEmployees('${ST}')`).employees.find(e => e.id === 'TNK-050');
t('…and the Tonk supervisor sees it marked (no second mark)', tonkView && tonkView.status === 'Half Day' && tonkView.locked);
newRequest();
t('a Tonk worker without a second site cannot be marked from Newai', /another supervisor/.test(A(`submitAttendance('${ns.token}', 'TNK-003', 'Full Day')`).error));
const vRow = empTab.find(r => r[0] === 'TNK-050'); vRow[5] = false; dropEmp(); newRequest();
t('switched off: no longer on the second site\'s list', !A(`getSupervisorEmployees('${ns.token}')`).employees.some(e => e.id === 'TNK-050'));
vRow[5] = true; vRow[6] = 'newai'; dropEmp(); newRequest();
t('a second site typed by hand in the sheet works whatever the case', A(`getSupervisorEmployees('${ns.token}')`).employees.some(e => e.id === 'TNK-050' && e.home === 'Tonk'));
// take the test worker away again (later checks use a fixed Tonk roster)
empTab.splice(empTab.indexOf(vRow), 1);
{ const tk = book.tabs['Tonk_' + tq.year]._s; const i = tk.v.findIndex(r => r[0] === 'TNK-050'); if (i > -1) { tk.v.splice(i, 1); tk.bg.splice(i, 1); } }
Object.keys(cacheMap).filter(x => /^ATT_EMP|^ATT_DAY_|^ATT_REC_|^ATT_OVERVIEW|^ROSTER_|^SUPERVISORS/.test(x)).forEach(x => delete cacheMap[x]);
const pg = fs.readFileSync(path.join(APPDIR, 'Scripts.html'), 'utf8');
t('page: Second site picker on add + edit, "Staying here from" tag, staff list shows "Also at"',
  (pg.match(/id="eSec"/g) || []).length === 2 && /Staying here from/.test(pg) && /Also at \$\{esc\(e\.secondary\)\}/.test(pg) && /\$\('eSec'\)\.value\)\.then/.test(pg));

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

/* ---------- 6g. punch report: fits = approved (green), does not fit = purple ---------- */
{
  const yr = new Date().getFullYear(), d0 = new Date();
  const iso = dt => dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  const today = iso(d0), tomorrow = iso(new Date(d0.getTime() + 864e5));
  // today on the Tonk tab: TNK-001 Full Day (HR), TNK-002 cleared, TNK-003 Absent, TNK-005 not marked
  newRequest(); A(`hrSetAttendance('${HRT}', 'Tonk', 'TNK-002', 'Half Day')`);
  const payload = { file: 'daily_punch_report.xlsx', dates: [today, tomorrow], rows: [
    { id: 'TNK-001', d: ['540,1100,2', '540,1100,2'] },   // 9:00 → 18:20 = 9h20: Full day fits
    { id: 'TNK-002', d: ['540,1100,2', ''] },             // marked Half day but 9h20 → purple
    { id: 'TNK-003', d: ['', ''] },                       // marked Absent, no punch: fits
    { id: 'TNK-005', d: ['600,900,2', ''] },              // punched, not marked: counted, untouched
    { id: '99999', d: ['540,1100,2', ''] }                // not on the attendance
  ] };
  const tab = book.tabs['Tonk_' + yr]._s, col = A(`dayCol_(${yr}, ${d0.getMonth() + 1}, ${d0.getDate()})`);
  const rowOf = id => tab.v.findIndex(r => r[0] === id);
  const font = id => (tab.fc[rowOf(id)] || [])[col - 1] || '#000000';
  const bg = id => String((tab.bg[rowOf(id)] || [])[col - 1] || '#ffffff').toLowerCase();
  (tab.fc[rowOf('TNK-001')] = tab.fc[rowOf('TNK-001')] || [])[col - 1] = '#ff0000';   // red text from the old way
  tab.bg[rowOf('TNK-003')][col - 1] = '#f4c7c3';   // TNK-003 waiting for HR (light red) before the upload
  newRequest();
  const pr = A(`uploadPunchReport('${HRT}', ${JSON.stringify(payload)})`);
  t('punch upload: marks that fit are approved (green), the one that does not is purple', pr.ok && bg('TNK-002') === '#b4a7d6' && bg('TNK-001') === '#b7e1cd' && bg('TNK-003') === '#b7e1cd' && pr.matched === 2);
  newRequest();
  t('…Today shows the fitting ones as approved by HR', A(`getTodayRows('${HRT}', 'Tonk')`).rows.find(r => r.id === 'TNK-003').ap === 'Approved');
  t('…a day not marked although they punched in is purple too, with a note', bg('TNK-005') === '#b4a7d6' && /Marked: nothing/.test(String((tab.nt[rowOf('TNK-005')] || [])[col - 1] || '')) && /Punches: 10:00 AM–3:00 PM \(5h00\)/.test(String((tab.nt[rowOf('TNK-005')] || [])[col - 1] || '')));
  t('…and old red text goes back to black', font('TNK-001') === '#000000' && font('TNK-002') === '#000000');
  const noteOf = id => String((tab.nt[rowOf(id)] || [])[col - 1] || '');
  t('…the purple cell gets a note with what the report says', /^Punch report \(daily_punch_report\.xlsx, .*hr1\)/.test(noteOf('TNK-002')) && /Punches: 9:00 AM–6:20 PM \(9h20\)/.test(noteOf('TNK-002')) && /Marked: Half Day/.test(noteOf('TNK-002')) && /Punches fit: Full Day/.test(noteOf('TNK-002')) && !noteOf('TNK-001'));
  t('…every tile has its list: fit, punched-not-marked, not on attendance', pr.fit.length === 2 && pr.fit.every(x => x.punch && x.marked) &&
    pr.unmarked.length === 1 && pr.unmarked[0].id === 'TNK-005' && pr.missing.join() === '99999');
  newRequest();
  t('…purple is waiting for HR again: Today shows it as "Mismatch"', A(`getTodayRows('${HRT}', 'Tonk')`).rows.find(r => r.id === 'TNK-002').ap === 'Mismatch');
  newRequest();
  const va = A(`verifyAllPending('${HRT}', 'Tonk')`);
  t('…"Approve all" leaves it purple and says how many are left', va.ok && va.left === 1 && bg('TNK-002') === '#b4a7d6');
  tab.v[rowOf('TNK-002')][col - 1] = 'FD';     // corrected by hand in the sheet
  newRequest(); A(`uploadPunchReport('${HRT}', ${JSON.stringify(payload)})`);
  t('…once it fits, uploading again approves it (green) and takes our note off', bg('TNK-002') === '#b7e1cd' && !noteOf('TNK-002'));
  t('…counts: checked, different, punched-but-not-marked, not on attendance; tomorrow is never touched',
    pr.compared === 3 && pr.different === 1 && pr.notMarked === 1 && pr.notOnAttendance === 1 && pr.list[0].id === 'TNK-002' && /9h20/.test(pr.list[0].punch));
  const exp = (p, fd, hd) => A(`punchExpect_('${p}', { fdHours: ${fd}, hdHours: ${hd} }).fit.join('|')`);
  t('muster codes: FD = Full, HD = Half, A = Absent, P = present', exp('FD', 7, 4) === 'Full Day' && exp('HD', 7, 4) === 'Half Day' && exp('A', 7, 4) === 'Absent' && exp('P', 7, 4) === 'Full Day|Half Day');
  {
    // a Muster Report: yesterday FD/A/WO; today's column is skipped (still changing)
    const y = new Date(d0.getTime() - 864e5), ycol = A(`dayCol_(${y.getFullYear()}, ${y.getMonth() + 1}, ${y.getDate()})`);
    if (y.getFullYear() === yr) {
      const set = (id, code, bgc) => { tab.v[rowOf(id)][ycol - 1] = code; (tab.bg[rowOf(id)] = tab.bg[rowOf(id)] || [])[ycol - 1] = bgc; };
      set('TNK-001', 'FD', '#f4c7c3'); set('TNK-002', 'FD', '#f4c7c3'); set('TNK-003', 'HD', '#f4c7c3');
      const ybg = id => String(tab.bg[rowOf(id)][ycol - 1]).toLowerCase();
      const tBefore = bg('TNK-001');
      const mp = { file: 'muster_report.xlsx', dates: [iso(y), today], rows: [
        { id: 'TNK-001', d: ['FD', 'A'] }, { id: 'TNK-002', d: ['A', 'A'] }, { id: 'TNK-003', d: ['SKIP', 'A'] }, { id: 'TNK-005', d: ['FD', 'FD'] }] };
      newRequest();
      const mr = A(`uploadPunchReport('${HRT}', ${JSON.stringify(mp)})`);
      t('muster report: same verdict = green, different = purple, WO / "-" left alone', mr.ok && ybg('TNK-001') === '#b7e1cd' && ybg('TNK-002') === '#b4a7d6' && ybg('TNK-003') === '#f4c7c3');
      t('…today\'s column of a muster report is not touched', bg('TNK-001') === tBefore && mr.skipped >= 4);
      t('…absent people are not counted as "punched, not marked"; a present one is', mr.notMarked === 1);
    }
  }
  t('rules: no punch = Absent, one punch = present, ≥7h Full, ≥4h Half, less = Half or Absent',
    exp('', 7, 4) === 'Absent' && exp('540,540,1', 7, 4) === 'Full Day|Half Day' && exp('540,960,2', 7, 4) === 'Full Day' &&
    exp('540,840,2', 7, 4) === 'Half Day' && exp('540,700,2', 7, 4) === 'Half Day|Absent');
  {
    // 17 Nov 2026: purple cells auto-marked Absent kept only "Auto-marked Absent: …" and never got the punch note
    const r3 = rowOf('TNK-003'), auto = 'Auto-marked Absent: not marked by 20:00 on 16/11/2026';
    tab.v[r3][col - 1] = 'A'; tab.bg[r3][col - 1] = '#f4c7c3'; (tab.nt[r3] = tab.nt[r3] || [])[col - 1] = auto;
    const one = p => ({ file: 'daily_punch_report.xlsx', dates: [today], rows: [{ id: 'TNK-003', d: [p] }] });
    newRequest(); A(`uploadPunchReport('${HRT}', ${JSON.stringify(one('540,1100,2'))})`);
    const n1 = noteOf('TNK-003');
    t('punch note also goes on a cell that already has a note (auto Absent), which is kept below it',
      bg('TNK-003') === '#b4a7d6' && /^Punch report \(/.test(n1) && /Marked: Absent/.test(n1) && /Punches fit: Full Day/.test(n1) && n1.endsWith('\n- - -\n' + auto));
    newRequest(); A(`uploadPunchReport('${HRT}', ${JSON.stringify(one('540,1100,2'))})`);
    t('…uploading again replaces our part, not stacking a second one', (noteOf('TNK-003').match(/Punch report/g) || []).length === 1 && noteOf('TNK-003').endsWith(auto));
    newRequest(); A(`uploadPunchReport('${HRT}', ${JSON.stringify(one(''))})`);
    t('…once it fits, only our part comes off; the earlier note stays', bg('TNK-003') === '#b7e1cd' && noteOf('TNK-003') === auto);
  }
  newRequest();
  t('a supervisor cannot upload the punch report', throws(() => A(`uploadPunchReport('${ST}', ${JSON.stringify(payload)})`), /Not authorised/));
}

/* ---------- 6e2. auto Absent at closing time ---------- */
{
  const yr = new Date().getFullYear(), d0 = new Date(), col = A(`dayCol_(${yr}, ${d0.getMonth() + 1}, ${d0.getDate()})`);
  const tonkT = book.tabs['Tonk_' + yr]._s, newaiT = book.tabs['Newai_' + yr]._s;
  const cell = (tb, id) => { const i = tb.v.findIndex(r => r[0] === id); return { v: tb.v[i][col - 1], bg: String((tb.bg[i] || [])[col - 1] || '').toLowerCase(), nt: String((tb.nt[i] || [])[col - 1] || '') }; };
  const setv = tb => tb.v.slice(2).filter(r => r[0]).forEach(r => { r[col - 1] = ''; });
  const st = book.tabs.Settings._s.v;
  const closeAll = () => { st[1][1] = '00:00'; st[2][1] = '00:00'; Object.keys(cacheMap).filter(x => /^ATT_SETTINGS|^ATT_DAY_/.test(x)).forEach(x => delete cacheMap[x]); };
  // Tonk: TNK-001 marked today, the rest not; Newai: nobody marked today
  setv(tonkT); setv(newaiT);
  tonkT.v[tonkT.v.findIndex(r => r[0] === 'TNK-001')][col - 1] = 'FD';
  Object.keys(props).filter(k => /^ATT_AUTOABS/.test(k)).forEach(k => delete props[k]);
  newRequest();
  A(`autoAbsent_()`);
  t('auto Absent: nothing happens while marking is still open', !cell(tonkT, 'TNK-002').v);
  closeAll(); newRequest();
  const done = A(`autoAbsent_()`);
  const c2 = cell(tonkT, 'TNK-002');
  t('after closing time everyone not marked is Absent, waiting for HR, with a note', c2.v === 'A' && c2.bg === '#f4c7c3' && /^Auto-marked Absent: not marked by 00:00/.test(c2.nt) && cell(tonkT, 'TNK-001').v === 'FD');
  t('…switched-off people are left alone', !cell(tonkT, 'TNK-004').v);
  t('…a site where nobody was marked is marked Absent too (no holidays)', cell(newaiT, 'NW-01').v === 'A' && cell(newaiT, 'NW-01').bg === '#f4c7c3' && done.join().indexOf('Newai') > -1);
  tonkT.v[tonkT.v.findIndex(r => r[0] === 'TNK-003')][col - 1] = '';
  newRequest(); A(`autoAbsent_()`);
  t('…only once a day', !cell(tonkT, 'TNK-003').v);
  newRequest(); A(`hrSetAttendance('${HRT}', 'Tonk', 'TNK-002', 'Full Day')`);
  t('HR changing an auto Absent takes the note off', cell(tonkT, 'TNK-002').v === 'FD' && !cell(tonkT, 'TNK-002').nt);
  // switched off for the site
  Object.keys(props).filter(k => /^ATT_AUTOABS/.test(k)).forEach(k => delete props[k]);
  st[1][7] = false; Object.keys(cacheMap).filter(x => /^ATT_SETTINGS/.test(x)).forEach(x => delete cacheMap[x]);
  newRequest(); A(`autoAbsent_()`);
  t('rule switched off for a site (Site rules): nobody is marked', !cell(tonkT, 'TNK-003').v);
  newRequest();
  t('Site rules show the switch', A(`getSettings('${HRT}')`).find(x => x.site === 'Tonk').autoAbsent === false);
  st[1][7] = ''; st[1][1] = '23:59'; st[2][1] = '23:59';
  Object.keys(cacheMap).filter(x => /^ATT_SETTINGS|^ATT_DAY_|^ATT_REC_/.test(x)).forEach(x => delete cacheMap[x]);
}

/* ---------- 6e3. one-off: past empty days -> Absent ---------- */
{
  const now = new Date(), ago = k => new Date(now.getTime() - k * 864e5);
  if (ago(3).getFullYear() === now.getFullYear()) {
    const yr = now.getFullYear(), colOf = d => A(`dayCol_(${yr}, ${d.getMonth() + 1}, ${d.getDate()})`);
    const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const tb = book.tabs['Tonk_' + yr]._s, c3 = colOf(ago(3)), c2 = colOf(ago(2)), c1 = colOf(ago(1)), c0 = colOf(now);
    const ri = id => tb.v.findIndex(r => r[0] === id);
    const put = (id, col, v, bgc, nt) => { const i = ri(id); tb.v[i][col - 1] = v; (tb.bg[i] = tb.bg[i] || [])[col - 1] = bgc || '#ffffff'; (tb.nt[i] = tb.nt[i] || [])[col - 1] = nt || ''; };
    const get = (id, col) => { const i = ri(id); return { v: tb.v[i][col - 1], bg: String((tb.bg[i] || [])[col - 1] || '').toLowerCase(), nt: String((tb.nt[i] || [])[col - 1] || '') }; };
    ['TNK-001', 'TNK-002', 'TNK-003', 'TNK-005'].forEach(id => [c3, c2, c1, c0].forEach(col => put(id, col, '')));
    put('TNK-001', c2, 'FD', '#b7e1cd');
    put('TNK-003', c2, '', '#b4a7d6', 'Punch report (x.xlsx, hr1)\nPunches: 9:00 AM–6:00 PM (9h00)\nMarked: nothing\nPunches fit: Full Day');
    put('TNK-001', c1, 'HD', '#f4c7c3'); put('TNK-002', c1, 'A', '#b7e1cd');
    const tnk4 = get('TNK-004', c2).v;
    newRequest();
    const res = A(`backfillAbsent_('${isoOf(ago(3))}')`);
    const e2 = get('TNK-002', c2), e3 = get('TNK-003', c2);
    t('fill past empty days: an empty day becomes Absent, waiting for HR, with a note', e2.v === 'A' && e2.bg === '#f4c7c3' && /^Auto-marked Absent: day left empty/.test(e2.nt) && get('TNK-005', c1).v === 'A');
    t('…an empty purple day (punched) gets A, stays purple, note says "Marked: Absent"', e3.v === 'A' && e3.bg === '#b4a7d6' && /Marked: Absent/.test(e3.nt) && /Punches: 9:00 AM/.test(e3.nt));
    t('…marks already there are kept', get('TNK-001', c2).v === 'FD' && get('TNK-001', c2).bg === '#b7e1cd' && get('TNK-002', c1).v === 'A' && get('TNK-002', c1).bg === '#b7e1cd');
    t('…a day nobody was marked is filled too (no holidays), and today is not touched', get('TNK-002', c3).v === 'A' && get('TNK-005', c3).v === 'A' && !get('TNK-002', c0).v && res.length > 0);
    t('…switched-off people are left alone', !get('TNK-004', c2).v && !tnk4);
  }
}

/* ---------- 6e4. a hand edit in the sheet shows at once ---------- */
{
  const yr = new Date().getFullYear(), m = new Date().getMonth() + 1;
  newRequest(); A(`dayRows_('Tonk')`); A(`siteMonthRows_('Tonk', ${yr}, ${m})`); A(`employeesAll_()`); A(`getSiteSetting_('Tonk')`);
  const before = Object.keys(cacheMap).filter(k => /^ATT_(DAY_Tonk|REC_Tonk|EMP$|SETTINGS$)/.test(k)).length;
  newRequest(); A(`sheetChanged({ changeType: 'EDIT' })`);
  const after = Object.keys(cacheMap).filter(k => /^ATT_(DAY_Tonk|REC_Tonk|EMP$|SETTINGS$)/.test(k)).length;
  t('a hand edit in the sheet drops the saved copies (day, month, employees, settings) at once', before >= 4 && after === 0);
  const tb = book.tabs['Tonk_' + yr]._s, col = A(`dayCol_(${yr}, ${m}, ${new Date().getDate()})`), i = tb.v.findIndex(r => r[0] === 'TNK-005');
  newRequest(); A(`dayRows_('Tonk')`);
  tb.v[i][col - 1] = 'HD';
  newRequest(); A(`sheetChanged({ changeType: 'EDIT' })`);
  newRequest();
  t('…and the next read shows the new mark', A(`dayRows_('Tonk')`).find(r => r.id === 'TNK-005').status === 'Half Day');
}

/* ---------- 6h. salary (17 Nov 2026): setup tabs, the month's pay, advances & loans, lock ---------- */
{
  const now = new Date(), yr = now.getFullYear();
  const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1), Y = lm.getFullYear(), M = lm.getMonth() + 1;
  const ym = Y + '-' + String(M).padStart(2, '0'), curYm = yr + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const D = new Date(Y, M, 0).getDate();
  if (Y === yr) {
    book.tabs['Portal Users ATTENDANCE'].appendRow(portalRow('umesh', 'Umesh Ji', 'Accounts', '', 'acc12345'));
    delete cacheMap['ggm_tab_ATTENDANCE'];
    newRequest();
    const acc = A(`loginAndLoad('umesh', 'acc12345')`);
    t('salary: the new Accounts role signs in and lands on Salary', acc.ok && acc.session.role === 'Accounts' && acc.first.view === 'salary');
    const AT = acc.session.token;
    newRequest();
    t('…Accounts does not see attendance screens', throws(() => A(`getTodayRows('${AT}', 'ALL')`), /Not authorised/));
    t('…the portal offers Accounts as a role', A(`GGM_APP.meta().roles.join()`) === 'Supervisor,HR,Accounts,Admin');
    const hrT = A(`login('hr1', 'hr123456')`).token, adT = A(`login('admin.a', 'admin123')`).token, supT = A(`login('tonk.super', 'super123')`).token;

    newRequest(); A(`salSetupOnce_()`);
    const su = book.tabs['Salary Setup']._s, rules = book.tabs['Salary Rules']._s, hol = book.tabs['Holidays']._s, led = book.tabs['Advances & Loans']._s;
    t('salary tabs are made once: Setup, Rules, Holidays, Firms, Advances & Loans', ['Salary Setup', 'Salary Rules', 'Holidays', 'Firms', 'Advances & Loans'].every(n => book.tabs[n]) &&
      book.tabs['Firms']._s.v[3][0] === 'NAKUL GOYAL HUF' && book.tabs['Firms']._s.v[13][0] === 'GMPL');
    const sRow = id => su.v.findIndex(r => r[0] === id);
    t('…Setup has a row for every Employee ID with name, site and active filled in', sRow('TNK-001') >= 3 && su.v[sRow('TNK-001')][1] === 'Ramesh Kumar' && su.v[sRow('TNK-001')][2] === 'Tonk' && su.v[sRow('TNK-004')][4] === 'No');
    t('…the group rules are seeded (Ladies ₹350 a day, Jaipur Sundays paid)', rules.v.some(r => r[1] === 'Ladies' && r[3] === 350) && rules.v.some(r => r[0] === 'Jaipur' && r[5] === 'Yes'));

    // pay rules: TNK-001 monthly D×1000 (₹1000 a day), TNK-002 daily 500 + 2 paid absents + Sundays, TNK-003 nothing (held),
    // NW-01 from a site rule (daily 400), NW-02 fixed 9000
    const setSu = (id, vals) => vals.forEach((v, j) => { if (v !== undefined) su.v[sRow(id)][5 + j] = v; });
    setSu('TNK-001', ['Monthly', D * 1000, '', '', '', 'NAKUL GOYAL HUF', 'Bank', 'RAMESH KUMAR', '1234567890', 'SBIN0000001']);
    setSu('TNK-002', ['Daily', 500, 2, 'Yes', '', 'GMPL', 'Cash']);
    setSu('NW-02', ['Fixed', 9000, '', '', '', '', 'Cash']);
    rules.v.push(['Newai', '', 'Daily', 400, '', '', '', 'Cash', 'test']);
    hol.v.push([new Date(Y, M - 1, 5), 'Test festival', '', '', '', '']);
    hol.v.push([new Date(Y, M - 1, 6), 'Newai only', 'Newai', '', '', '']);
    // attendance last month
    A(`ensureYearSheet_(ss_(), 'Newai', ${yr})`);
    const tabOf = s => book.tabs[s + '_' + yr]._s, c0 = A(`dayCol_(${Y}, ${M}, 1)`);
    const mark = (site, id, from, to, code, bg) => { const tb = tabOf(site), r = tb.v.findIndex(x => x[0] === id); for (let d = from; d <= to; d++) { tb.v[r][c0 + d - 2] = code; (tb.bg[r] = tb.bg[r] || [])[c0 + d - 2] = bg || '#b7e1cd'; } };
    for (let d = 1; d <= D; d++) ['TNK-001', 'TNK-002', 'TNK-003', 'TNK-005'].forEach(id => mark('Tonk', id, d, d, '', '#ffffff'));
    mark('Tonk', 'TNK-001', 1, 10, 'FD'); mark('Tonk', 'TNK-001', 11, 12, 'HD'); mark('Tonk', 'TNK-001', 13, D, 'A');
    mark('Tonk', 'TNK-002', 1, 4, 'FD'); mark('Tonk', 'TNK-002', 5, D, 'A', '#f4c7c3');
    mark('Tonk', 'TNK-003', 1, D, 'FD');
    mark('Newai', 'NW-01', 1, 3, 'FD'); mark('Newai', 'NW-01', 4, D, 'A');
    mark('Newai', 'NW-02', 1, 1, 'FD'); mark('Newai', 'NW-02', 2, D, 'A');

    // advances: given in the app by Accounts and HR
    newRequest();
    let ad = A(`addAdvance('${AT}', { id: 'TNK-001', type: 'Advance', amount: 3000, date: '${ym}-03', months: 1, from: '${ym}', note: 'festival' })`);
    t('advance: Accounts gives a cash advance in the app; it goes into the ledger with "still due"', ad.ok && ad.added && ad.entries.length === 1 && ad.entries[0].no === 'A-0001' && ad.entries[0].due === 3000 && led.v[3][5] === 'Advance' && led.v[3][8] === lm.toLocaleString('en-GB', { month: 'short' }).slice(0, 3) + ' ' + Y);
    newRequest(); ad = A(`addAdvance('${hrT}', { id: 'TNK-002', type: 'Loan', amount: 5000, date: '${ym}-02', months: 2, from: '${ym}' })`);
    newRequest(); ad = A(`addAdvance('${hrT}', { id: 'NW-02', type: 'Bonus', amount: 700, date: '${ym}-20', months: 1, from: '${ym}' })`);
    newRequest(); const ad4 = A(`addAdvance('${hrT}', { id: 'TNK-005', type: 'Petrol', amount: 400, date: '${ym}-20', months: 1, from: '${curYm}' })`);
    t('…HR can enter too: a loan split over 2 months, a bonus, a petrol advance', ad.ok && ad4.ok && ad4.entries.length === 4);
    newRequest();
    t('…bad entries are refused (no amount, unknown ID, half rupees, no type)',
      !A(`addAdvance('${AT}', { id: 'TNK-001', type: 'Advance', amount: 0, from: '${ym}' })`).ok && !A(`addAdvance('${AT}', { id: 'XX-9', type: 'Advance', amount: 10, from: '${ym}' })`).ok &&
      !A(`addAdvance('${AT}', { id: 'TNK-001', type: 'Advance', amount: 10.5, from: '${ym}' })`).ok && !A(`addAdvance('${AT}', { id: 'TNK-001', type: 'Gift', amount: 10, from: '${ym}' })`).ok);
    t('…a supervisor cannot see or give advances', throws(() => A(`advancesData('${supT}')`), /Not authorised/));

    // make last month
    newRequest();
    const mk = A(`makeSalary('${AT}', '${ym}')`);
    const row = id => mk.rows.filter(r => r.id === id)[0];
    const sundays = Array.from({ length: D }, (_, i) => new Date(Y, M - 1, i + 1).getDay() === 0 ? i + 1 : 0).filter(Boolean);
    const r1 = row('TNK-001'), r2 = row('TNK-002'), r3 = row('TNK-003'), n1 = row('NW-01'), n2 = row('NW-02');
    t('make: present = full + ½ half, + festival → payable; monthly = basic ÷ days in month × payable (no rounding)',
      mk.ok && r1.p === 11 && r1.fe === 1 && r1.su === 0 && r1.pa === 0 && r1.pd === 12 && r1.g === 12000 && r1.r === 1000);
    t('…the advance is recovered in full from that salary: net = gross − advance', r1.ad === 3000 && r1.net === 9000 && r1.f === 'NAKUL GOYAL HUF' && r1.mo === 'Bank');
    const fe2 = sundays.indexOf(5) > -1 ? 0 : 1, pd2 = 4 + sundays.length + fe2 + 2;
    t('…daily pay: (present + paid Sundays + festival + 2 paid absents) × rate; a festival on a paid Sunday counts once',
      r2.su === sundays.length && r2.fe === fe2 && r2.pa === 2 && r2.pd === pd2 && r2.g === 500 * pd2);
    t('…a loan over 2 months takes half this month', r2.lo === 2500 && r2.net === 500 * pd2 - 2500);
    t('…no basic pay anywhere → held at ₹0, listed under problems', r3.held && r3.net === 0 && mk.problems.some(p => p.k === 'noBasic' && p.ids.indexOf('TNK-003') > -1));
    t('…a site rule gives the pay type and rate (Newai daily ₹400) and a Newai-only holiday', n1.pt === 'Daily' && n1.b === 400 && n1.fe === 2 && n1.pd === 5 && n1.g === 2000);
    t('…fixed pay is the basic whatever the days, plus the bonus', n2.g === 9000 && n2.bo === 700 && n2.net === 9700);
    t('…switched-off people with no days are left out; HR-unapproved days are noted', !row('TNK-004') && mk.problems.some(p => p.k === 'pending' && p.ids.indexOf('TNK-002') > -1));
    t('…totals add up (held rows not counted)', mk.totals.people === mk.rows.filter(r => !r.held).length && mk.totals.net === mk.rows.reduce((s, r) => s + r.net, 0) &&
      mk.totals.bank === r1.net && mk.byFirm.some(f => f.k === 'GMPL' && f.cash === r2.net));
    const tab = book.tabs['Salary ' + lm.toLocaleString('en-GB', { month: 'short' }).slice(0, 3) + ' ' + Y];
    t('…the month gets its own tab: header row, one row each, a TOTAL row', !!tab && tab._s.v[4][0] === 'Emp ID' && tab._s.v[4][21] === 'Net pay ₹' &&
      tab._s.v.some(r => r[0] === 'TOTAL') && /DRAFT/.test(tab._s.v[0][5]));
    t('…the "How it was worked out" column explains each person', /Present 11 \(10 full \+ 2 half\) \+ festivals 1 = 12 days/.test(r1.how) && /net ₹9,000/.test(r1.how));
    newRequest();
    const home = A(`salaryHome('${AT}', '${ym}')`);
    t('…reading it back: draft, every row, Accounts may lock (the month is over)', home.state === 'draft' && home.rows.length === mk.rows.length && home.canLock && home.rows.filter(r => r.id === 'TNK-001')[0].net === 9000);
    newRequest();
    t('…HR may make it but not lock it; a supervisor may not even look', A(`salaryHome('${hrT}', '${ym}')`).canLock === false && throws(() => A(`lockSalary('${hrT}', '${ym}')`), /Not authorised/) &&
      throws(() => A(`salaryHome('${supT}', '${ym}')`), /Not authorised/));

    // lock: purple blocks, changes force a re-check, then recoveries go into the ledger
    const tb = tabOf('Tonk'), rr = tb.v.findIndex(x => x[0] === 'TNK-001');
    tb.bg[rr][c0 + 12] = '#b4a7d6';
    newRequest();
    const l1 = A(`lockSalary('${AT}', '${ym}')`);
    t('lock: refused while a day is purple (punches don\'t match)', !l1.ok && /purple/.test(l1.error));
    tb.bg[rr][c0 + 12] = '#b7e1cd';
    tb.v[rr][c0 + 12] = 'FD';   // HR corrected day 13 → pay changes
    newRequest();
    const l2 = A(`lockSalary('${AT}', '${ym}')`);
    t('…refused when attendance changed since it was made — made again for a fresh look', !l2.ok && l2.changed && /made again/.test(l2.error));
    newRequest();
    const l3 = A(`lockSalary('${AT}', '${ym}')`);
    const recs = led.v.filter(r => r[5] === 'Recovered' || r[5] === 'Paid out');
    t('…then it locks: recoveries and the paid bonus are written into the ledger against their entries', l3.ok && l3.state === 'locked' && recs.length === 3 &&
      recs.some(r => r[10] === 'A-0001' && r[6] === 3000) && recs.some(r => r[10] === 'A-0002' && r[6] === 2500) && recs.some(r => r[5] === 'Paid out' && r[6] === 700));
    newRequest();
    const adv2 = A(`advancesData('${AT}')`), e = no => adv2.entries.filter(x => x.no === no)[0];
    t('…still due: advance cleared, loan half left, bonus paid', e('A-0001').due === 0 && e('A-0002').due === 2500 && e('A-0003').due === 0 && led.v[4][9] === 2500);
    newRequest();
    t('…a locked month cannot be made again, nor have new advances start in it',
      !A(`makeSalary('${AT}', '${ym}')`).ok && /locked/.test(A(`addAdvance('${AT}', { id: 'TNK-001', type: 'Advance', amount: 100, from: '${ym}' })`).error));
    newRequest();
    t('…an entry with recoveries cannot be deleted; a fresh one can', !A(`deleteAdvance('${AT}', 'A-0001')`).ok && A(`deleteAdvance('${hrT}', 'A-0004')`).ok);

    // this month: the second loan instalment
    newRequest();
    const cur = A(`makeSalary('${hrT}', '${curYm}')`), c2 = cur.rows.filter(r => r.id === 'TNK-002')[0];
    t('next month: the loan\'s second half is due (never more than the salary)', cur.ok && c2.lo === Math.min(2500, c2.g) && !cur.canLock);
    newRequest();
    t('unlock: only an Admin, and only the newest locked month', throws(() => A(`unlockSalary('${AT}', '${ym}')`), /Not authorised/) && A(`unlockSalary('${adT}', '${ym}')`).ok);
    t('…the recoveries of that month come out of the ledger again', !led.v.some(r => r[5] === 'Recovered' || r[5] === 'Paid out') && A(`advancesData('${AT}')`).entries.filter(x => x.no === 'A-0001')[0].due === 3000);

    // one ID for two different people → held
    book.tabs['Employees'].appendRow(['TNK-001', 'Someone Else', 'Newai', '', '', true]);
    A(`dropEmployees_()`);
    newRequest();
    const two = A(`makeSalary('${AT}', '${ym}')`), tr = two.rows.filter(r => r.id === 'TNK-001')[0];
    t('an ID used by two different people is held, not paid', tr.held && /two different people/.test(tr.ck) && two.problems.some(p => p.k === 'two'));
    book.tabs['Employees']._s.v.pop(); A(`dropEmployees_()`);

    // one-time import from the old salary workbook (here: tabs with the old names in the same fake book)
    fill('MASTER SHEET', [['EMP. CODE'], ['NW-01', '0', 'NEWAI', 'Apr-25', '', 'Allow', 'Kamla', '', '', '', 'KAMLA DEVI', 'BANK', '001234567890123456', 'SBIN0000002', 'BIJENDER KUMAR GOYAL HUF', '15,000'],
      ['TNK-001', '0', 'TONK', '', '', 'Allow', 'x', '', '', '', 'X', 'BANK', '1', '1', 'GMPL', '99999']]);
    fill('LABOUR SHEET', [[], [], [], [], ['TNK-005', 'TONK', '1', 'x', 'Ladies Labour', 'Ladies', 'CASH', '350', 'PD']]);
    newRequest();
    const imp = A(`salImportOld_(ss_(), ss_())`), sv = id => su.v[sRow(id)];
    t('import from the old sheet: empty rows get pay, firm (spelling fixed), Bank and the account no. as text',
      imp === 2 && sv('NW-01')[5] === 'Monthly' && sv('NW-01')[6] === 15000 && sv('NW-01')[10] === 'BIJENDRA KUMAR GOYAL HUF' && sv('NW-01')[11] === 'Bank' &&
      sv('NW-01')[13] === '001234567890123456' && /paid absents by slab/.test(sv('NW-01')[15]));
    t('…labour gets its daily rate when no group rule gives it; rows already filled are never overwritten',
      sv('TNK-005')[5] === 'Daily' && sv('TNK-005')[6] === 350 && sv('TNK-001')[6] === D * 1000);
  }
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
{
  const pv = vm.createContext({});
  const src = n => { const i = page.indexOf('function ' + n + '('); let d = 0, j = page.indexOf('{', i); for (; j < page.length; j++) { if (page[j] === '{') d++; else if (page[j] === '}' && --d === 0) break; } return page.slice(i, j + 1); };
  vm.runInContext(src('punchOf'), pv);
  const po = c => vm.runInContext('punchOf(' + JSON.stringify(c) + ')', pv);
  t('punch file: day shift read as first / last punch', po('09:20 AM\n06:00 PM') === '560,1080,2' && po('08:47 AM\n08:52 AM\n09:34 AM\n04:37 PM') === '527,997,4');
  t('punch file: a night shift over midnight is its real length (9 PM to 2 AM = 5h)', po('09:00 PM\n02:00 AM') === '1260,1560,2');
  t('punch file: muster codes and week off', po('FD') === 'FD' && po(' hd ') === 'HD' && po('WO') === 'SKIP' && po('-') === 'SKIP' && po('') === '');
}
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
