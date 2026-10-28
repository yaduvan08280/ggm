// Profile photos: the hub stores them (Photos tab), lists them for apps with every
// name a person is known by, and apps fetch + cache them over the signed channel.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };

/* ---------------- hub ---------------- */
const tabs = {};
function sheet(name) {
  const g = () => tabs[name];
  return {
    getRange: (r, c, nr, nc) => ({
      getValues: () => g().slice(r - 1, r - 1 + (nr || 1)).map(x => { const y = x.slice(c - 1, c - 1 + (nc || 1)); while (y.length < (nc || 1)) y.push(''); return y; }),
      setValues: v => { while (g().length < r - 1 + v.length) g().push([]); v.forEach((x, i) => x.forEach((y, j) => { g()[r - 1 + i][c - 1 + j] = y; })); return { setFontWeight: () => {} }; },
      setFontWeight: () => {}
    }),
    getLastRow: () => g().length, deleteRow: r => g().splice(r - 1, 1),
    setFrozenRows: () => {}, hideSheet: () => {}
  };
}
const book = { getSheetByName: n => (tabs[n] ? sheet(n) : null), insertSheet: n => { tabs[n] = []; return sheet(n); } };
const cacheBox = {}, props = {}; const logs = [];
const cache = { get: k => (k in cacheBox ? cacheBox[k] : null), getAll: ks => { const o = {}; ks.forEach(k => { if (k in cacheBox) o[k] = cacheBox[k]; }); return o; },
  putAll: o => Object.assign(cacheBox, o), put: (k, v) => { cacheBox[k] = v; }, remove: k => { delete cacheBox[k]; } };
const hub = vm.createContext({ console, JSON, Math, Date, String, Number, Object, Array, parseInt,
  CacheService: { getScriptCache: () => cache },
  book_: () => book, props_: () => ({ setProperty: (k, v) => { props[k] = v; } }), PROPS_: null,
  prop_: k => props[k] || '',
  requireSession_: s => { if (!s) throw new Error('SESSION_EXPIRED'); return { username: s }; },
  withLock_: fn => fn(), log_: (...a) => logs.push(a),
  allUsers_: () => [{ username: 'harshit', name: 'Harshit Jain', active: true }, { username: 'gajendra', name: 'Gajendra Meena', active: true }, { username: 'old', name: 'Old Guy', active: false }],
  accessMap_: () => ({ harshit: { FUEL: { doer: '' }, TONK_TASKS: { doer: 'HARSHIT J' } }, gajendra: {} }),
  values_: () => [['Username', 'App ID', 'Local Username', 'App Role'], ['harshit', 'ASSETS', 'harshit@ggminerals.com', ''], ['gajendra', 'STAFF', 'Gajju', '']],
  TABS: { LOGINS: {} }, L: { USER: 0, APP: 1, LOCAL: 2, ROLE: 3 } });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'main hub app', 'Photos.js'), 'utf8'), hub);
const H = c => vm.runInContext(c, hub);
const img = n => 'data:image/jpeg;base64,' + 'A'.repeat(n);

let threw = '';
try { H(`savePhoto('harshit', 'javascript:alert(1)', '${img(10)}')`); } catch (e) { threw = e.message; }
t('a non-image is refused', /not a photo/.test(threw));
threw = '';
try { H(`savePhoto('harshit', '${img(10)}', '${img(60000)}')`); } catch (e) { threw = e.message; }
t('an image over one cell is refused', /too large/.test(threw));
threw = '';
try { H(`savePhoto('', '${img(10)}', '${img(10)}')`); } catch (e) { threw = e.message; }
t('needs a portal sign-in', /SESSION_EXPIRED/.test(threw));

const r1 = H(`savePhoto('harshit', '${img(12)}', '${img(40)}')`);
t('saved: Photos tab created with a header and one row', tabs.Photos.length === 2 && tabs.Photos[0][0] === 'Username' && tabs.Photos[1][0] === 'harshit');
t('save bumps the version', r1.ver && props.PHOTOS_VER === r1.ver);
H(`savePhoto('harshit', '${img(14)}', '${img(41)}')`);
t('saving again replaces the row (no duplicate)', tabs.Photos.length === 2 && tabs.Photos[1][1] === img(14));
H(`savePhoto('old', '${img(9)}', '${img(9)}')`);

