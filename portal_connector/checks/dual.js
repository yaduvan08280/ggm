// While Portal-only is OFF an app accepts BOTH the portal login and its own old login;
// switching Portal-only ON ends the old ones.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(String(e.message || e)); } };

// ---- Portal.js session rules
const props = { PORTAL_SECRET: 's', PORTAL_EPOCH: '3' };
const cache = {};
const ctx = vm.createContext({ console, JSON, Math, Date, String, Number, Object, Array,
  PropertiesService: { getScriptProperties: () => ({ getProperties: () => Object.assign({}, props), getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
  CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
  Utilities: { getUuid: () => Math.random().toString(16).slice(2) + '-' + Math.random().toString(16).slice(2) } });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'portal_connector', 'Portal.js'), 'utf8'), ctx);
const R = c => vm.runInContext(c, ctx);
const reset = () => R('PORTAL_P_ = null');
reset();
const legacy = R(`portalNewSession_({ u: '9829012345', n: 'Ramesh' }, 'legacy')`);
const direct = R(`portalNewSession_({ u: 'ramesh' }, 'direct')`);
const viaTile = R(`portalNewSession_({ u: 'ramesh' }, 'portal')`);
t('switch OFF: an old-login session works', R(`portalCheck_('${legacy}').n`) === 'Ramesh');
t('switch OFF: own-link portal session works', R(`portalCheck_('${direct}').u`) === 'ramesh');
props.PORTAL_ONLY = 'true'; props.PORTAL_EPOCH = '4'; reset();      // what the hub's switch does
t('switch ON: old-login session ends', throws(() => R(`portalCheck_('${legacy}')`), /SESSION_EXPIRED/));
t('switch ON: own-link session ends', throws(() => R(`portalCheck_('${direct}')`), /SESSION_EXPIRED/));
t('switch ON: tile session still works', R(`portalCheck_('${viaTile}').u`) === 'ramesh');
props.PORTAL_ONLY = 'false'; reset();
const legacy2 = R(`portalNewSession_({ u: 'x' }, 'legacy')`);
t('switch OFF again: a NEW old login works', R(`portalCheck_('${legacy2}').u`) === 'x');
t('…but the session from before the switch stays ended', throws(() => R(`portalCheck_('${legacy}')`), /SESSION_EXPIRED/));

// ---- an app's login order (Indent Flow 03_Auth.js)
const ictx = vm.createContext({ console, JSON, Math, Date, String, Number, Object, Array });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'indent_flow', '03_Auth.js'), 'utf8'), ictx);
const I = c => vm.runInContext(c, ictx);
ictx.ST = { enabled: true, only: false, portalOk: false };
I(`
  portalEnabled_ = () => ST.enabled; portalOnly_ = () => ST.only;
  portalRemoteLogin_ = (id, pw) => { if (ST.portalOk) return { token: 'D-x', via: 'portal' }; throw new Error('Username or password is wrong.'); };
  pinLogin_ = (id, pin) => { if (id === 'VINOD' && pin === '1234') return { token: 'old', via: 'pin' }; throw new Error('Invalid User ID or PIN.'); };
`);
ictx.ST.portalOk = true;
t('portal password works', I(`login_('vinod', 'pw').via`) === 'portal');
ictx.ST.portalOk = false;
t('switch OFF: old User ID + PIN works when the portal says no', I(`login_('VINOD', '1234').via`) === 'pin');
t('both wrong: one clear message', throws(() => I(`login_('VINOD', 'nope')`), /User ID or password \/ PIN is wrong/));
ictx.ST.only = true;
t('switch ON: old PIN refused', throws(() => I(`login_('VINOD', '1234')`), /Username or password is wrong/));

// ---- every connected app's login tries the portal first and keeps its old login while the switch is OFF
const logins = { 'indent_flow/03_Auth.js': 'pinLogin_', 'fuel_and_car_tasks/Auth.js': 'emailLogin_', 'assets/Code.js': 'siteLogin_',
  'Staff_dashboard/Code.js': 'mobileLogin_', 'newai_checklist/Code.js': 'mobileLogin_', 'tonk_checklist/Code.js': 'mobileLogin_', 'jaipur_checklist/Code.js': 'mobileLogin_' };
Object.keys(logins).forEach(f => {
  const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
  t(f + ': portal first, old login kept while OFF', /if \(portalOnly_\(\)\) (throw e|return)/.test(s) && s.indexOf('function ' + logins[f] + '(') > -1);
});
['tonk_checklist/Code.js', 'jaipur_checklist/Code.js'].forEach(f => {
  t(f + ': shared "Main" login stays closed when connected', /!portalEnabled_\(\) && String\(mobile\)\.trim\(\) === "Main"/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
});

console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
