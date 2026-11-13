// Portal language: the English / Hindi choice is saved on the user's row, rides in every
// launch pass, reaches the page as PORTAL.boot.lang, and each app applies it.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ---------- hub ---------- */
const hubSrc = read('main hub app/Code.js');
const users = [['Username'], ['rajpal', 'Rajpal', '', true, '', 'hash', 'salt', '', '', '', '', '', false, '', 'Hindi'], ['nikhil', 'Nikhil', '', true, '', 'hash', 'salt']];
const cells = {};
const hub = vm.createContext({ console, JSON, String, Object, Array, Math, Date,
  Utilities: { getUuid: () => 'u' } });
vm.runInContext(hubSrc, hub);
vm.runInContext(`
  values_ = function () { return USERS; };
  sheet_ = function () { return { getRange: function (r, c) { return { getValue: function () { return CELLS[r + ',' + c] || (r === 1 ? '' : ''); }, setValue: function (v) { CELLS[r + ',' + c] = v; return { setFontWeight: function () {} }; } }; } }; };
  withLock_ = function (fn) { return fn(); }; forgetTabs_ = function () {}; log_ = function () {};
  requireSession_ = function (s) { var u = findUser_(s, true); if (!u) throw new Error('SESSION_EXPIRED'); return u; };
  getLocalLogin_ = function () { return {}; }; localIdFor_ = function (u) { return u.username; };`, Object.assign(hub, { USERS: users, CELLS: cells }));
const H = c => vm.runInContext(c, hub);
t('Users row "Hindi" is read as hi, empty as en', H(`findUser_('rajpal', true).lang`) === 'hi' && H(`findUser_('nikhil', true).lang`) === 'en');
t('launch pass carries the language', H(`claimsFor_(findUser_('rajpal', true), { id: 'FUEL' }, { role: '', site: '', doer: '' }).lg`) === 'hi');
const r = H(`setLanguage('nikhil', 'hi')`);
t('switch saved on the person\'s row (column O) with a header', r.lang === 'hi' && cells['3,15'] === 'Hindi' && cells['1,15'] === 'Language');
H(`setLanguage('nikhil', 'xx')`);
t('anything but hi saves English', cells['3,15'] === 'English');
t('Users tab gains the Language column at the far right', /'Designation', 'Language'\] \}/.test(hubSrc) && /DESIG: 13, LANG: 14/.test(hubSrc));
t('home screen tells the page the saved language', /lang: user\.lang \}, apps: apps/.test(hubSrc));

/* ---------- apps: pass → page ---------- */
const portal = read('portal_connector/Portal.js'), ggm = read('portal_connector/GgmLogin.js');
const kitOf = s => s.slice(s.indexOf('function portalLangOf_')).replace(/\r\n/g, '\n').trim();
t('v2 login carries the exact same language script', kitOf(portal) === kitOf(ggm));
t('every connected app has the master Portal.js', ['Staff_dashboard', 'assets', 'fuel_and_car_tasks', 'indent_flow', 'jaipur_checklist', 'main_admin_dashboard', 'newai_checklist', 'tonk_checklist']
  .every(a => read(a + '/Portal.js') === portal));
t('Task Delegation has the master GgmLogin.js', read('task delegation/GgmLogin.js') === ggm);
t('app gate puts the language on the boot (portal + v2)', /gate\.boot\.lang = portalLangOf_\(claims\)/.test(portal) && /lang: portalLangOf_\(c\)/.test(ggm));
const ctx = vm.createContext({ String });
vm.runInContext(portal.slice(portal.indexOf('function portalLangOf_')), ctx);
t('only hi / en pass through', vm.runInContext(`[portalLangOf_({ lg: 'HI' }), portalLangOf_({ lg: 'en' }), portalLangOf_({ lg: 'fr' }), portalLangOf_({})].join()`, ctx) === 'hi,en,,');

/* ---------- each app ---------- */
t('Fuel switches its own Hindi', /window\.ggmApplyLang = function \(l\) \{ if \(\(l === 'hi'\) !== \(currentLang === 'hi'\)\) toggleLanguage\(\); \}/.test(read('fuel_and_car_tasks/Index.html')));
const ind = read('indent_flow/Scripts.html');
t('Indent: portal language wins at sign-in, both ways in', (ind.match(/setLang\(ggmPortalLang_\(\) \|\|/g) || []).length === 2 && /window\.ggmApplyLang = function\(\)\{\};/.test(ind));
t('Newai switches its own Hindi', /window\.ggmApplyLang = function \(l\) \{ if \(\(localStorage\.getItem\('newaiTasksLang'\)/.test(read('newai_checklist/index.html')));
t('Main Admin flips its own translate switch', /window\.ggmApplyLang = function \(l\) \{[\s\S]*toggleAppLanguage\(\)/.test(read('main_admin_dashboard/Index.html')));
['Staff_dashboard/Index.html', 'assets/Index.html', 'jaipur_checklist/index.html', 'tonk_checklist/index.html', 'task delegation/main.html'].forEach(p =>
  t(p.split('/')[0] + ': no own Hindi → Google page translation', !/ggmApplyLang/.test(read(p))));

/* ---------- hub page ---------- */
const page = read('main hub app/Index.html');
t('hub page: EN/हिं button, menu choice, login switch', (page.match(/class="(rfr|lt) lang-btn"/g) || []).length === 2 && /id="langSeg"/.test(page));
t('hub page: switching drops apps kept open in the old language and saves it', /dropParkedApps\(\);/.test(page) && /run\('setLanguage', session, l\)/.test(page));

console.log(ok + ' passed, ' + bad + ' failed');
process.exit(bad ? 1 : 0);
