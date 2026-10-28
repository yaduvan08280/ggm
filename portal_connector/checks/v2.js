// v2 login: the hub's "Portal Users <APP>" rows and the app's GgmLogin.js must agree on
// password hashes, row signatures and tokens; removed / edited rows must stop working.
const vm = require('vm'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const toSigned = buf => Array.from(buf).map(b => b > 127 ? b - 256 : b);
const toBuf = x => Buffer.isBuffer(x) ? x : typeof x === 'string' ? Buffer.from(x, 'utf8') : Buffer.from(x.map(b => b & 255));
const Utilities = {
  Charset: { UTF_8: 'utf8' }, DigestAlgorithm: { MD5: 'md5' },
  base64EncodeWebSafe: x => toBuf(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
  base64DecodeWebSafe: s => toSigned(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
  computeHmacSha256Signature: (v, k) => toSigned(crypto.createHmac('sha256', toBuf(k)).update(toBuf(v)).digest()),
  computeDigest: (a, v) => toSigned(crypto.createHash('md5').update(toBuf(v)).digest()),
  newBlob: x => ({ getDataAsString: () => toBuf(x).toString('utf8'), getBytes: () => toSigned(toBuf(x)) }),
  getUuid: () => crypto.randomUUID(),
  formatDate: () => '07/10/2026 12:00'
};
const PEPPER = 'pepper-' + crypto.randomBytes(8).toString('hex');
const mkProps = o => ({ getScriptProperties: () => ({ getProperty: k => o[k] || null, getProperties: () => Object.assign({}, o),
  setProperty: (k, v) => { o[k] = v; }, deleteProperty: k => { delete o[k]; } }) });
const mkCache = () => { const m = {}; return { getScriptCache: () => ({ get: k => m[k] || null, put: (k, v) => { m[k] = v; }, remove: k => { delete m[k]; }, getAll: () => ({}), removeAll: () => {} }), _m: m }; };

// ---- a fake spreadsheet tab, enough for writeAppTab_ / ggmRows_
function fakeSheet() {
  const sh = { grid: [], protections: 0, hidden: [], maxRows: 1000, maxCols: 26, notes: 0,
    getLastRow() { let n = 0; this.grid.forEach((r, i) => { if (r.some(v => v !== '')) n = i + 1; }); return n; },
    getMaxRows() { return this.maxRows; }, getMaxColumns() { return this.maxCols; },
    insertRowsAfter(a, n) { this.maxRows += n; }, insertColumnsAfter(a, n) { this.maxCols += n; },
    getRange(r, c, nr, nc) { const s = this; nr = nr || 1; nc = nc || 1; return {
      setNumberFormat() { return this; }, setFontWeight() { return this; }, setBackground() { return this; }, setNote() { s.notes++; return this; },
      setValues(v) { v.forEach((row, i) => { s.grid[r - 1 + i] = s.grid[r - 1 + i] || []; row.forEach((x, j) => { s.grid[r - 1 + i][c - 1 + j] = String(x); }); }); },
      getDisplayValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(((s.grid[r - 1 + i] || [])[c - 1 + j]) || ''); out.push(row); } return out; }
    }; },
    setFrozenRows() {}, hideColumns(c, n) { this.hidden.push([c, n || 1]); },
    getProtections() { return this.protections ? [1] : []; },
    protect() { const s = this; s.protections++; const p = { setDescription: () => p, addEditor: () => p, getEditors: () => [], removeEditors: () => p, canDomainEdit: () => true, setDomainEdit: () => p }; return p; }
  };
  return sh;
}
const book = { tabs: {}, getSheetByName(n) { return this.tabs[n] || null; }, insertSheet(n) { return (this.tabs[n] = fakeSheet()); } };
const SpreadsheetApp = { openById: () => book, getActiveSpreadsheet: () => book, ProtectionType: { SHEET: 'SHEET' } };
const Session = { getScriptTimeZone: () => 'Asia/Kolkata', getEffectiveUser: () => ({}) };

// ---- hub
const hubProps = { PEPPER, HUB_SECRET: 'hubsecret' };
const hub = vm.createContext({ Utilities, PropertiesService: mkProps(hubProps), CacheService: mkCache(), SpreadsheetApp, Session, console, JSON, Math, Date, String, Number, Object, Array });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'main hub app', 'Code.js'), 'utf8'), hub);
const H = c => vm.runInContext(c, hub);
H(`getLocalLogin_ = () => ({}); log_ = () => {};`);

