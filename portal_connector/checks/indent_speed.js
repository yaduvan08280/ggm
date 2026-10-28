// Indent Flow: who works each step (Settings), the cross-request caches, the
// row guard, Telegram sent after the lock, and the batched stock sweep.
// Runs the real server files against an in-memory spreadsheet.
const vm = require('vm'), fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', '..', 'indent_flow');
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(String(e.message || e)); } };

/* ---------------- fake Apps Script ---------------- */
const book = {};            // tab -> 2D array (row 0 = header)
const calls = { read: 0, write: 0 };
function mkSheet(name) {
  const g = () => book[name];
  const width = () => Math.max(0, ...g().map(r => r.length));
  const pad = (r, c) => { while (g().length < r) g().push([]); g().forEach(row => { while (row.length < c) row.push(''); }); };
  const range = (r, c, nr, nc) => ({
    getValues: () => { calls.read++; pad(r + nr - 1, c + nc - 1); return g().slice(r - 1, r - 1 + nr).map(row => row.slice(c - 1, c - 1 + nc)); },
    setValues: v => { calls.write++; pad(r + nr - 1, c + nc - 1); v.forEach((row, i) => row.forEach((x, j) => { g()[r - 1 + i][c - 1 + j] = x; })); },
    setValue: x => { calls.write++; pad(r, c); g()[r - 1][c - 1] = x; },
    createTextFinder: txt => ({ matchEntireCell() { return this; }, findAll() {
      calls.find = (calls.find || 0) + 1; const out = [];
      for (let i = r - 1; i < Math.min(g().length, r - 1 + nr); i++)
        for (let j = c - 1; j < c - 1 + nc; j++)
          if (String(g()[i][j] == null ? '' : g()[i][j]).toLowerCase() === String(txt).toLowerCase()) out.push({ getRow: () => i + 1 });
      return out; } })
  });
  const lastRow = () => { let n = g().length; while (n && g()[n - 1].every(x => x === '' || x == null)) n--; return n; };
  return {
    getName: () => name,
    getLastRow: lastRow,
    getLastColumn: () => width(),
    getRange: (r, c, nr, nc) => range(r, c, nr || 1, nc || 1),
    getDataRange: () => range(1, 1, Math.max(1, lastRow()), Math.max(1, width())),
    appendRow: row => { calls.write++; g().splice(lastRow(), 0, row.slice()); },
    deleteRow: r => { calls.write++; g().splice(r - 1, 1); },
    setFrozenRows: () => {}
  };
}
const cacheStore = {};
const ctx = vm.createContext({
  calls, console, JSON, Math, Date, String, Number, Object, Array, Boolean, RegExp, Error, isNaN, isFinite, parseInt, parseFloat,
  SpreadsheetApp: { getActiveSpreadsheet: () => ({
    getSheetByName: n => book[n] ? mkSheet(n) : null,
    insertSheet: n => { book[n] = []; return mkSheet(n); } }) },
  CacheService: { getScriptCache: () => ({
    get: k => (k in cacheStore ? cacheStore[k] : null),
    getAll: ks => { const o = {}; ks.forEach(k => { if (k in cacheStore) o[k] = cacheStore[k]; }); return o; },
    put: (k, v) => { cacheStore[k] = String(v); }, putAll: o => Object.assign(cacheStore, o), remove: k => { delete cacheStore[k]; } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, getProperties: () => ({}) }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => { ctx.__unlocked = (ctx.__unlocked || 0) + 1; } }) },
  Utilities: { getUuid: () => Math.random().toString(16).slice(2), formatDate: d => String(d),
               computeDigest: () => [1, 2, 3], DigestAlgorithm: {}, Charset: {} },
  UrlFetchApp: { fetchAll: reqs => { ctx.__sentInLock = ctx.__lockDepthAtSend; return reqs.map(() => ({ getContentText: () => '{"ok":true}' })); } },
  HtmlService: {}, ContentService: {}, ScriptApp: {}
});
fs.readdirSync(DIR).filter(f => f.endsWith('.js')).sort().forEach(f => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx, { filename: f }));
const R = c => vm.runInContext(c, ctx);
const fresh = () => R('memoClear_(); _STAMPS = {}; _STAGE_ROLES = null; _TAT_MEMO = null; _RED_MINS = null;');

