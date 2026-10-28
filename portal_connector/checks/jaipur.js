// Jaipur checklist: admin needs no doer; a user can only tick their own task.
const vm = require('vm'), fs = require('fs'), path = require('path');
const doers = [['Ramesh Kumar', 'Store', 'r@x', '9829011111']];
const master = [['Ramesh Kumar', '', '', 'T1'], ['Sita Devi', '', '', 'T2']];   // A doer · D task id
const written = [];
const sheets = {
  'Doer List': { getLastRow: () => doers.length + 1, getRange: () => ({ getValues: () => doers }) },
  'Master': {
    getRange: (a, b) => typeof a === 'string'
      ? { createTextFinder: id => ({ matchEntireCell: () => ({ findNext: () => { const i = master.findIndex(r => r[3] === id); return i < 0 ? null : { getRow: () => i + 2 }; } }) }) }
      : { getValue: () => (b === 1 ? master[a - 2][0] : ''), setValue: v => written.push([a, b, v]) }
  }
};
const ctx = vm.createContext({ String, Object, JSON, Date, Math, Array, Utilities: { formatDate: () => 'now' },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: n => sheets[n] }), flush: () => {} },
  portalNewSession_: c => 'tok:' + JSON.stringify(c), portalCheck_: t => JSON.parse(t.slice(4)), updateMonthlyMaster: () => {} });
const dir = path.join(__dirname, '..', '..', 'jaipur_checklist');
vm.runInContext(fs.readFileSync(path.join(dir, 'PortalApp.js'), 'utf8'), ctx);
const code = fs.readFileSync(path.join(dir, 'Code.js'), 'utf8');
vm.runInContext(code.slice(code.indexOf('function markTaskAsDoneInSheet'), code.indexOf('function checkLogin')), ctx);
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log((c ? 'PASS ' : 'FAIL ') + n); };
const r = c => vm.runInContext(c, ctx);
t('admin starts without a doer name', r(`portalAdapter_().startSession({ u: 'boss', n: 'Boss', r: 'ADMIN' }, 'portal').isAdmin === true`));
t('user must be in the Doer List', r(`try { portalAdapter_().startSession({ u: 'x', d: 'Ghost', r: 'USER' }, 'portal'); false } catch (e) { /Doer List/.test(e.message) }`));
const userTok = r(`portalAdapter_().startSession({ u: 'ramesh.k', d: 'Ramesh Kumar', r: 'USER' }, 'portal').token`);
t('user ticks own task', r(`markTaskAsDoneInSheet(${JSON.stringify(userTok)}, 'T1').success === true`) && written.length > 0);
written.length = 0;
t('user cannot tick someone else\'s task', r(`try { markTaskAsDoneInSheet(${JSON.stringify(userTok)}, 'T2'); false } catch (e) { true }`) && written.length === 0);
t('no session: refused', r(`try { markTaskAsDoneInSheet('', 'T1'); false } catch (e) { e.message === 'SESSION_EXPIRED' }`));
console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