const list = H('photoList_()');
t('list: only active people', list.length === 1 && list[0].u === 'harshit');
t('list: other names (full name, doer name) but never emails', list[0].n === 'Harshit Jain' && list[0].a.includes('HARSHIT J') && !JSON.stringify(list).includes('@'));
t('list carries the small photo only', list[0].t === img(14) && !JSON.stringify(list).includes(img(41)));
const v = props.PHOTOS_VER;
t('app asks with the current version: nothing re-sent', H(`appPhotos_({ ver: '${v}' })`).same === true);
t('app asks with an old version: full list', H(`appPhotos_({ ver: 'x' })`).list.length === 1);
t('big photo for one person', H(`appPhoto_({ u: 'HARSHIT' })`).p === img(41));
t('signed-in portal user can open anyone\'s big photo', H(`getPhoto('gajendra', 'harshit')`) === img(41));
H(`removePhoto('harshit')`);
t('remove: row gone, version bumped, list empty', tabs.Photos.length === 2 && tabs.Photos[1][0] === 'old' && props.PHOTOS_VER !== v && H('photoList_()').length === 0);

/* ---------------- app connector ---------------- */
const aCache = {}; let hubCalls = 0;
const aProps = { PORTAL_SECRET: 's', PORTAL_APP_ID: 'FUEL', PORTAL_HUB_URL: 'https://script.google.com/a/ggminerals.com/macros/s/AKfycbzOLDTEST/exec' };
const app = vm.createContext({ console, JSON, Math, Date, String, Number, Object, Array, parseInt,
  PropertiesService: { getScriptProperties: () => ({ getProperties: () => Object.assign({}, aProps), setProperty: (k, v) => { aProps[k] = v; } }) },
  CacheService: { getScriptCache: () => ({ get: k => (k in aCache ? aCache[k] : null), getAll: ks => { const o = {}; ks.forEach(k => { if (k in aCache) o[k] = aCache[k]; }); return o; }, putAll: o => Object.assign(aCache, o), put: (k, v) => { aCache[k] = v; } }) },
  Utilities: { base64EncodeWebSafe: s => Buffer.from(s).toString('base64') } });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'portal_connector', 'Portal.js'), 'utf8'), app);
vm.runInContext(`portalCallHub_ = function (op, data) { HUBCALL(); return op === 'photos' ? { ver: 'v9', list: [{ u: 'harshit', n: 'Harshit Jain', a: [], t: 'T' }] } : { p: 'BIG-' + data.u }; }`, Object.assign(app, { HUBCALL: () => hubCalls++ }));
const A = c => vm.runInContext(c, app);
const p1 = A(`portalPhotos('')`);
t('app: first call fetches from the hub', hubCalls === 1 && p1.ver === 'v9' && p1.list[0].u === 'harshit');
const p2 = A(`portalPhotos('')`);
t('app: next call within 5 min comes from its cache', hubCalls === 1 && p2.list.length === 1);
t('app: page already has this version -> tiny "same" answer', A(`portalPhotos('v9')`).same === true);
t('app: big photo fetched once, then cached', A(`portalPhoto('Harshit', 'v9')`) === 'BIG-harshit' && A(`portalPhoto('harshit', 'v9')`) === 'BIG-harshit' && hubCalls === 2);
t('kit source has no closing script tag inside', A('portalPhotoKit_.toString()').indexOf('</script') < 0);

/* ---------------- stale hub address corrects itself ---------------- */
const LIVE = 'https://script.google.com/macros/s/AKfycbyWO02yOI3G9IcE1QjCMEvvJostJZL7_2o8DSYIMEswCtI9Ub8sI9uBTdMp_Zd0WSXvSQ/exec';
A(`portalLearnHubUrl_('https://evil.example.com/exec')`);
t('a non-Google address is ignored', /AKfycbzOLDTEST/.test(aProps.PORTAL_HUB_URL));
A(`portalLearnHubUrl_('${LIVE}')`);
t('the live hub address sent by the hub replaces the stale one', aProps.PORTAL_HUB_URL === LIVE);
t('and the "Go to portal" link follows it', A('portalHubLink_()') === LIVE + '?app=FUEL');
t('the app learns it from every signed hub request', /portalLearnHubUrl_\(msg\.hub\)/.test(fs.readFileSync(path.join(ROOT, 'portal_connector', 'Portal.js'), 'utf8')));
const hubSrc = fs.readFileSync(path.join(ROOT, 'main hub app', 'Code.js'), 'utf8');
t('the hub signs its live address into every request to an app', /hub: hubUrl_\(\)/.test(hubSrc) && hubSrc.indexOf("const hubUrl = hubUrl_();") > -1 && hubSrc.indexOf('ScriptApp.getService().getUrl()') < 0);