// ---- app (Task Delegation's GgmLogin.js; the copy must equal the master)
const appCache = mkCache();
const app = vm.createContext({ Utilities, PropertiesService: mkProps({ PORTAL_KEY: PEPPER }), CacheService: appCache, SpreadsheetApp, Session,
  ContentService: { createTextOutput: s => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
  HtmlService: { createHtmlOutput: h => ({ h }) }, console, JSON, Math, Date, String, Number, Object, Array });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'portal_connector', 'GgmLogin.js'), 'utf8'), app);
const A = c => vm.runInContext(c, app);
A(`var GGM_APP = { id: 'DELEGATION', name: 'Task Delegation', hub: 'https://hub', counts: list => { const o = {}; list.forEach(x => o[x.u] = 4); return o; } };`);
const reset = () => { A(`GGM_MEMO_ = {}`); Object.keys(appCache._m).forEach(k => delete appCache._m[k]); };

let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(String(e.message || e)); } };

t('GgmLogin.js copy in task delegation = master', fs.readFileSync(path.join(ROOT, 'task delegation', 'GgmLogin.js'), 'utf8') === fs.readFileSync(path.join(ROOT, 'portal_connector', 'GgmLogin.js'), 'utf8'));
t('Task Delegation app id = hub Apps row', /id: 'DELEGATION'/.test(fs.readFileSync(path.join(ROOT, 'task delegation', 'PortalApp.js'), 'utf8')) && H(`DEFAULT_APPS.some(r => r[0] === 'DELEGATION' && r[A.SHEET])`));
t('same password hash in hub and app', H(`hashPassword_('pass ₹1', 'salt9')`) === A(`ggmHash_('pass ₹1', 'salt9')`));

// ---- plan + write
H(`var APP = { id: 'DELEGATION', fields: [], matchBy: 'username', sheetId: 'X', active: true };
   var U1 = { username: 'Ramesh.K', name: 'Ramesh Kumar — ₹', phone: '9829012345', email: 'r@ggm.com', active: true, salt: '12e45', hash: hashPassword_('secret1', '12e45') };
   var U2 = { username: 'mohan', name: 'Mohan', phone: '', email: '', active: false, salt: 's', hash: hashPassword_('x', 's') };
   var U3 = { username: 'nobody', name: 'No Tick', phone: '', email: '', active: true, salt: 's', hash: 'h' };
   var U4 = { username: 'newbie', name: 'New', phone: '', email: '', active: true, salt: '', hash: '' };
   var ACC = { 'ramesh.k': { DELEGATION: { on: true } }, mohan: { DELEGATION: { on: true } }, newbie: { DELEGATION: { on: true } } };
   var PLAN = directPlan_(APP, [U1, U2, U3, U4], ACC, {});`);
t('plan: only active + ticked people get a row', H(`PLAN.rows.map(r => r[0]).join() === 'Ramesh.K,newbie'`));
t('plan: switched-off person listed in Sync as not in the app', H(`PLAN.status.some(l => l[0] === 'mohan' && l[4] === 'OK' && /switched off/.test(l[5]))`));
t('plan: no password yet is said', H(`PLAN.status.some(l => l[0] === 'newbie' && /no password/.test(l[5]))`));
t('plan: a username used twice in Users blocks both rows', H(`var D1 = Object.assign({}, U1, { name: 'Other' }); var P3 = directPlan_(APP, [U1, D1], ACC, {}); !P3.rows.length && P3.status.every(l => l[4] === 'BLOCKED' && /2 rows/.test(l[5]))`));
t('plan: missing role blocks the row', H(`var P2 = directPlan_(Object.assign({}, APP, { fields: ['role'] }), [U1], ACC, {}); !P2.rows.length && P2.status[0][4] === 'BLOCKED'`));
H(`writeAppTab_(APP, PLAN.rows)`);
const tab = book.tabs['Portal Users DELEGATION'];
t('tab created with header, protected, hash/salt/check hidden', tab && tab.grid[0][0] === 'Username' && tab.grid[0][10] === 'Check' && tab.protections === 1 && tab.hidden.length === 2);
t('salt "12e45" kept as text (not a number)', tab.grid[1][8] === '12e45');