/* ---------------- data ---------------- */
const S = R('SCHEMA');
const rowOf = (tab, o) => S[tab].map(h => (o[h] === undefined ? '' : o[h]));
book.Users = [S.Users,
  rowOf('Users', { User_ID: 'ADM', Name: 'Admin', Role: 'ADMIN', Site: 'ALL', Active: 'TRUE' }),
  rowOf('Users', { User_ID: 'ST1', Name: 'Store Tonk', Role: 'STORE', Site: 'TONK', Active: 'TRUE', Telegram_Chat_ID: '11' }),
  rowOf('Users', { User_ID: 'PU1', Name: 'Purchase One', Role: 'PURCHASE', Site: 'ALL', Active: 'TRUE', Telegram_Chat_ID: '22' }),
  rowOf('Users', { User_ID: 'PC1', Name: 'Coord', Role: 'PC', Site: 'ALL', Active: 'TRUE' })];
book.Settings = [S.Settings, ['TELEGRAM_ENABLED', 'TRUE', ''], ['ALERT_RED_HOURS', '24', '']];
book.Sessions = [S.Sessions, ['tok-st', 'ST1', 'STORE', new Date(), new Date(Date.now() + 3600e3)],
                 ['tok-pu', 'PU1', 'PURCHASE', new Date(), new Date(Date.now() + 3600e3)],
                 ['tok-adm', 'ADM', 'ADMIN', new Date(), new Date(Date.now() + 3600e3)]];
book.Indents = [S.Indents, rowOf('Indents', { Indent_ID: 'IND-001', Site: 'TONK', Part_Name: 'Bearing', Quantity: 4,
  Current_Stage: 'RECEIVE_CHECK', Status: 'IN_TRANSIT', Destination_Type: 'VIA_HUB', Requester_ID: 'U9', Created_At: new Date() })];
['Notifications', 'Stage_Timings', 'History', 'Stock_Logs', 'Attachments'].forEach(n => { book[n] = [S[n]]; });
R(`tgToken_ = function(){ return 'x'; }; appUrl_ = function(){ return ''; }; notifyText_ = function(){ return 'hi'; };`);

/* ---------------- 1. step 7 name, defaults ---------------- */
fresh();
t('step 7 is now "Receive & Check Jaipur"', R(`stageByKey_('RECEIVE_CHECK').name`) === 'Receive & Check Jaipur');
const ind = () => R(`findBy_(SH.INDENTS, 'Indent_ID', 'IND-001')`);
const user = id => R(`findBy_(SH.USERS, 'User_ID', '${id}')`);
t('default: store (own site) can act on step 7', R(`canActOn_(findBy_(SH.USERS,'User_ID','ST1'), findBy_(SH.INDENTS,'Indent_ID','IND-001'))`) === true);
t('default: purchase cannot act on step 7', R(`canActOn_(findBy_(SH.USERS,'User_ID','PU1'), findBy_(SH.INDENTS,'Indent_ID','IND-001'))`) === false);
t('default: purchase still works step 8 (as before)', JSON.stringify(R(`stageRoles_(stageByKey_('SEND_TO_STATION'))`)) === '["STORE","PURCHASE"]');
t('purchase refused at receiveCheck by default', throws(() => R(`receiveCheck_('tok-pu', { indentId:'IND-001', qcResult:'PERFECT', receivedQty:4 })`), /does not work the "Receive & Check Jaipur" step/));

/* ---------------- 2. admin gives steps 7 and 8 to purchase ---------------- */
fresh();
R(`saveStages_('tok-adm', { tat: { RECEIVE_CHECK: 32 }, roles: {
  STORE_VERIFY:['STORE'], PURCHASE_MODE:['PURCHASE'], ADMIN_APPROVAL:[], SET_ETA:['PURCHASE'], FOLLOW_UP:['PURCHASE','PC'],
  RECEIVE_CHECK:['STORE','PURCHASE'], SEND_TO_STATION:['STORE','PURCHASE'], PLANT_RECEIVE:['STORE'] } })`);