t('hub keeps the space in App IDs like "MAIN ADMIN" when an app calls it', hubSrc.indexOf("String(body.app || '').replace(/[^A-Za-z0-9 _-]/g, '').trim()") > -1);

/* ---------------- v2 apps (Task Delegation): photos arrive as a tab in their own sheet ---------------- */
const kitOf = src => { const i = src.indexOf('function portalPhotoKit_()'); return src.slice(i).replace(/\r\n/g, '\n').trim(); };
const ggmSrc = fs.readFileSync(path.join(ROOT, 'portal_connector', 'GgmLogin.js'), 'utf8');
t('v2 login carries the exact same page script as Portal.js', kitOf(ggmSrc) === kitOf(fs.readFileSync(path.join(ROOT, 'portal_connector', 'Portal.js'), 'utf8')));
t('Task Delegation has the master copy of the v2 login', fs.readFileSync(path.join(ROOT, 'task delegation', 'GgmLogin.js'), 'utf8').replace(/\r\n/g, '\n') === ggmSrc.replace(/\r\n/g, '\n'));
t('v2 pages get the script injected', /GGM_CLIENT_ \+ portalPhotoTag_\(\)/.test(ggmSrc));

// hub writes the tab
const v2book = {}; const v2sheet = name => ({
  getRange: (r, c, nr, nc) => ({
    setNumberFormat() { return this; }, setFontWeight() { return this; }, setBackground() { return this; }, setNote() { return this; },
    setValues: v => { const g = v2book[name]; v.forEach((row, i) => row.forEach((x, j) => { (g[r - 1 + i] = g[r - 1 + i] || [])[c - 1 + j] = x; })); },
    setValue: x => { const g = v2book[name]; (g[r - 1] = g[r - 1] || [])[c - 1] = x; },
    getValue: () => ((v2book[name][r - 1] || [])[c - 1]),
    getValues: () => v2book[name].slice(r - 1, r - 1 + nr).map(x => { const y = (x || []).slice(c - 1, c - 1 + nc); while (y.length < nc) y.push(''); return y; })
  }),
  getLastRow: () => v2book[name].filter(r => r && r.some(Boolean)).length, getMaxRows: () => 1000, insertRowsAfter() {},
  setFrozenRows() {}, hideSheet() {}, getProtections: () => [1]
});
const v2ss = { getSheetByName: n => (v2book[n] ? v2sheet(n) : null), insertSheet: n => { v2book[n] = []; return v2sheet(n); } };
let v2writes = 0;
Object.assign(hub, { SpreadsheetApp: { openById: () => { v2writes++; return v2ss; }, ProtectionType: { SHEET: 'S' } }, Session: { getEffectiveUser: () => 'me' },
  directApps_: () => [{ id: 'DELEGATION', sheetId: 'X', active: true }] });
H(`savePhoto('harshit', '${img(15)}', '${img(42)}')`);
H('syncPhotoTabs_()');
const tab = v2book['Portal Photos DELEGATION'];
t('hub writes "Portal Photos DELEGATION": header + one person, small and big photo, version in F1',
  tab && tab[0][0] === 'Username' && tab[1][0] === 'harshit' && tab[1][3] === img(15) && tab[1][4] === img(42) && tab[0][5] === props.PHOTOS_VER);
const w1 = v2writes; H('syncPhotoTabs_()');
t('nothing rewritten while the photos have not changed', v2writes === w1);

// the v2 app reads it
const g = vm.createContext({ console, JSON, Math, Date, String, Number, Object, Array, parseInt,
  GGM_APP: { id: 'DELEGATION', sheetId: 'X' },
  SpreadsheetApp: { openById: () => v2ss, getActiveSpreadsheet: () => v2ss },
  CacheService: { getScriptCache: () => ({ get: () => null, getAll: () => ({}), putAll: () => {}, put: () => {} }) },
  Utilities: { base64EncodeWebSafe: s => Buffer.from(s).toString('base64') } });
vm.runInContext(ggmSrc, g);
const gl = vm.runInContext(`portalPhotos('')`, g);
t('v2 app lists the photo with the name and other names', gl.ver === props.PHOTOS_VER && gl.list.length === 1 && gl.list[0].u === 'harshit' && gl.list[0].a.includes('HARSHIT J'));
t('v2 app answers "same" when the page is up to date', vm.runInContext(`portalPhotos('${props.PHOTOS_VER}')`, g).same === true);
t('v2 app gives the big photo on tap', vm.runInContext(`portalPhoto('Harshit', 'x')`, g) === img(42));

console.log(ok + ' passed, ' + bad + ' failed');
process.exit(bad ? 1 : 0);