// ---- app side
reset();
const login = A(`ggmLogin('ramesh.k', 'secret1')`);
t('login with username (any case)', login && login.user.username === 'Ramesh.K' && login.user.name === 'Ramesh Kumar — ₹');
reset();
t('login with phone in any format', A(`ggmLogin('+91 98290 12345', 'secret1').user.username`) === 'Ramesh.K');
reset();
t('login with email', A(`ggmLogin('R@GGM.com', 'secret1').user.username`) === 'Ramesh.K');
t('wrong password refused', throws(() => A(`ggmLogin('ramesh.k', 'nope')`), /wrong/));
t('person without a password told to set one', throws(() => A(`ggmLogin('newbie', 'x')`), /No password/));
t('person not ticked refused like a wrong password', throws(() => A(`ggmLogin('nobody', 'h')`), /wrong/));
A(`for (var i = 0; i < 5; i++) { try { ggmLogin('lockme', 'x'); } catch (e) {} }`);
t('locked after 5 wrong tries', throws(() => A(`ggmLogin('lockme', 'x')`), /Too many/));
reset();
app.TOKEN = login.token;
t('token accepted while the person is in the tab', A(`ggmUser_(TOKEN).username`) === 'Ramesh.K');
t('ggmMe returns only public fields', A(`JSON.stringify(Object.keys(ggmMe(TOKEN)))`) === '["username","name","role","site","doer"]');

// hand edit: role typed into the tab → row ignored
const saved = tab.grid[1].slice();
tab.grid[1][4] = 'ADMIN'; reset();
t('row edited by hand stops working', throws(() => A(`ggmUser_(TOKEN)`), /SESSION_EXPIRED/));
tab.grid[1] = saved; reset();

// a token for another app, or forged
t('token of another app refused', throws(() => A(`ggmUser_(ggmSign_({ t: 's', a: 'STAFF', u: 'Ramesh.K', pv: ggmRows_()['ramesh.k'].hash.slice(0, 12), exp: ggmNow_() + 60 }))`), /SESSION_EXPIRED/));
t('garbage token refused', throws(() => A(`ggmUser_('abc.def')`), /SESSION_EXPIRED/));

// untick: hub rewrites without Ramesh → old token dead, row cleared, Updated kept for others
H(`ACC['ramesh.k'].DELEGATION.on = false; writeAppTab_(APP, directPlan_(APP, [U1, U2, U3, U4], ACC, {}).rows);`); reset();
t('untick removes the row (leftover cleared)', tab.grid[1][0] === 'newbie' && tab.grid[2].every(v => v === ''));
t('unticked person is signed out at once', throws(() => A(`ggmUser_(TOKEN)`), /SESSION_EXPIRED/));
H(`ACC['ramesh.k'].DELEGATION.on = true; writeAppTab_(APP, directPlan_(APP, [U1, U2, U3, U4], ACC, {}).rows);`); reset();
t('ticked again: same token works again', A(`ggmUser_(TOKEN).username`) === 'Ramesh.K');
// password change in the hub → old token dead
H(`U1.salt = 'newsalt'; U1.hash = hashPassword_('secret2', 'newsalt'); writeAppTab_(APP, directPlan_(APP, [U1, U2, U3, U4], ACC, {}).rows);`); reset();
t('password changed in the hub: old sign-in ends', throws(() => A(`ggmUser_(TOKEN)`), /SESSION_EXPIRED/));
t('password changed in the hub: new one works in the app', A(`ggmLogin('ramesh.k', 'secret2').user.username`) === 'Ramesh.K');

// launch pass from a portal tile
reset();
const pass = H(`signToken_(Object.assign(claimsFor_({ username: 'Ramesh.K', name: 'R', email: '', phone: '' }, { id: 'DELEGATION', matchBy: 'username' }, {}), { t: 'l', a: 'DELEGATION', j: 'J1', exp: now_() + 90 }), appKey_({ id: 'DELEGATION', sheetId: 'X' }))`);
app.PASS = pass;
const g1 = A(`ggmGate_({ parameter: { pt: PASS } })`);
t('portal tile pass signs the person in', g1.boot && g1.boot.user.username === 'Ramesh.K' && A(`ggmUser_(${JSON.stringify(g1.boot.token)}).username`) === 'Ramesh.K');
t('same pass reloading gives the same sign-in', A(`ggmGate_({ parameter: { pt: PASS } }).boot.token`) === g1.boot.token);
app.PASS2 = H(`signToken_({ t: 'l', a: 'STAFF', u: 'Ramesh.K', j: 'J2', exp: now_() + 90 }, pepper_())`);
t('pass for another app ignored', A(`ggmGate_({ parameter: { pt: PASS2 } }).boot`) === null);
app.PASS3 = H(`signToken_({ t: 'l', a: 'DELEGATION', u: 'nobody', j: 'J3', exp: now_() + 90 }, pepper_())`);
t('pass for someone not in the tab explains why', /not in this app/.test(A(`ggmGate_({ parameter: { pt: PASS3 } }).error`)));