t('saved as STAGE_ROLES_JSON in Settings', book.Settings.some(r => r[0] === 'STAGE_ROLES_JSON' && /RECEIVE_CHECK/.test(r[1])));
fresh();
t('now purchase can act on step 7', R(`canActOn_(findBy_(SH.USERS,'User_ID','PU1'), findBy_(SH.INDENTS,'Indent_ID','IND-001'))`) === true);
t('approval with no extra team stays the admin\'s', JSON.stringify(R(`stageRoles_(stageByKey_('ADMIN_APPROVAL'))`)) === '["ADMIN"]');
t('the browser gets roles per step', JSON.stringify(R(`stagesOut_().filter(function(s){return s.key==='RECEIVE_CHECK';})[0].roles`)) === '["STORE","PURCHASE"]');
t('a step with no team is refused', throws(() => R(`saveStages_('tok-adm', { roles: { RECEIVE_CHECK: [] } })`), /needs at least one team/));
t('the old raw-setting route cannot change it', throws(() => R(`saveSetting_('tok-adm', { key:'STAGE_ROLES_JSON', value:'{}' })`), /Settings screen/));
t('non-admin cannot save steps', throws(() => R(`saveStages_('tok-st', { roles: {} })`), /not allowed/));

/* ---------------- 3. purchase does step 7; Telegram goes out after the lock ---------------- */
fresh();
R(`(function(){ var orig = tgSendMany_; tgSendMany_ = function(){ __lockDepthAtSend = _LOCK_DEPTH; return orig.apply(null, arguments); }; })()`);
const res = R(`receiveCheck_('tok-pu', { indentId:'IND-001', qcResult:'PERFECT', receivedQty:4 })`);
fresh();
t('purchase completed step 7 → indent at step 8', res.nextStage === 'SEND_TO_STATION' && ind().Current_Stage === 'SEND_TO_STATION');
t('Telegram was sent after the lock was released', ctx.__sentInLock === 0);
const ntf = book.Notifications.slice(1);
t('"received at hub" went to the owners of step 8 (store + purchase), not the sender', ntf.length >= 1 && ntf.every(r => r[2] === 'RECEIVED_AT_HUB') && ntf.some(r => r[5] === 'ST1') && !ntf.some(r => r[5] === 'PU1'));

/* ---------------- 4. hot-tab cache: one sheet read, then none ---------------- */
cacheStore['s_tok-st'] = JSON.stringify({ u: 'ST1', r: 'STORE' });   // as a real sign-in leaves it
fresh(); R(`touchTab_(SH.USERS); _TOUCHED = {}`);                    // start from an empty Users cache
fresh(); calls.read = 0;
R(`requireAuth_('tok-st')`);
const first = calls.read;
fresh(); calls.read = 0;
R(`requireAuth_('tok-st')`);
t('signed-in check: Users comes from the cache on the next request (' + first + ' read → ' + calls.read + ')', first >= 1 && calls.read <= first - 1);
fresh();
R(`update_(SH.USERS, findBy_(SH.USERS,'User_ID','ST1').__row, { Name: 'Store Tonk Renamed' })`);
R(`bumpIfDirty_()`);
fresh();
t('a write through the app is seen at once by the next request', user('ST1').Name === 'Store Tonk Renamed');
t('cached dates come back as dates', R(`findBy_(SH.SESSIONS,'Token','tok-st').Expires_At instanceof Date`) &&
  (function(){ fresh(); R(`readAll_(SH.USERS)`); fresh(); return true; })());

/* ---------------- 5. row guard: a row moved by hand cannot take a write ---------------- */
fresh(); R(`readAll_(SH.USERS)`);          // fill cache
book.Users.splice(1, 1);                   // somebody deletes the Admin row in the sheet by hand
fresh();
const st1 = user('ST1');                   // cached copy still says row 3
t('a stale cached row number is refused, not written to the wrong person', throws(() => R(`update_(SH.USERS, ${st1.__row}, { Language: 'HI' })`), /changed by hand/));
t('…and nobody else was touched', book.Users.every(r => r[S.Users.indexOf('Language')] !== 'HI'));
fresh();
t('…and the next read is fresh again', user('ST1').__row === 2);

