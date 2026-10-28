// Hub speed paths: batched Settings write, one-call tab prefetch, one-call badges.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ctx = vm.createContext({ console, JSON, Math, Date, String, Number, Object, Array });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'main hub app', 'Code.js'), 'utf8'), ctx);
const st = { settings: [['Setting','Value','Changed By','Changed At'], ['PORTAL_ONLY','OFF','',''], ['MODE · INDENT','OK OFF','','']],
             notes: [], cacheCalls: 0, cache: {}, sheetReads: 0 };
ctx.ST = st;
vm.runInContext(`
  sheet_ = tab => tab.name === 'Settings' ? {
      getDataRange: () => ({ getValues: () => ST.settings.map(r => r.slice()) }),
      getRange: (r, c, nr, nc) => ({ setValues: v => { ST.settings = v.map(x => x.slice()); }, setNote: n => ST.notes.push([r, n]) }) }
    : tab.name === 'Badges' ? { getDataRange: () => { ST.sheetReads++; return { getValues: () => [['App','Counts'], ['FUEL', '{"ramesh.k":3}']] }; } }
    : { getDataRange: () => { ST.sheetReads++; return { getValues: () => [['h']] }; } };
  CacheService = { getScriptCache: () => ({
    getAll: keys => { ST.cacheCalls++; const o = {}; keys.forEach(k => { if (ST.cache[k]) o[k] = ST.cache[k]; }); return o; },
    get: k => { ST.cacheCalls++; return ST.cache[k] || null; }, put: () => {}, removeAll: () => {} }) };
  getApps_ = () => [{ id: 'INDENT', badges: true }, { id: 'FUEL', badges: true }, { id: 'MINES', badges: false }];`, ctx);
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
vm.runInContext(`setSettings_([['PORTAL_ONLY','ON','itadmin'], ['MODE · INDENT','PENDING',''], ['MODE · FUEL','PENDING','', 'down']])`, ctx);
t('settings: updated in place', st.settings[1][1] === 'ON' && st.settings[1][2] === 'itadmin' && st.settings[2][1] === 'PENDING');
t('settings: new key appended', st.settings.length === 4 && st.settings[3][0] === 'MODE · FUEL');
t('settings: note on the right row', st.notes.length === 1 && st.notes[0][0] === 4 && st.notes[0][1] === 'down');
st.cache = { tab_Users: '[["Username"],["ramesh.k"]]', tab_Apps: '[["App ID"]]' }; st.cacheCalls = 0; st.sheetReads = 0;
vm.runInContext(`forgetTabs_(); values_(TABS.USERS); values_(TABS.APPS);`, ctx);
t('tabs: two cached tabs = one cache call, no sheet read', st.cacheCalls === 1 && st.sheetReads === 0);
st.cache = { badge_INDENT: '{"ramesh.k":7}' }; st.cacheCalls = 0; st.sheetReads = 0;
const b = vm.runInContext(`readAllBadges_()`, ctx);
t('badges: one cache call + one sheet read for the miss', st.cacheCalls === 1 && st.sheetReads === 1 && b.INDENT['ramesh.k'] === 7 && b.FUEL['ramesh.k'] === 3 && !b.MINES);
t('badges: per-user value with * fallback', vm.runInContext(`badgeFrom_({ '*': 5 }, 'x') === 5 && badgeFrom_({ x: 2, '*': 5 }, 'x') === 2 && badgeFrom_(null, 'x') === null`, ctx));
console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