// hub → app request (badges)
const req = H(`JSON.parse(appRequest_({ id: 'DELEGATION', url: 'https://app/exec', sheetId: 'X' }, 'counts', { users: [{ u: 'Ramesh.K' }] }).payload)`);
app.REQ = JSON.stringify(req);
const res = JSON.parse(A(`ggmHandlePost_({ parameter: { portal: '1' }, postData: { contents: REQ } }).s`));
t('hub badge request answered', res.ok && res.data['Ramesh.K'] === 4);
t('same request replayed is refused', !JSON.parse(A(`ggmHandlePost_({ parameter: { portal: '1' }, postData: { contents: REQ } }).s`)).ok);
t('not a portal request: left to the app', A(`ggmHandlePost_({ parameter: {} })`) === null);

// ---- Sync tab merge keeps v1 lines
const syncRows = [TABS_SYNC = ['Username', 'App', 'Local ID', 'Wanted', 'Status', 'Message', 'Last Sync', 'Hash'],
  ['ramesh.k', 'INDENT', 'ramesh.k', 'STORE', 'OK', 'ok', 'D1', 'h'],
  ['Ramesh.K', 'DELEGATION', 'Ramesh.K', 'active', 'OK', 'in Portal Users DELEGATION', 'D0', ''],
  ['gone', 'DELEGATION', 'gone', 'active', 'OK', 'x', 'D0', '']];
hub.SYNCROWS = syncRows; hub.WROTE = null;
H(`sheet_ = () => ({ getDataRange: () => ({ getValues: () => SYNCROWS.map(r => r.slice()) }), getRange: () => ({ setValues: v => { WROTE = v; } }) }); writeAccessStatus_ = () => {};
   mergeSyncRows_({ DELEGATION: [['Ramesh.K', 'DELEGATION', 'Ramesh.K', 'active', 'OK', 'in Portal Users DELEGATION', '', '']] });`);
const W = hub.WROTE;
t('sync merge: v1 line kept, unticked v2 line dropped, padded', W && W.length === 3 && W.some(r => r[1] === 'INDENT') && !W.some(r => r[0] === 'gone') && W[2].every(v => v === ''));
t('sync merge: unchanged line keeps its old time', W.some(r => r[1] === 'DELEGATION' && r[6] === 'D0'));

// ---- page side: PORTAL.run adds the token; an ended sign-in shows the card
const src = A(`GGM_CLIENT_`);
const js = src.slice(src.indexOf('<script>') + 8, src.lastIndexOf('</script>'));
const els = {};
const mkEl = id => (els[id] = els[id] || { id, className: '', textContent: '', value: '', disabled: false, style: {}, href: '',
  focus() {}, addEventListener() {}, querySelector: () => mkEl('h1'), appendChild() {},
  set innerHTML(h) { (h.match(/id="([^"]+)"/g) || []).forEach(m => mkEl(m.slice(4, -1))); } });
const calls = [];
const runner = (succ, fail) => new Proxy({}, { get: (t2, k) => k === 'withSuccessHandler' ? f => runner(f, fail) : k === 'withFailureHandler' ? f => runner(succ, f) : k === 'withUserObject' ? () => runner(succ, fail)
  : (...a) => { calls.push({ k, a, succ, fail }); } });
const store = {};
const page = vm.createContext({ console, JSON, String, Proxy, Object, setTimeout: f => f(), alert: () => {},
  localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } },
  document: { readyState: 'complete', getElementById: id => els[id] || null, createElement: () => mkEl('ggm-login'), body: { appendChild() {} } },
  google: { script: { run: runner() } },
  window: { PORTAL_CFG: { app: 'DELEGATION', name: 'Task Delegation', hub: 'https://hub', boot: { token: 'TOK1', user: { username: 'Ramesh.K', name: 'R' } }, error: '' } } });
vm.runInContext('var window = this.window; ' + js.replace(/window\.PORTAL=/, 'window.PORTAL=') , page);
const P = page.window.PORTAL;
let readyUser = null; P.ready(u => { readyUser = u; });
t('page: signed in from the tile pass, ready() runs', readyUser && readyUser.username === 'Ramesh.K' && store.ggm_DELEGATION_token === 'TOK1');
P.run.withSuccessHandler(() => {}).getAllDoers('x');
const c1 = calls.pop();
t('page: PORTAL.run puts the token first', c1.k === 'getAllDoers' && c1.a[0] === 'TOK1' && c1.a[1] === 'x');
c1.fail({ message: 'SESSION_EXPIRED' });
t('page: ended sign-in shows the card and forgets the token', els['ggm-login'].className === 'on' && !store.ggm_DELEGATION_token);
let pageFail = null;
P.token = 'TOK2'; P.run.withFailureHandler(e => { pageFail = e; }).addNew({ a: 1 });
calls.pop().fail({ message: 'Add New Error: x' });
t('page: other errors still reach the page handler', pageFail && pageFail.message === 'Add New Error: x');

console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