/* ---------------- 6. sessions are not data ---------------- */
fresh(); R(`_DIRTY = false; insert_(SH.SESSIONS, { Token:'x', User_ID:'ST1' })`);
t('a new session does not make every screen reload', R('_DIRTY') === false);
fresh(); R(`_DIRTY = false; insert_(SH.HISTORY, { Log_ID:'L1' })`);
t('a real change still does', R('_DIRTY') === true);

/* ---------------- 7. stock sweep: one write per changed column, no reload ---------------- */
const inv = R('INVENTORY_COLUMNS');
const invRow = o => inv.map(h => (o[h] === undefined ? '' : o[h]));
R(`siteList_ = function(){ return ['TONK']; }`);
book.INV_TONK = [inv.slice(),
  invRow({ Item_Name: 'Bearing', Active: 'TRUE', Initial_Stock: 10, Current_Stock: 10, Total_IN: 0, Total_OUT: 0, Reorder_Point: 0, Notes: 'keep me' }),
  invRow({ Item_Name: 'Belt', Active: 'TRUE', Initial_Stock: 5, Current_Stock: 5, Total_IN: 0, Total_OUT: 0, Reorder_Point: 0 })];
book.Stock_Logs = [S.Stock_Logs, rowOf('Stock_Logs', { Product_Name: 'Bearing', Quantity: -3, Transaction_Type: 'ISSUED', Site: 'TONK', Moves_Stock: 'Y' })];
fresh(); calls.write = 0; R('_DIRTY = false');
const fixed = R('stockSweep()');
const col = h => inv.indexOf(h);
t('sweep fixed the one item that moved', fixed === 1 && book.INV_TONK[1][col('Current_Stock')] === 7 && book.INV_TONK[1][col('Total_OUT')] === 3);
t('the other item and other columns are untouched', book.INV_TONK[2][col('Current_Stock')] === 5 && book.INV_TONK[1][col('Notes')] === 'keep me');
t('two column writes, not one per row (' + calls.write + ')', calls.write === 2);
t('sweep does not make open screens reload', R('_DIRTY') === false);
fresh(); calls.write = 0; R('stockSweep()');
t('a second sweep with nothing to fix writes nothing', calls.write === 0);

/* ---------------- 8. one indent's timing rows without reading the whole tab ---------------- */
const SK = R('STAGES').map(x => x.key);
book.Stage_Timings = [S.Stage_Timings];
for (let n = 1; n <= 300; n++) {                     // 300 older indents, 10 rows each
  SK.forEach((k, i) => book.Stage_Timings.push(rowOf('Stage_Timings', { Row_ID: 'IND-' + n + '#' + k, Indent_ID: 'IND-' + n, Stage_No: i + 1, Stage_Key: k, Status: 'DONE' })));
}
fresh();
const viaFull = R(`readWhere_(SH.STAGES, function(r){ return String(r.Indent_ID) === 'IND-150'; }).map(function(r){ return r.__row + r.Stage_Key; }).join()`);
fresh(); calls.read = 0;
const viaFind = R(`stageRowsFor_('IND-150').map(function(r){ return r.__row + r.Stage_Key; }).join()`);
t('same ten rows, same row numbers, as reading the whole tab', viaFind === viaFull && viaFind.split(',').length === 10);
t('IND-15 is not mixed up with IND-150', R(`stageRowsFor_('IND-15').length`) === 10 && R(`stageRowsFor_('IND-15')[0].Indent_ID`) === 'IND-15');
fresh(); calls.read = 0; R(`stageRowsFor_('IND-7')`);
t('reads a 10-row block, not 3000 rows', calls.read <= 2);
fresh();
const r7 = R(`stageRow_('IND-200', 'SET_ETA')`);
t('one step row found with its sheet row number', r7 && r7.Stage_Key === 'SET_ETA' && book.Stage_Timings[r7.__row - 1][1] === 'IND-200');
fresh(); R(`update_(SH.STAGES, stageRow_('IND-200','SET_ETA').__row, { Note: 'hello' })`);
t('a write lands on exactly that row', book.Stage_Timings[r7.__row - 1][S.Stage_Timings.indexOf('Note')] === 'hello');
t('an indent with no rows gives none', R(`stageRowsFor_('IND-9999').length`) === 0);

/* ---------------- 9. raising a new indent end to end ---------------- */
book.Users.push(rowOf('Users', { User_ID: 'U9', Name: 'Fitter', Role: 'USER', Site: 'TONK', Active: 'TRUE' }));
book.Sessions.push(['tok-u9', 'U9', 'USER', new Date(), new Date(Date.now() + 3600e3)]);
book.Sites = [S.Sites, ['TONK', 'TRUE']];
book.Sections = [S.Sections, ['TONK', 'CRUSHER', 'TRUE']];
fresh(); R('_TOUCHED = {}; touchTab_(SH.USERS); touchTab_(SH.SITES); touchTab_(SH.SECTIONS); _TOUCHED = {}');
let made = null, why = '';
try { fresh(); made = R(`createIndent_('tok-u9', { partName:'V-Belt', quantity:2, unit:'NOS', site:'TONK', section:'CRUSHER', description:'test' })`); }
catch (e) { why = e.message; }
fresh();
const newId = made && (made.indentId || made.id);
const rowsNew = newId ? R(`stageRowsFor_('${newId}')`) : [];
t('a new indent is raised (' + (newId || why) + ')', !!newId);
t('its ten timing rows are found straight after being written', rowsNew.length === 10);
t('step 2 is open and waiting (store verification)', rowsNew.length && rowsNew[1].Status === 'PENDING' && rowsNew[0].Status === 'DONE');

/* ---------------- 10. the read screens still answer ---------------- */
['Item_Requests', 'Transfers', 'Quotations', 'Followups', 'Reminders', 'Vendors'].forEach(n => { if (!book[n]) book[n] = [S[n]]; });
book.Users.push(rowOf('Users', { User_ID: 'ADM', Name: 'Admin', Role: 'ADMIN', Site: 'ALL', Active: 'TRUE' }));   // removed by hand in section 5
fresh(); R('touchTab_(SH.USERS); _TOUCHED = {}');
const smoke = (label, code, check) => { try { fresh(); const v = R(code); t(label, check(v)); } catch (e) { t(label + ' — ' + e.message, false); } };
smoke('admin dashboard', `dashboard_('tok-adm')`, d => d.counts.total >= 2 && typeof d.counts.reorder === 'number');
smoke('dashboard again: reorder count comes from the cache', `(function(){ calls.read = 0; memoClear_(); _STAMPS = {}; dashboardFresh_(requireAuth_('tok-adm')); return calls.read; })()`, n => n < 6);
smoke('store queue list', `listIndents_('tok-st', { scope:'MY_QUEUE' })`, d => Array.isArray(d.rows));
smoke('indent detail with the timeline and who works each step', `getIndent_('tok-adm', '${newId}')`,
  d => d.timeline.length === 10 && JSON.stringify(d.timeline[6].ownerRoles) === '["STORE","PURCHASE"]' && d.indent.id === newId);
smoke('process-coordinator board', `pcBoard_('tok-adm', {})`, d => Array.isArray(d.rows));
smoke('menus for the browser carry the step owners', `masters_('tok-adm')`, m => m.stages[6].name === 'Receive & Check Jaipur' && m.stageRoleChoices.length === 3);

/* ---------------- 11. admin "Waiting on me" = step 4 only ---------------- */
const mk = (id, stage, status, site) => rowOf('Indents', { Indent_ID: id, Site: site || 'TONK', Part_Name: 'X', Quantity: 1,
  Current_Stage: stage, Status: status, Requester_ID: 'U9', Created_At: new Date() });
book.Indents = [S.Indents,
  mk('A-1', 'ADMIN_APPROVAL', 'PENDING_ADMIN_APPROVAL'), mk('A-2', 'ADMIN_APPROVAL', 'PENDING_ADMIN_APPROVAL', 'NEWAI'),
  mk('A-3', 'STORE_VERIFY', 'PENDING_STORE_VERIFICATION'), mk('A-4', 'PURCHASE_MODE', 'SENT_TO_PURCHASE'),
  mk('A-5', 'RECEIVE_CHECK', 'IN_TRANSIT'), mk('A-6', 'CLOSED', 'COMPLETED')];
fresh(); cacheStore['DATA_VERSION'] = String(Date.now());
const dAdm = R(`dashboardFresh_(requireAuth_('tok-adm'))`);
t('admin "Waiting on me" counts only the 2 at Admin Approval (not all 5 open)', dAdm.counts.myQueue === 2 && dAdm.counts.active === 5);
fresh();
const qAdm = R(`listIndentsFresh_(requireAuth_('tok-adm'), { scope:'MY_QUEUE' })`);
t('the Approvals list shows the same 2', qAdm.total === 2 && qAdm.rows.every(r => r.currentStage === 'ADMIN_APPROVAL'));
t('the admin can still act on every open indent', qAdm.rows.length === 2 &&
  R(`listIndentsFresh_(requireAuth_('tok-adm'), { scope:'ACTIVE' })`).rows.every(r => r.canAct));
fresh();
t('store queue unchanged: its own site, its own steps (store verify + receive)', R(`dashboardFresh_(requireAuth_('tok-st'))`).counts.myQueue === 2);
fresh();
t('purchase queue unchanged (purchase step + receive, given in section 2)', R(`dashboardFresh_(requireAuth_('tok-pu'))`).counts.myQueue === 2);
fresh();
t('portal tile number for the admin: step 4 only', R(`portalIndentCounts_([{ u:'nikhil', lu:'ADM' }])`).nikhil === 2);

/* ---------------- 12. stock movements reach the site's IMS sheet (restored v19 feature) ---------------- */
const ims = { 'In/Out (Form)': [['Sr', 'Date', 'Type', 'Item', 'Qty', '', 'Remark']], 'Item List': [['SKU', 'Name'], ['SKU-77', 'Bearing 6205']] };
let imsDepth = null;
ctx.SpreadsheetApp.openById = id => ({ getSheetByName: n => !ims[n] ? null : {
  getLastRow: () => ims[n].length, getRange: (r, c) => ({ getValue: () => ims[n][r - 1][c - 1] }),
  getDataRange: () => ({ getValues: () => ims[n].map(x => x.slice()) }),
  appendRow: row => { imsDepth = R('_LOCK_DEPTH'); ims[n].push(row); } } });
const out = ims['In/Out (Form)'];
fresh();
R(`withLock_(function () { logStock_('TONK', 'IND-9', 'Bearing 6205', 'P-1', -3, 'ISSUED', '', null, 'issued to fitter', true, 'Ram'); })`);
t('push is OFF by default: nothing written to IMS (staff fill it by hand)', out.length === 1);
book.Settings.push(['IMS_PUSH_ENABLED', 'TRUE', '']); fresh(); R('touchTab_(SH.SETTINGS); _TOUCHED = {}');
fresh();
R(`withLock_(function () { logStock_('TONK', 'IND-9', 'Bearing 6205', 'P-1', -3, 'ISSUED', '', null, 'issued to fitter', true, 'Ram'); })`);
t('switched on: an issue at TONK writes one "Out" row to the TONK IMS sheet', out.length === 2 && out[1][2] === 'Out' && out[1][4] === 3);
t('…with the SKU matched from the IMS item list', out[1][3] === 'SKU-77 - Bearing 6205' && out[1][0] === 1);
t('…written after the write lock was released', imsDepth === 0);
fresh(); R(`withLock_(function () { logStock_('TONK', 'IND-9', 'Bearing 6205', 'P-1', 3, 'RECEIVED_AT_HUB', '', null, 'hub count', false, ''); })`);
t('a hub checkpoint (no shelf movement) is not pushed', out.length === 2);
fresh();
try { R(`withLock_(function () { logStock_('TONK', 'IND-9', 'Bearing 6205', 'P-1', 5, 'RECEIVED_AT_PLANT', '', null, '', true, ''); throw new Error('boom'); })`); } catch (e) {}
t('nothing is pushed if the save itself fails', out.length === 2);

console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
